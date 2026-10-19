import { createServer, type Server } from 'node:http';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, schema } from '@/db';
import {
  campaignTotals,
  createCampaign,
  getCampaign,
  importMetricsCsv,
  syncProviderMetrics,
} from '@/server/services/campaigns';
import { ingestLead } from '@/server/services/leads';
import { checkUrl, createMonitor, updateIncident } from '@/server/services/monitoring';
import { generateReport } from '@/server/services/reports';
import { makeClient, makeOrg, runWorkflow, type TestOrg } from '../helpers/fixtures';

let org: TestOrg;
let server: Server;
let healthy = true;
let base = '';

beforeAll(async () => {
  org = await makeOrg();
  server = createServer((req, res) => {
    if (req.method !== 'GET') {
      res.writeHead(405).end();
      return;
    }
    if (healthy)
      res.writeHead(200, { 'content-type': 'text/html' }).end('<form><button>Apply now</button></form>');
    else res.writeHead(503).end('down');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

// Calendar dates in the organisation's timezone (Asia/Kolkata by default), as the app reports them.
// Using UTC here made this test fail between 00:00 and 05:30 IST.
const ymd = (daysAgo: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(
    new Date(Date.now() - daysAgo * 86400000),
  );

describe('campaign metrics', () => {
  it('imports CSV metrics after validating every row, and refuses partial imports', async () => {
    const c = await makeClient(org, undefined, org.users.perf.id);
    const camp = await createCampaign(org.actors.perf, {
      clientId: c.id,
      name: 'CSV campaign',
      platform: 'other',
    });
    await expect(
      importMetricsCsv(
        org.actors.perf,
        camp.id,
        `date,spend,impressions,clicks\n${ymd(2)},100,1000,20\nbad-date,1,1,1`,
      ),
    ).rejects.toThrow(/Row 3/);
    expect(
      await db.select().from(schema.campaignMetrics).where(eq(schema.campaignMetrics.campaignId, camp.id)),
    ).toHaveLength(0);
    const r = await importMetricsCsv(
      org.actors.perf,
      camp.id,
      `date,spend,impressions,clicks,leads\n${ymd(2)},1000,10000,200,5\n${ymd(1)},500,5000,100,`,
    );
    expect(r.imported).toBe(2);
    // Re-importing replaces rather than duplicates.
    await importMetricsCsv(org.actors.perf, camp.id, `date,spend,impressions,clicks\n${ymd(1)},600,5000,100`);
    const t = (await campaignTotals(db, [camp.id], ymd(3), ymd(0))).get(camp.id)!;
    expect(t.spendMinor).toBe(160000);
    expect(t.platformLeads).toBe(5); // the missing value on day 1 is unknown, not zero
  });

  it('reconciles platform leads with CRM leads by day', async () => {
    const c = await makeClient(org, undefined, org.users.perf.id);
    const camp = await createCampaign(org.actors.perf, { clientId: c.id, name: 'Recon', platform: 'other' });
    await importMetricsCsv(
      org.actors.perf,
      camp.id,
      `date,spend,impressions,clicks,leads\n${ymd(0)},1000,10000,200,6`,
    );
    await ingestLead(
      org.system,
      { name: 'R1', email: 'r1@example.com', clientId: c.id, campaignId: camp.id },
      'api',
    );
    await ingestLead(
      org.system,
      { name: 'R2', email: 'r2@example.com', clientId: c.id, campaignId: camp.id },
      'api',
    );
    const d = await getCampaign(org.actors.perf, camp.id, ymd(1), ymd(0));
    const today = d.reconciliation.find((r) => r.date === ymd(0));
    expect(today?.platformLeads).toBe(6);
    expect(today?.crmLeads).toBe(2);
    expect(today?.gap).toBe(4);
    expect(d.metrics.cplMinor).toBe(50000);
  });

  it('syncs only when connected; demo mode only produces labelled demo data for demo campaigns', async () => {
    const skipped = await syncProviderMetrics(org.orgId, 'meta_ads', ymd(3), ymd(0), () => {});
    expect(skipped.status).toBe('skipped');
    const c = await makeClient(org, undefined, org.users.perf.id);
    const [demoCamp] = await db
      .insert(schema.campaigns)
      .values({
        orgId: org.orgId,
        clientId: c.id,
        name: 'Demo camp',
        platform: 'meta',
        externalId: `demo_${Date.now()}`,
        isDemo: true,
        budgetMinor: 9_000_000,
      })
      .returning();
    const [realCamp] = await db
      .insert(schema.campaigns)
      .values({
        orgId: org.orgId,
        clientId: c.id,
        name: 'Real camp',
        platform: 'meta',
        externalId: `real_${Date.now()}`,
      })
      .returning();
    await db
      .update(schema.integrationConnections)
      .set({ mode: 'demo' })
      .where(
        and(
          eq(schema.integrationConnections.orgId, org.orgId),
          eq(schema.integrationConnections.provider, 'meta_ads'),
        ),
      );
    const r = await syncProviderMetrics(org.orgId, 'meta_ads', ymd(3), ymd(0), () => {});
    expect(r.status).toBe('synced');
    const demoRows = await db
      .select()
      .from(schema.campaignMetrics)
      .where(eq(schema.campaignMetrics.campaignId, demoCamp.id));
    expect(demoRows.length).toBe(4);
    expect(demoRows.every((x) => x.source === 'demo')).toBe(true);
    expect(
      await db
        .select()
        .from(schema.campaignMetrics)
        .where(eq(schema.campaignMetrics.campaignId, realCamp.id)),
    ).toHaveLength(0);
    await db
      .update(schema.integrationConnections)
      .set({ mode: 'live' })
      .where(
        and(
          eq(schema.integrationConnections.orgId, org.orgId),
          eq(schema.integrationConnections.provider, 'meta_ads'),
        ),
      );
    const live = await syncProviderMetrics(org.orgId, 'meta_ads', ymd(3), ymd(0), () => {});
    expect(live.status).toBe('skipped'); // credentials missing → never pretends to sync
    const [conn] = await db
      .select()
      .from(schema.integrationConnections)
      .where(
        and(
          eq(schema.integrationConnections.orgId, org.orgId),
          eq(schema.integrationConnections.provider, 'meta_ads'),
        ),
      );
    expect(conn.status).toBe('error');
  });
});

describe('Workflow 4 — CPL alerts respect thresholds and minimum sample', () => {
  it('does not alert below the minimum sample, alerts once above it, and pauses on stale data', async () => {
    const o = await makeOrg();
    const c = await makeClient(o, undefined, o.users.perf.id);
    const camp = await createCampaign(o.actors.perf, {
      clientId: c.id,
      name: 'Threshold test',
      platform: 'other',
      cplThreshold: '500',
      minLeadsForAlert: '5',
      ownerId: o.users.perf.id,
    });
    // ₹6,000 spend, 3 leads → CPL ₹2,000 (> ₹500) but below the 5-lead minimum sample.
    await importMetricsCsv(o.actors.perf, camp.id, `date,spend,impressions,clicks\n${ymd(1)},6000,10000,100`);
    for (let i = 0; i < 3; i++)
      await ingestLead(
        o.system,
        { name: `L${i}`, email: `l${i}@x.com`, clientId: c.id, campaignId: camp.id },
        'api',
      );
    await runWorkflow(o.orgId, 'campaign.alerts');
    const alerts = async () =>
      (
        await db.select().from(schema.notifications).where(eq(schema.notifications.userId, o.users.perf.id))
      ).filter((n) => n.type === 'campaign.alert');
    expect((await alerts()).filter((a) => a.title.startsWith('CPL above'))).toHaveLength(0);
    for (let i = 3; i < 6; i++)
      await ingestLead(
        o.system,
        { name: `L${i}`, email: `l${i}@x.com`, clientId: c.id, campaignId: camp.id },
        'api',
      );
    await runWorkflow(o.orgId, 'campaign.alerts');
    await runWorkflow(o.orgId, 'campaign.alerts'); // deduplicated for the day
    expect((await alerts()).filter((a) => a.title.startsWith('CPL above'))).toHaveLength(1);
    // Stale data → a missing-data alert, and no threshold evaluation.
    await db
      .update(schema.campaigns)
      .set({ lastSyncedAt: new Date(Date.now() - 5 * 86400000) })
      .where(eq(schema.campaigns.id, camp.id));
    await runWorkflow(o.orgId, 'campaign.alerts');
    expect((await alerts()).some((a) => a.title.startsWith('Missing/stale data'))).toBe(true);
  });
});

describe('Workflow 5 — landing-page monitoring', () => {
  it('opens one incident on failure, marks recovery, and closes only after a verified fix', async () => {
    healthy = true;
    const ok = await checkUrl(`${base}/lp`, 200, 'Apply now');
    expect(ok.ok).toBe(true);
    expect((await checkUrl(`${base}/lp`, 200, 'Missing text')).ok).toBe(false);
    const page = await createMonitor(org.actors.perf, {
      name: 'LP',
      url: `${base}/lp`,
      expectedText: 'Apply now',
    });
    healthy = false;
    await runWorkflow(org.orgId, 'monitoring.pages', {}, 'm1');
    await runWorkflow(org.orgId, 'monitoring.pages', {}, 'm2');
    let incs = await db.select().from(schema.incidents).where(eq(schema.incidents.pageId, page.id));
    expect(incs).toHaveLength(1);
    expect(incs[0].status).toBe('open');
    await updateIncident(org.actors.perf, incs[0].id, 'resolve', 'Restarted server');
    // Still failing after "fix" → reopened.
    await runWorkflow(org.orgId, 'monitoring.pages', {}, 'm3');
    incs = await db.select().from(schema.incidents).where(eq(schema.incidents.pageId, page.id));
    expect(incs[0].status).toBe('open');
    healthy = true;
    await updateIncident(org.actors.perf, incs[0].id, 'resolve', 'Fixed DNS');
    await runWorkflow(org.orgId, 'monitoring.pages', {}, 'm4');
    incs = await db.select().from(schema.incidents).where(eq(schema.incidents.pageId, page.id));
    expect(incs[0].status).toBe('closed');
    expect(incs[0].verifiedAt).not.toBeNull();
    // The CRM self-test used a test lead and created no tasks or notifications.
    const testLeads = await db
      .select()
      .from(schema.leads)
      .where(and(eq(schema.leads.orgId, org.orgId), eq(schema.leads.isTest, true)));
    expect(testLeads.length).toBeGreaterThan(0);
    expect(testLeads.every((l) => l.deletedAt && !l.ownerId)).toBe(true);
  });

  it('refuses to monitor internal addresses when private access is not allowed', async () => {
    process.env.MONITOR_ALLOW_PRIVATE = 'false';
    try {
      await expect(
        createMonitor(org.actors.perf, { name: 'Metadata', url: 'http://169.254.169.254/latest' }),
      ).rejects.toThrow(/private/);
      expect((await checkUrl('http://127.0.0.1:1/', 200, null)).ok).toBe(false);
    } finally {
      process.env.MONITOR_ALLOW_PRIVATE = 'true';
    }
  });
});

describe('Workflow 8/9 — reports use the right period and never invent numbers', () => {
  it('counts only data inside the period (org timezone) and marks missing outcomes unavailable', async () => {
    const o = await makeOrg({ timezone: 'Asia/Kolkata' });
    const c = await makeClient(o);
    // 30 Sept 23:30 IST (inside September) and 1 Oct 00:30 IST (outside).
    await db.insert(schema.leads).values([
      {
        orgId: o.orgId,
        ref: 'LD-A',
        clientId: c.id,
        name: 'Inside',
        email: 'in@x.com',
        emailNormalized: 'in@x.com',
        createdAt: new Date('2026-09-30T18:00:00Z'),
      },
      {
        orgId: o.orgId,
        ref: 'LD-B',
        clientId: c.id,
        name: 'Outside',
        email: 'out@x.com',
        emailNormalized: 'out@x.com',
        createdAt: new Date('2026-09-30T19:00:00Z'),
      },
    ]);
    const [camp] = await db
      .insert(schema.campaigns)
      .values({ orgId: o.orgId, clientId: c.id, name: 'Sept', platform: 'other', lastSyncedAt: new Date() })
      .returning();
    await db.update(schema.leads).set({ campaignId: camp.id }).where(eq(schema.leads.orgId, o.orgId));
    const { report } = await generateReport(
      o.orgId,
      { type: 'monthly_client', clientId: c.id, periodStart: '2026-09-01', periodEnd: '2026-09-30' },
      null,
    );
    expect(report.periodStart).toBe('2026-09-01');
    expect(report.periodEnd).toBe('2026-09-30');
    const summary = report.content.sections.find((s) => s.title === 'Performance summary')!;
    expect(summary.metrics.find((m) => m.key === 'crmLeads')?.value).toBe(1);
    expect(summary.metrics.find((m) => m.key === 'spend')?.display).toBe('Unavailable');
    const outcomes = report.content.sections.find((s) => s.title === 'Outcomes')!;
    expect(outcomes.metrics.find((m) => m.key === 'admissions')?.value).toBeNull();
    for (const s of report.content.sections)
      for (const m of s.metrics) expect(m.definition.length + m.source.length).toBeGreaterThan(0);
    expect(report.content.freshness.length).toBeGreaterThan(0);
  });

  it('daily digest automation produces and delivers yesterday’s report once', async () => {
    const o = await makeOrg();
    const r1 = await runWorkflow(o.orgId, 'reports.daily');
    const r2 = await runWorkflow(o.orgId, 'reports.daily');
    expect(r1.execution.status).toBe('succeeded');
    expect(r2.execution.status).toBe('succeeded');
    const reports = await db.select().from(schema.reports).where(eq(schema.reports.orgId, o.orgId));
    expect(reports).toHaveLength(1);
    expect(reports[0].status).toBe('delivered');
    const n = (
      await db.select().from(schema.notifications).where(eq(schema.notifications.userId, o.users.ceo.id))
    ).filter((x) => x.type === 'report.delivered');
    expect(n).toHaveLength(1);
  });
});
