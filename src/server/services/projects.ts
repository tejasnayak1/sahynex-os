import { addDays, parseISO } from 'date-fns';
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema, type DBOrTx } from '@/db';
import type { TemplateItem } from '@/db/schema';
import { actorUserId, assertCan, can, type Actor } from '../actor';
import { clientScope, projectScope } from '../access';
import { audit, diff } from '../audit';
import { forbidden, invalid, notFound, precondition } from '../errors';
import { nextRef } from '../refs';
import {
  bool,
  optDate,
  optMoney,
  optStr,
  optUuid,
  parse,
  reqStr,
  type PageParams,
  type Paged,
} from '../validation';
import { createSystemTask } from './tasks';
import { notify } from './notifications';

const {
  projects,
  projectMembers,
  milestones,
  clients,
  users,
  handovers,
  budgets,
  taskTemplates,
  tasks,
  taskDependencies,
  roles,
  deliverables,
} = schema;
export type Project = typeof projects.$inferSelect;

const projectSchema = z.object({
  clientId: z.string().uuid('Choose a client'),
  name: reqStr(200),
  scope: optStr(20000),
  objectives: optStr(20000),
  ownerId: optUuid,
  startDate: optDate,
  endDate: optDate,
  budget: optMoney,
  revenue: optMoney,
  reportingCadence: z.enum(['none', 'weekly', 'monthly']).default('monthly'),
  approvalRequired: bool.default(true),
  risks: optStr(10000),
});

export async function createProject(actor: Actor, raw: Record<string, unknown>) {
  assertCan(actor, 'projects.write');
  const input = parse(projectSchema, raw);
  if (input.startDate && input.endDate && input.endDate < input.startDate)
    throw invalid('End date must be after start date.');
  if ((input.budget !== undefined || input.revenue !== undefined) && !can(actor, 'projects.commercials'))
    throw forbidden('You cannot set project commercials.');
  return db.transaction(async (tx) => {
    const [c] = await tx
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.id, input.clientId), clientScope(actor)));
    if (!c) throw invalid('Unknown client.', { clientId: 'Unknown client' });
    const ref = await nextRef(tx, actor.orgId, 'PRJ');
    const ownerId = input.ownerId ?? actorUserId(actor);
    const [p] = await tx
      .insert(projects)
      .values({
        orgId: actor.orgId,
        ref,
        clientId: input.clientId,
        name: input.name,
        scope: input.scope ?? null,
        objectives: input.objectives ?? null,
        ownerId,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        budgetMinor: input.budget ?? null,
        revenueMinor: input.revenue ?? null,
        reportingCadence: input.reportingCadence,
        approvalRequired: input.approvalRequired,
        risks: input.risks ?? null,
      })
      .returning();
    if (ownerId)
      await tx
        .insert(projectMembers)
        .values({ projectId: p.id, userId: ownerId, role: 'owner' })
        .onConflictDoNothing();
    await audit(tx, actor, 'project.created', 'project', p.id, { after: { ref, name: p.name } });
    return p;
  });
}

async function getProjectForUpdate(tx: DBOrTx, actor: Actor, id: string) {
  if (!z.string().uuid().safeParse(id).success) throw notFound('Project');
  const [p] = await tx
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), projectScope(actor)))
    .for('update');
  if (!p) throw notFound('Project');
  return p;
}

