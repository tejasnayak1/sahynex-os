import { and, desc, eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { db, schema } from '@/db';
import { configureIntegration } from '@/server/services/admin';
import { changeDealStage, createDeal } from '@/server/services/deals';
import { ingestLead, setLeadConsent } from '@/server/services/leads';
import {
  cancelMeeting,
  completeMeeting,
  meetingIcs,
  rescheduleMeeting,
  scheduleMeeting,
} from '@/server/services/meetings';
import { sendWhatsAppTemplate, whatsappAvailability } from '@/server/services/messaging';
import { addDependency, bulkUpdateTasks, createTask } from '@/server/services/tasks';
import { drainOrg, makeOrg, type TestOrg } from '../helpers/fixtures';

let org: TestOrg;
beforeAll(async () => {
  org = await makeOrg();
});

const inHours = (h: number) => new Date(Date.now() + h * 3_600_000);
const task = async (id: string) => (await db.select().from(schema.tasks).where(eq(schema.tasks.id, id)))[0];

/* ------------------------------------------------------------- bulk */

describe('Bulk task edits', () => {
  it('applies a status to many tasks, reports per-task failures and never bypasses dependency rules', async () => {
    const a = await createTask(org.actors.pm, { title: 'Bulk A', ownerId: org.users.designer.id });
    const b = await createTask(org.actors.pm, { title: 'Bulk B', ownerId: org.users.designer.id });
    const c = await createTask(org.actors.pm, { title: 'Bulk C (waits on A)', ownerId: org.users.pm.id });
    await addDependency(org.actors.pm, c.id, a.id);
    // C is processed before A finishes in this order, so C must be refused.
    const res = await bulkUpdateTasks(org.actors.pm, { ids: [c.id, a.id, b.id], status: 'done' });
    expect(res.updated).toBe(2);
    expect(res.failed).toHaveLength(1);
    expect(res.failed[0].id).toBe(c.id);
    expect(res.failed[0].error).toMatch(/Waiting on/);
    expect((await task(a.id)).status).toBe('done');
    expect((await task(c.id)).status).toBe('todo');
    const again = await bulkUpdateTasks(org.actors.pm, { ids: [a.id, b.id], status: 'done' });
    expect(again).toEqual({ updated: 0, unchanged: 2, failed: [] });
  });

  it('reassigns and re-prioritises in one go and notifies the new owner', async () => {
    const t1 = await createTask(org.actors.pm, { title: 'Move me 1', ownerId: org.users.pm.id });
    const t2 = await createTask(org.actors.pm, { title: 'Move me 2', ownerId: org.users.pm.id });
    const res = await bulkUpdateTasks(org.actors.coo, {
      ids: [t1.id, t2.id],
      ownerId: org.users.designer.id,
      priority: 'urgent',
    });
    expect(res.updated).toBe(2);
    for (const id of [t1.id, t2.id]) {
      const t = await task(id);
      expect(t.ownerId).toBe(org.users.designer.id);
      expect(t.priority).toBe('urgent');
    }
    const notes = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, org.users.designer.id));
    expect(notes.filter((n) => n.link === `/tasks/${t1.id}` || n.link === `/tasks/${t2.id}`).length).toBe(2);
  });

  it('keeps permissions: no bulk reassign without tasks.assign, no editing other people’s tasks, no bulk "blocked"', async () => {
    const theirs = await createTask(org.actors.pm, {
      title: 'Designer work',
      ownerId: org.users.designer.id,
    });
    const mine = await createTask(org.actors.employee, { title: 'Employee work' });
    await expect(
      bulkUpdateTasks(org.actors.employee, { ids: [mine.id], ownerId: org.users.designer.id }),
    ).rejects.toThrow(/permission/i);
    const res = await bulkUpdateTasks(org.actors.employee, { ids: [mine.id, theirs.id], priority: 'high' });
    expect(res.updated).toBe(1);
    expect(res.failed.map((f) => f.id)).toEqual([theirs.id]);
    expect((await task(theirs.id)).priority).toBe('medium');
    await expect(bulkUpdateTasks(org.actors.pm, { ids: [theirs.id], status: 'blocked' })).rejects.toThrow();
    await expect(bulkUpdateTasks(org.actors.pm, { ids: [theirs.id] })).rejects.toThrow(/Choose a change/);
  });
});

/* ---------------------------------------------------------- meetings */

