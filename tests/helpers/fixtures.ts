import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { bootstrapOrg } from '@/db/bootstrap-lib';
import type { RoleKey } from '@/lib/permissions';
import { systemActor } from '@/server/actor';
import { loadActorForUser } from '@/server/auth/session';
import { hashPassword } from '@/server/auth/password';

let pwHash: string | null = null;

/** Creates an isolated organisation with one user per role. */
export async function makeOrg(opts: { timezone?: string } = {}) {
  const slug = `t-${randomUUID().slice(0, 8)}`;
  const { orgId, roleIds } = await bootstrapOrg(db, { name: `Test ${slug}`, slug, timezone: opts.timezone });
  pwHash ??= await hashPassword('Test-Password-123');
  const mk = async (role: RoleKey, extra: Partial<typeof schema.users.$inferInsert> = {}) => {
    const [u] = await db
      .insert(schema.users)
      .values({
        orgId,
        email: `${role}-${randomUUID().slice(0, 6)}@${slug}.test`,
        name: `${role} user`,
        passwordHash: pwHash!,
        roleId: roleIds[role],
        ...extra,
      })
      .returning();
    return u;
  };
  const users = {
    ceo: await mk('ceo'),
    coo: await mk('coo'),
    sales: await mk('sales', { acceptsLeads: true }),
    sales2: await mk('sales', { acceptsLeads: true }),
    pm: await mk('project_manager'),
    perf: await mk('performance_marketing'),
    designer: await mk('creative'),
    employee: await mk('employee'),
  };
  const actor = async (u: { id: string }) => (await loadActorForUser(u.id))!;
  return {
    orgId,
    slug,
    roleIds,
    users,
    system: systemActor(orgId, 'Test automation'),
    actors: {
      ceo: await actor(users.ceo),
      coo: await actor(users.coo),
      sales: await actor(users.sales),
      sales2: await actor(users.sales2),
      pm: await actor(users.pm),
      perf: await actor(users.perf),
      designer: await actor(users.designer),
      employee: await actor(users.employee),
    },
    actorFor: actor,
    async clientReviewer(clientId: string) {
      const u = await mk('client_reviewer', { clientId });
      return actor(u);
    },
  };
}

export type TestOrg = Awaited<ReturnType<typeof makeOrg>>;

export async function makeClient(
  org: TestOrg,
  name = `Client ${randomUUID().slice(0, 6)}`,
  ownerId?: string,
) {
  const [c] = await db
    .insert(schema.clients)
    .values({ orgId: org.orgId, name, accountOwnerId: ownerId ?? org.users.pm.id, status: 'active' })
    .returning();
  return c;
}

/** Runs one automation synchronously for an org (bypassing the shared queue). */
export async function runWorkflow(
  orgId: string,
  key: string,
  payload: Record<string, unknown> = {},
  idempotencyKey = `test:${randomUUID()}`,
) {
  const { runExecution } = await import('@/server/automation/engine');
  const [a] = (await db.select().from(schema.automations).where(eq(schema.automations.orgId, orgId))).filter(
    (x) => x.key === key,
  );
  const [e] = await db
    .insert(schema.automationExecutions)
    .values({
      orgId,
      automationId: a.id,
      idempotencyKey,
      payload,
      status: 'running',
      attempts: 1,
      startedAt: new Date(),
      lockedAt: new Date(),
      lockedBy: 'test',
    })
    .returning();
  const status = await runExecution(e);
  const [after] = await db
    .select()
    .from(schema.automationExecutions)
    .where(eq(schema.automationExecutions.id, e.id));
  return { status, execution: after };
}

/** Processes queued executions belonging to this org only (event-driven workflows). */
export async function drainOrg(orgId: string, max = 50) {
  const { runExecution } = await import('@/server/automation/engine');
  const { and, lte, sql } = await import('drizzle-orm');
  let n = 0;
  for (; n < max; n++) {
    const res = await db.execute<{ id: string }>(sql`
      update automation_executions set status = 'running', locked_at = now(), locked_by = 'test', attempts = attempts + 1, started_at = coalesce(started_at, now())
      where id = (select id from automation_executions where org_id = ${orgId} and status = 'queued' and run_after <= now() order by run_after limit 1 for update skip locked)
      returning id`);
    const id = res.rows[0]?.id;
    if (!id) break;
    const [e] = await db
      .select()
      .from(schema.automationExecutions)
      .where(
        and(eq(schema.automationExecutions.id, id), lte(schema.automationExecutions.runAfter, new Date())),
      );
    await runExecution(e);
  }
  return n;
}
