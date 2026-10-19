import { addDays, addMonths, addWeeks } from 'date-fns';
import {
  aliasedTable,
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  notInArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { z } from 'zod';
import { db, schema, type DBOrTx } from '@/db';
import { actorUserId, assertCan, can, type Actor } from '../actor';
import { projectScope, taskScope } from '../access';
import { audit, diff } from '../audit';
import { emit } from '../automation/events';
import { forbidden, invalid, notFound, precondition } from '../errors';
import { nextRef } from '../refs';
import {
  optDateTime,
  optInt,
  optStr,
  optUuid,
  parse,
  reqStr,
  type PageParams,
  type Paged,
} from '../validation';
import { notify } from './notifications';

const {
  tasks,
  users,
  projects,
  clients,
  taskDependencies,
  taskCollaborators,
  comments,
  timeEntries,
  leads,
  deals,
  employeeProfiles,
} = schema;
export type Task = typeof tasks.$inferSelect;
export const TASK_STATUSES = ['todo', 'in_progress', 'blocked', 'in_review', 'done', 'cancelled'] as const;
export const OPEN_STATUSES = ['todo', 'in_progress', 'blocked', 'in_review'] as const;
export const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

/* ------------------------------------------------- system task creation */

export type SystemTaskInput = {
  orgId: string;
  sourceKey: string;
  title: string;
  description?: string | null;
  ownerId?: string | null;
  createdById?: string | null;
  projectId?: string | null;
  clientId?: string | null;
  leadId?: string | null;
  dealId?: string | null;
  deliverableId?: string | null;
  milestoneId?: string | null;
  dueAt?: Date | null;
  startAt?: Date | null;
  priority?: Task['priority'];
  effortPoints?: number;
  recurrence?: string | null;
  isDemo?: boolean;
};

/**
 * Idempotent task creation for automations. The (org, source_key) unique index guarantees that a
 * retried or duplicated event never produces a second task.
 */
export async function createSystemTask(
  tx: DBOrTx,
  t: SystemTaskInput,
): Promise<{ task: Task; created: boolean }> {
  const [existing] = await tx
    .select()
    .from(tasks)
    .where(and(eq(tasks.orgId, t.orgId), eq(tasks.sourceKey, t.sourceKey)));
  if (existing) return { task: existing, created: false };
  const ref = await nextRef(tx, t.orgId, 'TK');
  const ins = await tx
    .insert(tasks)
    .values({
      orgId: t.orgId,
      ref,
      sourceKey: t.sourceKey,
      title: t.title.slice(0, 300),
      description: t.description ?? null,
      ownerId: t.ownerId ?? null,
      createdById: t.createdById ?? null,
      projectId: t.projectId ?? null,
      clientId: t.clientId ?? null,
      leadId: t.leadId ?? null,
      dealId: t.dealId ?? null,
      deliverableId: t.deliverableId ?? null,
      milestoneId: t.milestoneId ?? null,
      dueAt: t.dueAt ?? null,
      startAt: t.startAt ?? null,
      priority: t.priority ?? 'medium',
      effortPoints: t.effortPoints ?? 1,
      recurrence: t.recurrence ?? null,
      isDemo: t.isDemo ?? false,
    })
    .onConflictDoNothing()
    .returning();
  if (ins[0]) return { task: ins[0], created: true };
  const [again] = await tx
    .select()
    .from(tasks)
    .where(and(eq(tasks.orgId, t.orgId), eq(tasks.sourceKey, t.sourceKey)));
  return { task: again, created: false };
}

/* ------------------------------------------------------- user actions */

const taskInputSchema = z.object({
  title: reqStr(300),
  description: optStr(10000),
  projectId: optUuid,
  leadId: optUuid,
  dealId: optUuid,
  ownerId: optUuid,
  priority: z.enum(PRIORITIES).default('medium'),
  dueAt: optDateTime,
  startAt: optDateTime,
  effortPoints: optInt(1, 100),
  recurrence: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(['daily', 'weekly', 'monthly']).optional(),
  ),
});