async function newDeal(name = `Prospect ${Math.random().toString(36).slice(2, 7)}`) {
  const d = await createDeal(org.actors.sales, {
    title: `${name} — admissions`,
    prospectName: name,
    value: '250000',
    contactEmail: 'principal@example.org',
  });
  await changeDealStage(org.actors.sales, d.id, 'qualified');
  await drainOrg(org.orgId);
  return d;
}

describe('Discovery meetings', () => {
  it('schedules a meeting on a deal: calendar task, discovery to-do closed, next action set, invite available', async () => {
    const d = await newDeal('Demo Polytechnic');
    const discoveryTodo = (
      await db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.sourceKey, `deal-discovery:${d.id}`))
    )[0];
    expect(discoveryTodo?.status).toBe('todo');

    const { meeting, mail } = await scheduleMeeting(org.actors.sales, {
      dealId: d.id,
      startAt: inHours(30).toISOString(),
      durationMinutes: '60',
      location: 'https://meet.example.com/abc',
      attendees: 'principal@example.org, Dean@Example.org',
      agenda: 'Admissions goals; current channels; budget',
    });
    expect(mail).toBeNull();
    expect(meeting.title).toBe('Discovery meeting — Demo Polytechnic');
    expect(meeting.attendees).toEqual(['principal@example.org', 'dean@example.org']);
    expect(meeting.endAt.getTime() - meeting.startAt.getTime()).toBe(60 * 60_000);

    const t = await task(meeting.taskId!);
    expect(t.startAt?.getTime()).toBe(meeting.startAt.getTime());
    expect(t.dueAt?.getTime()).toBe(meeting.endAt.getTime());
    expect(t.ownerId).toBe(org.users.sales.id);
    expect((await task(discoveryTodo.id)).status).toBe('done');
    const [deal] = await db.select().from(schema.deals).where(eq(schema.deals.id, d.id));
    expect(deal.nextActionAt?.getTime()).toBe(meeting.startAt.getTime());

    const { ics } = await meetingIcs(org.actors.ceo, meeting.id);
    expect(ics).toContain(`UID:${meeting.icsUid}`);
    expect(ics).toContain('METHOD:REQUEST');
    expect(ics.replace(/\r\n /g, '')).toContain(
      'ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:dean@example.org',
    );
    const audits = await db
      .select()
      .from(schema.auditLogs)
      .where(
        and(eq(schema.auditLogs.entityId, meeting.id), eq(schema.auditLogs.action, 'meeting.scheduled')),
      );
    expect(audits).toHaveLength(1);
  });

  it('reschedules with a new sequence and cancels with METHOD:CANCEL, keeping the calendar task in step', async () => {
    const d = await newDeal();
    const { meeting } = await scheduleMeeting(org.actors.sales, {
      dealId: d.id,
      startAt: inHours(48).toISOString(),
    });
    const later = inHours(72);
    const { meeting: moved } = await rescheduleMeeting(org.actors.sales, meeting.id, {
      startAt: later.toISOString(),
      durationMinutes: '30',
    });
    expect(moved.sequence).toBe(1);
    expect((await task(meeting.taskId!)).dueAt?.getTime()).toBe(later.getTime() + 30 * 60_000);

    const { meeting: cancelled } = await cancelMeeting(org.actors.sales, meeting.id, {
      reason: 'Principal travelling',
    });
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.sequence).toBe(2);
    expect((await task(meeting.taskId!)).status).toBe('cancelled');
    const { ics } = await meetingIcs(org.actors.sales, meeting.id);
    expect(ics).toContain('METHOD:CANCEL');
    expect(ics).toContain('SEQUENCE:2');
    await expect(
      rescheduleMeeting(org.actors.sales, meeting.id, { startAt: inHours(80).toISOString() }),
    ).rejects.toThrow(/Only scheduled/);
  });

  it('records the outcome only after the meeting and can advance the deal through normal stage rules', async () => {
    const d = await newDeal();
    const { meeting } = await scheduleMeeting(org.actors.sales, {
      dealId: d.id,
      startAt: inHours(2).toISOString(),
    });
    await expect(completeMeeting(org.actors.sales, meeting.id, { outcome: 'Too early' })).rejects.toThrow(
      /not started/,
    );
    await db
      .update(schema.meetings)
      .set({ startAt: inHours(-2), endAt: inHours(-1) })
      .where(eq(schema.meetings.id, meeting.id));
    await expect(completeMeeting(org.actors.sales, meeting.id, {})).rejects.toThrow(
      /Record what was discussed/,
    );
    await completeMeeting(org.actors.sales, meeting.id, {
      outcome: 'Wants Meta + Google for B.E. admissions; send proposal by Friday.',
      markDiscoveryCompleted: 'on',
    });
    const [deal] = await db.select().from(schema.deals).where(eq(schema.deals.id, d.id));
    expect(deal.stage).toBe('discovery_completed');
    expect(deal.lastInteractionAt).not.toBeNull();
    expect((await task(meeting.taskId!)).status).toBe('done');
    await expect(completeMeeting(org.actors.sales, meeting.id, { outcome: 'again' })).rejects.toThrow(
      /already been closed/,
    );
  });

  it('logs lead meetings on the timeline and refuses people without access, past times and unconfigured email', async () => {
    const r = await ingestLead(
      org.actors.sales,
      { name: 'Ananya Shetty', email: 'ananya@example.com' },
      'manual',
    );
    const { meeting, mail } = await scheduleMeeting(org.actors.sales, {
      leadId: r.lead.id,
      purpose: 'other',
      startAt: inHours(5).toISOString(),
      attendees: 'ananya@example.com',
      emailInvite: 'on',
    });
    // SMTP is not configured in tests: the result says so and nothing is recorded as emailed.
    expect(mail?.status).toBe('not_configured');
    const [m] = await db.select().from(schema.meetings).where(eq(schema.meetings.id, meeting.id));
    expect(m.inviteEmailedAt).toBeNull();
    const acts = await db
      .select()
      .from(schema.leadActivities)
      .where(and(eq(schema.leadActivities.leadId, r.lead.id), eq(schema.leadActivities.type, 'meeting')));
    expect(acts).toHaveLength(1);

    await expect(
      scheduleMeeting(org.actors.employee, { leadId: r.lead.id, startAt: inHours(5).toISOString() }),
    ).rejects.toThrow();
    await expect(meetingIcs(org.actors.employee, meeting.id)).rejects.toThrow(/not found/i);
    await expect(
      scheduleMeeting(org.actors.sales, { leadId: r.lead.id, startAt: inHours(-3).toISOString() }),
    ).rejects.toThrow(/past/);
    await expect(
      scheduleMeeting(org.actors.sales, {
        leadId: r.lead.id,
        startAt: inHours(3).toISOString(),
        attendees: 'nope',
      }),
    ).rejects.toThrow();
  });
});

