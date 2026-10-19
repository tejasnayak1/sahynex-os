import { format, subDays } from 'date-fns';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { schema } from '@/db';
import { formatMoney } from '@/lib/format';
import { deriveCampaignMetrics } from '@/lib/metrics';
import { campaignTotals, freshness, syncProviderMetrics } from '../../services/campaigns';
import { ingestLead } from '../../services/leads';
import { checkConversionGap, checkUrl, recordCheck } from '../../services/monitoring';
import { notify, usersWithRoles } from '../../services/notifications';
import { TransientError, type WorkflowDefinition } from '../types';

const { campaigns, campaignMetrics, monitoredPages, leads } = schema;

const localDate = (d: Date, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);

/** Automated campaign dashboard refresh. */
export const campaignRefresh: WorkflowDefinition = {
  key: 'campaign.refresh',
  name: 'Campaign metrics refresh',
  description:
    'Every 6 hours, pull the last 7 days of daily metrics from connected ad platforms (re-pulling recent days captures late attribution). Disconnected platforms are skipped and reported — never filled with estimates.',
  trigger: { type: 'schedule', cron: '15 */6 * * *' },
  conditions: ['Platform connection is Live (or explicitly Demo)', 'Campaign has a platform campaign ID'],
  actions: [
    'Fetch daily metrics',
    'Upsert per campaign/day',
    'Update data freshness',
    'Record unmapped platform campaigns',
  ],
  defaultConfig: { lookbackDays: 7 },
  configFields: [{ key: 'lookbackDays', label: 'Days to re-pull', type: 'number' }],
  handler: async (ctx) => {
    const to = localDate(ctx.now, ctx.timezone);
    const from = format(
      subDays(new Date(`${to}T00:00:00Z`), Number(ctx.config.lookbackDays ?? 7) - 1),
      'yyyy-MM-dd',
    );
    const results: string[] = [];
    let synced = 0;
    for (const provider of ['meta_ads', 'google_ads'] as const) {
      const r = await syncProviderMetrics(ctx.orgId, provider, from, to, (m, d) => ctx.log(m, d));
      if (r.status === 'skipped') results.push(`${provider}: skipped (${r.reason})`);
      else {
        synced++;
        results.push(
          `${provider}${r.mode === 'demo' ? ' [DEMO]' : ''}: ${r.rows} rows for ${r.campaigns} campaign(s)${r.unmatched ? `, ${r.unmatched} unmapped` : ''}`,
        );
      }
    }
    return { status: synced ? 'succeeded' : 'skipped', summary: results.join('; ') };
  },
};

/** Workflow 4 — Campaign performance alert. */
export const campaignAlerts: WorkflowDefinition = {
  key: 'campaign.alerts',
  name: 'Ad-spend & CPL alerts',
  description:
    'Hourly: check data freshness, then compare CPL over the evaluation window and yesterday’s spend against each campaign’s approved thresholds. CPL alerts only fire once the minimum lead sample is reached.',
  trigger: { type: 'schedule', cron: '35 * * * *' },
  conditions: [
    'Campaign active with at least one threshold set',
    'Data is fresh (stale data raises a missing-data alert instead)',
    'Minimum lead sample reached for CPL',
  ],
  actions: [
    'Missing-data alert',
    'CPL above threshold alert',
    'Daily spend above threshold alert',
    'Spending without leads alert',
  ],
  defaultConfig: {},
  handler: async (ctx) => {
    const cs = await ctx.db
      .select()
      .from(campaigns)
      .where(
        and(
          eq(campaigns.orgId, ctx.orgId),
          eq(campaigns.status, 'active'),
          sql`(${campaigns.cplThresholdMinor} is not null or ${campaigns.dailySpendThresholdMinor} is not null)`,
        ),
      );
    if (!cs.length) return { status: 'skipped', summary: 'No active campaigns with thresholds.' };
    const today = localDate(ctx.now, ctx.timezone);
    const yesterday = format(subDays(new Date(`${today}T00:00:00Z`), 1), 'yyyy-MM-dd');
    const from = format(
      subDays(new Date(`${today}T00:00:00Z`), ctx.settings.campaigns.evaluationDays - 1),
      'yyyy-MM-dd',
    );
    const totals = await campaignTotals(
      ctx.db,
      cs.map((c) => c.id),
      from,
      today,
      ctx.timezone,
    );
    const [{ currency }] = await ctx.db
      .select({ currency: schema.organisations.currency })
      .from(schema.organisations)
      .where(eq(schema.organisations.id, ctx.orgId));
    const fallback = (await usersWithRoles(ctx.db, ctx.orgId, ['coo', 'ceo'])).map((u) => u.id);
    let alerts = 0;
    const send = async (
      c: (typeof cs)[number],
      key: string,
      title: string,
      body: string,
      severity: 'warning' | 'high',
    ) => {
      const to = c.ownerId ? [c.ownerId] : fallback;
      for (const u of to)
        if (
          await notify(ctx.db, {
            orgId: ctx.orgId,
            userId: u,
            type: 'campaign.alert',
            severity,
            title,
            body,
            link: `/campaigns/${c.id}`,
            dedupeKey: `${key}:${u}`,
          })
        )
          alerts++;
      ctx.log(title);
    };
    for (const c of cs) {
      const f = freshness(c, ctx.settings.campaigns.staleAfterHours, ctx.now);
      if (f.state !== 'fresh') {
        await send(
          c,
          `campaign-stale:${c.id}:${today}`,
          `Missing/stale data: ${c.name}`,
          `${f.label}. Alerts are paused for this campaign until metrics refresh.`,
          'warning',
        );
        continue;
      }
      const t = deriveCampaignMetrics(totals.get(c.id)!);
      if (c.cplThresholdMinor) {
        if (t.crmLeads >= c.minLeadsForAlert && t.cplMinor != null && t.cplMinor > c.cplThresholdMinor)
          await send(
            c,
            `cpl:${c.id}:${today}`,
            `CPL above threshold: ${c.name}`,
            `CPL ${formatMoney(t.cplMinor, currency)} vs approved ${formatMoney(c.cplThresholdMinor, currency)} over the last ${ctx.settings.campaigns.evaluationDays} days (${t.crmLeads} leads).`,
            'high',
          );
        else if (
          t.crmLeads < c.minLeadsForAlert &&
          (t.spendMinor ?? 0) >= c.cplThresholdMinor * c.minLeadsForAlert
        )
          await send(
            c,
            `cpl-noleads:${c.id}:${today}`,
            `Spending without enough leads: ${c.name}`,
            `${formatMoney(t.spendMinor, currency)} spent for ${t.crmLeads} CRM lead(s) — CPL will exceed ${formatMoney(c.cplThresholdMinor, currency)} even at the minimum sample.`,
            'high',
          );
      }
      if (c.dailySpendThresholdMinor) {
        const [y] = await ctx.db
          .select({ spend: campaignMetrics.spendMinor })
          .from(campaignMetrics)
          .where(and(eq(campaignMetrics.campaignId, c.id), eq(campaignMetrics.date, yesterday)));
        if (y && y.spend > c.dailySpendThresholdMinor)
          await send(
            c,
            `spend:${c.id}:${yesterday}`,
            `Daily spend above threshold: ${c.name}`,
            `${formatMoney(y.spend, currency)} spent on ${yesterday} vs threshold ${formatMoney(c.dailySpendThresholdMinor, currency)}.`,
            'warning',
          );
      }
    }
    return {
      status: alerts ? 'succeeded' : 'skipped',
      summary: `${cs.length} campaign(s) evaluated; ${alerts} alert(s) sent.`,
    };
  },
};

