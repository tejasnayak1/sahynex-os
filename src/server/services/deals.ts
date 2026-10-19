import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema, type DBOrTx } from '@/db';
import { actorUserId, assertCan, can, type Actor } from '../actor';
import { dealScope } from '../access';
import { audit, diff } from '../audit';
import { emit } from '../automation/events';
import { forbidden, invalid, notFound, precondition } from '../errors';
import { nextRef } from '../refs';
import {
  optDate,
  optDateTime,
  optMoney,
  optStr,
  optUuid,
  parse,
  reqStr,
  strArray,
  type PageParams,
  type Paged,
} from '../validation';
import { getOrg } from './org';

const { deals, dealStageHistory, proposals, handovers, users, clients, leads } = schema;
export type Deal = typeof deals.$inferSelect;
export const DEAL_STAGES = [
  'new_prospect',
  'qualified',
  'discovery_completed',
  'proposal_preparation',
  'proposal_sent',
  'negotiation',
  'won',
  'lost',
] as const;
export const OPEN_DEAL_STAGES = DEAL_STAGES.filter((s) => s !== 'won' && s !== 'lost');
export const DEAL_STAGE_LABEL: Record<Deal['stage'], string> = {
  new_prospect: 'New prospect',
  qualified: 'Qualified',
  discovery_completed: 'Discovery completed',
  proposal_preparation: 'Proposal preparation',
  proposal_sent: 'Proposal sent',
  negotiation: 'Negotiation',
  won: 'Won',
  lost: 'Lost',
};

const dealInputSchema = z.object({
  title: reqStr(200),
  prospectName: reqStr(200),
  prospectOrgType: z
    .enum(['educational_institution', 'company', 'media', 'community', 'government', 'other'])
    .default('educational_institution'),
  clientId: optUuid,
  leadId: optUuid,
  contactName: optStr(200),
  contactEmail: optStr(320),
  contactPhone: optStr(40),
  ownerId: optUuid,
  services: strArray.default([]),
  value: optMoney,
  expectedCloseDate: optDate,
  nextAction: optStr(300),
  nextActionAt: optDateTime,
});

export async function createDeal(actor: Actor, raw: Record<string, unknown>) {
  assertCan(actor, 'deals.write');
  const input = parse(dealInputSchema, raw);
  return db.transaction(async (tx) => {
    const org = await getOrg(tx, actor.orgId);
    const ownerId = input.ownerId ?? actorUserId(actor);
    if (!ownerId) throw invalid('Choose a deal owner.', { ownerId: 'Required' });
    const [owner] = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.id, ownerId),
          eq(users.orgId, actor.orgId),
          eq(users.isActive, true),
          isNull(users.clientId),
        ),
      );
    if (!owner) throw invalid('Choose an active team member as owner.', { ownerId: 'Invalid' });
    if (input.clientId) {
      const [c] = await tx
        .select({ id: clients.id })
        .from(clients)
        .where(and(eq(clients.id, input.clientId), eq(clients.orgId, actor.orgId)));
      if (!c) throw invalid('Unknown client.');
    }
    const ref = await nextRef(tx, actor.orgId, 'DL');
    const [d] = await tx
      .insert(deals)
      .values({
        orgId: actor.orgId,
        ref,
        title: input.title,
        prospectName: input.prospectName,
        prospectOrgType: input.prospectOrgType,
        clientId: input.clientId ?? null,
        leadId: input.leadId ?? null,
        contactName: input.contactName ?? null,
        contactEmail: input.contactEmail ?? null,
        contactPhone: input.contactPhone ?? null,
        ownerId,
        services: input.services,
        valueMinor: input.value ?? 0,
        probability: org.parsedSettings.sales.stageProbability.new_prospect ?? 10,
        expectedCloseDate: input.expectedCloseDate ?? null,
        nextAction: input.nextAction ?? null,
        nextActionAt: input.nextActionAt ?? null,
        lastInteractionAt: new Date(),
      })
      .returning();
    await tx
      .insert(dealStageHistory)
      .values({ dealId: d.id, fromStage: null, toStage: 'new_prospect', actorId: actorUserId(actor) });
    await audit(tx, actor, 'deal.created', 'deal', d.id, {
      after: { ref, title: d.title, valueMinor: d.valueMinor },
    });
    await emit(
      tx,
      actor.orgId,
      'deal.stage_changed',
      { dealId: d.id, from: null, to: 'new_prospect', actorId: actorUserId(actor) },
      `${d.id}:new_prospect:0`,
    );
    return d;
  });
}