/* ---------------------------------------------------------- WhatsApp */

describe('WhatsApp Business templates', () => {
  const TEMPLATES = 'admission_followup:en:first_name,institution|Admissions follow-up\nopen_day:en';
  let consented: string;

  beforeAll(async () => {
    const r = await ingestLead(
      org.actors.sales,
      {
        name: 'Rahul Kamath',
        phone: '98450 22222',
        organisationName: 'Demo Institute',
        email: 'rahul@example.com',
      },
      'manual',
    );
    consented = r.lead.id;
    await setLeadConsent(org.actors.sales, consented, { consent: true, suppressed: false, reason: null });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.META_GRAPH_VERSION;
  });

  it('is unavailable until an administrator connects it', async () => {
    expect((await whatsappAvailability(org.actors.sales)).state).toBe('disconnected');
    await expect(sendWhatsAppTemplate(org.actors.sales, consented, 'open_day:en')).rejects.toThrow(
      /not connected/,
    );
  });

  it('rejects malformed template lists when configuring', async () => {
    await expect(
      configureIntegration(org.actors.ceo, 'whatsapp', {
        mode: 'demo',
        config: { templates: 'Bad Name:en' },
      }),
    ).rejects.toThrow(/lowercase/);
  });

  it('demo mode logs a clearly labelled attempt, sends nothing and blocks repeats for 24 hours', async () => {
    await configureIntegration(org.actors.ceo, 'whatsapp', {
      mode: 'demo',
      config: { templates: TEMPLATES },
    });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const res = await sendWhatsAppTemplate(org.actors.sales, consented, 'admission_followup:en');
    expect(res.status).toBe('demo');
    expect(fetchSpy).not.toHaveBeenCalled();
    const [act] = await db
      .select()
      .from(schema.leadActivities)
      .where(and(eq(schema.leadActivities.leadId, consented), eq(schema.leadActivities.type, 'whatsapp')))
      .orderBy(desc(schema.leadActivities.createdAt));
    expect(act.body).toMatch(/^\[Demo — not sent\]/);
    expect(act.meta).toMatchObject({ status: 'demo', demo: true });
    await expect(sendWhatsAppTemplate(org.actors.sales, consented, 'admission_followup:en')).rejects.toThrow(
      /already sent/,
    );
  });

  it('only sends to consented, non-suppressed leads with a valid number, by people allowed to', async () => {
    const noConsent = await ingestLead(
      org.actors.sales,
      { name: 'No Consent', phone: '9845033333' },
      'manual',
    );
    await expect(sendWhatsAppTemplate(org.actors.sales, noConsent.lead.id, 'open_day:en')).rejects.toThrow(
      /consent/,
    );
    const optedOut = await ingestLead(org.actors.sales, { name: 'Opted Out', phone: '9845044444' }, 'manual');
    await setLeadConsent(org.actors.sales, optedOut.lead.id, {
      consent: true,
      suppressed: true,
      reason: 'STOP',
    });
    await expect(sendWhatsAppTemplate(org.actors.sales, optedOut.lead.id, 'open_day:en')).rejects.toThrow(
      /opted out/,
    );
    const noPhone = await ingestLead(
      org.actors.sales,
      { name: 'Email Only', email: 'eo@example.com' },
      'manual',
    );
    await setLeadConsent(org.actors.sales, noPhone.lead.id, {
      consent: true,
      suppressed: false,
      reason: null,
    });
    await expect(sendWhatsAppTemplate(org.actors.sales, noPhone.lead.id, 'open_day:en')).rejects.toThrow(
      /mobile number/,
    );
    await expect(sendWhatsAppTemplate(org.actors.pm, consented, 'open_day:en')).rejects.toThrow(
      /permission/i,
    );
    await expect(sendWhatsAppTemplate(org.actors.sales, consented, 'unknown:en')).rejects.toThrow(
      /approved templates/,
    );
  });

  it('live mode refuses to send without credentials instead of pretending', async () => {
    await configureIntegration(org.actors.ceo, 'whatsapp', {
      mode: 'live',
      config: { templates: TEMPLATES, phoneNumberId: '123456789012345' },
    });
    const avail = await whatsappAvailability(org.actors.sales);
    expect(avail).toMatchObject({ state: 'misconfigured' });
    await expect(sendWhatsAppTemplate(org.actors.sales, consented, 'open_day:en')).rejects.toThrow(
      /not fully configured/,
    );
  });

  it('live mode calls the Cloud API messages endpoint and records the real outcome (success and failure)', async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = 'test-token';
    process.env.META_GRAPH_VERSION = 'v21.0';
    const ok = vi.fn(
      async () => new Response(JSON.stringify({ messages: [{ id: 'wamid.TEST123' }] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', ok);
    const res = await sendWhatsAppTemplate(org.actors.sales, consented, 'open_day:en');
    expect(res).toMatchObject({ status: 'sent', messageId: 'wamid.TEST123' });
    const [url, init] = ok.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://graph.facebook.com/v21.0/123456789012345/messages');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-token');
    expect(JSON.parse(String(init.body))).toMatchObject({
      to: '919845022222',
      template: { name: 'open_day' },
    });

    const failing = await ingestLead(org.actors.sales, { name: 'Fail Case', phone: '9845055555' }, 'manual');
    await setLeadConsent(org.actors.sales, failing.lead.id, {
      consent: true,
      suppressed: false,
      reason: null,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: 'Template not approved' } }), { status: 400 }),
      ),
    );
    await expect(sendWhatsAppTemplate(org.actors.sales, failing.lead.id, 'open_day:en')).rejects.toThrow(
      /did not accept/,
    );
    const [act] = await db
      .select()
      .from(schema.leadActivities)
      .where(
        and(eq(schema.leadActivities.leadId, failing.lead.id), eq(schema.leadActivities.type, 'whatsapp')),
      );
    expect(act.meta).toMatchObject({ status: 'failed' });
    expect(act.body).toMatch(/failed$/);
    const [conn] = await db
      .select()
      .from(schema.integrationConnections)
      .where(
        and(
          eq(schema.integrationConnections.orgId, org.orgId),
          eq(schema.integrationConnections.provider, 'whatsapp'),
        ),
      );
    expect(conn.status).toBe('error');
    // A failed attempt does not block a retry.
    vi.stubGlobal('fetch', ok);
    await expect(
      sendWhatsAppTemplate(org.actors.sales, failing.lead.id, 'open_day:en'),
    ).resolves.toMatchObject({
      status: 'sent',
    });
  });
});
