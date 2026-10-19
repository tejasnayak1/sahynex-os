import { randomUUID } from 'node:crypto';
import { addMinutes, differenceInMinutes } from 'date-fns';
import { and, asc, eq, inArray, notInArray } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema, type DBOrTx } from '@/db';
import { buildIcs } from '@/lib/ics';
import { actorUserId, assertCan, type Actor } from '../actor';
import { dealScope, leadScope } from '../access';
import { audit } from '../audit';
import { invalid, notFound, precondition } from '../errors';
import { sendMail, type MailResult } from '../mailer';
import { bool, optDateTime, optInt, optStr, optUuid, parse, reqStr } from '../validation';
import { changeDealStage } from './deals';
import { createSystemTask } from './tasks';

const { meetings, deals, leads, leadActivities, tasks, users } = schema;
export type Meeting = typeof meetings.$inferSelect;

export const MEETING_PURPOSES = ['discovery', 'proposal_review', 'negotiation', 'kickoff', 'other'] as const;
export const PURPOSE_LABEL: Record<(typeof MEETING_PURPOSES)[number], string> = {
  discovery: 'Discovery meeting',
  proposal_review: 'Proposal walkthrough',
  negotiation: 'Negotiation',
  kickoff: 'Kick-off',
  other: 'Meeting',
};
const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const OPEN_TASK = ['todo', 'in_progress', 'blocked', 'in_review'] as const;

const attendeesField = z.preprocess(
  (v) =>
    (Array.isArray(v) ? v : String(v ?? '').split(/[\s,;]+/))
      .map((s) => String(s).trim().toLowerCase())
      .filter(Boolean),
  z
    .array(z.string().regex(EMAIL, 'Each attendee must be an email address.'))
    .max(20, 'At most 20 attendees.'),
);

const scheduleSchema = z.object({
  dealId: optUuid,
  leadId: optUuid,
  title: optStr(200),
  purpose: z.enum(MEETING_PURPOSES).default('discovery'),
  startAt: optDateTime,
  durationMinutes: optInt(15, 480),
  location: optStr(500),
  attendees: attendeesField,
  agenda: optStr(4000),
  emailInvite: bool.default(false),
});

const rescheduleSchema = z.object({
  startAt: optDateTime,
  durationMinutes: optInt(15, 480),
  location: optStr(500),
  emailInvite: bool.default(false),
});

const completeSchema = z.object({
  status: z.enum(['completed', 'no_show']).default('completed'),
  outcome: optStr(4000),
  markDiscoveryCompleted: bool.default(false),
});

/* ------------------------------------------------------------ access */

type Subject = { kind: 'deal' | 'lead'; id: string; name: string; ownerId: string | null; stage: string };

async function loadSubject(
  tx: DBOrTx,
  actor: Actor,
  ref: { dealId?: string | null; leadId?: string | null },
): Promise<Subject> {
  if (ref.dealId) {
    const [d] = await tx
      .select({ id: deals.id, name: deals.prospectName, ownerId: deals.ownerId, stage: deals.stage })
      .from(deals)
      .where(and(eq(deals.id, ref.dealId), dealScope(actor)));
    if (!d) throw notFound('Deal');
    return { kind: 'deal', ...d };
  }
  if (ref.leadId) {
    const [l] = await tx
      .select({ id: leads.id, name: leads.name, ownerId: leads.ownerId, stage: leads.stage })
      .from(leads)
      .where(and(eq(leads.id, ref.leadId), leadScope(actor)));
    if (!l) throw notFound('Lead');
    return { kind: 'lead', ...l };
  }
  throw invalid('A meeting belongs to a deal or a lead.');
}

function assertWrite(actor: Actor, kind: Subject['kind']) {
  assertCan(actor, kind === 'deal' ? 'deals.write' : 'leads.write');
}

/** Loads a meeting only if the actor can see the deal or lead it belongs to. */
async function getMeetingScoped(tx: DBOrTx, actor: Actor, id: string, lock = false) {
  if (!z.string().uuid().safeParse(id).success) throw notFound('Meeting');
  const q = tx
    .select()
    .from(meetings)
    .where(and(eq(meetings.id, id), eq(meetings.orgId, actor.orgId)));
  const [m] = lock ? await q.for('update') : await q;
  if (!m) throw notFound('Meeting');
  const subject = await loadSubject(tx, actor, m);
  return { m, subject };
}

