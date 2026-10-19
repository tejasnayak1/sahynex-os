import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { db, schema } from '@/db';
import { DEFAULT_TEMPLATES } from '@/db/defaults';
import {
  changeDealStage,
  createDeal,
  createProposal,
  decideHandover,
  markProposalSent,
  saveHandover,
  submitHandover,
  updateDeal,
} from '@/server/services/deals';
import { projectReadiness, setProjectStatus } from '@/server/services/projects';
import { drainOrg, makeOrg, runWorkflow, type TestOrg } from '../helpers/fixtures';

let org: TestOrg;
beforeAll(async () => {
  org = await makeOrg();
});

async function wonDeal(value = '500000') {
  const d = await createDeal(org.actors.sales, {
    title: 'Big deal',
    prospectName: `Prospect ${Math.random().toString(36).slice(2, 7)}`,
    value,
    contactName: 'Principal',
    contactEmail: 'p@example.org',
  });
  await changeDealStage(org.actors.sales, d.id, 'qualified');
  await drainOrg(org.orgId);
  await changeDealStage(org.actors.sales, d.id, 'discovery_completed');
  await drainOrg(org.orgId);
  await createProposal(org.actors.sales, d.id, { title: 'v1', value });
  const [p] = await db.select().from(schema.proposals).where(eq(schema.proposals.dealId, d.id));
  await markProposalSent(org.actors.sales, p.id);
  await changeDealStage(org.actors.sales, d.id, 'won');
  await drainOrg(org.orgId);
  return d;
}

describe('sales pipeline', () => {
  it('creates discovery and proposal tasks on stage changes, and a handover task on win', async () => {
    const d = await wonDeal();
    const tasks = await db.select().from(schema.tasks).where(eq(schema.tasks.dealId, d.id));
    const keys = tasks.map((t) => t.sourceKey);
    expect(keys).toContain(`deal-discovery:${d.id}`);
    expect(keys).toContain(`deal-proposal:${d.id}`);
    expect(keys).toContain(`deal-handover:${d.id}`);
    expect(tasks.find((t) => t.sourceKey === `deal-discovery:${d.id}`)?.status).toBe('done');
  });

  it('ignores stale stage events (deal already moved on) instead of creating out-of-date tasks', async () => {
    const d = await createDeal(org.actors.sales, {
      title: 'Fast mover',
      prospectName: 'Quick',
      value: '1000',
    });
    await changeDealStage(org.actors.sales, d.id, 'qualified');
    await changeDealStage(org.actors.sales, d.id, 'negotiation');
    await drainOrg(org.orgId);
    const keys = (await db.select().from(schema.tasks).where(eq(schema.tasks.dealId, d.id))).map(
      (t) => t.sourceKey,
    );
    expect(keys).not.toContain(`deal-discovery:${d.id}`);
    const runs = await db
      .select()
      .from(schema.automationExecutions)
      .where(eq(schema.automationExecutions.orgId, org.orgId));
    expect(runs.some((r) => r.status === 'skipped' && String(r.result?.summary).includes('moved on'))).toBe(
      true,
    );
  });

  it('requires a lost reason and blocks reopening closed deals', async () => {
    const d = await createDeal(org.actors.sales, { title: 'Lose me', prospectName: 'X', value: '1000' });
    await expect(changeDealStage(org.actors.sales, d.id, 'lost')).rejects.toThrow(/lost/);
    await changeDealStage(org.actors.sales, d.id, 'lost', { lostReason: 'Budget' });
    await expect(changeDealStage(org.actors.sales, d.id, 'qualified')).rejects.toThrow(/closed/);
  });

  it('cannot move to “proposal sent” without a sent proposal', async () => {
    const d = await createDeal(org.actors.sales, { title: 'No proposal', prospectName: 'Y', value: '1000' });
    await expect(changeDealStage(org.actors.sales, d.id, 'proposal_sent')).rejects.toThrow(/Send a proposal/);
  });

  it('discounts above the threshold need approval before winning', async () => {
    const d = await createDeal(org.actors.sales, { title: 'Discounted', prospectName: 'Z', value: '100000' });
    await updateDeal(org.actors.sales, d.id, { discountPct: '25' });
    await expect(changeDealStage(org.actors.sales, d.id, 'won')).rejects.toThrow(/discount/i);
  });
});

