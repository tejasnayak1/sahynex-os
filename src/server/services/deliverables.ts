import { and, asc, desc, eq, gte, ilike, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema, type DBOrTx } from '@/db';
import { actorUserId, assertCan, can, type Actor } from '../actor';
import { deliverableScope, projectScope } from '../access';
import { audit, diff } from '../audit';
import { emit } from '../automation/events';
import { forbidden, invalid, notFound, precondition } from '../errors';
import { nextRef } from '../refs';
import { putObject } from '../storage';
import { optDateTime, optStr, optUuid, parse, reqStr, type PageParams, type Paged } from '../validation';

const { deliverables, assets, approvals, revisions, projects, clients, users, tasks } = schema;
export type Deliverable = typeof deliverables.$inferSelect;
export type Approval = typeof approvals.$inferSelect;

export const DELIVERABLE_FORMATS = [
  'poster',
  'reel',
  'testimonial',
  'brand_film',
  'aftermovie',
  'landing_page',
  'newsletter',
  'social_post',
  'admission_campaign',
  'other',
] as const;
export const FORMAT_LABEL: Record<(typeof DELIVERABLE_FORMATS)[number], string> = {
  poster: 'Poster',
  reel: 'Reel',
  testimonial: 'Testimonial',
  brand_film: 'Brand film',
  aftermovie: 'Event aftermovie',
  landing_page: 'Landing page',
  newsletter: 'Newsletter',
  social_post: 'Social post',
  admission_campaign: 'Admission campaign creative',
  other: 'Other',
};

/** Reusable production templates: default brief prompts and timelines per format. */
export const CONTENT_TEMPLATES: Record<
  (typeof DELIVERABLE_FORMATS)[number],
  { brief: string; productionDays: number }
> = {
  poster: {
    brief:
      'Objective:\nKey message / headline:\nMandatory elements (logo, accreditation, dates, contact):\nSizes & placements:\nCTA:',
    productionDays: 3,
  },
  reel: {
    brief:
      'Hook (first 3s):\nStory beats:\nOn-screen text:\nMusic / VO:\nDuration & aspect ratio (9:16):\nCTA:',
    productionDays: 5,
  },
  testimonial: {
    brief:
      'Speaker(s) & consent status:\nQuestions:\nLocation & schedule:\nKey proof points:\nDeliverable cuts:',
    productionDays: 7,
  },
  brand_film: {
    brief:
      'Narrative & tone:\nAudience:\nShot list / locations:\nTalent & permissions:\nRuntime & cut-downs:',
    productionDays: 21,
  },
  aftermovie: {
    brief: 'Event & date:\nMust-capture moments:\nRuntime:\nMusic licensing:\nPublish deadline:',
    productionDays: 5,
  },
  landing_page: {
    brief:
      'Campaign & audience:\nOffer / programme details:\nForm fields & consent text:\nTracking (pixel, GA4 events, UTMs):\nThank-you page:',
    productionDays: 7,
  },
  newsletter: {
    brief: 'Audience segment:\nSubject line options:\nSections:\nCTA & links (UTM-tagged):\nSend date:',
    productionDays: 3,
  },
  social_post: {
    brief: 'Platform(s):\nCaption:\nHashtags:\nCreative format:\nPublish date:',
    productionDays: 2,
  },
  admission_campaign: {
    brief:
      'Programmes & intake:\nKey USPs (placements, accreditation, facilities):\nEligibility & deadlines:\nChannels:\nLead form & consent:',
    productionDays: 10,
  },
  other: { brief: 'Objective:\nRequirements:\nDeadline:', productionDays: 5 },
};

const deliverableSchema = z.object({
  projectId: z.string().uuid('Choose a project'),
  campaignId: optUuid,
  title: reqStr(300),
  format: z.enum(DELIVERABLE_FORMATS).default('social_post'),
  channel: optStr(100),
  audience: optStr(300),
  brief: optStr(20000),
  objective: optStr(200),
  priority: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  ),
  ownerId: optUuid,
  dueAt: optDateTime,
  publishAt: optDateTime,
});