/** Workflow 5 — Landing-page & conversion monitoring. */
export const pageMonitoring: WorkflowDefinition = {
  key: 'monitoring.pages',
  name: 'Landing-page & conversion monitoring',
  description:
    'Every 15 minutes: check each monitored page (status code + expected text), open/close incidents, detect campaigns spending without CRM leads, and run a safe CRM-ingestion self-test using a designated test lead (never notifies anyone).',
  trigger: { type: 'schedule', cron: '*/15 * * * *' },
  conditions: ['Monitor is active', 'URL resolves to a public address (SSRF protection)'],
  actions: [
    'Record check',
    'Open incident & notify owner on failure',
    'Mark recovered, then close after a verification check',
    'Conversion-gap incident',
    'CRM ingestion self-test',
  ],
  defaultConfig: { selfTest: true },
  configFields: [
    {
      key: 'selfTest',
      label: 'Run CRM ingestion self-test',
      type: 'boolean',
      help: 'Creates and immediately archives a flagged test lead. Test leads never trigger notifications or tasks.',
    },
  ],
  timeoutSeconds: 240,
  handler: async (ctx) => {
    const pages = await ctx.db
      .select()
      .from(monitoredPages)
      .where(and(eq(monitoredPages.orgId, ctx.orgId), eq(monitoredPages.isActive, true)));
    let failures = 0;
    const events: string[] = [];
    for (let i = 0; i < pages.length; i += 5) {
      const batch = pages.slice(i, i + 5);
      const results = await Promise.all(batch.map((p) => checkUrl(p.url, p.expectedStatus, p.expectedText)));
      for (const [j, p] of batch.entries()) {
        const r = results[j];
        if (!r.ok) failures++;
        const ev = await ctx.db.transaction((tx) => recordCheck(tx, p, r));
        if (ev) events.push(`${p.name}: incident ${ev}`);
        const gap = await ctx.db.transaction((tx) => checkConversionGap(tx, p, ctx.now));
        if (gap) events.push(`${p.name}: conversion-gap incident ${gap}`);
      }
    }
    let selfTest = 'not run';
    if (ctx.config.selfTest) {
      const email = `selftest+${ctx.execution.id.slice(0, 8)}@monitor.invalid`;
      try {
        const r = await ingestLead(
          ctx.actor,
          { name: 'CRM self-test (synthetic)', email, isTest: true, sourceKey: 'monitor_self_test' },
          'monitor_self_test',
        );
        const [stored] = await ctx.db
          .select()
          .from(leads)
          .where(and(eq(leads.id, r.lead.id), isNull(leads.deletedAt)));
        if (!stored) throw new TransientError('Self-test lead was not stored.');
        await ctx.db.update(leads).set({ deletedAt: ctx.now }).where(eq(leads.id, stored.id));
        selfTest = 'passed';
      } catch (e) {
        selfTest = `FAILED: ${e instanceof Error ? e.message : String(e)}`;
        for (const m of await usersWithRoles(ctx.db, ctx.orgId, ['coo', 'ceo']))
          await notify(ctx.db, {
            orgId: ctx.orgId,
            userId: m.id,
            type: 'monitoring.selftest',
            severity: 'high',
            title: 'CRM ingestion self-test failed',
            body: selfTest,
            link: '/automation/monitoring.pages',
            dedupeKey: `selftest-failed:${localDate(ctx.now, ctx.timezone)}`,
          });
      }
    }
    ctx.log(`Self-test: ${selfTest}`);
    events.forEach((e) => ctx.log(e));
    return {
      status: 'succeeded',
      summary: `${pages.length} page(s) checked, ${failures} failing; ${events.length} incident change(s); self-test ${selfTest}.`,
    };
  },
};