async function assertAssignable(tx: DBOrTx, actor: Actor, ownerId: string | undefined | null) {
  if (!ownerId) return;
  if (ownerId !== actorUserId(actor) && !can(actor, 'tasks.assign'))
    throw forbidden('You can only assign tasks to yourself.');
  const [u] = await tx
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
  if (!u) throw invalid('Choose an active team member.', { ownerId: 'Invalid owner' });
}

export async function createTask(actor: Actor, raw: Record<string, unknown>) {
  assertCan(actor, 'tasks.write');
  const input = parse(taskInputSchema, raw);
  if (input.dueAt && input.startAt && input.dueAt < input.startAt)
    throw invalid('Due date must be after the start date.');
  return db.transaction(async (tx) => {
    let clientId: string | null = null;
    if (input.projectId) {
      const [p] = await tx
        .select({ id: projects.id, clientId: projects.clientId })
        .from(projects)
        .where(and(eq(projects.id, input.projectId), projectScope(actor)));
      if (!p) throw invalid('Unknown project.', { projectId: 'Unknown project' });
      clientId = p.clientId;
    }
    if (input.leadId) {
      const [l] = await tx
        .select({ id: leads.id })
        .from(leads)
        .where(and(eq(leads.id, input.leadId), eq(leads.orgId, actor.orgId)));
      if (!l) throw invalid('Unknown lead.');
    }
    if (input.dealId) {
      const [d] = await tx
        .select({ id: deals.id })
        .from(deals)
        .where(and(eq(deals.id, input.dealId), eq(deals.orgId, actor.orgId)));
      if (!d) throw invalid('Unknown deal.');
    }
    const ownerId = input.ownerId ?? actorUserId(actor);
    await assertAssignable(tx, actor, ownerId);
    const ref = await nextRef(tx, actor.orgId, 'TK');
    const [t] = await tx
      .insert(tasks)
      .values({
        orgId: actor.orgId,
        ref,
        title: input.title,
        description: input.description ?? null,
        projectId: input.projectId ?? null,
        clientId,
        leadId: input.leadId ?? null,
        dealId: input.dealId ?? null,
        ownerId,
        createdById: actorUserId(actor),
        priority: input.priority,
        dueAt: input.dueAt ?? null,
        startAt: input.startAt ?? null,
        effortPoints: input.effortPoints ?? 1,
        recurrence: input.recurrence ?? null,
      })
      .returning();
    await audit(tx, actor, 'task.created', 'task', t.id, { after: { ref, title: t.title, ownerId } });
    if (ownerId && ownerId !== actorUserId(actor))
      await notify(tx, {
        orgId: actor.orgId,
        userId: ownerId,
        type: 'task.assigned',
        title: `New task: ${t.title}`,
        link: `/tasks/${t.id}`,
        dedupeKey: `task-assigned:${t.id}:${ownerId}`,
      });
    return t;
  });
}

async function getTaskForUpdate(tx: DBOrTx, actor: Actor, id: string): Promise<Task> {
  if (!z.string().uuid().safeParse(id).success) throw notFound('Task');
  const [t] = await tx
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, id), taskScope(actor)))
    .for('update');
  if (!t) throw notFound('Task');
  return t;
}

const taskUpdateSchema = z.object({
  title: reqStr(300).optional(),
  description: optStr(10000),
  ownerId: optUuid,
  priority: z.enum(PRIORITIES).optional(),
  dueAt: optDateTime,
  startAt: optDateTime,
  effortPoints: optInt(1, 100),
});

