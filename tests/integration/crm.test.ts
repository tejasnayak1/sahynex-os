import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { db, schema } from '@/db';
import { emit } from '@/server/automation/events';
import {
  changeLeadStage,
  getLead,
  ingestLead,
  listLeads,
  logLeadActivity,
  setLeadConsent,
  updateQualification,
} from '@/server/services/leads';
import { leadSourceBreakdown } from '@/server/services/leads';
import { drainOrg, makeClient, makeOrg, runWorkflow, type TestOrg } from '../helpers/fixtures';

let org: TestOrg;
beforeAll(async () => {
  org = await makeOrg();
});

const tasksForLead = (leadId: string) =>
  db.select().from(schema.tasks).where(eq(schema.tasks.leadId, leadId));
const notesFor = (userId: string) =>
  db.select().from(schema.notifications).where(eq(schema.notifications.userId, userId));

describe('Workflow 1 — new lead', () => {
  it('creates and retrieves a valid lead, assigns an owner, notifies them and creates one follow-up task', async () => {
    const r = await ingestLead(
      org.actors.sales,
      {
        name: 'Kavya Rao',
        email: 'Kavya@Example.com',
        phone: '98450 11111',
        organisationName: 'Demo PU College',
        sourceKey: 'website',
      },
      'manual',
    );
    expect(r.outcome).toBe('created');
    expect(r.lead.ref).toMatch(/^LD-\d{4}$/);
    expect(r.lead.emailNormalized).toBe('kavya@example.com');
    expect(r.lead.phoneNormalized).toBe('+919845011111');
    await drainOrg(org.orgId);
    const { lead } = await getLead(org.actors.ceo, r.lead.id);
    expect([org.users.sales.id, org.users.sales2.id]).toContain(lead.ownerId);
    const tasks = await tasksForLead(lead.id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].ownerId).toBe(lead.ownerId);
    expect(
      (await notesFor(lead.ownerId!)).some((n) => n.type === 'lead.new' && n.link === `/leads/${lead.id}`),
    ).toBe(true);
  });

  it('round-robins assignment across eligible people', async () => {
    const owners = new Set<string>();
    for (let i = 0; i < 4; i++) {
      const r = await ingestLead(
        org.actors.sales,
        { name: `RR ${i}`, email: `rr${i}@example.com` },
        'manual',
      );
      await drainOrg(org.orgId);
      owners.add((await getLead(org.actors.ceo, r.lead.id)).lead.ownerId!);
    }
    expect(owners).toEqual(new Set([org.users.sales.id, org.users.sales2.id]));
  });

  it('assigns client enquiries to the client account owner', async () => {
    const client = await makeClient(org, 'Assign Client', org.users.pm.id);
    const r = await ingestLead(
      org.system,
      { name: 'Student A', phone: '9000000001', clientId: client.id, leadType: 'admission_enquiry' },
      'api',
    );
    await drainOrg(org.orgId);
    expect((await getLead(org.actors.ceo, r.lead.id)).lead.ownerId).toBe(org.users.pm.id);
  });

  it('rejects leads without valid contact details', async () => {
    await expect(ingestLead(org.actors.sales, { name: 'No contact' }, 'manual')).rejects.toThrow(
      /email address or a phone/,
    );
    await expect(
      ingestLead(org.actors.sales, { name: 'Bad email', email: 'nope' }, 'manual'),
    ).rejects.toThrow(/not valid/);
  });
});

