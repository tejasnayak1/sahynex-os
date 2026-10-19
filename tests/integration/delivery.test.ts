import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { db, schema } from '@/db';
import {
  createDeliverable,
  decideApproval,
  getDeliverable,
  markPublished,
  submitForInternalReview,
  uploadVersion,
  canAccessAsset,
} from '@/server/services/deliverables';
import { createProject, setMembers } from '@/server/services/projects';
import {
  addDependency,
  createTask,
  getTask,
  listTasks,
  setTaskStatus,
  updateTask,
} from '@/server/services/tasks';
import { drainOrg, makeClient, makeOrg, runWorkflow, type TestOrg } from '../helpers/fixtures';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
let org: TestOrg;
let projectId: string;
let clientId: string;

beforeAll(async () => {
  org = await makeOrg();
  const c = await makeClient(org, 'Delivery Client', org.users.pm.id);
  clientId = c.id;
  const p = await createProject(org.actors.pm, {
    clientId: c.id,
    name: 'Delivery project',
    approvalRequired: 'true',
  });
  projectId = p.id;
  await setMembers(org.actors.pm, p.id, [org.users.designer.id]);
});

describe('task permissions', () => {
  it('employees only see tasks that involve them and cannot reassign or edit others’ tasks', async () => {
    const mine = await createTask(org.actors.pm, { title: 'For employee', ownerId: org.users.employee.id });
    const other = await createTask(org.actors.pm, {
      title: 'For designer',
      ownerId: org.users.designer.id,
      projectId,
    });
    const seen = await listTasks(org.actors.employee, { page: 1, pageSize: 100, dir: 'asc' });
    expect(seen.rows.map((t) => t.id)).toContain(mine.id);
    expect(seen.rows.map((t) => t.id)).not.toContain(other.id);
    await expect(getTask(org.actors.employee, other.id)).rejects.toThrow(/not found/i);
    await expect(setTaskStatus(org.actors.employee, other.id, 'done')).rejects.toThrow(/not found/i);
    await expect(
      updateTask(org.actors.employee, mine.id, { ownerId: org.users.designer.id }),
    ).rejects.toThrow(/permission/);
    await expect(
      createTask(org.actors.employee, { title: 'Sneaky', ownerId: org.users.designer.id }),
    ).rejects.toThrow(/yourself/);
  });

  it('project members see project tasks', async () => {
    const t = await createTask(org.actors.pm, { title: 'Project work', ownerId: org.users.pm.id, projectId });
    const seen = await listTasks(org.actors.designer, { page: 1, pageSize: 100, dir: 'asc', projectId });
    expect(seen.rows.map((x) => x.id)).toContain(t.id);
  });

  it('enforces dependencies, prevents cycles, requires blocker notes and hands off on completion', async () => {
    const a = await createTask(org.actors.pm, { title: 'A', ownerId: org.users.pm.id, projectId });
    const b = await createTask(org.actors.pm, { title: 'B', ownerId: org.users.designer.id, projectId });
    await addDependency(org.actors.pm, b.id, a.id);
    await expect(addDependency(org.actors.pm, a.id, b.id)).rejects.toThrow(/circular/);
    await expect(setTaskStatus(org.actors.designer, b.id, 'in_progress')).rejects.toThrow(/Waiting on/);
    await expect(setTaskStatus(org.actors.pm, a.id, 'blocked')).rejects.toThrow(/blocking/);
    await setTaskStatus(org.actors.pm, a.id, 'done');
    const n = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, org.users.designer.id));
    expect(n.some((x) => x.type === 'task.ready' && x.link === `/tasks/${b.id}`)).toBe(true);
    await setTaskStatus(org.actors.designer, b.id, 'in_progress');
  });

  it('creates the next occurrence of a recurring task exactly once', async () => {
    const t = await createTask(org.actors.pm, {
      title: 'Weekly report',
      ownerId: org.users.pm.id,
      recurrence: 'weekly',
      dueAt: '2026-11-02T10:00',
    });
    await setTaskStatus(org.actors.pm, t.id, 'done');
    await setTaskStatus(org.actors.pm, t.id, 'todo');
    await setTaskStatus(org.actors.pm, t.id, 'done');
    const next = await db.select().from(schema.tasks).where(eq(schema.tasks.recurrenceParentId, t.id));
    expect(next).toHaveLength(1);
  });
});