export async function updateTask(actor: Actor, id: string, raw: Record<string, unknown>) {
  assertCan(actor, 'tasks.write');
  const input = parse(taskUpdateSchema, raw);
  return db.transaction(async (tx) => {
    const t = await getTaskForUpdate(tx, actor, id);
    const patch: Partial<Task> = {};
    for (const k of ['title', 'description', 'priority', 'effortPoints'] as const)
      if (k in raw && input[k] !== undefined) (patch as Record<string, unknown>)[k] = input[k];
    if ('description' in raw) patch.description = input.description ?? null;
    if ('dueAt' in raw) patch.dueAt = input.dueAt ?? null;
    if ('startAt' in raw) patch.startAt = input.startAt ?? null;
    if ('ownerId' in raw) {
      const newOwner = input.ownerId ?? null;
      if (newOwner !== t.ownerId) {
        if (!can(actor, 'tasks.assign') && !(newOwner === actorUserId(actor) && !t.ownerId))
          throw forbidden('You do not have permission to reassign tasks.');
        await assertAssignable(tx, actor, newOwner);
        patch.ownerId = newOwner;
      }
    }
    const d = diff(t as unknown as Record<string, unknown>, patch as Record<string, unknown>);
    if (!d.changed) return t;
    if (patch.dueAt !== undefined) Object.assign(patch, { reminderSentAt: null, overdueEscalatedAt: null });
    const [u] = await tx.update(tasks).set(patch).where(eq(tasks.id, id)).returning();
    await audit(tx, actor, 'task.updated', 'task', id, { before: d.before, after: d.after });
    if (patch.ownerId && patch.ownerId !== actorUserId(actor))
      await notify(tx, {
        orgId: actor.orgId,
        userId: patch.ownerId,
        type: 'task.assigned',
        title: `Task reassigned to you: ${u.title}`,
        link: `/tasks/${id}`,
        dedupeKey: `task-assigned:${id}:${patch.ownerId}:${Date.now()}`,
      });
    if (
      t.ownerId &&
      patch.ownerId !== undefined &&
      t.ownerId !== actorUserId(actor) &&
      t.ownerId !== patch.ownerId
    )
      await notify(tx, {
        orgId: actor.orgId,
        userId: t.ownerId,
        type: 'task.unassigned',
        title: `Task moved to someone else: ${u.title}`,
        link: `/tasks/${id}`,
        dedupeKey: `task-unassigned:${id}:${t.ownerId}:${Date.now()}`,
      });
    return u;
  });
}

function nextOccurrence(due: Date, rule: string): Date {
  return rule === 'daily' ? addDays(due, 1) : rule === 'weekly' ? addWeeks(due, 1) : addMonths(due, 1);
}