export async function updateProject(actor: Actor, id: string, raw: Record<string, unknown>) {
  assertCan(actor, 'projects.write');
  const input = parse(projectSchema.partial().omit({ clientId: true }), raw);
  return db.transaction(async (tx) => {
    const p = await getProjectForUpdate(tx, actor, id);
    const patch: Partial<Project> = {};
    const map: Record<string, keyof Project> = { budget: 'budgetMinor', revenue: 'revenueMinor' };
    for (const k of Object.keys(input))
      if (k in raw)
        (patch as Record<string, unknown>)[map[k] ?? k] = (input as Record<string, unknown>)[k] ?? null;
    if (('budgetMinor' in patch || 'revenueMinor' in patch) && !can(actor, 'projects.commercials'))
      throw forbidden('You cannot change project commercials.');
    const start = patch.startDate ?? p.startDate;
    const end = patch.endDate ?? p.endDate;
    if (start && end && end < start) throw invalid('End date must be after start date.');
    const d = diff(p as unknown as Record<string, unknown>, patch as Record<string, unknown>);
    if (!d.changed) return p;
    const [u] = await tx.update(projects).set(patch).where(eq(projects.id, id)).returning();
    if (patch.ownerId)
      await tx
        .insert(projectMembers)
        .values({ projectId: id, userId: patch.ownerId, role: 'owner' })
        .onConflictDoNothing();
    await audit(tx, actor, 'project.updated', 'project', id, { before: d.before, after: d.after });
    return u;
  });
}