/* -------------------------------------------------------------- invites */

async function organizer(tx: DBOrTx, userId: string) {
  const [u] = await tx
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, userId));
  return u ?? null;
}

export async function meetingIcs(actor: Actor, id: string) {
  const { m } = await getMeetingScoped(db, actor, id);
  const org = await organizer(db, m.organizerId);
  return { meeting: m, ics: icsFor(m, org) };
}

function icsFor(m: Meeting, org: { name: string; email: string } | null) {
  const base = process.env.APP_URL ?? '';
  return buildIcs({
    uid: m.icsUid,
    sequence: m.sequence,
    title: m.title,
    start: m.startAt,
    end: m.endAt,
    description: [m.agenda, base && m.dealId ? `Deal: ${base}/deals/${m.dealId}` : null]
      .filter(Boolean)
      .join('\n\n'),
    location: m.location,
    url: m.location && /^https?:\/\//i.test(m.location) ? m.location : null,
    organizer: org,
    attendees: m.attendees,
    cancelled: m.status === 'cancelled',
  });
}

/**
 * Emails the invite to the attendees. Only called when the person explicitly asked for it; the
 * result is reported honestly (sent / SMTP not configured / failed) and only a real send is recorded.
 */
async function emailInvite(m: Meeting): Promise<MailResult> {
  if (!m.attendees.length) return { status: 'failed', error: 'No attendees to invite.' };
  const org = await organizer(db, m.organizerId);
  const when = m.startAt.toLocaleString('en-IN', {
    timeZone: process.env.APP_TIMEZONE ?? 'Asia/Kolkata',
    dateStyle: 'full',
    timeStyle: 'short',
  });
  const cancelled = m.status === 'cancelled';
  const res = await sendMail({
    to: m.attendees,
    subject: `${cancelled ? 'Cancelled: ' : m.sequence > 0 ? 'Updated: ' : ''}${m.title} — ${when}`,
    text: [
      cancelled ? 'This meeting has been cancelled.' : `You're invited: ${m.title}`,
      `When: ${when} (${differenceInMinutes(m.endAt, m.startAt)} minutes)`,
      m.location ? `Where: ${m.location}` : null,
      m.agenda ? `\nAgenda:\n${m.agenda}` : null,
      org ? `\nOrganiser: ${org.name} <${org.email}>` : null,
    ]
      .filter(Boolean)
      .join('\n'),
    icalEvent: {
      method: cancelled ? 'CANCEL' : 'REQUEST',
      filename: 'invite.ics',
      content: icsFor(m, org),
    },
  });
  if (res.status === 'sent')
    await db.update(meetings).set({ inviteEmailedAt: new Date() }).where(eq(meetings.id, m.id));
  return res;
}

/* ------------------------------------------------------------ actions */