describe('duplicate handling', () => {
  it('updates the existing lead on an exact, non-conflicting match without overwriting data', async () => {
    const a = await ingestLead(
      org.actors.sales,
      { name: 'Dup Person', email: 'dup@example.com', city: 'Udupi' },
      'manual',
    );
    const b = await ingestLead(
      org.actors.sales,
      { name: 'dup  person', email: 'DUP@example.com', phone: '9876543210', city: 'Mangaluru' },
      'website',
    );
    expect(b.outcome).toBe('updated');
    expect(b.lead.id).toBe(a.lead.id);
    expect(b.lead.phoneNormalized).toBe('+919876543210'); // filled empty field
    expect(b.lead.city).toBe('Udupi'); // existing value not overwritten
  });

  it('never silently merges conflicting records — flags them for review instead', async () => {
    const a = await ingestLead(
      org.actors.sales,
      { name: 'Ravi Kumar', email: 'shared@example.com' },
      'manual',
    );
    const b = await ingestLead(
      org.actors.sales,
      { name: 'Someone Else', email: 'shared@example.com' },
      'manual',
    );
    expect(b.outcome).toBe('flagged_duplicate');
    expect(b.lead.id).not.toBe(a.lead.id);
    expect(b.lead.possibleDuplicateOfId).toBe(a.lead.id);
    expect((await getLead(org.actors.ceo, a.lead.id)).lead.name).toBe('Ravi Kumar');
  });

  it('flags when email matches one lead and phone matches another', async () => {
    const a = await ingestLead(org.actors.sales, { name: 'X One', email: 'x1@example.com' }, 'manual');
    await ingestLead(org.actors.sales, { name: 'X Two', phone: '9123456780' }, 'manual');
    const c = await ingestLead(
      org.actors.sales,
      { name: 'X One', email: 'x1@example.com', phone: '9123456780' },
      'manual',
    );
    expect(c.outcome).toBe('flagged_duplicate');
    expect(c.lead.possibleDuplicateOfId).toBe(a.lead.id);
  });

  it('is idempotent for re-delivered external IDs (webhook retries)', async () => {
    const a = await ingestLead(
      org.system,
      { name: 'Meta Lead', email: 'meta1@example.com', externalId: 'meta:123' },
      'meta_lead_ads',
    );
    const b = await ingestLead(
      org.system,
      { name: 'Meta Lead', email: 'meta1@example.com', externalId: 'meta:123' },
      'meta_lead_ads',
    );
    expect(b.lead.id).toBe(a.lead.id);
    const rows = await db
      .select()
      .from(schema.leads)
      .where(and(eq(schema.leads.orgId, org.orgId), eq(schema.leads.externalId, 'meta:123')));
    expect(rows).toHaveLength(1);
  });

  it('keeps enquiries for different clients separate', async () => {
    const c1 = await makeClient(org);
    const c2 = await makeClient(org);
    const a = await ingestLead(
      org.system,
      { name: 'Same Student', phone: '9555555555', clientId: c1.id },
      'api',
    );
    const b = await ingestLead(
      org.system,
      { name: 'Same Student', phone: '9555555555', clientId: c2.id },
      'api',
    );
    expect(b.outcome).toBe('created');
    expect(b.lead.id).not.toBe(a.lead.id);
  });
});

describe('Workflow 2 — overdue leads and stopping reminders', () => {
  it('reminds owners once, escalates once, and skips suppressed/closed leads', async () => {
    const o = await makeOrg();
    const old = new Date(Date.now() - 30 * 3600_000);
    const mk = async (name: string, extra: Partial<typeof schema.leads.$inferInsert> = {}) =>
      (
        await db
          .insert(schema.leads)
          .values({
            orgId: o.orgId,
            ref: `LD-T${Math.random().toString().slice(2, 7)}`,
            name,
            email: `${name}@example.com`,
            emailNormalized: `${name}@example.com`,
            ownerId: o.users.sales.id,
            createdAt: old,
            ...extra,
          })
          .returning()
      )[0];
    const open = await mk('open');
    await mk('optedout', { suppressed: true });
    await mk('lost', { stage: 'lost' });
    const r1 = await runWorkflow(o.orgId, 'lead.overdue');
    expect(r1.execution.status).toBe('succeeded');
    const r2 = await runWorkflow(o.orgId, 'lead.overdue');
    expect(r2.execution.status).toBe('skipped'); // nothing new to do
    const ownerNotes = (await notesFor(o.users.sales.id)).filter((n) => n.type === 'lead.overdue');
    expect(ownerNotes).toHaveLength(1);
    expect(ownerNotes[0].title).toContain('open');
    const ceoNotes = (await notesFor(o.users.ceo.id)).filter((n) => n.type === 'lead.escalated');
    expect(ceoNotes).toHaveLength(1);
    const [after] = await db.select().from(schema.leads).where(eq(schema.leads.id, open.id));
    expect(after.escalatedAt).not.toBeNull();
  });

  it('cancels open follow-up tasks when a lead is closed, so reminders stop', async () => {
    const r = await ingestLead(org.actors.sales, { name: 'Closer', email: 'closer@example.com' }, 'manual');
    await drainOrg(org.orgId);
    await changeLeadStage(org.actors.sales, r.lead.id, 'lost', 'Chose another college');
    const tasks = await tasksForLead(r.lead.id);
    expect(tasks.every((t) => t.status === 'cancelled')).toBe(true);
  });

  it('logging a contact completes the first-contact task', async () => {
    const r = await ingestLead(
      org.actors.sales,
      { name: 'Contacted', email: 'contacted@example.com' },
      'manual',
    );
    await drainOrg(org.orgId);
    const { lead } = await getLead(org.actors.ceo, r.lead.id);
    const owner = lead.ownerId === org.users.sales.id ? org.actors.sales : org.actors.sales2;
    await logLeadActivity(owner, lead.id, { type: 'call', body: 'Spoke to parent' });
    const [t] = await tasksForLead(lead.id);
    expect(t.status).toBe('done');
    expect((await getLead(org.actors.ceo, lead.id)).lead.stage).toBe('contacted');
  });

  it('records opt-out and withdraws marketing consent', async () => {
    const r = await ingestLead(
      org.actors.sales,
      { name: 'Opt Out', email: 'optout@example.com', consentMarketing: true },
      'manual',
    );
    await setLeadConsent(org.actors.sales, r.lead.id, {
      consent: true,
      suppressed: true,
      reason: 'Asked to stop',
    });
    const { lead } = await getLead(org.actors.ceo, r.lead.id);
    expect(lead.suppressed).toBe(true);
    expect(lead.consentMarketing).toBe(false);
  });
});