async function getDealForUpdate(tx: DBOrTx, actor: Actor, id: string): Promise<Deal> {
  if (!z.string().uuid().safeParse(id).success) throw notFound('Deal');
  const [d] = await tx
    .select()
    .from(deals)
    .where(and(eq(deals.id, id), dealScope(actor)))
    .for('update');
  if (!d) throw notFound('Deal');
  return d;
}

const dealUpdateSchema = dealInputSchema.partial().extend({
  probability: z.preprocess(
    (v) => (v === '' || v == null ? undefined : Number(v)),
    z.number().int().min(0).max(100).optional(),
  ),
  contractStart: optDate,
  contractEnd: optDate,
  renewalDate: optDate,
  discountPct: z.preprocess(
    (v) => (v === '' || v == null ? undefined : Number(v)),
    z.number().min(0).max(100).optional(),
  ),
});

export async function updateDeal(actor: Actor, id: string, raw: Record<string, unknown>) {
  assertCan(actor, 'deals.write');
  const input = parse(dealUpdateSchema, raw);
  return db.transaction(async (tx) => {
    const d = await getDealForUpdate(tx, actor, id);
    if (d.stage === 'won' || d.stage === 'lost') {
      const allowed = ['nextAction', 'nextActionAt', 'contractStart', 'contractEnd', 'renewalDate'];
      if (Object.keys(raw).some((k) => !allowed.includes(k)))
        throw precondition('Closed deals can only have contract and renewal dates updated.');
    }
    const org = await getOrg(tx, actor.orgId);
    const patch: Partial<Deal> = {};
    const map: Record<string, keyof Deal> = { value: 'valueMinor' };
    for (const [k, v] of Object.entries(input)) {
      if (!(k in raw)) continue;
      const col = (map[k] ?? k) as keyof Deal;
      (patch as Record<string, unknown>)[col] = v ?? null;
    }
    if ('services' in raw) patch.services = input.services ?? [];
    if ('value' in raw) patch.valueMinor = input.value ?? 0;
    if (patch.ownerId !== undefined && patch.ownerId !== d.ownerId) {
      if (!patch.ownerId) throw invalid('A deal must have an owner.');
      if (!can(actor, 'deals.read.all')) throw forbidden('Only sales leads can reassign deals.');
    }
    // Commercial control: discounts above the threshold need explicit approval.
    if ('discountPct' in raw) {
      const pct = input.discountPct ?? null;
      patch.discountPct = pct === null ? null : String(pct);
      const needsApproval = pct !== null && pct > org.parsedSettings.sales.discountApprovalAbovePct;
      if (needsApproval && !can(actor, 'deals.approve_commercials')) {
        patch.discountApprovedById = null;
        patch.discountApprovedAt = null;
      } else if (pct !== null) {
        patch.discountApprovedById = actorUserId(actor);
        patch.discountApprovedAt = new Date();
      }
    }
    const dd = diff(d as unknown as Record<string, unknown>, patch as Record<string, unknown>);
    if (!dd.changed) return d;
    const [u] = await tx
      .update(deals)
      .set({ ...patch, lastInteractionAt: new Date() })
      .where(eq(deals.id, id))
      .returning();
    await audit(tx, actor, 'deal.updated', 'deal', id, { before: dd.before, after: dd.after });
    return u;
  });
}

export async function approveDiscount(actor: Actor, id: string) {
  assertCan(actor, 'deals.approve_commercials');
  return db.transaction(async (tx) => {
    const d = await getDealForUpdate(tx, actor, id);
    if (!d.discountPct) throw precondition('There is no discount to approve.');
    const [u] = await tx
      .update(deals)
      .set({ discountApprovedById: actorUserId(actor), discountApprovedAt: new Date() })
      .where(eq(deals.id, id))
      .returning();
    await audit(tx, actor, 'deal.discount_approved', 'deal', id, { after: { discountPct: d.discountPct } });
    return u;
  });
}

export function discountPending(d: Pick<Deal, 'discountPct' | 'discountApprovedAt'>, thresholdPct: number) {
  return d.discountPct !== null && Number(d.discountPct) > thresholdPct && !d.discountApprovedAt;
}

