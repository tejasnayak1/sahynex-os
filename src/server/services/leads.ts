import { and, asc, desc, eq, ilike, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema, type DBOrTx } from '@/db';
import type { Touch } from '@/db/schema';
import { conflicts, normalizeEmail, normalizePhone, scoreQualification } from '@/lib/normalize';
import { actorUserId, assertCan, can, type Actor } from '../actor';
import { leadScope } from '../access';
import { audit, diff } from '../audit';
import { emit } from '../automation/events';
import { forbidden, invalid, notFound, precondition } from '../errors';
import { nextRef } from '../refs';
import {
  bool,
  optDateTime,
  optStr,
  optUuid,
  parse,
  reqStr,
  type PageParams,
  type Paged,
} from '../validation';
import { getOrg } from './org';

const { leads, leadActivities, leadSources, users, campaigns, clients } = schema;
export type Lead = typeof leads.$inferSelect;

export const LEAD_STAGES = ['new', 'contacted', 'qualified', 'unqualified', 'converted', 'lost'] as const;
const CLOSED_STAGES = ['converted', 'lost', 'unqualified'] as const;

/* --------------------------------------------------------------- input */

export const leadInputSchema = z
  .object({
    name: reqStr(200),
    email: optStr(320),
    phone: optStr(40),
    organisationName: optStr(200),
    leadType: z
      .enum(['client_prospect', 'admission_enquiry', 'partnership', 'other'])
      .default('client_prospect'),
    interest: optStr(300),
    city: optStr(120),
    clientId: optUuid,
    campaignId: optUuid,
    sourceKey: optStr(60),
    externalId: optStr(200),
    utmSource: optStr(200),
    utmMedium: optStr(200),
    utmCampaign: optStr(200),
    utmContent: optStr(200),
    utmTerm: optStr(200),
    gclid: optStr(300),
    fbclid: optStr(300),
    landingPage: optStr(1000),
    consentMarketing: bool.optional(),
    consentSource: optStr(200),
    notes: optStr(5000),
    ownerId: optUuid,
    isTest: bool.optional(),
  })
  .refine((v) => v.email || v.phone, {
    message: 'Provide an email address or a phone number.',
    path: ['email'],
  });
export type LeadInput = { name: string } & Record<string, unknown>;

export type IngestOutcome = 'created' | 'updated' | 'flagged_duplicate';
export type IngestResult = { outcome: IngestOutcome; lead: Lead; message: string };

/* ------------------------------------------------------------- ingest */

/**
 * Single entry point for every lead channel (manual, CSV, API, Meta Lead Ads, landing pages).
 * Workflow 1 steps 1–5 happen here, atomically: Validate → Deduplicate → Store → Capture source → Emit.
 * Assignment, notification and follow-up task creation happen in the `lead.new` automation.
 *
 * Duplicate rules (never silently merges conflicting data):
 *   - exact email/phone match to ONE existing lead and no conflicting fields → update that lead
 *     (fills empty fields only, records latest touch, logs a re-submission activity).
 *   - match with conflicting values (different name, or email matches A while phone matches B)
 *     → new lead created and flagged `possibleDuplicateOfId` for human review.
 *   - no match → new lead.
 * Matching is scoped to the same client (an admissions enquiry for client A never merges with client B).
 */
