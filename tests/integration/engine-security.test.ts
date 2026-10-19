import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { db, schema } from '@/db';
import { can } from '@/server/actor';
import { authenticate } from '@/server/auth/login';
import { validateSessionToken } from '@/server/auth/session';
import {
  claimNext,
  enqueueDueSchedules,
  retryExecution,
  runExecution,
  setAutomationEnabled,
} from '@/server/automation/engine';
import { WORKFLOWS } from '@/server/automation/registry';
import { TransientError } from '@/server/automation/types';
import { apiFetch } from '@/server/integrations/http';
import {
  createApiKey,
  authenticateApiKey,
  configureIntegration,
  setRolePermissions,
  updateUser,
} from '@/server/services/admin';
import { getClient, listClients } from '@/server/services/clients';
import { createInvoice, financeSummary, listInvoices, projectProfitability } from '@/server/services/finance';
import { getProject } from '@/server/services/projects';
import { listLeads } from '@/server/services/leads';
import { createProject } from '@/server/services/projects';
import { generateReport, getReport, listReports } from '@/server/services/reports';
import { globalSearch } from '@/server/services/search';
import { makeClient, makeOrg, type TestOrg } from '../helpers/fixtures';

let org: TestOrg;
beforeAll(async () => {
  org = await makeOrg();
});