describe('Workflow 3 — qualification', () => {
  it('scores, qualifies, preserves attribution, creates next step and shows in reporting', async () => {
    const r = await ingestLead(
      org.actors.sales,
      { name: 'Qualify Me', email: 'q@example.com', sourceKey: 'referral', utmCampaign: 'spring' },
      'manual',
    );
    await drainOrg(org.orgId);
    await updateQualification(org.actors.sales, r.lead.id, {
      budget_confirmed: true,
      decision_maker: true,
      clear_need: true,
    });
    await drainOrg(org.orgId);
    const { lead } = await getLead(org.actors.ceo, r.lead.id);
    expect(lead.score).toBe(70);
    expect(lead.qualificationStatus).toBe('qualified');
    expect(lead.stage).toBe('qualified');
    expect(lead.firstTouch?.campaign).toBe('spring');
    expect((await tasksForLead(lead.id)).some((t) => t.sourceKey === `lead-qualified:${lead.id}`)).toBe(true);
    const breakdown = await leadSourceBreakdown(
      org.actors.ceo,
      new Date(Date.now() - 86400000),
      new Date(Date.now() + 86400000),
    );
    expect(breakdown.find((b) => b.source === 'Referral')?.qualified).toBeGreaterThanOrEqual(1);
  });
});

describe('reliability — duplicate events', () => {
  it('emitting the same event twice queues one execution and creates one task', async () => {
    const r = await ingestLead(org.actors.sales, { name: 'Twice', email: 'twice@example.com' }, 'manual');
    const extra = await emit(db, org.orgId, 'lead.created', { leadId: r.lead.id }, r.lead.id);
    expect(extra).toBe(0);
    await drainOrg(org.orgId);
    await runWorkflow(org.orgId, 'lead.new', { event: 'lead.created', leadId: r.lead.id }); // a forced re-run
    expect(await tasksForLead(r.lead.id)).toHaveLength(1);
    const n = (await notesFor((await getLead(org.actors.ceo, r.lead.id)).lead.ownerId!)).filter(
      (x) => x.type === 'lead.new' && x.link === `/leads/${r.lead.id}`,
    );
    expect(n).toHaveLength(1);
  });

  it('test leads never notify anyone or create tasks', async () => {
    const r = await ingestLead(
      org.system,
      { name: 'Synthetic', email: 'synthetic@monitor.invalid', isTest: true },
      'monitor_self_test',
    );
    await drainOrg(org.orgId);
    expect(await tasksForLead(r.lead.id)).toHaveLength(0);
    expect((await getLead(org.actors.ceo, r.lead.id)).lead.ownerId).toBeNull();
  });
});

describe('lead visibility', () => {
  it('project managers only see leads they own', async () => {
    const res = await listLeads(org.actors.pm, { page: 1, pageSize: 200, dir: 'desc' });
    expect(res.rows.every((l) => l.ownerId === org.users.pm.id)).toBe(true);
  });
  it('designers cannot see leads at all', async () => {
    expect((await listLeads(org.actors.designer, { page: 1, pageSize: 50, dir: 'desc' })).total).toBe(0);
  });
});