export async function ingestLead(actor: Actor, rawInput: LeadInput, channel: string): Promise<IngestResult> {
  assertCan(actor, 'leads.write');
  const input = parse(leadInputSchema, rawInput);
  const emailN = normalizeEmail(input.email);
  const phoneN = normalizePhone(input.phone);
  if (input.email && !emailN) throw invalid('Email address is not valid.', { email: 'Invalid email' });
  if (input.phone && !phoneN) throw invalid('Phone number is not valid.', { phone: 'Invalid phone number' });
  if (!emailN && !phoneN) throw invalid('Provide a valid email address or phone number.');

  return db.transaction(async (tx) => {
    const sourceId = await resolveSource(tx, actor.orgId, input.sourceKey ?? channel);
    if (input.clientId) await assertClientExists(tx, actor.orgId, input.clientId);
    if (input.campaignId) await assertCampaignExists(tx, actor.orgId, input.campaignId);

    const touch: Touch = {
      at: new Date().toISOString(),
      source: input.utmSource ?? input.sourceKey ?? channel,
      medium: input.utmMedium ?? null,
      campaign: input.utmCampaign ?? null,
      content: input.utmContent ?? null,
      term: input.utmTerm ?? null,
      gclid: input.gclid ?? null,
      fbclid: input.fbclid ?? null,
      landingPage: input.landingPage ?? null,
    };

    // Idempotent re-delivery of the same external lead (e.g. a webhook retried by Meta).
    if (input.externalId) {
      const [existing] = await tx
        .select()
        .from(leads)
        .where(and(eq(leads.orgId, actor.orgId), eq(leads.externalId, input.externalId)))
        .for('update');
      if (existing)
        return {
          outcome: 'updated',
          lead: existing,
          message: 'Already received (same external ID); no changes made.',
        };
    }

    const matchConds: SQL[] = [];
    if (emailN) matchConds.push(eq(leads.emailNormalized, emailN));
    if (phoneN) matchConds.push(eq(leads.phoneNormalized, phoneN));
    const matches = await tx
      .select()
      .from(leads)
      .where(
        and(
          eq(leads.orgId, actor.orgId),
          isNull(leads.deletedAt),
          input.clientId ? eq(leads.clientId, input.clientId) : isNull(leads.clientId),
          eq(leads.isTest, input.isTest ?? false),
          or(...matchConds),
        ),
      )
      .orderBy(asc(leads.createdAt))
      .for('update');

    const distinct = [...new Map(matches.map((m) => [m.id, m])).values()];
    if (distinct.length === 1) {
      const m = distinct[0];
      const conflict =
        conflicts(m.name, input.name) ||
        (emailN && m.emailNormalized && emailN !== m.emailNormalized) ||
        (phoneN && m.phoneNormalized && phoneN !== m.phoneNormalized) ||
        conflicts(m.organisationName, input.organisationName ?? null);
      if (!conflict) {
        const fill: Partial<Lead> = {};
        if (!m.email && input.email) Object.assign(fill, { email: input.email, emailNormalized: emailN });
        if (!m.phone && input.phone) Object.assign(fill, { phone: input.phone, phoneNormalized: phoneN });
        if (!m.organisationName && input.organisationName) fill.organisationName = input.organisationName;
        if (!m.interest && input.interest) fill.interest = input.interest;
        if (!m.city && input.city) fill.city = input.city;
        if (!m.campaignId && input.campaignId) fill.campaignId = input.campaignId;
        if (input.consentMarketing && !m.consentMarketing && !m.suppressed)
          Object.assign(fill, {
            consentMarketing: true,
            consentCapturedAt: new Date(),
            consentSource: input.consentSource ?? channel,
          });
        const [updated] = await tx
          .update(leads)
          .set({ ...fill, latestTouch: touch })
          .where(eq(leads.id, m.id))
          .returning();
        await tx.insert(leadActivities).values({
          orgId: actor.orgId,
          leadId: m.id,
          actorId: actorUserId(actor),
          type: 'system',
          body: `Re-submitted via ${channel}. ${
            Object.keys(fill).length
              ? `Filled: ${Object.keys(fill)
                  .filter((k) => !k.endsWith('Normalized'))
                  .join(', ')}.`
              : 'No new details.'
          }`,
          meta: { touch },
        });
        await audit(tx, actor, 'lead.resubmitted', 'lead', m.id, { after: fill });
        return {
          outcome: 'updated',
          lead: updated,
          message: `Matched existing lead ${m.ref}; updated without overwriting existing data.`,
        };
      }
    }

    const possibleDuplicateOfId = distinct.length ? distinct[0].id : null;
    const ref = await nextRef(tx, actor.orgId, 'LD');
    const [created] = await tx
      .insert(leads)
      .values({
        orgId: actor.orgId,
        ref,
        clientId: input.clientId ?? null,
        name: input.name,
        email: input.email ?? null,
        emailNormalized: emailN,
        phone: input.phone ?? null,
        phoneNormalized: phoneN,
        organisationName: input.organisationName ?? null,
        leadType: input.leadType,
        interest: input.interest ?? null,
        city: input.city ?? null,
        sourceId,
        campaignId: input.campaignId ?? null,
        externalId: input.externalId ?? null,
        firstTouch: touch,
        latestTouch: touch,
        ownerId: input.ownerId ?? null,
        consentMarketing: input.consentMarketing ?? false,
        consentCapturedAt: input.consentMarketing ? new Date() : null,
        consentSource: input.consentMarketing ? (input.consentSource ?? channel) : null,
        possibleDuplicateOfId,
        isTest: input.isTest ?? false,
      })
      .returning();
    await tx.insert(leadActivities).values({
      orgId: actor.orgId,
      leadId: created.id,
      actorId: actorUserId(actor),
      type: 'system',
      body: possibleDuplicateOfId
        ? `Created via ${channel}. Possible duplicate of ${distinct.map((d) => d.ref).join(', ')} with conflicting details — needs review.`
        : `Created via ${channel}.`,
      meta: { touch },
    });
    if (input.notes) {
      await tx.insert(leadActivities).values({
        orgId: actor.orgId,
        leadId: created.id,
        actorId: actorUserId(actor),
        type: 'note',
        body: input.notes,
      });
    }
    await audit(tx, actor, 'lead.created', 'lead', created.id, {
      after: { ref, channel, possibleDuplicateOfId },
    });
    // Synthetic/test leads never trigger owner notifications or follow-ups.
    if (!created.isTest)
      await emit(tx, actor.orgId, 'lead.created', { leadId: created.id, channel }, created.id);
    return {
      outcome: possibleDuplicateOfId ? 'flagged_duplicate' : 'created',
      lead: created,
      message: possibleDuplicateOfId
        ? `Created ${ref}, flagged as a possible duplicate for review.`
        : `Created ${ref}.`,
    };
  });
}