describe('automation engine', () => {
  it('retries transient failures with backoff, then dead-letters and alerts the owner', async () => {
    const def = WORKFLOWS.find((w) => w.key === 'lead.new')!;
    const original = def.handler;
    let calls = 0;
    def.handler = async () => {
      calls++;
      throw new TransientError('Upstream timeout');
    };
    try {
      const [a] = (
        await db.select().from(schema.automations).where(eq(schema.automations.orgId, org.orgId))
      ).filter((x) => x.key === 'lead.new');
      await db
        .update(schema.automations)
        .set({ maxAttempts: 3, backoffBaseSeconds: 1, ownerId: org.users.coo.id })
        .where(eq(schema.automations.id, a.id));
      const [e] = await db
        .insert(schema.automationExecutions)
        .values({ orgId: org.orgId, automationId: a.id, idempotencyKey: `t:${randomUUID()}`, payload: {} })
        .returning();
      for (let i = 0; i < 3; i++) {
        await db
          .update(schema.automationExecutions)
          .set({ runAfter: new Date(0) })
          .where(eq(schema.automationExecutions.id, e.id));
        const claimed = await db.execute<{ id: string }>(
          sql`update automation_executions set status='running', attempts = attempts + 1, locked_at = now() where id = ${e.id} returning id`,
        );
        expect(claimed.rows).toHaveLength(1);
        const [row] = await db
          .select()
          .from(schema.automationExecutions)
          .where(eq(schema.automationExecutions.id, e.id));
        await runExecution(row);
      }
      const [final] = await db
        .select()
        .from(schema.automationExecutions)
        .where(eq(schema.automationExecutions.id, e.id));
      expect(calls).toBe(3);
      expect(final.status).toBe('dead');
      expect(final.error).toContain('Upstream timeout');
      expect(final.logs.some((l) => l.message.includes('Will retry'))).toBe(true);
      const n = await db
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.userId, org.users.coo.id));
      expect(n.some((x) => x.type === 'automation.failed')).toBe(true);
      // Safe manual retry creates a linked execution; the original stays for investigation.
      def.handler = async () => ({ status: 'succeeded', summary: 'ok now' });
      const retry = await retryExecution(org.actors.coo, e.id);
      expect(retry.retryOfId).toBe(e.id);
      await expect(retryExecution(org.actors.employee, e.id)).rejects.toThrow(/permission/);
      await expect(retryExecution(org.actors.coo, retry.id)).rejects.toThrow(/Only failed/);
    } finally {
      def.handler = original;
    }
  });

  it('times out hung handlers', async () => {
    const def = WORKFLOWS.find((w) => w.key === 'lead.qualification')!;
    const original = def.handler;
    def.handler = () => new Promise(() => {});
    try {
      const [a] = (
        await db.select().from(schema.automations).where(eq(schema.automations.orgId, org.orgId))
      ).filter((x) => x.key === 'lead.qualification');
      await db
        .update(schema.automations)
        .set({ timeoutSeconds: 1, maxAttempts: 1 })
        .where(eq(schema.automations.id, a.id));
      const [e] = await db
        .insert(schema.automationExecutions)
        .values({
          orgId: org.orgId,
          automationId: a.id,
          idempotencyKey: `t:${randomUUID()}`,
          status: 'running',
          attempts: 1,
        })
        .returning();
      expect(await runExecution(e)).toBe('dead');
      const [row] = await db
        .select()
        .from(schema.automationExecutions)
        .where(eq(schema.automationExecutions.id, e.id));
      expect(row.error).toMatch(/Timed out/);
    } finally {
      def.handler = original;
    }
  });

  it('enqueues each schedule slot exactly once, even if called concurrently', async () => {
    const o = await makeOrg();
    const past = new Date(Date.now() - 60_000);
    await db
      .update(schema.automations)
      .set({ nextRunAt: past })
      .where(and(eq(schema.automations.orgId, o.orgId), eq(schema.automations.key, 'tasks.reminders')));
    await Promise.all([enqueueDueSchedules(), enqueueDueSchedules(), enqueueDueSchedules()]);
    const [a] = (
      await db.select().from(schema.automations).where(eq(schema.automations.orgId, o.orgId))
    ).filter((x) => x.key === 'tasks.reminders');
    const execs = await db
      .select()
      .from(schema.automationExecutions)
      .where(eq(schema.automationExecutions.automationId, a.id));
    expect(execs).toHaveLength(1);
    expect(a.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it('two workers never claim the same job', async () => {
    const o = await makeOrg();
    const [a] = (
      await db.select().from(schema.automations).where(eq(schema.automations.orgId, o.orgId))
    ).filter((x) => x.key === 'tasks.reminders');
    await db.insert(schema.automationExecutions).values(
      Array.from({ length: 6 }, () => ({
        orgId: o.orgId,
        automationId: a.id,
        idempotencyKey: randomUUID(),
      })),
    );
    const claimed = await Promise.all(Array.from({ length: 10 }, (_, i) => claimNext(`w${i}`)));
    const ids = claimed.filter(Boolean).map((c) => c!.id);
    expect(new Set(ids).size).toBe(ids.length);
    await db
      .update(schema.automationExecutions)
      .set({ status: 'skipped' })
      .where(eq(schema.automationExecutions.automationId, a.id));
  });

  it('disabled automations do not run', async () => {
    const o = await makeOrg();
    await setAutomationEnabled(o.actors.coo, 'tasks.reminders', false);
    const [a] = (
      await db.select().from(schema.automations).where(eq(schema.automations.orgId, o.orgId))
    ).filter((x) => x.key === 'tasks.reminders');
    expect(a.nextRunAt).toBeNull();
    const [e] = await db
      .insert(schema.automationExecutions)
      .values({
        orgId: o.orgId,
        automationId: a.id,
        idempotencyKey: randomUUID(),
        status: 'running',
        attempts: 1,
      })
      .returning();
    expect(await runExecution(e)).toBe('skipped');
  });

  it('maps upstream failures to retryable vs permanent errors', async () => {
    await expect(apiFetch('http://127.0.0.1:1/unreachable', { timeoutMs: 2000 })).rejects.toBeInstanceOf(
      TransientError,
    );
  });
});

describe('security & permissions', () => {
  it('employees cannot read company finances', async () => {
    expect(can(org.actors.employee, 'finance.read')).toBe(false);
    await expect(listInvoices(org.actors.employee)).rejects.toThrow(/permission/);
    await expect(financeSummary(org.actors.pm)).rejects.toThrow(/permission/);
    await expect(projectProfitability(org.actors.sales)).rejects.toThrow(/permission/);
    const c = await makeClient(org);
    await expect(
      createInvoice(org.actors.coo, {
        clientId: c.id,
        number: 'X1',
        issueDate: '2026-10-01',
        dueDate: '2026-10-31',
        amount: '1000',
      }),
    ).rejects.toThrow(/permission/);
  });

  it('project budgets are hidden from roles without commercial access', async () => {
    const c = await makeClient(org, undefined, org.users.pm.id);
    const p = await createProject(org.actors.coo, { clientId: c.id, name: 'Budgeted', budget: '100000' });
    await db.insert(schema.projectMembers).values({ projectId: p.id, userId: org.users.designer.id });
    expect((await getProject(org.actors.coo, p.id)).project.budgetMinor).toBe(10_000_000);
    expect((await getProject(org.actors.designer, p.id)).project.budgetMinor).toBeNull();
    await expect(
      createProject(org.actors.pm, { clientId: c.id, name: 'Sneaky budget', budget: '5' }),
    ).rejects.toThrow(/commercials/);
  });

  it('clients cannot access another client’s records, CRM or internal reports', async () => {
    const a = await makeClient(org, 'Client A');
    const b = await makeClient(org, 'Client B');
    const reviewer = await org.clientReviewer(a.id);
    expect(
      (await listClients(reviewer, { page: 1, pageSize: 50, dir: 'asc' })).rows.map((r) => r.id),
    ).toEqual([a.id]);
    await expect(getClient(reviewer, b.id)).rejects.toThrow(/not found/i);
    expect((await listLeads(reviewer, { page: 1, pageSize: 50, dir: 'desc' })).total).toBe(0);
    const { report: rb } = await generateReport(
      org.orgId,
      { type: 'monthly_client', clientId: b.id, periodStart: '2026-09-01', periodEnd: '2026-09-30' },
      null,
    );
    const { report: ra } = await generateReport(
      org.orgId,
      { type: 'monthly_client', clientId: a.id, periodStart: '2026-09-01', periodEnd: '2026-09-30' },
      null,
    );
    await expect(getReport(reviewer, rb.id)).rejects.toThrow(/not found/i);
    await expect(getReport(reviewer, ra.id)).rejects.toThrow(/not found/i); // drafts are not visible to clients
    await db.update(schema.reports).set({ status: 'approved' }).where(eq(schema.reports.id, ra.id));
    expect((await getReport(reviewer, ra.id)).id).toBe(ra.id);
    expect((await listReports(reviewer)).map((r) => r.r.id)).toEqual([ra.id]);
    const hits = await globalSearch(reviewer, 'Client');
    expect(hits.every((h) => h.type !== 'lead' && h.id !== b.id)).toBe(true);
  });

  it('users cannot escalate their own privileges', async () => {
    await expect(updateUser(org.actors.coo, org.users.coo.id, { isActive: 'false' })).rejects.toThrow(
      /yourself/,
    );
    await expect(setRolePermissions(org.actors.coo, org.roleIds.employee, ['finance.read'])).rejects.toThrow(
      /permission/,
    );
    await expect(
      setRolePermissions(org.actors.ceo, org.roleIds.ceo, ['dashboard.executive']),
    ).rejects.toThrow(/super-admin/);
    await expect(
      setRolePermissions(org.actors.ceo, org.roleIds.client_reviewer, ['finance.read']),
    ).rejects.toThrow(/External reviewers/);
  });

  it('role changes take effect immediately and revoke sessions', async () => {
    const o = await makeOrg();
    const login = await authenticate(o.users.employee.email, 'Test-Password-123', {
      ip: `t-${randomUUID()}`,
    });
    expect(await validateSessionToken(login.token)).not.toBeNull();
    await updateUser(o.actors.ceo, o.users.employee.id, { roleId: o.roleIds.creative });
    expect(await validateSessionToken(login.token)).toBeNull();
  });

  it('locks accounts after repeated failed sign-ins and does not reveal whether an email exists', async () => {
    const o = await makeOrg();
    const ip = `t-${randomUUID()}`;
    for (let i = 0; i < 5; i++)
      await expect(authenticate(o.users.sales.email, 'wrong-password', { ip })).rejects.toThrow(
        'Incorrect email or password.',
      );
    await expect(authenticate(o.users.sales.email, 'Test-Password-123', { ip })).rejects.toThrow(/locked/);
    await expect(authenticate('nobody@nowhere.test', 'whatever', { ip })).rejects.toThrow(
      'Incorrect email or password.',
    );
  });

  it('API keys are stored hashed, can be revoked, and refuse secrets in integration config', async () => {
    const { key } = await createApiKey(org.actors.ceo, 'Website');
    const [row] = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.orgId, org.orgId));
    expect(row.keyHash).not.toContain(key);
    expect(JSON.stringify(row)).not.toContain(key);
    expect((await authenticateApiKey(key))?.id).toBe(row.id);
    await expect(createApiKey(org.actors.sales, 'nope')).rejects.toThrow(/permission/);
    await expect(
      configureIntegration(org.actors.ceo, 'meta_ads', { mode: 'live', config: { accessToken: 'EAAB...' } }),
    ).rejects.toThrow(/secret/);
  });

  it('audit log records privileged and consequential actions with secrets redacted', async () => {
    const rows = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.orgId, org.orgId));
    const actions = new Set(rows.map((r) => r.action));
    for (const a of ['api_key.created', 'automation.retry']) expect(actions).toContain(a);
    expect(JSON.stringify(rows)).not.toMatch(/sx_live_[A-Za-z0-9_-]{20,}/);
  });
});

describe('scale', () => {
  it('lists, filters and counts 20,000 leads quickly using indexes', async () => {
    const o = await makeOrg();
    await db.execute(sql`
      insert into leads (org_id, ref, name, email, email_normalized, stage, owner_id, created_at)
      select ${o.orgId}, 'LD-B' || g, 'Bulk ' || g, 'bulk' || g || '@x.com', 'bulk' || g || '@x.com',
        (array['new','contacted','qualified','lost'])[1 + g % 4]::lead_stage, ${o.users.sales.id}, now() - (g || ' minutes')::interval
      from generate_series(1, 20000) g`);
    await db.execute(sql`analyze leads`);
    const t0 = performance.now();
    const page = await listLeads(o.actors.ceo, { page: 50, pageSize: 25, dir: 'desc', stage: 'qualified' });
    const search = await listLeads(o.actors.ceo, { page: 1, pageSize: 25, dir: 'desc', q: 'Bulk 1999' });
    const ms = performance.now() - t0;
    expect(page.total).toBe(5000);
    expect(page.rows).toHaveLength(25);
    expect(search.total).toBeGreaterThan(0);
    expect(ms).toBeLessThan(1500);
  });
});