export async function setTaskStatus(actor: Actor, id: string, status: Task['status'], note?: string | null) {
  assertCan(actor, 'tasks.write');
  if (!(TASK_STATUSES as readonly string[]).includes(status)) throw invalid('Unknown status.');
  return db.transaction(async (tx) => {
    const t = await getTaskForUpdate(tx, actor, id);
    if (t.status === status) return t;
    // Only the owner, the creator, or someone who can assign may change another person's task status.
    if (
      t.ownerId &&
      t.ownerId !== actorUserId(actor) &&
      t.createdById !== actorUserId(actor) &&
      !can(actor, 'tasks.assign')
    )
      throw forbidden('Only the task owner or a manager can change this task.');
    const patch: Partial<Task> = { status };
    if (status === 'blocked') {
      if (!note?.trim()) throw invalid('Describe what is blocking this task.', { note: 'Required' });
      patch.blockerNote = note.trim();
    }
    if (status === 'in_progress' || status === 'done') {
      const open = await tx
        .select({ ref: tasks.ref, title: tasks.title })
        .from(taskDependencies)
        .innerJoin(tasks, eq(tasks.id, taskDependencies.dependsOnTaskId))
        .where(and(eq(taskDependencies.taskId, id), notInArray(tasks.status, ['done', 'cancelled'])));
      if (open.length) throw precondition(`Waiting on: ${open.map((o) => `${o.ref} ${o.title}`).join('; ')}`);
    }
    if (status === 'done') {
      patch.completedAt = new Date();
      if (note?.trim()) patch.completionNote = note.trim();
    } else if (t.status === 'done') patch.completedAt = null;
    const [u] = await tx.update(tasks).set(patch).where(eq(tasks.id, id)).returning();
    await audit(tx, actor, 'task.status_changed', 'task', id, {
      before: { status: t.status },
      after: { status, note },
    });

    if (status === 'blocked' && t.projectId) {
      const [p] = await tx
        .select({ ownerId: projects.ownerId, name: projects.name })
        .from(projects)
        .where(eq(projects.id, t.projectId));
      if (p?.ownerId && p.ownerId !== actorUserId(actor))
        await notify(tx, {
          orgId: actor.orgId,
          userId: p.ownerId,
          type: 'task.blocked',
          severity: 'warning',
          title: `Blocked: ${t.title}`,
          body: note ?? undefined,
          link: `/tasks/${id}`,
          dedupeKey: `task-blocked:${id}:${Date.now()}`,
        });
    }
    if (status === 'done') {
      await emit(
        tx,
        actor.orgId,
        'task.completed',
        { taskId: u.id, projectId: u.projectId },
        u.id + ':' + u.completedAt!.toISOString(),
      );
      await handOffDependents(tx, actor, u);
      if (t.recurrence && t.dueAt) {
        const rootId = t.recurrenceParentId ?? t.id;
        const nextDue = nextOccurrence(t.dueAt, t.recurrence);
        const { task: next } = await createSystemTask(tx, {
          orgId: t.orgId,
          sourceKey: `recur:${rootId}:${nextDue.toISOString().slice(0, 10)}`,
          title: t.title,
          description: t.description,
          ownerId: t.ownerId,
          createdById: t.createdById,
          projectId: t.projectId,
          clientId: t.clientId,
          dueAt: nextDue,
          priority: t.priority,
          effortPoints: t.effortPoints,
          recurrence: t.recurrence,
        });
        await tx.update(tasks).set({ recurrenceParentId: rootId }).where(eq(tasks.id, next.id));
      }
    }
    return u;
  });
}

/* ------------------------------------------------------------ bulk edits */

export const BULK_TASK_LIMIT = 200;
/** "Blocked" needs a per-task explanation, so it is deliberately not offered in bulk. */
export const BULK_STATUSES = ['todo', 'in_progress', 'in_review', 'done', 'cancelled'] as const;

const bulkSchema = z
  .object({
    ids: z.array(z.string().uuid()).min(1, 'Select at least one task.').max(BULK_TASK_LIMIT),
    status: z.preprocess((v) => (v === '' ? undefined : v), z.enum(BULK_STATUSES).optional()),
    priority: z.preprocess((v) => (v === '' ? undefined : v), z.enum(PRIORITIES).optional()),
    ownerId: z.preprocess((v) => (v === '' ? undefined : v), z.string().uuid().optional()),
  })
  .refine((v) => v.status || v.priority || v.ownerId, { message: 'Choose a change to apply.' });

export type BulkTaskResult = {
  updated: number;
  unchanged: number;
  failed: Array<{ id: string; error: string }>;
};

/**
 * Applies the same change to several tasks. Each task goes through the single-task service
 * (record scope, ownership, dependency and assignment rules) in its own transaction, so a
 * failure on one task never leaves another half-updated and is reported back individually.
 */