async function resolveSource(tx: DBOrTx, orgId: string, key: string) {
  const k =
    key
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .slice(0, 60) || 'unknown';
  const [s] = await tx
    .insert(leadSources)
    .values({
      orgId,
      key: k,
      name: k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      channel: k,
    })
    .onConflictDoUpdate({ target: [leadSources.orgId, leadSources.key], set: { key: k } })
    .returning({ id: leadSources.id });
  return s.id;
}

async function assertClientExists(tx: DBOrTx, orgId: string, clientId: string) {
  const [c] = await tx
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.orgId, orgId)));
  if (!c) throw invalid('Unknown client.', { clientId: 'Unknown client' });
}
async function assertCampaignExists(tx: DBOrTx, orgId: string, id: string) {
  const [c] = await tx
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(and(eq(campaigns.id, id), eq(campaigns.orgId, orgId)));
  if (!c) throw invalid('Unknown campaign.', { campaignId: 'Unknown campaign' });
}

/* -------------------------------------------------------- assignment */

/**
 * Picks the next owner. Client enquiries go to the client's account owner when set; otherwise
 * round-robin among active users with `acceptsLeads`, least-recently-assigned first. The row lock
 * makes concurrent assignment fair.
 */
export async function pickOwner(
  tx: DBOrTx,
  orgId: string,
  lead: Pick<Lead, 'clientId'>,
): Promise<string | null> {
  if (lead.clientId) {
    const [c] = await tx
      .select({ ownerId: clients.accountOwnerId })
      .from(clients)
      .where(eq(clients.id, lead.clientId));
    if (c?.ownerId) return c.ownerId;
  }
  const res = await tx.execute<{ id: string }>(sql`
    select id from users where org_id = ${orgId} and is_active and accepts_leads and client_id is null
    order by last_assigned_at asc nulls first, created_at asc limit 1 for update skip locked`);
  const id = res.rows[0]?.id ?? null;
  if (id) await tx.update(users).set({ lastAssignedAt: new Date() }).where(eq(users.id, id));
  return id;
}