export async function createDeliverable(actor: Actor, raw: Record<string, unknown>) {
  assertCan(actor, 'content.write');
  const input = parse(deliverableSchema, raw);
  return db.transaction(async (tx) => {
    const [p] = await tx
      .select()
      .from(projects)
      .where(and(eq(projects.id, input.projectId), projectScope(actor)));
    if (!p) throw invalid('Unknown project.', { projectId: 'Unknown project' });
    const ref = await nextRef(tx, actor.orgId, 'DV');
    const [d] = await tx
      .insert(deliverables)
      .values({
        orgId: actor.orgId,
        ref,
        projectId: p.id,
        clientId: p.clientId,
        campaignId: input.campaignId ?? null,
        title: input.title,
        format: input.format,
        channel: input.channel ?? null,
        audience: input.audience ?? null,
        brief: input.brief ?? CONTENT_TEMPLATES[input.format].brief,
        objective: input.objective ?? null,
        priority: input.priority ?? 'medium',
        ownerId: input.ownerId ?? actorUserId(actor),
        dueAt: input.dueAt ?? null,
        publishAt: input.publishAt ?? null,
      })
      .returning();
    await audit(tx, actor, 'deliverable.created', 'deliverable', d.id, { after: { ref, title: d.title } });
    return d;
  });
}

async function getForUpdate(tx: DBOrTx, actor: Actor, id: string): Promise<Deliverable> {
  if (!z.string().uuid().safeParse(id).success) throw notFound('Deliverable');
  const [d] = await tx
    .select()
    .from(deliverables)
    .where(and(eq(deliverables.id, id), deliverableScope(actor)))
    .for('update');
  if (!d) throw notFound('Deliverable');
  return d;
}

export async function updateDeliverable(actor: Actor, id: string, raw: Record<string, unknown>) {
  assertCan(actor, 'content.write');
  const input = parse(deliverableSchema.partial().omit({ projectId: true }), raw);
  return db.transaction(async (tx) => {
    const d = await getForUpdate(tx, actor, id);
    const patch: Partial<Deliverable> = {};
    for (const k of Object.keys(input))
      if (k in raw) (patch as Record<string, unknown>)[k] = (input as Record<string, unknown>)[k] ?? null;
    const dd = diff(d as unknown as Record<string, unknown>, patch as Record<string, unknown>);
    if (!dd.changed) return d;
    const [u] = await tx.update(deliverables).set(patch).where(eq(deliverables.id, id)).returning();
    await audit(tx, actor, 'deliverable.updated', 'deliverable', id, { before: dd.before, after: dd.after });
    return u;
  });
}

/** Upload a new version. Versions are immutable; a revision request is resolved by the next upload. */
export async function uploadVersion(
  actor: Actor,
  id: string,
  file: { name: string; data: Buffer },
  note?: string | null,
) {
  assertCan(actor, 'content.write');
  const stored = await putObject(actor.orgId, file.data, file.name);
  return db.transaction(async (tx) => {
    const d = await getForUpdate(tx, actor, id);
    if (['internal_review', 'submitted_to_client'].includes(d.status))
      throw precondition('A version is under review. Wait for the decision before uploading a new one.');
    if (['approved', 'scheduled', 'published'].includes(d.status))
      throw precondition('This deliverable is approved. Create a new deliverable for further changes.');
    const version = d.currentVersion + 1;
    const [a] = await tx
      .insert(assets)
      .values({
        orgId: actor.orgId,
        deliverableId: id,
        projectId: d.projectId,
        clientId: d.clientId,
        version,
        uploadedById: actorUserId(actor),
        ...stored,
      })
      .returning();
    const status = d.status === 'changes_requested' ? 'revised' : d.status;
    await tx.update(deliverables).set({ currentVersion: version, status }).where(eq(deliverables.id, id));
    const open = await tx
      .select()
      .from(revisions)
      .where(and(eq(revisions.deliverableId, id), sql`${revisions.resolvedAt} is null`));
    for (const r of open) {
      await tx
        .update(revisions)
        .set({ toVersion: version, resolvedAt: new Date() })
        .where(eq(revisions.id, r.id));
      if (r.taskId)
        await tx
          .update(tasks)
          .set({ status: 'done', completedAt: new Date(), completionNote: `Uploaded v${version}` })
          .where(and(eq(tasks.id, r.taskId), inArray(tasks.status, ['todo', 'in_progress', 'blocked'])));
    }
    await audit(tx, actor, 'deliverable.version_uploaded', 'deliverable', id, {
      after: { version, fileName: stored.fileName, sha256: stored.sha256, note },
    });
    return a;
  });
}