/** Readiness gate: a project may not enter active delivery until these are recorded. */
export async function projectReadiness(tx: DBOrTx, p: Project) {
  const checks: Array<{ label: string; ok: boolean }> = [
    { label: 'Scope recorded', ok: Boolean(p.scope?.trim()) },
    { label: 'Owner assigned', ok: Boolean(p.ownerId) },
    { label: 'Start and end dates set', ok: Boolean(p.startDate && p.endDate) },
  ];
  const [{ n: deliverableCount }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(deliverables)
    .where(and(eq(deliverables.projectId, p.id), isNull(deliverables.deletedAt)));
  const [{ n: taskCount }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(and(eq(tasks.projectId, p.id), isNull(tasks.deletedAt)));
  checks.push({ label: 'Deliverables or work plan defined', ok: deliverableCount + taskCount > 0 });
  let commercialOk = false;
  if (p.handoverId) {
    const [h] = await tx
      .select({ status: handovers.status })
      .from(handovers)
      .where(eq(handovers.id, p.handoverId));
    commercialOk = h?.status === 'approved';
  }
  if (!commercialOk) {
    const [b] = await tx
      .select({ id: budgets.id })
      .from(budgets)
      .where(and(eq(budgets.projectId, p.id), isNotNull(budgets.approvedAt)));
    commercialOk = Boolean(b);
  }
  checks.push({ label: 'Commercials approved (approved handover or approved budget)', ok: commercialOk });
  return { ready: checks.every((c) => c.ok), checks };
}

export async function setProjectStatus(actor: Actor, id: string, status: Project['status']) {
  assertCan(actor, 'projects.write');
  return db.transaction(async (tx) => {
    const p = await getProjectForUpdate(tx, actor, id);
    if (p.status === status) return p;
    if (status === 'active') {
      assertCan(actor, 'projects.activate');
      const r = await projectReadiness(tx, p);
      if (!r.ready)
        throw precondition(
          `Not ready for active delivery: ${r.checks
            .filter((c) => !c.ok)
            .map((c) => c.label)
            .join('; ')}.`,
        );
    }
    const [u] = await tx.update(projects).set({ status }).where(eq(projects.id, id)).returning();
    await audit(tx, actor, 'project.status_changed', 'project', id, {
      before: { status: p.status },
      after: { status },
    });
    return u;
  });
}

export async function setMembers(actor: Actor, projectId: string, userIds: string[]) {
  assertCan(actor, 'projects.write');
  await db.transaction(async (tx) => {
    const p = await getProjectForUpdate(tx, actor, projectId);
    const valid = userIds.length
      ? await tx
          .select({ id: users.id })
          .from(users)
          .where(
            and(
              inArray(users.id, userIds),
              eq(users.orgId, actor.orgId),
              isNull(users.clientId),
              eq(users.isActive, true),
            ),
          )
      : [];
    const keep = new Set(valid.map((v) => v.id));
    if (p.ownerId) keep.add(p.ownerId);
    await tx.delete(projectMembers).where(eq(projectMembers.projectId, projectId));
    if (keep.size)
      await tx
        .insert(projectMembers)
        .values(
          [...keep].map((userId) => ({ projectId, userId, role: userId === p.ownerId ? 'owner' : 'member' })),
        );
    await audit(tx, actor, 'project.members_set', 'project', projectId, { after: { members: [...keep] } });
  });
}

export async function addMilestone(actor: Actor, projectId: string, raw: Record<string, unknown>) {
  assertCan(actor, 'projects.write');
  const input = parse(z.object({ name: reqStr(200), dueDate: optDate }), raw);
  return db.transaction(async (tx) => {
    await getProjectForUpdate(tx, actor, projectId);
    const [m] = await tx
      .insert(milestones)
      .values({ orgId: actor.orgId, projectId, name: input.name, dueDate: input.dueDate ?? null })
      .returning();
    await audit(tx, actor, 'project.milestone_added', 'project', projectId, { after: { name: m.name } });
    return m;
  });
}

export async function toggleMilestone(actor: Actor, milestoneId: string) {
  assertCan(actor, 'projects.write');
  await db.transaction(async (tx) => {
    const [m] = await tx
      .select()
      .from(milestones)
      .where(and(eq(milestones.id, milestoneId), eq(milestones.orgId, actor.orgId)));
    if (!m) throw notFound('Milestone');
    await getProjectForUpdate(tx, actor, m.projectId);
    await tx
      .update(milestones)
      .set({ completedAt: m.completedAt ? null : new Date() })
      .where(eq(milestones.id, m.id));
  });
}

/* ---------------------------------------------------------- templates */

/**
 * Generates tasks (and milestones) from a template. Idempotent: each item has a stable source key,
 * so applying the same template twice never duplicates tasks.
 */
export async function applyTemplate(
  tx: DBOrTx,
  orgId: string,
  projectId: string,
  templateKey: string,
  createdById: string | null,
) {
  const [tpl] = await tx
    .select()
    .from(taskTemplates)
    .where(and(eq(taskTemplates.orgId, orgId), eq(taskTemplates.key, templateKey)));
  if (!tpl) throw invalid(`Unknown task template "${templateKey}".`);
  const [p] = await tx.select().from(projects).where(eq(projects.id, projectId));
  const start = p.startDate ? parseISO(p.startDate) : new Date();
  const created: string[] = [];
  const idByIndex: string[] = [];
  const milestoneIds = new Map<string, string>();
  const roleOwner = async (roleKey: string): Promise<string | null> => {
    // Prefer a project member with that role, else any active user with the role.
    const [m] = await tx
      .select({ id: users.id })
      .from(projectMembers)
      .innerJoin(users, eq(users.id, projectMembers.userId))
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(and(eq(projectMembers.projectId, projectId), eq(roles.key, roleKey), eq(users.isActive, true)))
      .limit(1);
    return m?.id ?? null;
  };
  for (const [i, item] of (tpl.items as TemplateItem[]).entries()) {
    let milestoneId: string | null = null;
    if (item.milestone) {
      if (!milestoneIds.has(item.milestone)) {
        const [existing] = await tx
          .select()
          .from(milestones)
          .where(and(eq(milestones.projectId, projectId), eq(milestones.name, item.milestone)));
        const m =
          existing ??
          (
            await tx
              .insert(milestones)
              .values({
                orgId,
                projectId,
                name: item.milestone,
                dueDate: addDays(start, item.offsetDays + item.durationDays)
                  .toISOString()
                  .slice(0, 10),
              })
              .returning()
          )[0];
        milestoneIds.set(item.milestone, m.id);
      }
      milestoneId = milestoneIds.get(item.milestone)!;
    }
    const ownerId =
      !item.assignee || item.assignee === 'project_owner'
        ? p.ownerId
        : ((await roleOwner(item.assignee)) ?? p.ownerId);
    const { task, created: isNew } = await createSystemTask(tx, {
      orgId,
      sourceKey: `tpl:${projectId}:${templateKey}:${i}`,
      title: item.title,
      description: item.description ?? null,
      ownerId,
      createdById,
      projectId,
      clientId: p.clientId,
      milestoneId,
      startAt: addDays(start, item.offsetDays),
      dueAt: addDays(start, item.offsetDays + item.durationDays),
      priority: item.priority ?? 'medium',
      effortPoints: item.effortPoints ?? 1,
    });
    idByIndex[i] = task.id;
    if (isNew) created.push(task.id);
  }
  for (const [i, item] of (tpl.items as TemplateItem[]).entries()) {
    for (const dep of item.dependsOn ?? []) {
      if (idByIndex[dep] && idByIndex[i])
        await tx
          .insert(taskDependencies)
          .values({ taskId: idByIndex[i], dependsOnTaskId: idByIndex[dep] })
          .onConflictDoNothing();
    }
  }
  await tx.update(projects).set({ templateKey }).where(eq(projects.id, projectId));
  return { created: created.length, total: idByIndex.length };
}

export async function applyTemplateAsUser(actor: Actor, projectId: string, templateKey: string) {
  assertCan(actor, 'projects.write');
  return db.transaction(async (tx) => {
    await getProjectForUpdate(tx, actor, projectId);
    const r = await applyTemplate(tx, actor.orgId, projectId, templateKey, actorUserId(actor));
    await audit(tx, actor, 'project.template_applied', 'project', projectId, {
      after: { templateKey, ...r },
    });
    return r;
  });
}

/**
 * Workflow 6 core: approved handover → client (create or link) → project → template tasks → owners →
 * milestones → notify. Idempotent: the handover stores the projectId once created.
 */
export async function createProjectFromHandover(
  tx: DBOrTx,
  orgId: string,
  handoverId: string,
  log: (m: string) => void,
) {
  const [h] = await tx
    .select()
    .from(handovers)
    .where(and(eq(handovers.id, handoverId), eq(handovers.orgId, orgId)))
    .for('update');
  if (!h) throw invalid('Handover not found.');
  if (h.status !== 'approved') return { skipped: `Handover status is ${h.status}, not approved.` };
  if (h.projectId) return { skipped: 'Project already created for this handover.', projectId: h.projectId };
  const [deal] = await tx.select().from(schema.deals).where(eq(schema.deals.id, h.dealId));
  let clientId = deal.clientId;
  if (!clientId) {
    const [existing] = await tx
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.orgId, orgId), sql`lower(${clients.name}) = lower(${deal.prospectName})`));
    if (existing) {
      clientId = existing.id;
      log(`Linked existing client "${deal.prospectName}".`);
    } else {
      const [c] = await tx
        .insert(clients)
        .values({
          orgId,
          name: deal.prospectName,
          orgType: deal.prospectOrgType,
          status: 'onboarding',
          accountOwnerId: h.proposedOwnerId ?? deal.ownerId,
          services: deal.services,
          contractStart: deal.contractStart,
          contractEnd: deal.contractEnd,
          renewalDate: deal.renewalDate,
        })
        .returning();
      clientId = c.id;
      if (deal.contactName)
        await tx.insert(schema.clientContacts).values({
          orgId,
          clientId,
          name: deal.contactName,
          email: deal.contactEmail,
          phone: deal.contactPhone,
          isPrimary: true,
          isApprover: true,
        });
      log(`Created client "${c.name}".`);
    }
    await tx.update(schema.deals).set({ clientId }).where(eq(schema.deals.id, deal.id));
  }
  const ref = await nextRef(tx, orgId, 'PRJ');
  const [p] = await tx
    .insert(projects)
    .values({
      orgId,
      ref,
      clientId,
      name: h.projectName,
      scope: [h.scope, h.deliverablesSummary ? `Deliverables:\n${h.deliverablesSummary}` : null]
        .filter(Boolean)
        .join('\n\n'),
      ownerId: h.proposedOwnerId,
      startDate: h.targetStart,
      endDate: h.targetEnd,
      budgetMinor: h.budgetMinor,
      revenueMinor: deal.valueMinor,
      handoverId: h.id,
      status: 'planning',
    })
    .returning();
  if (h.proposedOwnerId)
    await tx
      .insert(projectMembers)
      .values({ projectId: p.id, userId: h.proposedOwnerId, role: 'owner' })
      .onConflictDoNothing();
  await tx.update(handovers).set({ projectId: p.id }).where(eq(handovers.id, h.id));
  log(`Created project ${ref} "${p.name}".`);
  let tasksCreated = 0;
  if (h.templateKey) {
    const r = await applyTemplate(tx, orgId, p.id, h.templateKey, null);
    tasksCreated = r.created;
    log(`Generated ${r.created} tasks from template "${h.templateKey}".`);
  } else log('No template selected — no tasks generated.');
  const recipients = new Set([h.proposedOwnerId, deal.ownerId].filter(Boolean) as string[]);
  const members = await tx
    .select({ userId: projectMembers.userId })
    .from(projectMembers)
    .where(eq(projectMembers.projectId, p.id));
  for (const m of members) recipients.add(m.userId);
  for (const userId of recipients)
    await notify(tx, {
      orgId,
      userId,
      type: 'project.created',
      title: `New project: ${p.name}`,
      body: `Created from won deal ${deal.ref}. ${tasksCreated} tasks generated.`,
      link: `/projects/${p.id}`,
      dedupeKey: `project-created:${p.id}`,
    });
  return { projectId: p.id, tasksCreated };
}