export async function assignLead(actor: Actor, leadId: string, ownerId: string) {
  assertCan(actor, 'leads.assign');
  return db.transaction(async (tx) => {
    const lead = await getLeadForUpdate(tx, actor, leadId);
    const [owner] = await tx
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(
        and(
          eq(users.id, ownerId),
          eq(users.orgId, actor.orgId),
          eq(users.isActive, true),
          isNull(users.clientId),
        ),
      );
    if (!owner) throw invalid('Choose an active team member.');
    if (lead.ownerId === ownerId) return lead;
    const [updated] = await tx.update(leads).set({ ownerId }).where(eq(leads.id, lead.id)).returning();
    await tx.insert(leadActivities).values({
      orgId: actor.orgId,
      leadId: lead.id,
      actorId: actorUserId(actor),
      type: 'assignment',
      body: `Assigned to ${owner.name}.`,
      meta: { from: lead.ownerId, to: ownerId },
    });
    await audit(tx, actor, 'lead.assigned', 'lead', lead.id, {
      before: { ownerId: lead.ownerId },
      after: { ownerId },
    });
    const { notify } = await import('./notifications');
    if (actorUserId(actor) !== ownerId)
      await notify(tx, {
        orgId: actor.orgId,
        userId: ownerId,
        type: 'lead.assigned',
        title: `Lead assigned to you: ${lead.name} (${lead.ref})`,
        link: `/leads/${lead.id}`,
        dedupeKey: `lead-assigned:${lead.id}:${ownerId}:${Date.now()}`,
      });
    return updated;
  });
}

/* ------------------------------------------------------------ queries */

export type LeadFilters = PageParams & {
  stage?: string;
  ownerId?: string;
  sourceId?: string;
  clientId?: string;
  qualification?: string;
  overdue?: boolean;
  duplicates?: boolean;
  mine?: boolean;
};

export async function listLeads(
  actor: Actor,
  f: LeadFilters,
): Promise<Paged<Lead & { ownerName: string | null; sourceName: string | null; clientName: string | null }>> {
  const scope = leadScope(actor);
  const conds: (SQL | undefined)[] = [scope];
  if (f.q) {
    const q = `%${f.q.replace(/[%_]/g, '')}%`;
    conds.push(
      or(
        ilike(leads.name, q),
        ilike(leads.email, q),
        ilike(leads.phone, q),
        ilike(leads.ref, q),
        ilike(leads.organisationName, q),
      ),
    );
  }
  if (f.stage && (LEAD_STAGES as readonly string[]).includes(f.stage))
    conds.push(eq(leads.stage, f.stage as Lead['stage']));
  if (f.qualification)
    conds.push(eq(leads.qualificationStatus, f.qualification as Lead['qualificationStatus']));
  if (f.ownerId === 'unassigned') conds.push(isNull(leads.ownerId));
  else if (f.ownerId) conds.push(eq(leads.ownerId, f.ownerId));
  if (f.mine && actor.kind === 'user') conds.push(eq(leads.ownerId, actor.id));
  if (f.sourceId) conds.push(eq(leads.sourceId, f.sourceId));
  if (f.clientId === 'none') conds.push(isNull(leads.clientId));
  else if (f.clientId) conds.push(eq(leads.clientId, f.clientId));
  if (f.overdue)
    conds.push(
      and(lte(leads.nextActionAt, new Date()), sql`${leads.stage} not in ('converted','lost','unqualified')`),
    );
  if (f.duplicates) conds.push(sql`${leads.possibleDuplicateOfId} is not null`);
  const where = and(...conds);
  const sortCol =
    {
      name: leads.name,
      stage: leads.stage,
      nextActionAt: leads.nextActionAt,
      score: leads.score,
      createdAt: leads.createdAt,
    }[f.sort ?? 'createdAt'] ?? leads.createdAt;
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({ lead: leads, ownerName: users.name, sourceName: leadSources.name, clientName: clients.name })
      .from(leads)
      .leftJoin(users, eq(users.id, leads.ownerId))
      .leftJoin(leadSources, eq(leadSources.id, leads.sourceId))
      .leftJoin(clients, eq(clients.id, leads.clientId))
      .where(where)
      .orderBy(
        f.dir === 'asc' ? sql`${sortCol} asc nulls last` : sql`${sortCol} desc nulls last`,
        desc(leads.id),
      )
      .limit(f.pageSize)
      .offset((f.page - 1) * f.pageSize),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(leads)
      .where(where),
  ]);
  return {
    rows: rows.map((r) => ({
      ...r.lead,
      ownerName: r.ownerName,
      sourceName: r.sourceName,
      clientName: r.clientName,
    })),
    total,
    page: f.page,
    pageSize: f.pageSize,
  };
}

