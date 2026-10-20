import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { db, schema } from '@/db';
import { authenticateWithGoogle } from '@/server/auth/login';
import { loadActorForUser } from '@/server/auth/session';
import { setOwnJobTitle } from '@/server/services/admin';
import {
  addClientNote,
  clientActivity,
  clientNotes,
  clientTasks,
  deleteClientNote,
  projectProgress,
  updateClient,
} from '@/server/services/clients';
import { createDeliverable } from '@/server/services/deliverables';
import { createProject } from '@/server/services/projects';
import { boardCardExtras, createTask, listTasks, setCollaborators } from '@/server/services/tasks';
import { makeClient, makeOrg, type TestOrg } from '../helpers/fixtures';

let org: TestOrg;
beforeAll(async () => {
  org = await makeOrg();
});

describe('Client notes, tabs and progress', () => {
  it('adds and removes notes as a timeline, newest first, only on visible clients', async () => {
    const c = await makeClient(org, undefined, org.users.pm.id);
    const other = await makeClient(org, undefined, org.users.ceo.id);
    await addClientNote(org.actors.pm, c.id, { title: 'Budget discussion', body: 'Q4 plan agreed.' });
    await addClientNote(org.actors.pm, c.id, { title: 'Meeting with Principal' });
    const notes = await clientNotes(org.actors.pm, c.id);
    expect(notes.map((n) => n.title)).toEqual(['Meeting with Principal', 'Budget discussion']);
    expect(notes[1].body).toBe('Q4 plan agreed.');
    await expect(addClientNote(org.actors.pm, c.id, { title: '' })).rejects.toThrow();
    await expect(addClientNote(org.actors.pm, other.id, { title: 'Nope' })).rejects.toThrow(/not found/i);
    await expect(addClientNote(org.actors.designer, c.id, { title: 'No permission' })).rejects.toThrow();
    await deleteClientNote(org.actors.pm, notes[0].id);
    expect(await clientNotes(org.actors.pm, c.id)).toHaveLength(1);
    const activity = await clientActivity(org.actors.pm, c.id);
    expect(activity.map((a) => a.action)).toEqual(
      expect.arrayContaining(['client.note_added', 'client.note_removed']),
    );
  });

  it('lists the client’s tasks and per-project progress', async () => {
    const c = await makeClient(org, undefined, org.users.pm.id);
    const p = await createProject(org.actors.pm, { clientId: c.id, name: 'Progress project' });
    const t1 = await createTask(org.actors.pm, { title: 'P1', projectId: p.id, ownerId: org.users.pm.id });
    await createTask(org.actors.pm, { title: 'P2', projectId: p.id, ownerId: org.users.pm.id });
    await db.update(schema.tasks).set({ status: 'done' }).where(eq(schema.tasks.id, t1.id));
    const tasks = await clientTasks(org.actors.pm, c.id);
    expect(tasks.map((t) => t.title)).toEqual(expect.arrayContaining(['P1', 'P2']));
    const prog = await projectProgress(org.actors.pm, [p.id]);
    expect(prog.get(p.id)!.done).toBe(1);
    expect(prog.get(p.id)!.total).toBeGreaterThanOrEqual(2);
  });

  it('changing only the budget period keeps the amount (inline period select)', async () => {
    const c = await makeClient(org);
    await updateClient(org.actors.coo, c.id, {
      marketingBudgetMinor: '300000',
      marketingBudgetPeriod: 'monthly',
    });
    await updateClient(org.actors.coo, c.id, {
      marketingBudgetMinor: '300000',
      marketingBudgetPeriod: 'annual',
    });
    const [after] = await db.select().from(schema.clients).where(eq(schema.clients.id, c.id));
    expect(after.marketingBudgetMinor).toBe(30_000_000);
    expect(after.marketingBudgetPeriod).toBe('annual');
  });
});

describe('Board data', () => {
  it('filters by client and returns collaborators and comment counts', async () => {
    const c = await makeClient(org, undefined, org.users.pm.id);
    const p = await createProject(org.actors.pm, { clientId: c.id, name: 'Board project' });
    const t = await createTask(org.actors.pm, {
      title: 'Board card',
      projectId: p.id,
      ownerId: org.users.pm.id,
    });
    await setCollaborators(org.actors.pm, t.id, [org.users.designer.id]);
    await db.insert(schema.comments).values({
      orgId: org.orgId,
      entityType: 'task',
      entityId: t.id,
      authorId: org.users.pm.id,
      body: 'Hi',
    });
    const res = await listTasks(org.actors.pm, { page: 1, pageSize: 50, dir: 'asc', clientId: c.id });
    expect(res.rows.map((r) => r.id)).toContain(t.id);
    const extras = await boardCardExtras(org.actors.pm, [t.id]);
    expect(extras.people.get(t.id)).toHaveLength(1);
    expect(extras.comments.get(t.id)).toBe(1);
    const none = await listTasks(org.actors.pm, {
      page: 1,
      pageSize: 50,
      dir: 'asc',
      clientId: c.id,
      noDue: true,
    });
    expect(none.rows.every((r) => r.dueAt === null)).toBe(true);
  });
});

describe('Deliverable objective and priority', () => {
  it('are stored when the person creates the deliverable', async () => {
    const c = await makeClient(org, undefined, org.users.pm.id);
    const p = await createProject(org.actors.pm, { clientId: c.id, name: 'Content project' });
    const d = await createDeliverable(org.actors.pm, {
      projectId: p.id,
      title: 'BCA post',
      format: 'social_post',
      objective: 'Generate enquiries',
      priority: 'high',
    });
    expect(d.objective).toBe('Generate enquiries');
    expect(d.priority).toBe('high');
    await expect(
      createDeliverable(org.actors.pm, { projectId: p.id, title: 'x', priority: 'extreme' }),
    ).rejects.toThrow();
  });
});

describe('Sign in with Google and job titles', () => {
  it('signs in only an existing active account with that exact email', async () => {
    const s = await authenticateWithGoogle(org.users.pm.email.toUpperCase(), { ip: '127.0.0.1' });
    expect(s.token).toBeTruthy();
    await expect(authenticateWithGoogle('stranger@example.com', { ip: '127.0.0.1' })).rejects.toThrow(
      /no active/i,
    );
    await db.update(schema.users).set({ isActive: false }).where(eq(schema.users.id, org.users.employee.id));
    await expect(authenticateWithGoogle(org.users.employee.email, { ip: '127.0.0.1' })).rejects.toThrow(
      /no active/i,
    );
  });

  it('lets a person set their own job title, shown on their session', async () => {
    await setOwnJobTitle(org.actors.ceo, '  CMO  ');
    expect((await loadActorForUser(org.users.ceo.id))!.jobTitle).toBe('CMO');
    await setOwnJobTitle(org.actors.ceo, '');
    expect((await loadActorForUser(org.users.ceo.id))!.jobTitle).toBeNull();
  });
});