export async function changeDealStage(
  actor: Actor,
  id: string,
  stage: Deal['stage'],
  opts: { lostReason?: string | null; note?: string | null } = {},
) {
  assertCan(actor, 'deals.write');
  if (!(DEAL_STAGES as readonly string[]).includes(stage)) throw invalid('Unknown stage.');
  return db.transaction(async (tx) => {
    const d = await getDealForUpdate(tx, actor, id);
    if (d.stage === stage) return d;
    if (d.stage === 'won' || d.stage === 'lost')
      throw precondition('This deal is closed. Create a new deal for new work.');
    const org = await getOrg(tx, actor.orgId);
    if (stage === 'lost' && !opts.lostReason?.trim())
      throw invalid('Record why the deal was lost.', { lostReason: 'Required' });
    if (stage === 'proposal_sent') {
      const sent = await tx
        .select({ id: proposals.id })
        .from(proposals)
        .where(and(eq(proposals.dealId, id), eq(proposals.status, 'sent')));
      if (!sent.length)
        throw precondition('Send a proposal (Proposals tab) before moving to “Proposal sent”.');
    }
    if (stage === 'won') {
      if (d.valueMinor <= 0) throw precondition('Record the deal value before marking it won.');
      if (discountPending(d, org.parsedSettings.sales.discountApprovalAbovePct))
        throw precondition('The discount on this deal needs approval before it can be marked won.');
    }
    const patch: Partial<Deal> = {
      stage,
      probability: org.parsedSettings.sales.stageProbability[stage] ?? d.probability,
      lastInteractionAt: new Date(),
      staleAlertedAt: null,
    };
    if (stage === 'won')
      Object.assign(patch, { wonAt: new Date(), closedAt: new Date(), nextActionAt: null });
    if (stage === 'lost')
      Object.assign(patch, { lostReason: opts.lostReason, closedAt: new Date(), nextActionAt: null });
    const [u] = await tx.update(deals).set(patch).where(eq(deals.id, id)).returning();
    const [h] = await tx
      .insert(dealStageHistory)
      .values({
        dealId: id,
        fromStage: d.stage,
        toStage: stage,
        actorId: actorUserId(actor),
        note: opts.note ?? opts.lostReason ?? null,
      })
      .returning();
    if (stage === 'won' || stage === 'lost') {
      // Stop proposal follow-ups after closure.
      await tx
        .update(schema.tasks)
        .set({ status: 'cancelled', completionNote: `Deal ${stage}` })
        .where(
          and(
            eq(schema.tasks.dealId, id),
            inArray(schema.tasks.status, ['todo', 'in_progress', 'blocked']),
            sql`${schema.tasks.sourceKey} like 'deal-%'`,
          ),
        );
    }
    await audit(tx, actor, 'deal.stage_changed', 'deal', id, {
      before: { stage: d.stage },
      after: { stage, lostReason: opts.lostReason },
    });
    await emit(
      tx,
      actor.orgId,
      'deal.stage_changed',
      { dealId: id, from: d.stage, to: stage, actorId: actorUserId(actor) },
      `${id}:${stage}:${h.id}`,
    );
    return u;
  });
}

/* ----------------------------------------------------------- proposals */

const proposalSchema = z.object({
  title: reqStr(200),
  value: optMoney,
  summary: optStr(10000),
  documentUrl: optStr(1000),
});