/* ------------------------------------------------------------ queries */

export type ProjectFilters = PageParams & { status?: string; clientId?: string; ownerId?: string };

export async function listProjects(
  actor: Actor,
  f: ProjectFilters,
): Promise<
  Paged<Project & { clientName: string; ownerName: string | null; openTasks: number; overdueTasks: number }>
> {
  const conds: (SQL | undefined)[] = [projectScope(actor)];
  if (f.q)
    conds.push(
      or(
        ilike(projects.name, `%${f.q.replace(/[%_]/g, '')}%`),
        ilike(projects.ref, `%${f.q.replace(/[%_]/g, '')}%`),
      ),
    );
  if (f.status) conds.push(eq(projects.status, f.status as Project['status']));
  if (f.clientId) conds.push(eq(projects.clientId, f.clientId));
  if (f.ownerId) conds.push(eq(projects.ownerId, f.ownerId));
  const where = and(...conds);
  const openTasks = sql<number>`(select count(*)::int from ${tasks} t where t.project_id = ${projects.id} and t.status in ('todo','in_progress','blocked','in_review') and t.deleted_at is null)`;
  const overdueTasks = sql<number>`(select count(*)::int from ${tasks} t where t.project_id = ${projects.id} and t.status in ('todo','in_progress','blocked','in_review') and t.due_at < now() and t.deleted_at is null)`;
  const sortCol =
    { name: projects.name, end: projects.endDate, status: projects.status, createdAt: projects.createdAt }[
      f.sort ?? 'createdAt'
    ] ?? projects.createdAt;
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({ p: projects, clientName: clients.name, ownerName: users.name, openTasks, overdueTasks })
      .from(projects)
      .innerJoin(clients, eq(clients.id, projects.clientId))
      .leftJoin(users, eq(users.id, projects.ownerId))
      .where(where)
      .orderBy(f.dir === 'asc' ? sql`${sortCol} asc nulls last` : sql`${sortCol} desc nulls last`)
      .limit(f.pageSize)
      .offset((f.page - 1) * f.pageSize),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(projects)
      .where(where),
  ]);
  return {
    rows: rows.map((r) => ({
      ...r.p,
      clientName: r.clientName,
      ownerName: r.ownerName,
      openTasks: r.openTasks,
      overdueTasks: r.overdueTasks,
      ...(can(actor, 'projects.commercials') ? {} : { budgetMinor: null, revenueMinor: null }),
    })),
    total,
    page: f.page,
    pageSize: f.pageSize,
  };
}

