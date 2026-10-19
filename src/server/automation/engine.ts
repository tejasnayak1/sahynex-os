/**
 * Durable workflow engine on PostgreSQL.
 *
 * - Queue: automation_executions rows; workers claim with `FOR UPDATE SKIP LOCKED` (safe with N workers).
 * - Idempotency: unique (automation_id, idempotency_key); handlers are additionally idempotent
 *   (tasks use source_key, notifications use dedupe_key) so a retried run never duplicates side effects.
 * - Retries: exponential backoff with jitter for transient errors, up to max_attempts → 'dead' (dead-letter).
 * - Timeouts: each run is raced against the automation's timeout.
 * - Schedules: cron + org timezone; next_run_at is advanced under a row lock so each slot runs once.
 * - Repeated failures alert the owner (and CEO/COO after 3 consecutive failures).
 */
import { CronExpressionParser } from 'cron-parser';
import { and, desc, eq, lte, sql } from 'drizzle-orm';
import { hostname } from 'node:os';
import { db, schema } from '@/db';
import { parseOrgSettings } from '@/lib/org-settings';
import { assertCan, systemActor, type Actor } from '../actor';
import { audit } from '../audit';
import { AppError, notFound, precondition } from '../errors';
import { notify, usersWithRoles } from '../services/notifications';
import { getWorkflow } from './registry';
import { PermanentError, TransientError, type ExecutionRow } from './types';

const { automations, automationExecutions, organisations } = schema;

export const WORKER_ID = `${hostname()}:${process.pid}`;

export function nextCronRun(cron: string, tz: string, from: Date): Date {
  return CronExpressionParser.parse(cron, { currentDate: from, tz }).next().toDate();
}

export function backoffDelaySeconds(base: number, attempt: number, retryAfter?: number): number {
  const exp = base * 2 ** Math.max(0, attempt - 1);
  const jitter = Math.random() * base;
  return Math.min(Math.max(exp + jitter, retryAfter ?? 0), 6 * 3600);
}

/** Queue due scheduled runs. Each (automation, slot) is enqueued exactly once. */
export async function enqueueDueSchedules(now = new Date()): Promise<number> {
  let queued = 0;
  await db.transaction(async (tx) => {
    const due = await tx.execute<{
      id: string;
      org_id: string;
      trigger: { cron: string };
      next_run_at: Date;
      timezone: string;
    }>(sql`
      select a.id, a.org_id, a.trigger, a.next_run_at, o.timezone
      from automations a join organisations o on o.id = a.org_id
      where a.enabled and a.trigger->>'type' = 'schedule' and a.next_run_at is not null and a.next_run_at <= ${now.toISOString()}::timestamptz
      for update of a skip locked`);
    for (const a of due.rows) {
      const slot = new Date(a.next_run_at);
      const ins = await tx
        .insert(automationExecutions)
        .values({
          orgId: a.org_id,
          automationId: a.id,
          idempotencyKey: `schedule:${slot.toISOString()}`,
          payload: { scheduledFor: slot.toISOString() },
        })
        .onConflictDoNothing()
        .returning({ id: automationExecutions.id });
      queued += ins.length;
      // Advance from max(slot, now) so a long outage queues one catch-up run, not hundreds.
      const next = nextCronRun(a.trigger.cron, a.timezone, new Date(Math.max(slot.getTime(), now.getTime())));
      await tx.update(automations).set({ nextRunAt: next }).where(eq(automations.id, a.id));
    }
  });
  return queued;
}

/** Recover executions whose worker died mid-run. */
export async function recoverStaleLocks(now = new Date()): Promise<number> {
  const res = await db.execute(sql`
    update automation_executions e set status = 'queued', locked_at = null, locked_by = null,
      logs = e.logs || jsonb_build_array(jsonb_build_object('at', ${now.toISOString()}::text, 'level', 'warn', 'message', 'Recovered from stale lock (worker stopped mid-run)'))
    from automations a
    where a.id = e.automation_id and e.status = 'running'
      and e.locked_at < ${now.toISOString()}::timestamptz - make_interval(secs => greatest(a.timeout_seconds * 3, 300))`);
  return res.rowCount ?? 0;
}