export async function createProposal(actor: Actor, dealId: string, raw: Record<string, unknown>) {
  assertCan(actor, 'deals.write');
  const input = parse(proposalSchema, raw);
  if (input.documentUrl && !/^https:\/\//i.test(input.documentUrl))
    throw invalid('Document link must start with https://');
  return db.transaction(async (tx) => {
    const d = await getDealForUpdate(tx, actor, dealId);
    if (d.stage === 'won' || d.stage === 'lost') throw precondition('Deal is closed.');
    const [{ max }] = await tx
      .select({ max: sql<number>`coalesce(max(${proposals.version}),0)::int` })
      .from(proposals)
      .where(eq(proposals.dealId, dealId));
    // Previous drafts/sent versions are superseded by the new version.
    await tx
      .update(proposals)
      .set({ status: 'superseded' })
      .where(and(eq(proposals.dealId, dealId), inArray(proposals.status, ['draft', 'sent'])));
    const [p] = await tx
      .insert(proposals)
      .values({
        orgId: actor.orgId,
        dealId,
        version: max + 1,
        title: input.title,
        valueMinor: input.value ?? d.valueMinor,
        summary: input.summary ?? null,
        documentUrl: input.documentUrl ?? null,
        createdById: actorUserId(actor),
      })
      .returning();
    await audit(tx, actor, 'proposal.created', 'deal', dealId, {
      after: { version: p.version, valueMinor: p.valueMinor },
    });
    return p;
  });
}

export async function markProposalSent(actor: Actor, proposalId: string) {
  assertCan(actor, 'deals.write');
  return db
    .transaction(async (tx) => {
      const [p] = await tx
        .select()
        .from(proposals)
        .where(and(eq(proposals.id, proposalId), eq(proposals.orgId, actor.orgId)))
        .for('update');
      if (!p) throw notFound('Proposal');
      const d = await getDealForUpdate(tx, actor, p.dealId);
      if (p.status !== 'draft') throw precondition('Only draft proposals can be sent.');
      await tx.update(proposals).set({ status: 'sent', sentAt: new Date() }).where(eq(proposals.id, p.id));
      await tx
        .update(deals)
        .set({ valueMinor: p.valueMinor, lastInteractionAt: new Date() })
        .where(eq(deals.id, d.id));
      await audit(tx, actor, 'proposal.sent', 'deal', d.id, {
        after: { version: p.version, valueMinor: p.valueMinor },
      });
      await emit(tx, actor.orgId, 'proposal.sent', { dealId: d.id, proposalId: p.id }, p.id);
      return p;
    })
    .then(async (p) => {
      const [d] = await db.select().from(deals).where(eq(deals.id, p.dealId));
      if (
        d &&
        (OPEN_DEAL_STAGES as readonly string[]).includes(d.stage) &&
        (OPEN_DEAL_STAGES as readonly string[]).indexOf(d.stage) < OPEN_DEAL_STAGES.indexOf('proposal_sent')
      )
        await changeDealStage(actor, d.id, 'proposal_sent');
      return p;
    });
}

export async function recordProposalResponse(actor: Actor, proposalId: string, accepted: boolean) {
  assertCan(actor, 'deals.write');
  return db.transaction(async (tx) => {
    const [p] = await tx
      .select()
      .from(proposals)
      .where(and(eq(proposals.id, proposalId), eq(proposals.orgId, actor.orgId)))
      .for('update');
    if (!p) throw notFound('Proposal');
    await getDealForUpdate(tx, actor, p.dealId);
    if (p.status !== 'sent') throw precondition('Only sent proposals can be accepted or rejected.');
    await tx
      .update(proposals)
      .set({ status: accepted ? 'accepted' : 'rejected', respondedAt: new Date() })
      .where(eq(proposals.id, p.id));
    await audit(tx, actor, accepted ? 'proposal.accepted' : 'proposal.rejected', 'deal', p.dealId, {
      after: { version: p.version },
    });
  });
}

/* ------------------------------------------------------------ handover */

const handoverSchema = z.object({
  projectName: reqStr(200),
  scope: optStr(20000),
  deliverablesSummary: optStr(20000),
  proposedOwnerId: optUuid,
  targetStart: optDate,
  targetEnd: optDate,
  budget: optMoney,
  templateKey: optStr(60),
});

export function handoverMissing(h: Partial<typeof handovers.$inferSelect>): string[] {
  const missing: string[] = [];
  if (!h.scope?.trim()) missing.push('Scope');
  if (!h.deliverablesSummary?.trim()) missing.push('Deliverables');
  if (!h.proposedOwnerId) missing.push('Project owner');
  if (!h.targetStart) missing.push('Target start date');
  if (!h.targetEnd) missing.push('Target end date');
  if (h.budgetMinor == null) missing.push('Budget');
  return missing;
}

export async function saveHandover(actor: Actor, dealId: string, raw: Record<string, unknown>) {
  assertCan(actor, 'deals.write');
  const input = parse(handoverSchema, raw);
  if (input.targetStart && input.targetEnd && input.targetEnd < input.targetStart)
    throw invalid('End date must be after the start date.');
  return db.transaction(async (tx) => {
    const d = await getDealForUpdate(tx, actor, dealId);
    if (d.stage !== 'won') throw precondition('Handover starts once the deal is won.');
    const [existing] = await tx.select().from(handovers).where(eq(handovers.dealId, dealId)).for('update');
    if (existing && existing.status === 'approved')
      throw precondition('This handover is approved and locked.');
    const values = {
      projectName: input.projectName,
      scope: input.scope ?? null,
      deliverablesSummary: input.deliverablesSummary ?? null,
      proposedOwnerId: input.proposedOwnerId ?? null,
      targetStart: input.targetStart ?? null,
      targetEnd: input.targetEnd ?? null,
      budgetMinor: input.budget ?? null,
      templateKey: input.templateKey ?? null,
      status: 'draft' as const,
    };
    const [h] = existing
      ? await tx.update(handovers).set(values).where(eq(handovers.id, existing.id)).returning()
      : await tx
          .insert(handovers)
          .values({ orgId: actor.orgId, dealId, ...values })
          .returning();
    await audit(tx, actor, 'handover.saved', 'deal', dealId, { after: values });
    return h;
  });
}

export async function submitHandover(actor: Actor, dealId: string) {
  assertCan(actor, 'deals.write');
  return db.transaction(async (tx) => {
    await getDealForUpdate(tx, actor, dealId);
    const [h] = await tx.select().from(handovers).where(eq(handovers.dealId, dealId)).for('update');
    if (!h) throw precondition('Fill in the handover first.');
    const missing = handoverMissing(h);
    if (missing.length) throw precondition(`Handover is incomplete: ${missing.join(', ')}.`);
    if (h.status === 'approved') throw precondition('Already approved.');
    await tx
      .update(handovers)
      .set({ status: 'submitted', submittedById: actorUserId(actor), submittedAt: new Date() })
      .where(eq(handovers.id, h.id));
    await audit(tx, actor, 'handover.submitted', 'deal', dealId);
    const { usersWithRoles, notify } = await import('./notifications');
    for (const u of await usersWithRoles(tx, actor.orgId, ['ceo', 'coo']))
      await notify(tx, {
        orgId: actor.orgId,
        userId: u.id,
        type: 'handover.submitted',
        title: `Handover awaiting approval: ${h.projectName}`,
        link: `/deals/${dealId}?tab=handover`,
        dedupeKey: `handover-submitted:${h.id}:${Date.now()}`,
      });
  });
}

/** Commercial approval of the handover. Approval emits `handover.approved` → Workflow 6 creates the project. */
export async function decideHandover(actor: Actor, dealId: string, approve: boolean, note?: string | null) {
  assertCan(actor, 'deals.approve_commercials');
  return db.transaction(async (tx) => {
    const d = await getDealForUpdate(tx, actor, dealId);
    const [h] = await tx.select().from(handovers).where(eq(handovers.dealId, dealId)).for('update');
    if (!h || h.status !== 'submitted') throw precondition('There is no submitted handover to decide.');
    if (!approve && !note?.trim()) throw invalid('Explain what needs to change.', { note: 'Required' });
    const org = await getOrg(tx, actor.orgId);
    if (approve && discountPending(d, org.parsedSettings.sales.discountApprovalAbovePct))
      throw precondition('Approve the deal discount first.');
    await tx
      .update(handovers)
      .set({
        status: approve ? 'approved' : 'rejected',
        commercialApproved: approve,
        decidedById: actorUserId(actor),
        decidedAt: new Date(),
        decisionNote: note ?? null,
      })
      .where(eq(handovers.id, h.id));
    await audit(tx, actor, approve ? 'handover.approved' : 'handover.rejected', 'deal', dealId, {
      after: { note },
    });
    if (approve) await emit(tx, actor.orgId, 'handover.approved', { handoverId: h.id, dealId }, h.id);
    else if (h.submittedById) {
      const { notify } = await import('./notifications');
      await notify(tx, {
        orgId: actor.orgId,
        userId: h.submittedById,
        type: 'handover.rejected',
        severity: 'warning',
        title: `Handover needs changes: ${h.projectName}`,
        body: note ?? undefined,
        link: `/deals/${dealId}?tab=handover`,
        dedupeKey: `handover-rejected:${h.id}:${Date.now()}`,
      });
    }
  });
}

/* ------------------------------------------------------------- queries */

export type DealFilters = PageParams & { stage?: string; ownerId?: string; open?: boolean };

export async function listDeals(
  actor: Actor,
  f: DealFilters,
): Promise<Paged<Deal & { ownerName: string | null }>> {
  const conds: (SQL | undefined)[] = [dealScope(actor)];
  if (f.q) {
    const q = `%${f.q.replace(/[%_]/g, '')}%`;
    conds.push(or(ilike(deals.title, q), ilike(deals.prospectName, q), ilike(deals.ref, q)));
  }
  if (f.stage && (DEAL_STAGES as readonly string[]).includes(f.stage))
    conds.push(eq(deals.stage, f.stage as Deal['stage']));
  if (f.open) conds.push(inArray(deals.stage, OPEN_DEAL_STAGES));
  if (f.ownerId) conds.push(eq(deals.ownerId, f.ownerId));
  const where = and(...conds);
  const sortCol =
    {
      value: deals.valueMinor,
      close: deals.expectedCloseDate,
      title: deals.title,
      createdAt: deals.createdAt,
      updatedAt: deals.updatedAt,
    }[f.sort ?? 'updatedAt'] ?? deals.updatedAt;
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({ d: deals, ownerName: users.name })
      .from(deals)
      .leftJoin(users, eq(users.id, deals.ownerId))
      .where(where)
      .orderBy(f.dir === 'asc' ? sql`${sortCol} asc nulls last` : sql`${sortCol} desc nulls last`)
      .limit(f.pageSize)
      .offset((f.page - 1) * f.pageSize),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(deals)
      .where(where),
  ]);
  return {
    rows: rows.map((r) => ({ ...r.d, ownerName: r.ownerName })),
    total,
    page: f.page,
    pageSize: f.pageSize,
  };
}