export async function getProject(actor: Actor, id: string) {
  if (!z.string().uuid().safeParse(id).success) throw notFound('Project');
  const [r] = await db
    .select({ p: projects, clientName: clients.name, ownerName: users.name })
    .from(projects)
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .leftJoin(users, eq(users.id, projects.ownerId))
    .where(and(eq(projects.id, id), projectScope(actor)));
  if (!r) throw notFound('Project');
  const project = can(actor, 'projects.commercials')
    ? r.p
    : { ...r.p, budgetMinor: null, revenueMinor: null };
  const [members, ms, readiness, taskStats] = await Promise.all([
    db
      .select({ id: users.id, name: users.name, role: projectMembers.role })
      .from(projectMembers)
      .innerJoin(users, eq(users.id, projectMembers.userId))
      .where(eq(projectMembers.projectId, id))
      .orderBy(asc(users.name)),
    db.select().from(milestones).where(eq(milestones.projectId, id)).orderBy(asc(milestones.dueDate)),
    projectReadiness(db, r.p),
    db
      .select({
        total: sql<number>`count(*)::int`,
        done: sql<number>`count(*) filter (where status = 'done')::int`,
        overdue: sql<number>`count(*) filter (where status in ('todo','in_progress','blocked','in_review') and due_at < now())::int`,
        blocked: sql<number>`count(*) filter (where status = 'blocked')::int`,
      })
      .from(tasks)
      .where(and(eq(tasks.projectId, id), isNull(tasks.deletedAt), sql`status <> 'cancelled'`)),
  ]);
  return {
    project,
    clientName: r.clientName,
    ownerName: r.ownerName,
    members,
    milestones: ms,
    readiness,
    taskStats: taskStats[0],
  };
}