describe('Workflow 10 — proposal follow-ups stop after closure', () => {
  it('creates follow-ups on schedule and none once the deal is closed', async () => {
    const d = await createDeal(org.actors.sales, { title: 'Follow me', prospectName: 'F', value: '200000' });
    await createProposal(org.actors.sales, d.id, { title: 'v1' });
    const [p] = await db.select().from(schema.proposals).where(eq(schema.proposals.dealId, d.id));
    await markProposalSent(org.actors.sales, p.id);
    await db
      .update(schema.proposals)
      .set({ sentAt: new Date(Date.now() - 8 * 86400000) })
      .where(eq(schema.proposals.id, p.id));
    await runWorkflow(org.orgId, 'sales.proposal_followup');
    await runWorkflow(org.orgId, 'sales.proposal_followup'); // idempotent
    const fu = (await db.select().from(schema.tasks).where(eq(schema.tasks.dealId, d.id))).filter((t) =>
      t.sourceKey?.startsWith('deal-followup:'),
    );
    expect(fu).toHaveLength(2); // day 3 and day 7
    await changeDealStage(org.actors.sales, d.id, 'lost', { lostReason: 'No budget' });
    const after = (await db.select().from(schema.tasks).where(eq(schema.tasks.dealId, d.id))).filter((t) =>
      t.sourceKey?.startsWith('deal-followup:'),
    );
    expect(after.every((t) => t.status === 'cancelled')).toBe(true);
    await db
      .update(schema.proposals)
      .set({ sentAt: new Date(Date.now() - 20 * 86400000) })
      .where(eq(schema.proposals.id, p.id));
    await runWorkflow(org.orgId, 'sales.proposal_followup');
    const escalations = (
      await db.select().from(schema.notifications).where(eq(schema.notifications.userId, org.users.ceo.id))
    ).filter((n) => n.link === `/deals/${d.id}` && n.type === 'deal.escalated');
    expect(escalations).toHaveLength(0);
  });
});

describe('Workflow 6 — handover → project', () => {
  it('requires a complete handover and commercial approval, then generates the template’s tasks exactly once', async () => {
    const d = await wonDeal();
    await expect(submitHandover(org.actors.sales, d.id)).rejects.toThrow(/Fill in the handover/);
    await saveHandover(org.actors.sales, d.id, {
      projectName: 'Admissions 2027',
      scope: 'Lead gen',
      proposedOwnerId: org.users.pm.id,
    });
    await expect(submitHandover(org.actors.sales, d.id)).rejects.toThrow(/incomplete/);
    await saveHandover(org.actors.sales, d.id, {
      projectName: 'Admissions 2027',
      scope: 'Lead gen',
      deliverablesSummary: 'Posters, LP',
      proposedOwnerId: org.users.pm.id,
      targetStart: '2026-11-01',
      targetEnd: '2027-01-31',
      budget: '400000',
      templateKey: 'admissions_campaign',
    });
    await submitHandover(org.actors.sales, d.id);
    await expect(decideHandover(org.actors.sales, d.id, true)).rejects.toThrow(/permission/);
    await decideHandover(org.actors.ceo, d.id, true);
    await drainOrg(org.orgId);
    const [h] = await db.select().from(schema.handovers).where(eq(schema.handovers.dealId, d.id));
    expect(h.projectId).not.toBeNull();
    const tasks = await db.select().from(schema.tasks).where(eq(schema.tasks.projectId, h.projectId!));
    const tpl = DEFAULT_TEMPLATES.find((t) => t.key === 'admissions_campaign')!;
    expect(tasks).toHaveLength(tpl.items.length);
    expect(tasks.every((t) => t.ownerId)).toBe(true);
    const deps = await db.select().from(schema.taskDependencies);
    expect(deps.filter((x) => tasks.some((t) => t.id === x.taskId)).length).toBe(
      tpl.items.reduce((a, i) => a + (i.dependsOn?.length ?? 0), 0),
    );
    const ms = await db.select().from(schema.milestones).where(eq(schema.milestones.projectId, h.projectId!));
    expect(ms.length).toBe(new Set(tpl.items.map((i) => i.milestone).filter(Boolean)).size);
    // Re-running the workflow does not duplicate anything.
    await runWorkflow(org.orgId, 'project.from_handover', { event: 'handover.approved', handoverId: h.id });
    expect(await db.select().from(schema.tasks).where(eq(schema.tasks.projectId, h.projectId!))).toHaveLength(
      tpl.items.length,
    );
    expect(
      await db
        .select()
        .from(schema.projects)
        .where(and(eq(schema.projects.orgId, org.orgId), eq(schema.projects.handoverId, h.id))),
    ).toHaveLength(1);
    // Project can go active because commercials were approved.
    const [p] = await db.select().from(schema.projects).where(eq(schema.projects.id, h.projectId!));
    expect((await projectReadiness(db, p)).ready).toBe(true);
    await setProjectStatus(org.actors.coo, p.id, 'active');
  });

  it('blocks active delivery for a project missing scope/owner/dates/commercials', async () => {
    const [c] = await db
      .insert(schema.clients)
      .values({ orgId: org.orgId, name: `Readiness ${Date.now()}` })
      .returning();
    const [p] = await db
      .insert(schema.projects)
      .values({ orgId: org.orgId, ref: `PRJ-T${Date.now() % 10000}`, clientId: c.id, name: 'Unready' })
      .returning();
    await expect(setProjectStatus(org.actors.coo, p.id, 'active')).rejects.toThrow(/Not ready/);
  });
});