export async function getLead(actor: Actor, id: string) {
  if (!z.string().uuid().safeParse(id).success) throw notFound('Lead');
  const [row] = await db
    .select({
      lead: leads,
      ownerName: users.name,
      sourceName: leadSources.name,
      clientName: clients.name,
      campaignName: campaigns.name,
    })
    .from(leads)
    .leftJoin(users, eq(users.id, leads.ownerId))
    .leftJoin(leadSources, eq(leadSources.id, leads.sourceId))
    .leftJoin(clients, eq(clients.id, leads.clientId))
    .leftJoin(campaigns, eq(campaigns.id, leads.campaignId))
    .where(and(eq(leads.id, id), leadScope(actor)));
  if (!row) throw notFound('Lead');
  const activities = await db
    .select({ a: leadActivities, actorName: users.name })
    .from(leadActivities)
    .leftJoin(users, eq(users.id, leadActivities.actorId))
    .where(eq(leadActivities.leadId, id))
    .orderBy(desc(leadActivities.createdAt))
    .limit(200);
  const duplicateOf = row.lead.possibleDuplicateOfId
    ? ((
        await db
          .select({ id: leads.id, ref: leads.ref, name: leads.name })
          .from(leads)
          .where(and(eq(leads.id, row.lead.possibleDuplicateOfId), leadScope(actor)))
      )[0] ?? null)
    : null;
  return { ...row, activities: activities.map((a) => ({ ...a.a, actorName: a.actorName })), duplicateOf };
}

async function getLeadForUpdate(tx: DBOrTx, actor: Actor, id: string): Promise<Lead> {
  if (!z.string().uuid().safeParse(id).success) throw notFound('Lead');
  const [l] = await tx
    .select()
    .from(leads)
    .where(and(eq(leads.id, id), leadScope(actor)))
    .for('update');
  if (!l) throw notFound('Lead');
  return l;
}

/* ------------------------------------------------------------ updates */

const leadUpdateSchema = z.object({
  name: reqStr(200).optional(),
  email: optStr(320),
  phone: optStr(40),
  organisationName: optStr(200),
  interest: optStr(300),
  city: optStr(120),
  leadType: z.enum(['client_prospect', 'admission_enquiry', 'partnership', 'other']).optional(),
  nextAction: optStr(300),
  nextActionAt: optDateTime,
});

export async function updateLead(actor: Actor, id: string, raw: Record<string, unknown>) {
  assertCan(actor, 'leads.write');
  const input = parse(leadUpdateSchema, raw);
  return db.transaction(async (tx) => {
    const lead = await getLeadForUpdate(tx, actor, id);
    const patch: Partial<Lead> = {};
    for (const k of ['name', 'organisationName', 'interest', 'city', 'leadType', 'nextAction'] as const) {
      if (k in raw) (patch as Record<string, unknown>)[k] = input[k] ?? null;
    }
    if ('nextActionAt' in raw) patch.nextActionAt = input.nextActionAt ?? null;
    if ('email' in raw) {
      const n = normalizeEmail(input.email);
      if (input.email && !n) throw invalid('Email address is not valid.', { email: 'Invalid email' });
      Object.assign(patch, { email: input.email ?? null, emailNormalized: n });
    }
    if ('phone' in raw) {
      const n = normalizePhone(input.phone);
      if (input.phone && !n) throw invalid('Phone number is not valid.', { phone: 'Invalid phone' });
      Object.assign(patch, { phone: input.phone ?? null, phoneNormalized: n });
    }
    const nextEmail = 'email' in patch ? patch.emailNormalized : lead.emailNormalized;
    const nextPhone = 'phone' in patch ? patch.phoneNormalized : lead.phoneNormalized;
    if (!nextEmail && !nextPhone) throw invalid('A lead needs an email address or phone number.');
    const d = diff(lead as unknown as Record<string, unknown>, patch as Record<string, unknown>);
    if (!d.changed) return lead;
    const [updated] = await tx.update(leads).set(patch).where(eq(leads.id, id)).returning();
    await audit(tx, actor, 'lead.updated', 'lead', id, { before: d.before, after: d.after });
    return updated;
  });
}