export async function projectOptions(actor: Actor, clientId?: string) {
  return db
    .select({ id: projects.id, name: projects.name, ref: projects.ref, clientId: projects.clientId })
    .from(projects)
    .where(
      and(
        projectScope(actor),
        clientId ? eq(projects.clientId, clientId) : undefined,
        inArray(projects.status, ['planning', 'active', 'on_hold']),
      ),
    )
    .orderBy(desc(projects.createdAt))
    .limit(500);
}

export async function listTemplates(orgId: string) {
  return db
    .select()
    .from(taskTemplates)
    .where(eq(taskTemplates.orgId, orgId))
    .orderBy(asc(taskTemplates.name));
}

const templateItemSchema = z.object({
  title: reqStr(300),
  description: z.string().max(2000).optional(),
  offsetDays: z.number().int().min(0).max(730),
  durationDays: z.number().int().min(0).max(365),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  assignee: z.string().max(60).optional(),
  effortPoints: z.number().int().min(1).max(100).optional(),
  milestone: z.string().max(200).optional(),
  dependsOn: z.array(z.number().int().min(0)).optional(),
});

export async function saveTemplate(
  actor: Actor,
  raw: { key: string; name: string; description?: string; items: unknown },
) {
  assertCan(actor, 'tasks.templates');
  const input = parse(
    z.object({
      key: z.string().regex(/^[a-z0-9_]{2,60}$/, 'Use lowercase letters, numbers and underscores'),
      name: reqStr(200),
      description: optStr(2000),
      items: z.array(templateItemSchema).min(1).max(200),
    }),
    raw,
  );
  for (const [i, it] of input.items.entries())
    for (const d of it.dependsOn ?? [])
      if (d >= i) throw invalid(`Item ${i + 1}: can only depend on earlier items.`);
  const [t] = await db
    .insert(taskTemplates)
    .values({
      orgId: actor.orgId,
      key: input.key,
      name: input.name,
      description: input.description ?? null,
      items: input.items,
    })
    .onConflictDoUpdate({
      target: [taskTemplates.orgId, taskTemplates.key],
      set: { name: input.name, description: input.description ?? null, items: input.items },
    })
    .returning();
  await audit(db, actor, 'template.saved', 'task_template', t.id, {
    after: { key: t.key, items: input.items.length },
  });
  return t;
}