export async function scheduleMeeting(
  actor: Actor,
  raw: Record<string, unknown>,
): Promise<{ meeting: Meeting; mail: MailResult | null }> {
  const input = parse(scheduleSchema, raw);
  if (Boolean(input.dealId) === Boolean(input.leadId))
    throw invalid('Schedule the meeting from a deal or a lead.');
  if (!input.startAt) throw invalid('Choose when the meeting starts.', { startAt: 'Required' });
  if (input.startAt.getTime() < Date.now() - 5 * 60_000)
    throw invalid('The meeting start is in the past.', { startAt: 'Choose a future time' });
  if (input.emailInvite && !input.attendees.length)
    throw invalid('Add at least one attendee email to send an invite.', { attendees: 'Required to email' });
  const duration = input.durationMinutes ?? 45;
  const userId = actorUserId(actor);
  if (!userId) throw invalid('Meetings are scheduled by a person.');

  const meeting = await db.transaction(async (tx) => {
    const subject = await loadSubject(tx, actor, input);
    assertWrite(actor, subject.kind);
    if (subject.kind === 'deal' && ['won', 'lost'].includes(subject.stage))
      throw precondition('This deal is closed.');
    const title = input.title ?? `${PURPOSE_LABEL[input.purpose]} — ${subject.name}`;
    const endAt = addMinutes(input.startAt!, duration);
    const id = randomUUID();
    const [m] = await tx
      .insert(meetings)
      .values({
        id,
        orgId: actor.orgId,
        dealId: subject.kind === 'deal' ? subject.id : null,
        leadId: subject.kind === 'lead' ? subject.id : null,
        title,
        purpose: input.purpose,
        startAt: input.startAt!,
        endAt,
        location: input.location ?? null,
        attendees: input.attendees,
        agenda: input.agenda ?? null,
        organizerId: userId,
        icsUid: `${id}@sahynex-os`,
      })
      .returning();
    // The meeting appears on the organiser's task calendar (start → end) and in My tasks.
    const { task } = await createSystemTask(tx, {
      orgId: actor.orgId,
      sourceKey: `meeting:${id}`,
      title,
      description: input.agenda ?? null,
      ownerId: userId,
      createdById: userId,
      dealId: m.dealId,
      leadId: m.leadId,
      startAt: m.startAt,
      dueAt: endAt,
      priority: 'high',
    });
    await tx.update(meetings).set({ taskId: task.id }).where(eq(meetings.id, id));
    if (subject.kind === 'deal') {
      await tx
        .update(deals)
        .set({ nextAction: title, nextActionAt: m.startAt })
        .where(eq(deals.id, subject.id));
      if (input.purpose === 'discovery')
        // The automation's "Schedule discovery meeting" to-do is now done.
        await tx
          .update(tasks)
          .set({
            status: 'done',
            completedAt: new Date(),
            completionNote: `Meeting scheduled for ${m.startAt.toISOString()}`,
          })
          .where(
            and(
              eq(tasks.orgId, actor.orgId),
              eq(tasks.sourceKey, `deal-discovery:${subject.id}`),
              inArray(tasks.status, [...OPEN_TASK]),
            ),
          );
    } else {
      await tx.update(leads).set({ nextActionAt: m.startAt }).where(eq(leads.id, subject.id));
      await tx.insert(leadActivities).values({
        orgId: actor.orgId,
        leadId: subject.id,
        actorId: userId,
        type: 'meeting',
        body: `Scheduled: ${title}`,
        meta: { meetingId: id, startAt: m.startAt.toISOString() },
      });
    }
    await audit(tx, actor, 'meeting.scheduled', 'meeting', id, {
      after: { title, startAt: m.startAt, endAt, dealId: m.dealId, leadId: m.leadId, attendees: m.attendees },
    });
    return { ...m, taskId: task.id };
  });
  const mail = input.emailInvite ? await emailInvite(meeting) : null;
  return { meeting, mail };
}

export async function rescheduleMeeting(actor: Actor, id: string, raw: Record<string, unknown>) {
  const input = parse(rescheduleSchema, raw);
  const meeting = await db.transaction(async (tx) => {
    const { m, subject } = await getMeetingScoped(tx, actor, id, true);
    assertWrite(actor, subject.kind);
    if (m.status !== 'scheduled') throw precondition('Only scheduled meetings can be moved.');
    const startAt = input.startAt ?? m.startAt;
    if (input.startAt && startAt.getTime() < Date.now() - 5 * 60_000)
      throw invalid('The new start is in the past.', { startAt: 'Choose a future time' });
    const duration = input.durationMinutes ?? differenceInMinutes(m.endAt, m.startAt);
    const endAt = addMinutes(startAt, duration);
    const location = 'location' in raw ? (input.location ?? null) : m.location;
    if (
      startAt.getTime() === m.startAt.getTime() &&
      endAt.getTime() === m.endAt.getTime() &&
      location === m.location
    )
      return m;
    const [u] = await tx
      .update(meetings)
      .set({ startAt, endAt, location, sequence: m.sequence + 1 })
      .where(eq(meetings.id, id))
      .returning();
    if (m.taskId)
      await tx
        .update(tasks)
        .set({ startAt, dueAt: endAt, reminderSentAt: null, overdueEscalatedAt: null })
        .where(eq(tasks.id, m.taskId));
    if (m.dealId) await tx.update(deals).set({ nextActionAt: startAt }).where(eq(deals.id, m.dealId));
    if (m.leadId) await tx.update(leads).set({ nextActionAt: startAt }).where(eq(leads.id, m.leadId));
    await audit(tx, actor, 'meeting.rescheduled', 'meeting', id, {
      before: { startAt: m.startAt, endAt: m.endAt, location: m.location },
      after: { startAt, endAt, location },
    });
    return u;
  });
  const mail = input.emailInvite ? await emailInvite(meeting) : null;
  return { meeting, mail };
}