/** Pipeline board: open deals grouped by stage (bounded) plus closed deals in the last 90 days. */
export async function pipelineBoard(actor: Actor, ownerId?: string) {
  const rows = await db
    .select({ d: deals, ownerName: users.name })
    .from(deals)
    .leftJoin(users, eq(users.id, deals.ownerId))
    .where(
      and(
        dealScope(actor),
        ownerId ? eq(deals.ownerId, ownerId) : undefined,
        or(inArray(deals.stage, OPEN_DEAL_STAGES), sql`${deals.closedAt} > now() - interval '90 days'`),
      ),
    )
    .orderBy(asc(deals.expectedCloseDate), desc(deals.valueMinor))
    .limit(1000);
  return rows.map((r) => ({ ...r.d, ownerName: r.ownerName }));
}

export async function getDeal(actor: Actor, id: string) {
  if (!z.string().uuid().safeParse(id).success) throw notFound('Deal');
  const [r] = await db
    .select({ d: deals, ownerName: users.name, clientName: clients.name, leadRef: leads.ref })
    .from(deals)
    .leftJoin(users, eq(users.id, deals.ownerId))
    .leftJoin(clients, eq(clients.id, deals.clientId))
    .leftJoin(leads, eq(leads.id, deals.leadId))
    .where(and(eq(deals.id, id), dealScope(actor)));
  if (!r) throw notFound('Deal');
  const [props, history, [handover]] = await Promise.all([
    db.select().from(proposals).where(eq(proposals.dealId, id)).orderBy(desc(proposals.version)),
    db
      .select({ h: dealStageHistory, actorName: users.name })
      .from(dealStageHistory)
      .leftJoin(users, eq(users.id, dealStageHistory.actorId))
      .where(eq(dealStageHistory.dealId, id))
      .orderBy(desc(dealStageHistory.createdAt)),
    db.select().from(handovers).where(eq(handovers.dealId, id)),
  ]);
  return {
    deal: r.d,
    ownerName: r.ownerName,
    clientName: r.clientName,
    leadRef: r.leadRef,
    proposals: props,
    history: history.map((x) => ({ ...x.h, actorName: x.actorName })),
    handover: handover ?? null,
  };
}

export async function pendingHandovers(actor: Actor) {
  if (!can(actor, 'deals.approve_commercials')) return [];
  return db
    .select({ h: handovers, dealTitle: deals.title, dealRef: deals.ref })
    .from(handovers)
    .innerJoin(deals, eq(deals.id, handovers.dealId))
    .where(and(eq(handovers.orgId, actor.orgId), eq(handovers.status, 'submitted')));
}