export async function submitForInternalReview(actor: Actor, id: string, reviewerId?: string | null) {
  assertCan(actor, 'content.write');
  return db.transaction(async (tx) => {
    const d = await getForUpdate(tx, actor, id);
    if (!['draft', 'revised'].includes(d.status))
      throw precondition(
        d.status === 'changes_requested'
          ? 'Upload a revised version first.'
          : `Cannot submit while ${d.status.replace(/_/g, ' ')}.`,
      );
    if (d.currentVersion < 1) throw precondition('Upload a version before submitting for review.');
    const [asset] = await tx
      .select()
      .from(assets)
      .where(and(eq(assets.deliverableId, id), eq(assets.version, d.currentVersion)));
    if (reviewerId) {
      const [r] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, reviewerId), eq(users.orgId, actor.orgId), eq(users.isActive, true)));
      if (!r) throw invalid('Unknown reviewer.');
    }
    const [ap] = await tx
      .insert(approvals)
      .values({
        orgId: actor.orgId,
        deliverableId: id,
        version: d.currentVersion,
        stage: 'internal',
        assetId: asset?.id ?? null,
        reviewerId: reviewerId ?? null,
        submittedById: actorUserId(actor),
      })
      .returning();
    await tx.update(deliverables).set({ status: 'internal_review' }).where(eq(deliverables.id, id));
    await audit(tx, actor, 'deliverable.submitted_internal', 'deliverable', id, {
      after: { version: d.currentVersion, approvalId: ap.id },
    });
    await emit(
      tx,
      actor.orgId,
      'deliverable.submitted',
      { deliverableId: id, approvalId: ap.id, stage: 'internal' },
      ap.id,
    );
    return ap;
  });
}

/**
 * Records a review decision. Only authorised reviewers may decide:
 *  - internal stage → `approvals.internal`
 *  - client stage   → a client reviewer of THAT client, or an internal user with `approvals.client`
 *                     recording the client's decision (a note naming the client contact is required).
 * Nothing is ever published automatically.
 */
export async function decideApproval(
  actor: Actor,
  approvalId: string,
  decision: 'approved' | 'changes_requested',
  feedback?: string | null,
) {
  if (!z.string().uuid().safeParse(approvalId).success) throw notFound('Approval');
  return db.transaction(async (tx) => {
    const [ap] = await tx
      .select()
      .from(approvals)
      .where(and(eq(approvals.id, approvalId), eq(approvals.orgId, actor.orgId)))
      .for('update');
    if (!ap) throw notFound('Approval');
    const d = await getForUpdate(tx, actor, ap.deliverableId);
    if (ap.decision !== 'pending') throw precondition('This review has already been decided.');
    if (ap.version !== d.currentVersion)
      throw precondition('A newer version exists; this review is out of date.');
    if (ap.stage === 'internal') {
      if (!can(actor, 'approvals.internal') || actor.clientId)
        throw forbidden('You are not an internal reviewer.');
    } else {
      if (!can(actor, 'approvals.client')) throw forbidden('You cannot record client approvals.');
      if (actor.clientId && actor.clientId !== d.clientId) throw forbidden();
      if (!actor.clientId && !feedback?.trim())
        throw invalid(
          'When recording a decision on the client’s behalf, note who decided and how (e.g. “Approved by Dr. Rao by email”).',
          { feedback: 'Required' },
        );
    }
    if (decision === 'changes_requested' && !feedback?.trim())
      throw invalid('Describe the changes needed.', { feedback: 'Required' });

    await tx
      .update(approvals)
      .set({
        decision,
        feedback: feedback?.trim() || null,
        decidedById: actorUserId(actor),
        decidedAt: new Date(),
      })
      .where(eq(approvals.id, ap.id));
    let nextStatus: Deliverable['status'];
    let clientApprovalId: string | null = null;
    if (decision === 'changes_requested') {
      nextStatus = 'changes_requested';
      await tx.insert(revisions).values({
        orgId: actor.orgId,
        deliverableId: d.id,
        approvalId: ap.id,
        fromVersion: ap.version,
        feedback: feedback ?? null,
      });
      await tx
        .update(deliverables)
        .set({ revisionCount: d.revisionCount + 1 })
        .where(eq(deliverables.id, d.id));
    } else if (ap.stage === 'internal') {
      const [p] = await tx
        .select({ approvalRequired: projects.approvalRequired })
        .from(projects)
        .where(eq(projects.id, d.projectId));
      if (p?.approvalRequired) {
        nextStatus = 'submitted_to_client';
        const [ca] = await tx
          .insert(approvals)
          .values({
            orgId: actor.orgId,
            deliverableId: d.id,
            version: ap.version,
            stage: 'client',
            assetId: ap.assetId,
            submittedById: actorUserId(actor),
          })
          .returning();
        clientApprovalId = ca.id;
      } else nextStatus = 'approved';
    } else nextStatus = 'approved';
    const patch: Partial<Deliverable> = { status: nextStatus };
    if (nextStatus === 'approved') patch.finalAssetId = ap.assetId;
    await tx.update(deliverables).set(patch).where(eq(deliverables.id, d.id));
    await audit(tx, actor, `approval.${decision}`, 'deliverable', d.id, {
      after: { stage: ap.stage, version: ap.version, feedback, approvalId: ap.id },
    });
    await emit(
      tx,
      actor.orgId,
      'approval.decided',
      { deliverableId: d.id, approvalId: ap.id, decision, stage: ap.stage, clientApprovalId },
      ap.id,
    );
    return { status: nextStatus, clientApprovalId };
  });
}