describe('Workflow 7 — approvals keep version history', () => {
  it('runs internal → client → changes → revision task → v2 → approval, preserving every version', async () => {
    const d = await createDeliverable(org.actors.designer, {
      projectId,
      title: 'Hero poster',
      format: 'poster',
    });
    await expect(submitForInternalReview(org.actors.designer, d.id)).rejects.toThrow(/Upload a version/);
    await uploadVersion(org.actors.designer, d.id, { name: 'poster.png', data: PNG });
    const internal = await submitForInternalReview(org.actors.designer, d.id);
    await drainOrg(org.orgId);
    await expect(decideApproval(org.actors.designer, internal.id, 'approved')).rejects.toThrow(
      /internal reviewer/,
    );
    const r1 = await decideApproval(org.actors.pm, internal.id, 'approved', 'Good');
    expect(r1.status).toBe('submitted_to_client');
    const reviewer = await org.clientReviewer(clientId);
    await expect(decideApproval(reviewer, r1.clientApprovalId!, 'changes_requested')).rejects.toThrow(
      /Describe the changes/,
    );
    await decideApproval(reviewer, r1.clientApprovalId!, 'changes_requested', 'Make the logo bigger');
    await drainOrg(org.orgId);
    const revTask = (await db.select().from(schema.tasks).where(eq(schema.tasks.deliverableId, d.id))).find(
      (t) => t.sourceKey === `revision:${r1.clientApprovalId}`,
    );
    expect(revTask?.ownerId).toBe(org.users.designer.id);
    await uploadVersion(org.actors.designer, d.id, { name: 'poster-v2.png', data: PNG });
    const [taskAfter] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, revTask!.id));
    expect(taskAfter.status).toBe('done');
    const internal2 = await submitForInternalReview(org.actors.designer, d.id);
    const r2 = await decideApproval(org.actors.pm, internal2.id, 'approved', 'ok');
    // A PM can record the client's decision only with a note naming who decided.
    await expect(decideApproval(org.actors.pm, r2.clientApprovalId!, 'approved')).rejects.toThrow(
      /who decided/,
    );
    await decideApproval(reviewer, r2.clientApprovalId!, 'approved');
    await drainOrg(org.orgId);
    const full = await getDeliverable(org.actors.pm, d.id);
    expect(full.deliverable.status).toBe('approved');
    expect(full.deliverable.currentVersion).toBe(2);
    expect(full.deliverable.revisionCount).toBe(1);
    expect(full.versions.map((v) => v.version)).toEqual([2, 1]);
    expect(full.approvals).toHaveLength(4);
    expect(full.revisions[0].toVersion).toBe(2);
    // Nothing is published automatically.
    expect(full.deliverable.publishedAt).toBeNull();
    expect(
      await db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.sourceKey, `publish:${d.id}`)),
    ).toHaveLength(1);
    await markPublished(org.actors.designer, d.id, 'https://instagram.com/p/xyz');
    // Audit trail of decisions exists.
    const audits = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.entityId, d.id));
    expect(audits.filter((a) => a.action.startsWith('approval.')).length).toBe(4);
  });

  it('reminders never approve anything', async () => {
    const d = await createDeliverable(org.actors.designer, {
      projectId,
      title: 'Waiting poster',
      format: 'poster',
    });
    await uploadVersion(org.actors.designer, d.id, { name: 'w.png', data: PNG });
    const ap = await submitForInternalReview(org.actors.designer, d.id);
    await db
      .update(schema.approvals)
      .set({ submittedAt: new Date(Date.now() - 10 * 86400000) })
      .where(eq(schema.approvals.id, ap.id));
    for (let i = 0; i < 6; i++) {
      await runWorkflow(org.orgId, 'approvals.reminders');
      await db
        .update(schema.approvals)
        .set({ lastReminderAt: new Date(Date.now() - 10 * 86400000) })
        .where(eq(schema.approvals.id, ap.id));
    }
    const [after] = await db.select().from(schema.approvals).where(eq(schema.approvals.id, ap.id));
    expect(after.decision).toBe('pending');
    expect((await getDeliverable(org.actors.pm, d.id)).deliverable.status).toBe('internal_review');
  });
});

describe('client isolation', () => {
  it('client reviewers cannot see other clients’ deliverables, unsubmitted work, or internal files', async () => {
    const other = await makeClient(org, 'Other Client');
    const otherProject = await createProject(org.actors.pm, { clientId: other.id, name: 'Other project' });
    const secret = await createDeliverable(org.actors.pm, {
      projectId: otherProject.id,
      title: 'Other client secret',
    });
    const draft = await createDeliverable(org.actors.designer, { projectId, title: 'Unsubmitted draft' });
    const asset = await uploadVersion(org.actors.designer, draft.id, { name: 'draft.png', data: PNG });
    const reviewer = await org.clientReviewer(clientId);
    await expect(getDeliverable(reviewer, secret.id)).rejects.toThrow(/not found/i);
    await expect(getDeliverable(reviewer, draft.id)).rejects.toThrow(/not found/i);
    expect(await canAccessAsset(reviewer, asset.id)).toBeNull();
    expect(await canAccessAsset(org.actors.pm, asset.id)).not.toBeNull();
    expect(await canAccessAsset(org.actors.employee, asset.id)).toBeNull();
  });
});