export async function changeLeadStage(
  actor: Actor,
  id: string,
  stage: Lead['stage'],
  reason?: string | null,
) {
  assertCan(actor, 'leads.write');
  if (!(LEAD_STAGES as readonly string[]).includes(stage)) throw invalid('Unknown stage.');
  if (stage === 'converted') throw precondition('Convert a lead by creating a deal from it.');
  if ((stage === 'lost' || stage === 'unqualified') && !reason?.trim())
    throw invalid('Give a reason when closing a lead.', { reason: 'Required' });
  return db.transaction(async (tx) => {
    const lead = await getLeadForUpdate(tx, actor, id);
    if (lead.stage === stage) return lead;
    const patch: Partial<Lead> = { stage };
    if (stage === 'lost' || stage === 'unqualified')
      Object.assign(patch, { lossReason: reason, nextActionAt: null });
    if (stage === 'contacted' && !lead.lastContactAt) patch.lastContactAt = new Date();
    if (stage === 'qualified') patch.qualificationStatus = 'qualified';
    if (stage === 'unqualified') patch.qualificationStatus = 'disqualified';
    const [updated] = await tx.update(leads).set(patch).where(eq(leads.id, id)).returning();
    await tx.insert(leadActivities).values({
      orgId: actor.orgId,
      leadId: id,
      actorId: actorUserId(actor),
      type: 'stage_change',
      body: `Stage: ${lead.stage} → ${stage}${reason ? ` (${reason})` : ''}`,
      meta: { from: lead.stage, to: stage },
    });
    await closeLeadFollowUps(tx, actor, id, stage);
    await audit(tx, actor, 'lead.stage_changed', 'lead', id, {
      before: { stage: lead.stage },
      after: { stage, reason },
    });
    return updated;
  });
}

/** When a lead closes, open follow-up tasks are cancelled so reminders stop. */
async function closeLeadFollowUps(tx: DBOrTx, actor: Actor, leadId: string, stage: string) {
  if (!(CLOSED_STAGES as readonly string[]).includes(stage)) return;
  await tx
    .update(schema.tasks)
    .set({ status: 'cancelled', completionNote: `Lead closed (${stage})` })
    .where(
      and(eq(schema.tasks.leadId, leadId), inArray(schema.tasks.status, ['todo', 'in_progress', 'blocked'])),
    );
}

const activitySchema = z.object({
  type: z.enum(['note', 'call', 'email', 'whatsapp', 'meeting']),
  body: reqStr(5000),
  nextActionAt: optDateTime,
  nextAction: optStr(300),
});

export async function logLeadActivity(actor: Actor, id: string, raw: Record<string, unknown>) {
  assertCan(actor, 'leads.write');
  const input = parse(activitySchema, raw);
  return db.transaction(async (tx) => {
    const lead = await getLeadForUpdate(tx, actor, id);
    await tx.insert(leadActivities).values({
      orgId: actor.orgId,
      leadId: id,
      actorId: actorUserId(actor),
      type: input.type,
      body: input.body,
    });
    const contact = input.type !== 'note';
    const patch: Partial<Lead> = {};
    if (contact) {
      patch.lastContactAt = new Date();
      if (lead.stage === 'new') patch.stage = 'contacted';
    }
    if (input.nextActionAt) patch.nextActionAt = input.nextActionAt;
    if (input.nextAction) patch.nextAction = input.nextAction;
    if (Object.keys(patch).length) await tx.update(leads).set(patch).where(eq(leads.id, id));
    if (contact) {
      // First contact made → the automatic "make first contact" follow-up is complete.
      await tx
        .update(schema.tasks)
        .set({ status: 'done', completedAt: new Date(), completionNote: `Contact logged (${input.type})` })
        .where(
          and(
            eq(schema.tasks.sourceKey, `lead-followup:${id}`),
            inArray(schema.tasks.status, ['todo', 'in_progress']),
          ),
        );
    }
    if (patch.stage)
      await tx.insert(leadActivities).values({
        orgId: actor.orgId,
        leadId: id,
        actorId: actorUserId(actor),
        type: 'stage_change',
        body: 'Stage: new → contacted',
        meta: { from: 'new', to: 'contacted' },
      });
  });
}

/* ------------------------------------------------------- qualification */

export const QUALIFICATION_QUESTIONS: Array<{ key: string; label: string }> = [
  { key: 'budget_confirmed', label: 'Budget confirmed' },
  { key: 'decision_maker', label: 'Speaking to the decision maker' },
  { key: 'clear_need', label: 'Clear, specific need' },
  { key: 'timeline_within_90_days', label: 'Wants to start within 90 days' },
  { key: 'reachable', label: 'Reachable on the provided contact details' },
];