export async function schedulePublication(actor: Actor, id: string, publishAt: Date) {
  assertCan(actor, 'content.write');
  return db.transaction(async (tx) => {
    const d = await getForUpdate(tx, actor, id);
    if (d.status !== 'approved' && d.status !== 'scheduled')
      throw precondition('Only approved deliverables can be scheduled.');
    await tx.update(deliverables).set({ status: 'scheduled', publishAt }).where(eq(deliverables.id, id));
    await audit(tx, actor, 'deliverable.scheduled', 'deliverable', id, { after: { publishAt } });
  });
}

/** Manual publishing handoff: the person who published records where it went live. */
export async function markPublished(actor: Actor, id: string, finalUrl?: string | null) {
  assertCan(actor, 'content.write');
  if (finalUrl && !/^https?:\/\//i.test(finalUrl)) throw invalid('Enter the full link (https://…).');
  return db.transaction(async (tx) => {
    const d = await getForUpdate(tx, actor, id);
    if (d.status !== 'approved' && d.status !== 'scheduled')
      throw precondition('Only approved deliverables can be published.');
    await tx
      .update(deliverables)
      .set({ status: 'published', publishedAt: new Date(), finalUrl: finalUrl ?? null })
      .where(eq(deliverables.id, id));
    await audit(tx, actor, 'deliverable.published', 'deliverable', id, { after: { finalUrl } });
  });
}

/* ------------------------------------------------------------ queries */

export type DeliverableFilters = PageParams & {
  status?: string;
  projectId?: string;
  clientId?: string;
  format?: string;
  ownerId?: string;
};

export async function listDeliverables(
  actor: Actor,
  f: DeliverableFilters,
): Promise<Paged<Deliverable & { projectName: string; clientName: string; ownerName: string | null }>> {
  const conds: (SQL | undefined)[] = [deliverableScope(actor)];
  if (f.q)
    conds.push(
      or(
        ilike(deliverables.title, `%${f.q.replace(/[%_]/g, '')}%`),
        ilike(deliverables.ref, `%${f.q.replace(/[%_]/g, '')}%`),
      ),
    );
  if (f.status) conds.push(eq(deliverables.status, f.status as Deliverable['status']));
  if (f.projectId) conds.push(eq(deliverables.projectId, f.projectId));
  if (f.clientId) conds.push(eq(deliverables.clientId, f.clientId));
  if (f.format) conds.push(eq(deliverables.format, f.format as Deliverable['format']));
  if (f.ownerId) conds.push(eq(deliverables.ownerId, f.ownerId));
  const where = and(...conds);
  const sortCol =
    {
      due: deliverables.dueAt,
      publish: deliverables.publishAt,
      title: deliverables.title,
      updatedAt: deliverables.updatedAt,
    }[f.sort ?? 'updatedAt'] ?? deliverables.updatedAt;
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        d: deliverables,
        projectName: projects.name,
        clientName: clients.name,
        ownerName: users.name,
      })
      .from(deliverables)
      .innerJoin(projects, eq(projects.id, deliverables.projectId))
      .innerJoin(clients, eq(clients.id, deliverables.clientId))
      .leftJoin(users, eq(users.id, deliverables.ownerId))
      .where(where)
      .orderBy(f.dir === 'asc' ? sql`${sortCol} asc nulls last` : sql`${sortCol} desc nulls last`)
      .limit(f.pageSize)
      .offset((f.page - 1) * f.pageSize),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(deliverables)
      .where(where),
  ]);
  return {
    rows: rows.map((r) => ({
      ...r.d,
      projectName: r.projectName,
      clientName: r.clientName,
      ownerName: r.ownerName,
    })),
    total,
    page: f.page,
    pageSize: f.pageSize,
  };
}

export async function contentCalendar(actor: Actor, from: Date, to: Date) {
  return db
    .select({
      id: deliverables.id,
      ref: deliverables.ref,
      title: deliverables.title,
      status: deliverables.status,
      format: deliverables.format,
      channel: deliverables.channel,
      publishAt: deliverables.publishAt,
      dueAt: deliverables.dueAt,
      clientName: clients.name,
    })
    .from(deliverables)
    .innerJoin(clients, eq(clients.id, deliverables.clientId))
    .where(
      and(
        deliverableScope(actor),
        or(
          and(gte(deliverables.publishAt, from), lt(deliverables.publishAt, to)),
          and(gte(deliverables.dueAt, from), lt(deliverables.dueAt, to)),
        ),
      ),
    )
    .orderBy(asc(sql`coalesce(${deliverables.publishAt}, ${deliverables.dueAt})`))
    .limit(1000);
}