export async function bulkUpdateTasks(actor: Actor, raw: Record<string, unknown>): Promise<BulkTaskResult> {
  assertCan(actor, 'tasks.write');
  const parsed = bulkSchema.safeParse(raw);
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? 'Invalid bulk change.');
  const input = parsed.data;
  if (input.ownerId) assertCan(actor, 'tasks.assign');
  const ids = [...new Set(input.ids)];
  const result: BulkTaskResult = { updated: 0, unchanged: 0, failed: [] };
  for (const id of ids) {
    try {
      let changed = false;
      if (input.priority || input.ownerId) {
        const [before] = await db
          .select({ priority: tasks.priority, ownerId: tasks.ownerId, createdById: tasks.createdById })
          .from(tasks)
          .where(and(eq(tasks.id, id), taskScope(actor)));
        if (!before) throw notFound('Task');
        // Bulk edits never widen what someone may change: other people's tasks need tasks.assign.
        const me = actorUserId(actor);
        if (
          !can(actor, 'tasks.assign') &&
          before.ownerId &&
          before.ownerId !== me &&
          before.createdById !== me
        )
          throw forbidden('Only the task owner or a manager can change this task.');
        const patch: Record<string, unknown> = {};
        if (input.priority && input.priority !== before.priority) patch.priority = input.priority;
        if (input.ownerId && input.ownerId !== before.ownerId) patch.ownerId = input.ownerId;
        if (Object.keys(patch).length) {
          await updateTask(actor, id, patch);
          changed = true;
        }
      }
      if (input.status) {
        const before = await db
          .select({ status: tasks.status })
          .from(tasks)
          .where(and(eq(tasks.id, id), taskScope(actor)));
        if (!before[0]) throw notFound('Task');
        if (before[0].status !== input.status) {
          await setTaskStatus(actor, id, input.status);
          changed = true;
        }
      }
      if (changed) result.updated++;
      else result.unchanged++;
    } catch (e) {
      result.failed.push({ id, error: e instanceof Error ? e.message : 'Failed' });
    }
  }
  await audit(db, actor, 'task.bulk_updated', 'task', null, {
    after: {
      requested: ids.length,
      status: input.status,
      priority: input.priority,
      ownerId: input.ownerId,
      updated: result.updated,
      failed: result.failed.length,
    },
  });
  return result;
}

/** Completion-triggered handoff: tell owners of tasks that are now unblocked. */
async function handOffDependents(tx: DBOrTx, actor: Actor, done: Task) {
  const dependents = await tx
    .select({ id: tasks.id, title: tasks.title, ownerId: tasks.ownerId })
    .from(taskDependencies)
    .innerJoin(tasks, eq(tasks.id, taskDependencies.taskId))
    .where(and(eq(taskDependencies.dependsOnTaskId, done.id), inArray(tasks.status, ['todo', 'blocked'])));
  for (const dep of dependents) {
    const stillOpen = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(taskDependencies)
      .innerJoin(tasks, eq(tasks.id, taskDependencies.dependsOnTaskId))
      .where(and(eq(taskDependencies.taskId, dep.id), notInArray(tasks.status, ['done', 'cancelled'])));
    if ((stillOpen[0]?.n ?? 0) === 0 && dep.ownerId)
      await notify(tx, {
        orgId: actor.orgId,
        userId: dep.ownerId,
        type: 'task.ready',
        title: `Ready to start: ${dep.title}`,
        body: `"${done.title}" was completed.`,
        link: `/tasks/${dep.id}`,
        dedupeKey: `task-ready:${dep.id}`,
      });
  }
}

export async function addDependency(actor: Actor, taskId: string, dependsOnTaskId: string) {
  assertCan(actor, 'tasks.write');
  if (taskId === dependsOnTaskId) throw invalid('A task cannot depend on itself.');
  await db.transaction(async (tx) => {
    await getTaskForUpdate(tx, actor, taskId);
    const [other] = await tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.id, dependsOnTaskId), taskScope(actor)));
    if (!other) throw notFound('Task');
    // Cycle check: does dependsOn (transitively) depend on taskId?
    const res = await tx.execute<{ found: boolean }>(sql`
      with recursive chain(id) as (
        select depends_on_task_id from task_dependencies where task_id = ${dependsOnTaskId}
        union select d.depends_on_task_id from task_dependencies d join chain c on d.task_id = c.id)
      select exists(select 1 from chain where id = ${taskId}) as found`);
    if (res.rows[0]?.found) throw invalid('That would create a circular dependency.');
    await tx.insert(taskDependencies).values({ taskId, dependsOnTaskId }).onConflictDoNothing();
    await audit(tx, actor, 'task.dependency_added', 'task', taskId, { after: { dependsOnTaskId } });
  });
}