export async function claimNext(workerId = WORKER_ID): Promise<ExecutionRow | null> {
  const res = await db.execute<{ id: string }>(sql`
    update automation_executions set status = 'running', locked_at = now(), locked_by = ${workerId},
      attempts = attempts + 1, started_at = coalesce(started_at, now())
    where id = (
      select id from automation_executions
      where status = 'queued' and run_after <= now()
      order by run_after limit 1 for update skip locked)
    returning id`);
  const id = res.rows[0]?.id;
  if (!id) return null;
  const [row] = await db.select().from(automationExecutions).where(eq(automationExecutions.id, id));
  return row ?? null;
}

function classify(e: unknown): { transient: boolean; message: string; retryAfter?: number } {
  if (e instanceof TransientError)
    return { transient: true, message: e.message, retryAfter: e.retryAfterSeconds };
  if (e instanceof PermanentError) return { transient: false, message: e.message };
  if (e instanceof AppError)
    return { transient: e.code === 'RATE_LIMITED' || e.code === 'CONFLICT', message: e.message };
  const msg = e instanceof Error ? e.message : String(e);
  return { transient: true, message: msg };
}

export async function runExecution(exec: ExecutionRow): Promise<ExecutionRow['status']> {
  const [automation] = await db.select().from(automations).where(eq(automations.id, exec.automationId));
  const [org] = await db.select().from(organisations).where(eq(organisations.id, exec.orgId));
  const logs = [...(exec.logs ?? [])];
  const log = (message: string, data?: unknown, level: 'info' | 'warn' | 'error' = 'info') =>
    logs.push({ at: new Date().toISOString(), level, message, ...(data === undefined ? {} : { data }) });
  const started = Date.now();

  const finish = async (status: ExecutionRow['status'], patch: Partial<ExecutionRow>) => {
    await db
      .update(automationExecutions)
      .set({ status, logs, lockedAt: null, lockedBy: null, ...patch })
      .where(eq(automationExecutions.id, exec.id));
    return status;
  };

  if (!automation || !org)
    return finish('dead', { error: 'Automation or organisation no longer exists', finishedAt: new Date() });
  const def = getWorkflow(automation.key);
  if (!def)
    return finish('dead', { error: `No handler registered for "${automation.key}"`, finishedAt: new Date() });
  if (!automation.enabled) {
    log('Automation is disabled — run skipped.');
    return finish('skipped', {
      finishedAt: new Date(),
      durationMs: 0,
      result: { summary: 'Automation disabled' },
    });
  }

  log(`Attempt ${exec.attempts} started on ${WORKER_ID}`);
  try {
    const timeoutMs = automation.timeoutSeconds * 1000;
    let timer: NodeJS.Timeout | undefined;
    const result = await Promise.race([
      def.handler({
        orgId: exec.orgId,
        timezone: org.timezone,
        automation,
        execution: exec,
        config: { ...def.defaultConfig, ...(automation.config ?? {}) },
        settings: parseOrgSettings(org.settings),
        payload: exec.payload ?? {},
        actor: systemActor(exec.orgId, `Automation: ${automation.name}`),
        db,
        now: new Date(),
        log,
      }),
      new Promise<never>((_, rej) => {
        timer = setTimeout(
          () => rej(new TransientError(`Timed out after ${automation.timeoutSeconds}s`)),
          timeoutMs,
        );
      }),
    ]).finally(() => clearTimeout(timer));

    log(result.summary);
    await db
      .update(automations)
      .set({ lastRunAt: new Date(), lastSuccessAt: new Date(), consecutiveFailures: 0 })
      .where(eq(automations.id, automation.id));
    return finish(result.status, {
      finishedAt: new Date(),
      durationMs: Date.now() - started,
      error: null,
      result: { summary: result.summary, ...(result.data ?? {}) },
    });
  } catch (e) {
    const c = classify(e);
    log(c.message, undefined, 'error');
    if (!(e instanceof AppError) && e instanceof Error && e.stack)
      console.error(`[automation:${automation.key}]`, e);
    const canRetry = c.transient && exec.attempts < automation.maxAttempts;
    if (canRetry) {
      const delay = backoffDelaySeconds(automation.backoffBaseSeconds, exec.attempts, c.retryAfter);
      log(
        `Will retry in ${Math.round(delay)}s (attempt ${exec.attempts}/${automation.maxAttempts})`,
        undefined,
        'warn',
      );
      return finish('queued', {
        error: c.message,
        runAfter: new Date(Date.now() + delay * 1000),
        durationMs: Date.now() - started,
      });
    }
    const failures = automation.consecutiveFailures + 1;
    await db
      .update(automations)
      .set({ lastRunAt: new Date(), consecutiveFailures: failures })
      .where(eq(automations.id, automation.id));
    await alertFailure(automation, exec, c.message, failures);
    return finish('dead', { error: c.message, finishedAt: new Date(), durationMs: Date.now() - started });
  }
}