export async function getDeliverable(actor: Actor, id: string) {
  if (!z.string().uuid().safeParse(id).success) throw notFound('Deliverable');
  const [r] = await db
    .select({ d: deliverables, projectName: projects.name, clientName: clients.name, ownerName: users.name })
    .from(deliverables)
    .innerJoin(projects, eq(projects.id, deliverables.projectId))
    .innerJoin(clients, eq(clients.id, deliverables.clientId))
    .leftJoin(users, eq(users.id, deliverables.ownerId))
    .where(and(eq(deliverables.id, id), deliverableScope(actor)));
  if (!r) throw notFound('Deliverable');
  // Client reviewers see only versions that were submitted to them.
  const clientVisibleVersions = actor.clientId
    ? (
        await db
          .select({ v: approvals.version })
          .from(approvals)
          .where(and(eq(approvals.deliverableId, id), eq(approvals.stage, 'client')))
      ).map((x) => x.v)
    : null;
  const [versionRows, approvalRows, revisionRows] = await Promise.all([
    db
      .select({ a: assets, uploadedBy: users.name })
      .from(assets)
      .leftJoin(users, eq(users.id, assets.uploadedById))
      .where(
        and(
          eq(assets.deliverableId, id),
          clientVisibleVersions
            ? inArray(assets.version, clientVisibleVersions.length ? clientVisibleVersions : [-1])
            : undefined,
        ),
      )
      .orderBy(desc(assets.version)),
    db
      .select({ ap: approvals, decidedByName: users.name })
      .from(approvals)
      .leftJoin(users, eq(users.id, approvals.decidedById))
      .where(and(eq(approvals.deliverableId, id), actor.clientId ? eq(approvals.stage, 'client') : undefined))
      .orderBy(desc(approvals.submittedAt)),
    actor.clientId
      ? Promise.resolve([])
      : db.select().from(revisions).where(eq(revisions.deliverableId, id)).orderBy(desc(revisions.createdAt)),
  ]);
  return {
    deliverable: r.d,
    projectName: r.projectName,
    clientName: r.clientName,
    ownerName: r.ownerName,
    versions: versionRows.map((v) => ({ ...v.a, uploadedByName: v.uploadedBy })),
    approvals: approvalRows.map((a) => ({ ...a.ap, decidedByName: a.decidedByName })),
    revisions: revisionRows,
  };
}

/** Pending approvals the actor can act on. */
export async function approvalQueue(actor: Actor) {
  const stages: Array<'internal' | 'client'> = [];
  if (can(actor, 'approvals.internal') && !actor.clientId) stages.push('internal');
  if (can(actor, 'approvals.client')) stages.push('client');
  if (!stages.length) return [];
  return db
    .select({
      ap: approvals,
      title: deliverables.title,
      ref: deliverables.ref,
      clientName: clients.name,
      format: deliverables.format,
      deliverableId: deliverables.id,
    })
    .from(approvals)
    .innerJoin(deliverables, eq(deliverables.id, approvals.deliverableId))
    .innerJoin(clients, eq(clients.id, deliverables.clientId))
    .where(and(eq(approvals.decision, 'pending'), inArray(approvals.stage, stages), deliverableScope(actor)))
    .orderBy(asc(approvals.submittedAt))
    .limit(200);
}

/** Asset access check used by the signed download route. */
export async function canAccessAsset(actor: Actor, assetId: string) {
  if (!z.string().uuid().safeParse(assetId).success) return null;
  const [a] = await db
    .select()
    .from(assets)
    .where(and(eq(assets.id, assetId), eq(assets.orgId, actor.orgId)));
  if (!a?.deliverableId) return null;
  const [d] = await db
    .select({ id: deliverables.id })
    .from(deliverables)
    .where(and(eq(deliverables.id, a.deliverableId), deliverableScope(actor)));
  if (!d) return null;
  if (actor.clientId) {
    const [shared] = await db
      .select({ id: approvals.id })
      .from(approvals)
      .where(
        and(
          eq(approvals.deliverableId, a.deliverableId),
          eq(approvals.stage, 'client'),
          eq(approvals.version, a.version ?? -1),
        ),
      );
    if (!shared) return null;
  }
  return a;
}