export async function removeDependency(actor: Actor, taskId: string, dependsOnTaskId: string) {
  assertCan(actor, 'tasks.write');
  await db.transaction(async (tx) => {
    await getTaskForUpdate(tx, actor, taskId);
    await tx
      .delete(taskDependencies)
      .where(and(eq(taskDependencies.taskId, taskId), eq(taskDependencies.dependsOnTaskId, dependsOnTaskId)));
  });
}

export async function addComment(
  actor: Actor,
  entityType: 'task' | 'deliverable' | 'project' | 'deal',
  entityId: string,
  body: string,
) {
  const text = body?.trim();
  if (!text) throw invalid('Comment cannot be empty.');
  if (text.length > 10000) throw invalid('Comment is too long.');
  if (entityType === 'task') {
    assertCan(actor, 'tasks.write');
    await getTaskForUpdate(db, actor, entityId);
  }
  const [c] = await db
    .insert(comments)
    .values({ orgId: actor.orgId, entityType, entityId, authorId: actorUserId(actor), body: text })
    .returning();
  if (entityType === 'task') {
    const [t] = await db.select().from(tasks).where(eq(tasks.id, entityId));
    if (t?.ownerId && t.ownerId !== actorUserId(actor))
      await notify(db, {
        orgId: actor.orgId,
        userId: t.ownerId,
        type: 'comment',
        title: `New comment on ${t.title}`,
        body: text.slice(0, 200),
        link: `/tasks/${t.id}`,
        dedupeKey: `comment:${c.id}`,
      });
  }
  return c;
}

export async function listComments(orgId: string, entityType: string, entityId: string) {
  return db
    .select({ c: comments, authorName: users.name })
    .from(comments)
    .leftJoin(users, eq(users.id, comments.authorId))
    .where(
      and(eq(comments.orgId, orgId), eq(comments.entityType, entityType), eq(comments.entityId, entityId)),
    )
    .orderBy(asc(comments.createdAt));
}

export async function setCollaborators(actor: Actor, taskId: string, userIds: string[]) {
  assertCan(actor, 'tasks.write');
  await db.transaction(async (tx) => {
    await getTaskForUpdate(tx, actor, taskId);
    await tx.delete(taskCollaborators).where(eq(taskCollaborators.taskId, taskId));
    const valid = userIds.length
      ? await tx
          .select({ id: users.id })
          .from(users)
          .where(and(inArray(users.id, userIds), eq(users.orgId, actor.orgId), isNull(users.clientId)))
      : [];
    if (valid.length) await tx.insert(taskCollaborators).values(valid.map((u) => ({ taskId, userId: u.id })));
  });
}

export async function logTime(
  actor: Actor,
  taskId: string,
  raw: { minutes: unknown; workDate: unknown; note?: unknown },
) {
  assertCan(actor, 'tasks.write');
  const input = parse(
    z.object({
      minutes: z.coerce
        .number()
        .int()
        .min(1)
        .max(24 * 60),
      workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      note: optStr(500),
    }),
    raw,
  );
  const t = await getTaskForUpdate(db, actor, taskId);
  const uid = actorUserId(actor);
  if (!uid) throw forbidden();
  await db.insert(timeEntries).values({
    orgId: actor.orgId,
    userId: uid,
    taskId,
    projectId: t.projectId,
    minutes: input.minutes,
    workDate: input.workDate,
    note: input.note ?? null,
  });
}

/* ------------------------------------------------------------- queries */

export type TaskFilters = PageParams & {
  status?: string;
  ownerId?: string;
  projectId?: string;
  priority?: string;
  mine?: boolean;
  overdue?: boolean;
  open?: boolean;
  from?: Date;
  to?: Date;
};