async function alertFailure(
  automation: typeof automations.$inferSelect,
  exec: ExecutionRow,
  message: string,
  failures: number,
) {
  const link = `/automation/${automation.key}?execution=${exec.id}`;
  const recipients = new Set<string>();
  if (automation.ownerId) recipients.add(automation.ownerId);
  if (failures >= 3 || !automation.ownerId) {
    for (const u of await usersWithRoles(db, automation.orgId, ['ceo', 'coo'])) recipients.add(u.id);
  }
  for (const userId of recipients) {
    await notify(db, {
      orgId: automation.orgId,
      userId,
      type: 'automation.failed',
      severity: failures >= 3 ? 'high' : 'warning',
      title:
        failures >= 3
          ? `${automation.name} has failed ${failures} times in a row`
          : `${automation.name} failed`,
      body: message.slice(0, 500),
      link,
      dedupeKey: `automation-failed:${exec.id}`,
    });
  }
}

/** Process up to `max` due executions. Used by the worker loop and by tests ("inline" mode). */
export async function drainQueue(max = 100, workerId = WORKER_ID): Promise<number> {
  let n = 0;
  while (n < max) {
    const exec = await claimNext(workerId);
    if (!exec) break;
    await runExecution(exec);
    n++;
  }
  return n;
}

/** Manually trigger a scheduled automation now (Automation Centre "Run now"). */
export async function runNow(actor: Actor, key: string) {
  assertCan(actor, 'automation.manage');
  const [a] = await db
    .select()
    .from(automations)
    .where(and(eq(automations.orgId, actor.orgId), eq(automations.key, key)));
  if (!a) throw notFound('Automation');
  if (!a.enabled) throw precondition('Enable the automation before running it.');
  if (a.trigger.type !== 'schedule')
    throw precondition('Event-driven automations run when their event occurs.');
  const [row] = await db
    .insert(automationExecutions)
    .values({
      orgId: a.orgId,
      automationId: a.id,
      idempotencyKey: `manual:${Date.now()}:${actor.id}`,
      payload: { manual: true },
    })
    .returning();
  await audit(db, actor, 'automation.run_now', 'automation', a.id);
  return row;
}