export async function updateQualification(
  actor: Actor,
  id: string,
  answers: Record<string, boolean>,
  notes?: string | null,
) {
  assertCan(actor, 'leads.write');
  return db.transaction(async (tx) => {
    const lead = await getLeadForUpdate(tx, actor, id);
    const data = { ...lead.qualificationData, ...answers, ...(notes ? { notes } : {}) };
    await tx.update(leads).set({ qualificationData: data }).where(eq(leads.id, id));
    await tx.insert(leadActivities).values({
      orgId: actor.orgId,
      leadId: id,
      actorId: actorUserId(actor),
      type: 'note',
      body: `Qualification updated: ${Object.entries(answers)
        .map(([k, v]) => `${k.replace(/_/g, ' ')}=${v ? 'yes' : 'no'}`)
        .join(', ')}${notes ? ` — ${notes}` : ''}`,
    });
    await audit(tx, actor, 'lead.qualification_updated', 'lead', id, {
      before: lead.qualificationData,
      after: data,
    });
    // Workflow 3 applies the rules and next actions. Dedupe by content so identical saves don't re-run.
    await emit(tx, actor.orgId, 'lead.qualification_updated', { leadId: id }, `${id}:${Date.now()}`);
  });
}

/** Applies the configured scoring rules. Called by the qualification workflow; deterministic and idempotent. */
export async function applyQualificationRules(tx: DBOrTx, orgId: string, leadId: string) {
  const org = await getOrg(tx, orgId);
  const [lead] = await tx
    .select()
    .from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.orgId, orgId)))
    .for('update');
  if (!lead) return null;
  const s = org.parsedSettings.leads;
  const score = scoreQualification(lead.qualificationData, s.scoreWeights);
  const status: Lead['qualificationStatus'] = score >= s.qualifyThreshold ? 'qualified' : 'pending';
  const patch: Partial<Lead> = {
    score,
    qualificationStatus: lead.qualificationStatus === 'disqualified' ? 'disqualified' : status,
  };
  // Promote stage only forward from new/contacted; never reopen closed leads. Attribution (touches) is untouched.
  if (patch.qualificationStatus === 'qualified' && (lead.stage === 'new' || lead.stage === 'contacted'))
    patch.stage = 'qualified';
  const [updated] = await tx.update(leads).set(patch).where(eq(leads.id, leadId)).returning();
  return { before: lead, after: updated };
}

/* --------------------------------------------------- consent & privacy */

export async function setLeadConsent(
  actor: Actor,
  id: string,
  opts: { consent: boolean; suppressed: boolean; reason?: string | null },
) {
  assertCan(actor, 'leads.write');
  return db.transaction(async (tx) => {
    const lead = await getLeadForUpdate(tx, actor, id);
    const patch: Partial<Lead> = {
      consentMarketing: opts.suppressed ? false : opts.consent,
      consentCapturedAt: opts.consent && !lead.consentMarketing ? new Date() : lead.consentCapturedAt,
      consentSource: opts.consent && !lead.consentMarketing ? 'manual' : lead.consentSource,
      suppressed: opts.suppressed,
      suppressedReason: opts.suppressed ? (opts.reason ?? 'Opted out') : null,
    };
    await tx.update(leads).set(patch).where(eq(leads.id, id));
    await tx.insert(leadActivities).values({
      orgId: actor.orgId,
      leadId: id,
      actorId: actorUserId(actor),
      type: 'system',
      body: opts.suppressed
        ? `Suppressed from marketing: ${patch.suppressedReason}`
        : opts.consent
          ? 'Marketing consent recorded.'
          : 'Marketing consent withdrawn.',
    });
    await audit(tx, actor, 'lead.consent_changed', 'lead', id, {
      before: { consent: lead.consentMarketing, suppressed: lead.suppressed },
      after: { consent: patch.consentMarketing, suppressed: patch.suppressed },
    });
  });
}

export async function archiveLead(actor: Actor, id: string) {
  assertCan(actor, 'leads.delete');
  await db.transaction(async (tx) => {
    const lead = await getLeadForUpdate(tx, actor, id);
    await tx.update(leads).set({ deletedAt: new Date() }).where(eq(leads.id, lead.id));
    await closeLeadFollowUps(tx, actor, id, 'lost');
    await audit(tx, actor, 'lead.archived', 'lead', id);
  });
}