export async function listTasks(actor: Actor, f: TaskFilters) {
  const conds: (SQL | undefined)[] = [taskScope(actor)];
  if (f.q)
    conds.push(
      or(
        ilike(tasks.title, `%${f.q.replace(/[%_]/g, '')}%`),
        ilike(tasks.ref, `%${f.q.replace(/[%_]/g, '')}%`),
      ),
    );
  if (f.status && (TASK_STATUSES as readonly string[]).includes(f.status))
    conds.push(eq(tasks.status, f.status as Task['status']));
  if (f.open) conds.push(inArray(tasks.status, [...OPEN_STATUSES]));
  if (f.priority && (PRIORITIES as readonly string[]).includes(f.priority))
    conds.push(eq(tasks.priority, f.priority as Task['priority']));
  if (f.ownerId === 'unassigned') conds.push(isNull(tasks.ownerId));
  else if (f.ownerId) conds.push(eq(tasks.ownerId, f.ownerId));
  if (f.mine && actor.kind === 'user') conds.push(eq(tasks.ownerId, actor.id));
  if (f.projectId) conds.push(eq(tasks.projectId, f.projectId));
  if (f.overdue) conds.push(and(lt(tasks.dueAt, new Date()), inArray(tasks.status, [...OPEN_STATUSES])));
  if (f.from) conds.push(gte(tasks.dueAt, f.from));
  if (f.to) conds.push(lt(tasks.dueAt, f.to));
  const where = and(...conds);
  const sortCol =
    {
      dueAt: tasks.dueAt,
      priority: sql`array_position(array['urgent','high','medium','low'], ${tasks.priority}::text)`,
      title: tasks.title,
      status: tasks.status,
      createdAt: tasks.createdAt,
    }[f.sort ?? 'dueAt'] ?? tasks.dueAt;
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({ task: tasks, ownerName: users.name, projectName: projects.name, clientName: clients.name })
      .from(tasks)
      .leftJoin(users, eq(users.id, tasks.ownerId))
      .leftJoin(projects, eq(projects.id, tasks.projectId))
      .leftJoin(clients, eq(clients.id, tasks.clientId))
      .where(where)
      .orderBy(
        f.dir === 'desc' ? sql`${sortCol} desc nulls last` : sql`${sortCol} asc nulls last`,
        desc(tasks.createdAt),
      )
      .limit(f.pageSize)
      .offset((f.page - 1) * f.pageSize),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(tasks)
      .where(where),
  ]);
  return {
    rows: rows.map((r) => ({
      ...r.task,
      ownerName: r.ownerName,
      projectName: r.projectName,
      clientName: r.clientName,
    })),
    total,
    page: f.page,
    pageSize: f.pageSize,
  } satisfies Paged<unknown>;
}

export async function getTask(actor: Actor, id: string) {
  if (!z.string().uuid().safeParse(id).success) throw notFound('Task');
  const creator = aliasedTable(users, 'creator');
  const [r] = await db
    .select({
      task: tasks,
      ownerName: users.name,
      creatorName: creator.name,
      projectName: projects.name,
      clientName: clients.name,
      leadName: leads.name,
      dealTitle: deals.title,
    })
    .from(tasks)
    .leftJoin(users, eq(users.id, tasks.ownerId))
    .leftJoin(creator, eq(creator.id, tasks.createdById))
    .leftJoin(projects, eq(projects.id, tasks.projectId))
    .leftJoin(clients, eq(clients.id, tasks.clientId))
    .leftJoin(leads, eq(leads.id, tasks.leadId))
    .leftJoin(deals, eq(deals.id, tasks.dealId))
    .where(and(eq(tasks.id, id), taskScope(actor)));
  if (!r) throw notFound('Task');
  const dependsOn = await db
    .select({ id: tasks.id, ref: tasks.ref, title: tasks.title, status: tasks.status })
    .from(taskDependencies)
    .innerJoin(tasks, eq(tasks.id, taskDependencies.dependsOnTaskId))
    .where(eq(taskDependencies.taskId, id));
  const blocks = await db
    .select({ id: tasks.id, ref: tasks.ref, title: tasks.title, status: tasks.status })
    .from(taskDependencies)
    .innerJoin(tasks, eq(tasks.id, taskDependencies.taskId))
    .where(eq(taskDependencies.dependsOnTaskId, id));
  const collaborators = await db
    .select({ id: users.id, name: users.name })
    .from(taskCollaborators)
    .innerJoin(users, eq(users.id, taskCollaborators.userId))
    .where(eq(taskCollaborators.taskId, id));
  const time = await db
    .select({ minutes: sql<number>`coalesce(sum(${timeEntries.minutes}),0)::int` })
    .from(timeEntries)
    .where(eq(timeEntries.taskId, id));
  const history = await db
    .select({ a: schema.auditLogs, actorName: users.name })
    .from(schema.auditLogs)
    .leftJoin(users, eq(users.id, schema.auditLogs.actorId))
    .where(and(eq(schema.auditLogs.entityType, 'task'), eq(schema.auditLogs.entityId, id)))
    .orderBy(desc(schema.auditLogs.createdAt))
    .limit(50);
  return {
    ...r,
    dependsOn,
    blocks,
    collaborators,
    minutesLogged: time[0]?.minutes ?? 0,
    history: history.map((h) => ({ ...h.a, actorName: h.actorName })),
  };
}