export async function cancelMeeting(actor: Actor, id: string, raw: Record<string, unknown>) {
  const reason = parse(optStr(1000), raw.reason);
  const notifyAttendees = parse(bool, raw.emailInvite);
  const meeting = await db.transaction(async (tx) => {
    const { m, subject } = await getMeetingScoped(tx, actor, id, true);
    assertWrite(actor, subject.kind);
    if (m.status !== 'scheduled') throw precondition('This meeting is not scheduled.');
    const [u] = await tx
      .update(meetings)
      .set({ status: 'cancelled', outcome: reason ?? null, sequence: m.sequence + 1 })
      .where(eq(meetings.id, id))
      .returning();
    if (m.taskId)
      await tx
        .update(tasks)
        .set({ status: 'cancelled', completionNote: reason ?? 'Meeting cancelled' })
        .where(and(eq(tasks.id, m.taskId), notInArray(tasks.status, ['done', 'cancelled'])));
    if (m.leadId)
      await tx.insert(leadActivities).values({
        orgId: actor.orgId,
        leadId: m.leadId,
        actorId: actorUserId(actor),
        type: 'meeting',
        body: `Cancelled: ${m.title}${reason ? ` — ${reason}` : ''}`,
        meta: { meetingId: id },
      });
    await audit(tx, actor, 'meeting.cancelled', 'meeting', id, { after: { reason } });
    return u;
  });
  // Only previously-invited attendees get a cancellation.
  const mail = notifyAttendees && meeting.inviteEmailedAt ? await emailInvite(meeting) : null;
  return { meeting, mail };
}

export async function completeMeeting(actor: Actor, id: string, raw: Record<string, unknown>) {
  const input = parse(completeSchema, raw);
  if (input.status === 'completed' && !input.outcome)
    throw invalid('Record what was discussed and the agreed next step.', { outcome: 'Required' });
  const { m, subject } = await getMeetingScoped(db, actor, id);
  assertWrite(actor, subject.kind);
  if (m.status !== 'scheduled') throw precondition('This meeting has already been closed.');
  if (m.startAt > new Date()) throw precondition('The meeting has not started yet.');
  const updated = await db.transaction(async (tx) => {
    const [u] = await tx
      .update(meetings)
      .set({ status: input.status, outcome: input.outcome ?? null })
      .where(and(eq(meetings.id, id), eq(meetings.status, 'scheduled')))
      .returning();
    if (!u) throw precondition('This meeting has already been closed.');
    if (m.taskId)
      await tx
        .update(tasks)
        .set({
          status: 'done',
          completedAt: new Date(),
          completionNote: input.status === 'no_show' ? 'No-show' : input.outcome,
        })
        .where(and(eq(tasks.id, m.taskId), notInArray(tasks.status, ['done', 'cancelled'])));
    if (m.dealId && input.status === 'completed')
      await tx.update(deals).set({ lastInteractionAt: m.endAt }).where(eq(deals.id, m.dealId));
    if (m.leadId)
      await tx.insert(leadActivities).values({
        orgId: actor.orgId,
        leadId: m.leadId,
        actorId: actorUserId(actor),
        type: 'meeting',
        body: input.status === 'no_show' ? `No-show: ${m.title}` : `Met: ${m.title}\n${input.outcome}`,
        meta: { meetingId: id },
      });
    await audit(tx, actor, 'meeting.closed', 'meeting', id, {
      after: { status: input.status, outcome: input.outcome },
    });
    return u;
  });
  // Stage changes go through the normal pipeline rules (closed deals, notifications, history).
  if (
    input.markDiscoveryCompleted &&
    input.status === 'completed' &&
    subject.kind === 'deal' &&
    ['new_prospect', 'qualified'].includes(subject.stage)
  )
    await changeDealStage(actor, subject.id, 'discovery_completed', { note: `After meeting: ${m.title}` });
  return updated;
}

export async function listMeetings(actor: Actor, ref: { dealId?: string; leadId?: string }) {
  await loadSubject(db, actor, ref);
  const rows = await db
    .select({
      m: meetings,
      organizerName: users.name,
    })
    .from(meetings)
    .innerJoin(users, eq(users.id, meetings.organizerId))
    .where(
      and(
        eq(meetings.orgId, actor.orgId),
        ref.dealId ? eq(meetings.dealId, ref.dealId) : eq(meetings.leadId, ref.leadId!),
      ),
    )
    .orderBy(asc(meetings.startAt));
  return rows.map((r) => ({ ...r.m, organizerName: r.organizerName }));
}