/** Resolve a flagged duplicate: either confirm it is distinct, or archive it as a duplicate. */
export async function resolveDuplicate(actor: Actor, id: string, resolution: 'distinct' | 'archive') {
  assertCan(actor, 'leads.write');
  if (resolution === 'archive' && !can(actor, 'leads.delete')) throw forbidden();
  await db.transaction(async (tx) => {
    const lead = await getLeadForUpdate(tx, actor, id);
    if (!lead.possibleDuplicateOfId) return;
    await tx
      .update(leads)
      .set(
        resolution === 'archive'
          ? { deletedAt: new Date(), possibleDuplicateOfId: lead.possibleDuplicateOfId }
          : { possibleDuplicateOfId: null },
      )
      .where(eq(leads.id, id));
    if (resolution === 'archive') await closeLeadFollowUps(tx, actor, id, 'lost');
    await tx.insert(leadActivities).values({
      orgId: actor.orgId,
      leadId: lead.possibleDuplicateOfId,
      actorId: actorUserId(actor),
      type: 'system',
      body:
        resolution === 'archive'
          ? `Duplicate ${lead.ref} (${lead.name}) archived after review.`
          : `${lead.ref} reviewed and confirmed as a separate lead.`,
    });
    await audit(tx, actor, `lead.duplicate_${resolution}`, 'lead', id);
  });
}

/* ---------------------------------------------------------- convert */

export async function convertLeadToDeal(
  actor: Actor,
  id: string,
  raw: { title?: string; valueRupees?: string | number; services?: string[] },
) {
  assertCan(actor, 'leads.write', 'deals.write');
  const { createDeal } = await import('./deals');
  const lead = (await getLead(actor, id)).lead;
  if (lead.stage === 'converted' && lead.convertedDealId)
    throw precondition('This lead has already been converted.');
  if (lead.clientId)
    throw precondition(
      'Client enquiries (e.g. admissions) are outcomes for the client, not Sahynex sales deals.',
    );
  const deal = await createDeal(actor, {
    title: raw.title || `${lead.organisationName ?? lead.name} — new engagement`,
    prospectName: lead.organisationName ?? lead.name,
    contactName: lead.name,
    contactEmail: lead.email ?? undefined,
    contactPhone: lead.phone ?? undefined,
    value: raw.valueRupees ?? 0,
    services: raw.services ?? [],
    leadId: lead.id,
  });
  await db.transaction(async (tx) => {
    await tx
      .update(leads)
      .set({
        stage: 'converted',
        convertedDealId: deal.id,
        qualificationStatus: 'qualified',
        nextActionAt: null,
      })
      .where(eq(leads.id, lead.id));
    await tx.insert(leadActivities).values({
      orgId: actor.orgId,
      leadId: lead.id,
      actorId: actorUserId(actor),
      type: 'stage_change',
      body: `Converted to deal ${deal.ref}.`,
      meta: { from: lead.stage, to: 'converted', dealId: deal.id },
    });
    await closeLeadFollowUps(tx, actor, lead.id, 'converted');
  });
  return deal;
}

/* ---------------------------------------------------------- reporting */

export async function leadSourceBreakdown(actor: Actor, from: Date, to: Date) {
  return db
    .select({
      source: sql<string>`coalesce(${leadSources.name}, 'Unknown')`,
      total: sql<number>`count(*)::int`,
      qualified: sql<number>`count(*) filter (where ${leads.qualificationStatus} = 'qualified')::int`,
      converted: sql<number>`count(*) filter (where ${leads.stage} = 'converted')::int`,
    })
    .from(leads)
    .leftJoin(leadSources, eq(leadSources.id, leads.sourceId))
    .where(
      and(
        leadScope(actor),
        eq(leads.isTest, false),
        sql`${leads.createdAt} >= ${from}`,
        sql`${leads.createdAt} < ${to}`,
      ),
    )
    .groupBy(leadSources.name)
    .orderBy(desc(sql`count(*)`));
}

export async function listLeadSources(orgId: string) {
  return db.select().from(leadSources).where(eq(leadSources.orgId, orgId)).orderBy(asc(leadSources.name));
}