/**
 * Workload: open effort per person against weekly capacity. Effort points (not raw task counts)
 * are used, because task count alone is a poor measure of load or performance.
 */
export async function teamWorkload(actor: Actor) {
  assertCan(actor, 'team.workload');
  const now = new Date();
  const weekEnd = addDays(now, 7);
  return db
    .select({
      userId: users.id,
      name: users.name,
      capacity: sql<number>`coalesce(${employeeProfiles.capacityHoursPerWeek}, 40)::int`,
      open: sql<number>`count(${tasks.id}) filter (where ${tasks.status} in ('todo','in_progress','blocked','in_review'))::int`,
      openPoints: sql<number>`coalesce(sum(${tasks.effortPoints}) filter (where ${tasks.status} in ('todo','in_progress','blocked','in_review')),0)::int`,
      dueThisWeekPoints: sql<number>`coalesce(sum(${tasks.effortPoints}) filter (where ${tasks.status} in ('todo','in_progress','blocked','in_review') and ${tasks.dueAt} < ${weekEnd}),0)::int`,
      overdue: sql<number>`count(${tasks.id}) filter (where ${tasks.status} in ('todo','in_progress','blocked','in_review') and ${tasks.dueAt} < ${now})::int`,
      blocked: sql<number>`count(${tasks.id}) filter (where ${tasks.status} = 'blocked')::int`,
      doneLast7: sql<number>`count(${tasks.id}) filter (where ${tasks.status} = 'done' and ${tasks.completedAt} > ${addDays(now, -7)})::int`,
    })
    .from(users)
    .leftJoin(employeeProfiles, eq(employeeProfiles.userId, users.id))
    .leftJoin(tasks, and(eq(tasks.ownerId, users.id), isNull(tasks.deletedAt)))
    .where(and(eq(users.orgId, actor.orgId), eq(users.isActive, true), isNull(users.clientId)))
    .groupBy(users.id, users.name, employeeProfiles.capacityHoursPerWeek)
    .orderBy(
      desc(
        sql`coalesce(sum(${tasks.effortPoints}) filter (where ${tasks.status} in ('todo','in_progress','blocked','in_review')),0)`,
      ),
    );
}

export async function taskCounts(actor: Actor) {
  const [r] = await db
    .select({
      open: sql<number>`count(*) filter (where ${tasks.status} in ('todo','in_progress','blocked','in_review'))::int`,
      overdue: sql<number>`count(*) filter (where ${tasks.status} in ('todo','in_progress','blocked','in_review') and ${tasks.dueAt} < now())::int`,
      dueToday: sql<number>`count(*) filter (where ${tasks.status} in ('todo','in_progress','blocked','in_review') and ${tasks.dueAt} < now() + interval '1 day' and ${tasks.dueAt} >= now())::int`,
      blocked: sql<number>`count(*) filter (where ${tasks.status} = 'blocked')::int`,
    })
    .from(tasks)
    .where(and(taskScope(actor), actor.kind === 'user' ? eq(tasks.ownerId, actor.id) : undefined));
  return r;
}