/** Safe retry: only failed/dead runs; creates a linked new execution (handlers are idempotent). */
export async function retryExecution(actor: Actor, executionId: string) {
  assertCan(actor, 'automation.manage');
  const [e] = await db
    .select()
    .from(automationExecutions)
    .where(and(eq(automationExecutions.id, executionId), eq(automationExecutions.orgId, actor.orgId)));
  if (!e) throw notFound('Execution');
  if (e.status !== 'dead' && e.status !== 'failed') throw precondition('Only failed runs can be retried.');
  const priorRetries = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(automationExecutions)
    .where(eq(automationExecutions.retryOfId, e.id));
  const [row] = await db
    .insert(automationExecutions)
    .values({
      orgId: e.orgId,
      automationId: e.automationId,
      idempotencyKey: `${e.idempotencyKey}:retry:${(priorRetries[0]?.n ?? 0) + 1}`,
      payload: e.payload,
      retryOfId: e.id,
    })
    .returning();
  await db.update(automationExecutions).set({ status: 'failed' }).where(eq(automationExecutions.id, e.id));
  await audit(db, actor, 'automation.retry', 'automation_execution', e.id, {
    after: { newExecutionId: row.id },
  });
  return row;
}

export async function setAutomationEnabled(actor: Actor, key: string, enabled: boolean) {
  assertCan(actor, 'automation.manage');
  const [a] = await db
    .select()
    .from(automations)
    .where(and(eq(automations.orgId, actor.orgId), eq(automations.key, key)));
  if (!a) throw notFound('Automation');
  const [org] = await db.select().from(organisations).where(eq(organisations.id, actor.orgId));
  const nextRunAt =
    enabled && a.trigger.type === 'schedule' ? nextCronRun(a.trigger.cron, org.timezone, new Date()) : null;
  await db
    .update(automations)
    .set({ enabled, nextRunAt, consecutiveFailures: enabled ? 0 : a.consecutiveFailures })
    .where(eq(automations.id, a.id));
  await audit(db, actor, enabled ? 'automation.enabled' : 'automation.disabled', 'automation', a.id);
}

export async function updateAutomationConfig(
  actor: Actor,
  key: string,
  patch: { config?: Record<string, unknown>; cron?: string; ownerId?: string | null },
) {
  assertCan(actor, 'automation.manage');
  const [a] = await db
    .select()
    .from(automations)
    .where(and(eq(automations.orgId, actor.orgId), eq(automations.key, key)));
  if (!a) throw notFound('Automation');
  const [org] = await db.select().from(organisations).where(eq(organisations.id, actor.orgId));
  const set: Partial<typeof automations.$inferInsert> = {};
  if (patch.config) set.config = { ...a.config, ...patch.config };
  if (patch.ownerId !== undefined) set.ownerId = patch.ownerId;
  if (patch.cron !== undefined) {
    if (a.trigger.type !== 'schedule') throw precondition('Only scheduled automations have a schedule.');
    try {
      set.nextRunAt = a.enabled ? nextCronRun(patch.cron, org.timezone, new Date()) : null;
    } catch {
      throw new AppError(
        'VALIDATION',
        'That schedule is not a valid cron expression (minute hour day month weekday).',
      );
    }
    set.trigger = { type: 'schedule', cron: patch.cron };
  }
  await db.update(automations).set(set).where(eq(automations.id, a.id));
  await audit(db, actor, 'automation.configured', 'automation', a.id, {
    before: { config: a.config, trigger: a.trigger, ownerId: a.ownerId },
    after: set,
  });
}

export async function recentExecutions(orgId: string, automationId: string, limit = 50) {
  return db
    .select()
    .from(automationExecutions)
    .where(and(eq(automationExecutions.orgId, orgId), eq(automationExecutions.automationId, automationId)))
    .orderBy(desc(automationExecutions.createdAt))
    .limit(limit);
}

export async function queueDepth(orgId: string) {
  const [r] = await db
    .select({
      queued: sql<number>`count(*) filter (where status = 'queued' and run_after <= now())::int`,
      retrying: sql<number>`count(*) filter (where status = 'queued' and attempts > 0)::int`,
      dead: sql<number>`count(*) filter (where status = 'dead')::int`,
      running: sql<number>`count(*) filter (where status = 'running')::int`,
    })
    .from(automationExecutions)
    .where(and(eq(automationExecutions.orgId, orgId), lte(automationExecutions.createdAt, sql`now()`)));
  return r;
}
