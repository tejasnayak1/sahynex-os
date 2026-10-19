import { format, parseISO, subDays } from 'date-fns';
import { and, asc, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema, type DBOrTx } from '@/db';
import type { ReportContent } from '@/db/schema';
import { formatMoney } from '@/lib/format';
import { deriveCampaignMetrics, METRIC_DEFINITIONS } from '@/lib/metrics';
import { actorUserId, assertCan, type Actor } from '../actor';
import { reportScope } from '../access';
import { audit } from '../audit';
import { emit } from '../automation/events';
import { invalid, notFound, precondition } from '../errors';
import { sendMail } from '../mailer';
import { campaignTotals, freshness, sumTotals } from './campaigns';
import { notify, usersWithRoles } from './notifications';
import { getOrg } from './org';

const {
  reports,
  leads,
  deals,
  tasks,
  approvals,
  deliverables,
  incidents,
  automationExecutions,
  automations,
  campaigns,
  clients,
  conversionEvents,
  integrationConnections,
  dailyReports,
  users,
  invoices,
  expenses,
  clientContacts,
} = schema;
export type Report = typeof reports.$inferSelect;
export type ReportType = Report['type'];
type Metric = ReportContent['sections'][number]['metrics'][number];

export const REPORT_LABEL: Record<ReportType, string> = {
  daily_digest: 'Daily internal digest',
  weekly_ops: 'Weekly operational report',
  weekly_campaign: 'Weekly campaign summary',
  monthly_client: 'Monthly client report',
  executive: 'Executive management report',
  pipeline: 'Sales pipeline report',
};

const fmtCount = (v: number | null) => (v == null ? 'Unavailable' : v.toLocaleString('en-IN'));
const fmtPct = (v: number | null) => (v == null ? 'Unavailable' : `${(v * 100).toFixed(1)}%`);
const fmtMoney = (v: number | null, cur: string) => (v == null ? 'Unavailable' : formatMoney(v, cur));

function m(
  key: string,
  value: number | null,
  display: string,
  source: string,
  previous?: number | null,
  labelOverride?: string,
): Metric {
  const def = METRIC_DEFINITIONS[key];
  return {
    key,
    label: labelOverride ?? def?.label ?? key,
    value,
    display,
    definition: def?.definition ?? '',
    source,
    ...(previous !== undefined ? { previous } : {}),
  };
}
const internal = (
  key: string,
  label: string,
  value: number | null,
  definition: string,
  source = 'Sahynex OS records',
  previous?: number | null,
): Metric => ({
  key,
  label,
  value,
  display: fmtCount(value),
  definition,
  source,
  ...(previous !== undefined ? { previous } : {}),
});

async function freshnessFor(tx: DBOrTx, orgId: string, campaignIds: string[], staleAfterHours: number) {
  const conns = await tx.select().from(integrationConnections).where(eq(integrationConnections.orgId, orgId));
  const fr: ReportContent['freshness'] = conns
    .filter((c) => c.mode !== 'disconnected')
    .map((c) => ({
      source: `${c.provider}${c.mode === 'demo' ? ' (DEMO)' : ''}`,
      lastSuccessAt: c.lastSuccessSyncAt?.toISOString() ?? null,
      stale: !c.lastSuccessSyncAt || Date.now() - c.lastSuccessSyncAt.getTime() > staleAfterHours * 3_600_000,
    }));
  if (campaignIds.length) {
    const cs = await tx.select().from(campaigns).where(inArray(campaigns.id, campaignIds));
    for (const c of cs) {
      const f = freshness(c, staleAfterHours);
      fr.push({
        source: `Campaign: ${c.name}`,
        lastSuccessAt: c.lastSyncedAt?.toISOString() ?? null,
        stale: f.state !== 'fresh',
      });
    }
  }
  fr.push({ source: 'CRM (Sahynex OS)', lastSuccessAt: new Date().toISOString(), stale: false });
  return fr;
}

/** Start/end are calendar dates (inclusive) interpreted in the organisation's timezone. */
function tsRange(start: string, end: string, tz: string) {
  return {
    from: sql`(${start}::date)::timestamp at time zone ${tz}`,
    to: sql`((${end}::date + 1)::timestamp) at time zone ${tz}`,
  };
}

/* --------------------------------------------------------- builders */

async function buildCampaignSection(
  tx: DBOrTx,
  orgId: string,
  clientId: string | null,
  start: string,
  end: string,
  prevStart: string,
  prevEnd: string,
  currency: string,
  tz: string,
) {
  const cs = await tx
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.orgId, orgId), clientId ? eq(campaigns.clientId, clientId) : undefined));
  const ids = cs.map((c) => c.id);
  const [cur, prev] = await Promise.all([
    campaignTotals(tx, ids, start, end, tz),
    campaignTotals(tx, ids, prevStart, prevEnd, tz),
  ]);
  const total = deriveCampaignMetrics(sumTotals([...cur.values()]));
  const prevTotal = deriveCampaignMetrics(sumTotals([...prev.values()]));
  const sources = new Set<string>();
  const metricRows = ids.length
    ? await tx
        .selectDistinct({ source: schema.campaignMetrics.source })
        .from(schema.campaignMetrics)
        .where(
          and(
            inArray(schema.campaignMetrics.campaignId, ids),
            gte(schema.campaignMetrics.date, start),
            sql`${schema.campaignMetrics.date} <= ${end}`,
          ),
        )
    : [];
  metricRows.forEach((r) => sources.add(r.source));
  const platformSource = sources.size
    ? `Ad platforms (${[...sources].join(', ')})`
    : 'Ad platforms (no data in period)';
  const summary: Metric[] = [
    m('spend', total.spendMinor, fmtMoney(total.spendMinor, currency), platformSource, prevTotal.spendMinor),
    m('impressions', total.impressions, fmtCount(total.impressions), platformSource, prevTotal.impressions),
    m('clicks', total.clicks, fmtCount(total.clicks), platformSource, prevTotal.clicks),
    m('ctr', total.ctr, fmtPct(total.ctr), platformSource, prevTotal.ctr),
    m('cpc', total.cpcMinor, fmtMoney(total.cpcMinor, currency), platformSource, prevTotal.cpcMinor),
    m(
      'platformLeads',
      total.platformLeads,
      fmtCount(total.platformLeads),
      platformSource,
      prevTotal.platformLeads,
    ),
    m('crmLeads', total.crmLeads, fmtCount(total.crmLeads), 'Sahynex OS CRM', prevTotal.crmLeads),
    m(
      'cpl',
      total.cplMinor,
      fmtMoney(total.cplMinor, currency),
      'Platform spend ÷ CRM leads',
      prevTotal.cplMinor,
    ),
    m(
      'qualifiedLeads',
      total.qualifiedLeads,
      fmtCount(total.qualifiedLeads),
      'Sahynex OS CRM',
      prevTotal.qualifiedLeads,
    ),
    m(
      'cpql',
      total.cpqlMinor,
      fmtMoney(total.cpqlMinor, currency),
      'Platform spend ÷ qualified CRM leads',
      prevTotal.cpqlMinor,
    ),
    m(
      'lpConversion',
      total.lpConversion,
      fmtPct(total.lpConversion),
      'CRM leads ÷ platform landing-page views',
      prevTotal.lpConversion,
    ),
  ];
  const perCampaign: Metric[] = cs.map((c) => {
    const t = deriveCampaignMetrics(cur.get(c.id)!);
    return {
      key: `campaign:${c.id}`,
      label: c.name,
      value: t.spendMinor,
      display: `Spend ${fmtMoney(t.spendMinor, currency)} · CRM leads ${t.crmLeads} · CPL ${fmtMoney(t.cplMinor, currency)} · Qualified ${t.qualifiedLeads}`,
      definition: 'Per-campaign spend, CRM leads, CPL and qualified leads for the period.',
      source: `${c.platform}${c.isDemo ? ' (DEMO)' : ''}`,
    };
  });
  const exceptions: string[] = [];
  for (const c of cs) {
    const t = deriveCampaignMetrics(cur.get(c.id)!);
    if (
      c.cplThresholdMinor &&
      t.cplMinor != null &&
      t.crmLeads >= c.minLeadsForAlert &&
      t.cplMinor > c.cplThresholdMinor
    )
      exceptions.push(
        `${c.name}: CPL ${fmtMoney(t.cplMinor, currency)} is above the approved threshold ${fmtMoney(c.cplThresholdMinor, currency)}.`,
      );
    if (c.status === 'active' && (t.spendMinor ?? 0) > 0 && t.crmLeads === 0)
      exceptions.push(
        `${c.name}: spent ${fmtMoney(t.spendMinor, currency)} with no CRM leads — check the form and lead integration.`,
      );
    if (t.platformLeads != null && t.platformLeads - t.crmLeads > Math.max(3, t.platformLeads * 0.2))
      exceptions.push(
        `${c.name}: platform reports ${t.platformLeads} leads but only ${t.crmLeads} reached the CRM — reconcile the lead integration.`,
      );
  }
  return {
    summary,
    perCampaign,
    exceptions,
    campaignIds: ids,
    demo: cs.some((c) => c.isDemo) || sources.has('demo'),
  };
}

async function buildDailyDigest(tx: DBOrTx, orgId: string, start: string, end: string) {
  const org = await getOrg(tx, orgId);
  const { from, to } = tsRange(start, end, org.timezone);
  const cur = org.currency;
  const sla = org.parsedSettings.leads.firstContactSlaHours;
  const [leadStats] = await tx
    .select({
      total: sql<number>`count(*) filter (where ${leads.createdAt} >= ${from} and ${leads.createdAt} < ${to})::int`,
      qualified: sql<number>`count(*) filter (where ${leads.qualificationStatus} = 'qualified' and ${leads.updatedAt} >= ${from} and ${leads.updatedAt} < ${to})::int`,
      uncontacted: sql<number>`count(*) filter (where ${leads.stage} = 'new' and ${leads.createdAt} < now() - make_interval(hours => ${sla}))::int`,
      duplicates: sql<number>`count(*) filter (where ${leads.possibleDuplicateOfId} is not null)::int`,
    })
    .from(leads)
    .where(and(eq(leads.orgId, orgId), eq(leads.isTest, false), isNull(leads.deletedAt)));
  const [dealStats] = await tx
    .select({
      won: sql<number>`count(*) filter (where ${deals.stage} = 'won' and ${deals.wonAt} >= ${from} and ${deals.wonAt} < ${to})::int`,
      wonValue: sql<number>`coalesce(sum(${deals.valueMinor}) filter (where ${deals.stage} = 'won' and ${deals.wonAt} >= ${from} and ${deals.wonAt} < ${to}),0)::bigint`,
      stale: sql<number>`count(*) filter (where ${deals.stage} not in ('won','lost') and ${deals.lastInteractionAt} < now() - make_interval(days => ${org.parsedSettings.sales.staleDealDays}))::int`,
    })
    .from(deals)
    .where(and(eq(deals.orgId, orgId), isNull(deals.deletedAt)));
  const [taskStats] = await tx
    .select({
      completed: sql<number>`count(*) filter (where ${tasks.status} = 'done' and ${tasks.completedAt} >= ${from} and ${tasks.completedAt} < ${to})::int`,
      overdue: sql<number>`count(*) filter (where ${tasks.status} in ('todo','in_progress','blocked','in_review') and ${tasks.dueAt} < now())::int`,
      blocked: sql<number>`count(*) filter (where ${tasks.status} = 'blocked')::int`,
    })
    .from(tasks)
    .where(and(eq(tasks.orgId, orgId), isNull(tasks.deletedAt)));
  const [pendingApprovals] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(approvals)
    .where(and(eq(approvals.orgId, orgId), eq(approvals.decision, 'pending')));
  const [openIncidents] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(incidents)
    .where(and(eq(incidents.orgId, orgId), inArray(incidents.status, ['open', 'acknowledged'])));
  const failed = await tx
    .select({ name: automations.name, n: sql<number>`count(*)::int` })
    .from(automationExecutions)
    .innerJoin(automations, eq(automations.id, automationExecutions.automationId))
    .where(
      and(
        eq(automationExecutions.orgId, orgId),
        eq(automationExecutions.status, 'dead'),
        gte(automationExecutions.finishedAt, sql`now() - interval '24 hours'`),
      ),
    )
    .groupBy(automations.name);
  const [team] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.orgId, orgId), eq(users.isActive, true), isNull(users.clientId)));
  const [submitted] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(dailyReports)
    .where(and(eq(dailyReports.orgId, orgId), eq(dailyReports.reportDate, end)));
  const camp = await buildCampaignSection(
    tx,
    orgId,
    null,
    start,
    end,
    format(subDays(parseISO(start), 1), 'yyyy-MM-dd'),
    format(subDays(parseISO(end), 1), 'yyyy-MM-dd'),
    cur,
    org.timezone,
  );

  const exceptions: string[] = [];
  if (leadStats.uncontacted)
    exceptions.push(`${leadStats.uncontacted} lead(s) not contacted within the ${sla}h SLA.`);
  if (leadStats.duplicates)
    exceptions.push(`${leadStats.duplicates} possible duplicate lead(s) awaiting review.`);
  if (dealStats.stale)
    exceptions.push(
      `${dealStats.stale} open deal(s) with no interaction in ${org.parsedSettings.sales.staleDealDays}+ days.`,
    );
  if (taskStats.overdue)
    exceptions.push(`${taskStats.overdue} overdue task(s); ${taskStats.blocked} blocked.`);
  if (openIncidents.n) exceptions.push(`${openIncidents.n} open landing-page / conversion incident(s).`);
  for (const f of failed) exceptions.push(`Automation “${f.name}” failed ${f.n} time(s) in the last 24h.`);
  exceptions.push(...camp.exceptions);

  const content: ReportContent = {
    sections: [
      {
        title: 'Leads & sales',
        metrics: [
          internal(
            'newLeads',
            'New leads',
            leadStats.total,
            'Leads created in the period, excluding test leads.',
          ),
          internal(
            'qualifiedToday',
            'Leads qualified',
            leadStats.qualified,
            'Leads whose status is qualified and that were updated in the period.',
          ),
          internal(
            'uncontacted',
            'Uncontacted beyond SLA',
            leadStats.uncontacted,
            `Leads still in “new” more than ${sla}h after creation (current).`,
          ),
          internal('dealsWon', 'Deals won', dealStats.won, 'Deals moved to Won in the period.'),
          {
            key: 'wonValue',
            label: 'Won value',
            value: Number(dealStats.wonValue),
            display: formatMoney(Number(dealStats.wonValue), cur),
            definition: 'Sum of deal values won in the period (contract value, not invoiced revenue).',
            source: 'Sahynex OS records',
          },
        ],
      },
      {
        title: 'Delivery',
        metrics: [
          internal(
            'tasksCompleted',
            'Tasks completed',
            taskStats.completed,
            'Tasks marked done in the period. Not a measure of individual performance on its own.',
          ),
          internal(
            'tasksOverdue',
            'Tasks overdue',
            taskStats.overdue,
            'Open tasks past their due date (current).',
          ),
          internal(
            'approvalsPending',
            'Approvals pending',
            pendingApprovals.n,
            'Internal and client reviews awaiting a decision (current).',
          ),
          internal(
            'dailyReports',
            'Daily updates submitted',
            submitted.n,
            `Daily work updates submitted for ${end}, out of ${team.n} team members.`,
          ),
        ],
      },
      {
        title: 'Campaigns (all clients)',
        metrics: camp.summary,
        notes: camp.demo ? ['Includes DEMO campaign data.'] : undefined,
      },
    ],
    exceptions,
    freshness: await freshnessFor(tx, orgId, camp.campaignIds, org.parsedSettings.campaigns.staleAfterHours),
    demoDataIncluded: camp.demo,
  };
  return content;
}

async function buildClientReport(tx: DBOrTx, orgId: string, clientId: string, start: string, end: string) {
  const org = await getOrg(tx, orgId);
  const days = Math.round((parseISO(end).getTime() - parseISO(start).getTime()) / 86_400_000) + 1;
  const prevEnd = format(subDays(parseISO(start), 1), 'yyyy-MM-dd');
  const prevStart = format(subDays(parseISO(start), days), 'yyyy-MM-dd');
  const { from, to } = tsRange(start, end, org.timezone);
  const camp = await buildCampaignSection(
    tx,
    orgId,
    clientId,
    start,
    end,
    prevStart,
    prevEnd,
    org.currency,
    org.timezone,
  );
  const conv = await tx
    .select({ type: conversionEvents.type, n: sql<number>`count(*)::int` })
    .from(conversionEvents)
    .where(
      and(
        eq(conversionEvents.clientId, clientId),
        eq(conversionEvents.verified, true),
        sql`${conversionEvents.occurredAt} >= ${from} and ${conversionEvents.occurredAt} < ${to}`,
      ),
    )
    .groupBy(conversionEvents.type);
  const convCount = (t: string) => conv.find((c) => c.type === t)?.n ?? null;
  const [content] = await tx
    .select({
      published: sql<number>`count(*) filter (where ${deliverables.publishedAt} >= ${from} and ${deliverables.publishedAt} < ${to})::int`,
      approved: sql<number>`count(*) filter (where ${deliverables.status} in ('approved','scheduled','published') and ${deliverables.updatedAt} >= ${from} and ${deliverables.updatedAt} < ${to})::int`,
      inReview: sql<number>`count(*) filter (where ${deliverables.status} in ('internal_review','submitted_to_client'))::int`,
      revisions: sql<number>`coalesce(sum(${deliverables.revisionCount}) filter (where ${deliverables.updatedAt} >= ${from} and ${deliverables.updatedAt} < ${to}),0)::int`,
    })
    .from(deliverables)
    .where(and(eq(deliverables.clientId, clientId), isNull(deliverables.deletedAt)));
  const out: ReportContent = {
    sections: [
      {
        title: 'Performance summary',
        metrics: camp.summary,
        notes: camp.demo ? ['Includes DEMO campaign data — not real results.'] : undefined,
      },
      {
        title: 'Outcomes',
        metrics: [
          m(
            'applications',
            convCount('application'),
            fmtCount(convCount('application')),
            'Verified conversion records',
          ),
          m(
            'admissions',
            convCount('admission'),
            fmtCount(convCount('admission')),
            'Verified conversion records',
          ),
        ],
        notes: conv.length
          ? undefined
          : [
              'No verified applications/admissions were recorded for this period — shown as unavailable, not zero.',
            ],
      },
      { title: 'Campaign breakdown', metrics: camp.perCampaign },
      {
        title: 'Creative delivery',
        metrics: [
          internal(
            'published',
            'Deliverables published',
            content.published,
            'Deliverables marked published in the period.',
          ),
          internal(
            'approved',
            'Deliverables approved',
            content.approved,
            'Deliverables approved in the period.',
          ),
          internal(
            'inReview',
            'Currently in review',
            content.inReview,
            'Deliverables awaiting internal or client review (current).',
          ),
          internal(
            'revisions',
            'Revision rounds',
            content.revisions,
            'Revision requests on deliverables updated in the period.',
          ),
        ],
      },
    ],
    exceptions: camp.exceptions,
    freshness: await freshnessFor(tx, orgId, camp.campaignIds, org.parsedSettings.campaigns.staleAfterHours),
    demoDataIncluded: camp.demo,
  };
  return out;
}

async function buildPipelineReport(tx: DBOrTx, orgId: string, start: string, end: string) {
  const org = await getOrg(tx, orgId);
  const { from, to } = tsRange(start, end, org.timezone);
  const stages = await tx
    .select({
      stage: deals.stage,
      n: sql<number>`count(*)::int`,
      value: sql<number>`coalesce(sum(${deals.valueMinor}),0)::bigint`,
      weighted: sql<number>`coalesce(sum(${deals.valueMinor} * ${deals.probability} / 100.0),0)::bigint`,
    })
    .from(deals)
    .where(and(eq(deals.orgId, orgId), isNull(deals.deletedAt), sql`${deals.stage} not in ('won','lost')`))
    .groupBy(deals.stage);
  const [closed] = await tx
    .select({
      won: sql<number>`count(*) filter (where ${deals.stage} = 'won')::int`,
      wonValue: sql<number>`coalesce(sum(${deals.valueMinor}) filter (where ${deals.stage} = 'won'),0)::bigint`,
      lost: sql<number>`count(*) filter (where ${deals.stage} = 'lost')::int`,
    })
    .from(deals)
    .where(and(eq(deals.orgId, orgId), sql`${deals.closedAt} >= ${from} and ${deals.closedAt} < ${to}`));
  const reasons = await tx
    .select({ reason: deals.lostReason, n: sql<number>`count(*)::int` })
    .from(deals)
    .where(
      and(
        eq(deals.orgId, orgId),
        eq(deals.stage, 'lost'),
        sql`${deals.closedAt} >= ${from} and ${deals.closedAt} < ${to}`,
      ),
    )
    .groupBy(deals.lostReason);
  const weighted = stages.reduce((a, s) => a + Number(s.weighted), 0);
  const content: ReportContent = {
    sections: [
      {
        title: 'Pipeline (current)',
        metrics: [
          {
            key: 'weightedPipeline',
            label: 'Weighted pipeline',
            value: weighted,
            display: formatMoney(weighted, org.currency),
            definition: METRIC_DEFINITIONS.weightedPipeline.definition,
            source: 'Sahynex OS deals',
          },
          ...stages.map((s) => ({
            key: `stage:${s.stage}`,
            label: s.stage.replace(/_/g, ' '),
            value: s.n,
            display: `${s.n} deals · ${formatMoney(Number(s.value), org.currency)}`,
            definition: 'Open deals in this stage and their total value.',
            source: 'Sahynex OS deals',
          })),
        ],
      },
      {
        title: 'Closed in period',
        metrics: [
          internal('won', 'Won', closed.won, 'Deals closed as won in the period.'),
          {
            key: 'wonValue',
            label: 'Won value',
            value: Number(closed.wonValue),
            display: formatMoney(Number(closed.wonValue), org.currency),
            definition: 'Contract value of deals won.',
            source: 'Sahynex OS deals',
          },
          internal('lost', 'Lost', closed.lost, 'Deals closed as lost in the period.'),
          {
            key: 'winRate',
            label: 'Win rate',
            value: closed.won + closed.lost ? closed.won / (closed.won + closed.lost) : null,
            display: fmtPct(closed.won + closed.lost ? closed.won / (closed.won + closed.lost) : null),
            definition: 'Won ÷ (won + lost) for deals closed in the period.',
            source: 'Sahynex OS deals',
          },
        ],
        notes: reasons.length
          ? [`Lost reasons: ${reasons.map((r) => `${r.reason ?? 'unspecified'} (${r.n})`).join(', ')}`]
          : undefined,
      },
    ],
    exceptions: [],
    freshness: [{ source: 'CRM (Sahynex OS)', lastSuccessAt: new Date().toISOString(), stale: false }],
    demoDataIncluded: false,
  };
  return content;
}

async function buildExecutiveReport(tx: DBOrTx, orgId: string, start: string, end: string) {
  const org = await getOrg(tx, orgId);
  const pipeline = await buildPipelineReport(tx, orgId, start, end);
  const digest = await buildDailyDigest(tx, orgId, start, end);
  const [inv] = await tx
    .select({
      invoiced: sql<number>`coalesce(sum(${invoices.amountMinor}),0)::bigint`,
      collected: sql<number>`coalesce(sum(least(${invoices.paidMinor}, ${invoices.amountMinor})) filter (where ${invoices.status} in ('paid','partially_paid')),0)::bigint`,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.orgId, orgId),
        sql`${invoices.status} <> 'void'`,
        gte(invoices.issueDate, start),
        sql`${invoices.issueDate} <= ${end}`,
      ),
    );
  const [exp] = await tx
    .select({
      total: sql<number>`coalesce(sum(${expenses.amountMinor}) filter (where not ${expenses.isPassThrough}),0)::bigint`,
    })
    .from(expenses)
    .where(
      and(eq(expenses.orgId, orgId), gte(expenses.incurredOn, start), sql`${expenses.incurredOn} <= ${end}`),
    );
  const content: ReportContent = {
    sections: [
      {
        title: 'Revenue (agency fees)',
        metrics: [
          {
            key: 'invoiced',
            label: 'Invoiced (excl. tax & pass-through)',
            value: Number(inv.invoiced),
            display: formatMoney(Number(inv.invoiced), org.currency),
            definition:
              'Agency-fee amount on non-void invoices issued in the period. Excludes GST and pass-through media spend.',
            source: 'Invoices',
          },
          {
            key: 'collected',
            label: 'Collected',
            value: Number(inv.collected),
            display: formatMoney(Number(inv.collected), org.currency),
            definition: 'Payments recorded against those invoices (capped at fee amount).',
            source: 'Invoices',
          },
          {
            key: 'directCosts',
            label: 'Direct costs (recorded)',
            value: Number(exp.total),
            display: formatMoney(Number(exp.total), org.currency),
            definition:
              'Recorded non-pass-through expenses in the period. Labour cost is excluded unless configured; see project profitability for estimates.',
            source: 'Expenses',
          },
        ],
        notes: [
          'Margins here are not shown because labour cost allocation is only available per project when hourly costs and time entries are recorded.',
        ],
      },
      ...pipeline.sections,
      ...digest.sections,
    ],
    exceptions: digest.exceptions,
    freshness: digest.freshness,
    demoDataIncluded: digest.demoDataIncluded,
  };
  return content;
}

async function buildWeeklyOps(tx: DBOrTx, orgId: string, start: string, end: string) {
  const org = await getOrg(tx, orgId);
  const { from, to } = tsRange(start, end, org.timezone);
  const byPerson = await tx
    .select({
      name: users.name,
      completed: sql<number>`count(${tasks.id}) filter (where ${tasks.status} = 'done' and ${tasks.completedAt} >= ${from} and ${tasks.completedAt} < ${to})::int`,
      points: sql<number>`coalesce(sum(${tasks.effortPoints}) filter (where ${tasks.status} = 'done' and ${tasks.completedAt} >= ${from} and ${tasks.completedAt} < ${to}),0)::int`,
      overdue: sql<number>`count(${tasks.id}) filter (where ${tasks.status} in ('todo','in_progress','blocked','in_review') and ${tasks.dueAt} < now())::int`,
    })
    .from(users)
    .leftJoin(tasks, and(eq(tasks.ownerId, users.id), isNull(tasks.deletedAt)))
    .where(and(eq(users.orgId, orgId), eq(users.isActive, true), isNull(users.clientId)))
    .groupBy(users.name)
    .orderBy(asc(users.name));
  const [appr] = await tx
    .select({
      decided: sql<number>`count(*)::int`,
      avgHours: sql<
        number | null
      >`avg(extract(epoch from (${approvals.decidedAt} - ${approvals.submittedAt})) / 3600)`,
    })
    .from(approvals)
    .where(
      and(
        eq(approvals.orgId, orgId),
        sql`${approvals.decidedAt} >= ${from} and ${approvals.decidedAt} < ${to}`,
      ),
    );
  const digest = await buildDailyDigest(tx, orgId, start, end);
  return {
    sections: [
      {
        title: 'Team execution',
        metrics: byPerson.map((p) => ({
          key: `person:${p.name}`,
          label: p.name,
          value: p.points,
          display: `${p.completed} tasks (${p.points} effort pts) completed · ${p.overdue} overdue`,
          definition: 'Completed tasks and effort points. Task counts are context, not a performance score.',
          source: 'Sahynex OS tasks',
        })),
      },
      {
        title: 'Approvals',
        metrics: [
          internal(
            'decided',
            'Reviews decided',
            appr.decided,
            'Internal and client reviews decided in the period.',
          ),
          {
            key: 'turnaround',
            label: 'Average review turnaround',
            value: appr.avgHours == null ? null : Number(appr.avgHours),
            display: appr.avgHours == null ? 'Unavailable' : `${Number(appr.avgHours).toFixed(1)} h`,
            definition: 'Average hours from submission to decision.',
            source: 'Sahynex OS approvals',
          },
        ],
      },
      ...digest.sections.filter((s) => s.title !== 'Leads & sales'),
    ],
    exceptions: digest.exceptions,
    freshness: digest.freshness,
    demoDataIncluded: digest.demoDataIncluded,
  } satisfies ReportContent;
}

/* ------------------------------------------------------------ lifecycle */

const genSchema = z.object({
  type: z.enum(['daily_digest', 'weekly_ops', 'weekly_campaign', 'monthly_client', 'executive', 'pipeline']),
  clientId: z.string().uuid().optional().nullable(),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * Generates (or regenerates) a report draft. Approved/delivered reports are immutable — regenerating
 * returns the existing record unchanged so what the client received is preserved.
 */
export async function generateReport(
  orgId: string,
  raw: z.input<typeof genSchema>,
  generatedById: string | null,
) {
  const input = genSchema.parse(raw);
  if (input.periodEnd < input.periodStart) throw invalid('Period end must be after the start.');
  const needsClient = input.type === 'monthly_client';
  if (needsClient && !input.clientId) throw invalid('Choose a client for a client report.');
  return db.transaction(async (tx) => {
    let content: ReportContent;
    let clientName: string | null = null;
    if (input.clientId) {
      const [c] = await tx
        .select({ name: clients.name })
        .from(clients)
        .where(and(eq(clients.id, input.clientId), eq(clients.orgId, orgId)));
      if (!c) throw invalid('Unknown client.');
      clientName = c.name;
    }
    switch (input.type) {
      case 'daily_digest':
        content = await buildDailyDigest(tx, orgId, input.periodStart, input.periodEnd);
        break;
      case 'monthly_client':
        content = await buildClientReport(tx, orgId, input.clientId!, input.periodStart, input.periodEnd);
        break;
      case 'weekly_campaign': {
        const org = await getOrg(tx, orgId);
        const days =
          Math.round(
            (parseISO(input.periodEnd).getTime() - parseISO(input.periodStart).getTime()) / 86_400_000,
          ) + 1;
        const camp = await buildCampaignSection(
          tx,
          orgId,
          input.clientId ?? null,
          input.periodStart,
          input.periodEnd,
          format(subDays(parseISO(input.periodStart), days), 'yyyy-MM-dd'),
          format(subDays(parseISO(input.periodStart), 1), 'yyyy-MM-dd'),
          org.currency,
          org.timezone,
        );
        content = {
          sections: [
            { title: 'Summary', metrics: camp.summary },
            { title: 'By campaign', metrics: camp.perCampaign },
          ],
          exceptions: camp.exceptions,
          freshness: await freshnessFor(
            tx,
            orgId,
            camp.campaignIds,
            org.parsedSettings.campaigns.staleAfterHours,
          ),
          demoDataIncluded: camp.demo,
        };
        break;
      }
      case 'pipeline':
        content = await buildPipelineReport(tx, orgId, input.periodStart, input.periodEnd);
        break;
      case 'executive':
        content = await buildExecutiveReport(tx, orgId, input.periodStart, input.periodEnd);
        break;
      case 'weekly_ops':
        content = await buildWeeklyOps(tx, orgId, input.periodStart, input.periodEnd);
        break;
    }
    const title = `${REPORT_LABEL[input.type]}${clientName ? ` — ${clientName}` : ''} (${input.periodStart === input.periodEnd ? input.periodStart : `${input.periodStart} to ${input.periodEnd}`})`;
    const [existing] = await tx
      .select()
      .from(reports)
      .where(
        and(
          eq(reports.orgId, orgId),
          eq(reports.type, input.type),
          eq(reports.periodStart, input.periodStart),
          input.clientId ? eq(reports.clientId, input.clientId) : isNull(reports.clientId),
        ),
      )
      .for('update');
    if (existing && (existing.status === 'approved' || existing.status === 'delivered'))
      return { report: existing, regenerated: false };
    if (existing) {
      const [u] = await tx
        .update(reports)
        .set({
          content,
          title,
          periodEnd: input.periodEnd,
          status: 'draft',
          generatedAt: new Date(),
          generatedById,
          deliveryError: null,
        })
        .where(eq(reports.id, existing.id))
        .returning();
      return { report: u, regenerated: true };
    }
    const [r] = await tx
      .insert(reports)
      .values({
        orgId,
        type: input.type,
        clientId: input.clientId ?? null,
        title,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        content,
        generatedById,
      })
      .returning();
    return { report: r, regenerated: true };
  });
}

export async function generateReportAsUser(actor: Actor, raw: z.input<typeof genSchema>) {
  assertCan(actor, 'reports.generate');
  if (raw.clientId) {
    const { clientOptions } = await import('./clients');
    const ok = (await clientOptions(actor)).some((c) => c.id === raw.clientId);
    if (!ok) throw notFound('Client');
  }
  const r = await generateReport(actor.orgId, raw, actorUserId(actor));
  await audit(db, actor, 'report.generated', 'report', r.report.id, {
    after: { type: r.report.type, period: r.report.periodStart },
  });
  return r;
}

async function getReportForUpdate(tx: DBOrTx, actor: Actor, id: string) {
  if (!z.string().uuid().safeParse(id).success) throw notFound('Report');
  const [r] = await tx
    .select()
    .from(reports)
    .where(and(eq(reports.id, id), reportScope(actor)))
    .for('update');
  if (!r) throw notFound('Report');
  return r;
}

export async function saveCommentary(actor: Actor, id: string, commentary: string) {
  assertCan(actor, 'reports.generate');
  await db.transaction(async (tx) => {
    const r = await getReportForUpdate(tx, actor, id);
    if (r.status === 'approved' || r.status === 'delivered')
      throw precondition('Approved reports cannot be edited.');
    await tx
      .update(reports)
      .set({ commentary: commentary.slice(0, 20000) })
      .where(eq(reports.id, id));
  });
}

export async function submitReportForReview(actor: Actor, id: string) {
  assertCan(actor, 'reports.generate');
  await db.transaction(async (tx) => {
    const r = await getReportForUpdate(tx, actor, id);
    if (r.status !== 'draft') throw precondition('Only drafts can be submitted for review.');
    await tx.update(reports).set({ status: 'in_review' }).where(eq(reports.id, id));
    await audit(tx, actor, 'report.submitted', 'report', id);
    for (const u of await usersWithRoles(tx, actor.orgId, ['coo', 'ceo']))
      await notify(tx, {
        orgId: actor.orgId,
        userId: u.id,
        type: 'report.review',
        title: `Report awaiting review: ${r.title}`,
        link: `/reports/${id}`,
        dedupeKey: `report-review:${id}:${Date.now()}`,
      });
  });
}

export async function approveReport(actor: Actor, id: string) {
  assertCan(actor, 'reports.approve');
  await db.transaction(async (tx) => {
    const r = await getReportForUpdate(tx, actor, id);
    if (r.status !== 'in_review' && r.status !== 'draft')
      throw precondition('Report is not awaiting approval.');
    if (r.content.demoDataIncluded && r.clientId)
      throw precondition('This report contains DEMO data and cannot be approved for a client.');
    await tx
      .update(reports)
      .set({ status: 'approved', reviewedById: actorUserId(actor), approvedAt: new Date() })
      .where(eq(reports.id, id));
    await audit(tx, actor, 'report.approved', 'report', id);
    await emit(tx, actor.orgId, 'report.approved', { reportId: id }, id);
  });
}

/** Delivery: in-app always; email when SMTP is configured. Never marks delivered when sending failed. */
export async function deliverReport(orgId: string, reportId: string, log: (m: string) => void = () => {}) {
  const [r] = await db
    .select()
    .from(reports)
    .where(and(eq(reports.id, reportId), eq(reports.orgId, orgId)));
  if (!r) throw notFound('Report');
  if (r.status !== 'approved') return { status: 'skipped' as const, reason: `Report status is ${r.status}` };
  const appUrl = process.env.APP_URL ?? '';
  const text = `${r.title}\n\nView the report: ${appUrl}/reports/${r.id}\n\nKey exceptions:\n${
    r.content.exceptions
      .slice(0, 10)
      .map((e) => `- ${e}`)
      .join('\n') || '- None'
  }`;
  let emails: string[] = [];
  if (r.clientId) {
    emails = (
      await db
        .select({ email: clientContacts.email })
        .from(clientContacts)
        .where(and(eq(clientContacts.clientId, r.clientId), eq(clientContacts.isApprover, true)))
    )
      .map((c) => c.email)
      .filter(Boolean) as string[];
    const portalUsers = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.clientId, r.clientId), eq(users.isActive, true)));
    for (const u of portalUsers)
      await notify(db, {
        orgId,
        userId: u.id,
        type: 'report.delivered',
        title: `New report: ${r.title}`,
        link: `/reports/${r.id}`,
        dedupeKey: `report-delivered:${r.id}`,
      });
  } else {
    const org = await getOrg(db, orgId);
    const recips = await usersWithRoles(db, orgId, org.parsedSettings.reports.digestRecipientRoles);
    emails = recips.map((u) => u.email);
    for (const u of recips)
      await notify(db, {
        orgId,
        userId: u.id,
        type: 'report.delivered',
        title: r.title,
        link: `/reports/${r.id}`,
        dedupeKey: `report-delivered:${r.id}`,
      });
  }
  if (!emails.length) {
    await db
      .update(reports)
      .set({
        status: 'delivered',
        deliveredAt: new Date(),
        deliveryChannel: 'in_app',
        deliveryError: r.clientId ? 'No client approver email on file — delivered in-app only.' : null,
      })
      .where(eq(reports.id, r.id));
    log('Delivered in-app (no email recipients).');
    return { status: 'delivered' as const, channel: 'in_app' };
  }
  const res = await sendMail({ to: emails, subject: r.title, text });
  if (res.status === 'sent') {
    await db
      .update(reports)
      .set({
        status: 'delivered',
        deliveredAt: new Date(),
        deliveryChannel: 'email+in_app',
        deliveryError: null,
      })
      .where(eq(reports.id, r.id));
    log(`Emailed to ${emails.length} recipient(s).`);
    return { status: 'delivered' as const, channel: 'email' };
  }
  const msg =
    res.status === 'not_configured'
      ? 'Email (SMTP) is not configured — share the report link or print to PDF manually.'
      : `Email failed: ${res.error}`;
  await db
    .update(reports)
    .set({ status: 'delivered', deliveredAt: new Date(), deliveryChannel: 'in_app', deliveryError: msg })
    .where(eq(reports.id, r.id));
  log(msg);
  return { status: 'delivered' as const, channel: 'in_app', warning: msg };
}

export async function listReports(actor: Actor, type?: string, clientId?: string) {
  return db
    .select({ r: reports, clientName: clients.name })
    .from(reports)
    .leftJoin(clients, eq(clients.id, reports.clientId))
    .where(
      and(
        reportScope(actor),
        type ? eq(reports.type, type as ReportType) : undefined,
        clientId ? eq(reports.clientId, clientId) : undefined,
      ),
    )
    .orderBy(desc(reports.periodStart), desc(reports.generatedAt))
    .limit(200);
}

export async function getReport(actor: Actor, id: string) {
  if (!z.string().uuid().safeParse(id).success) throw notFound('Report');
  const [r] = await db
    .select({ r: reports, clientName: clients.name })
    .from(reports)
    .leftJoin(clients, eq(clients.id, reports.clientId))
    .where(and(eq(reports.id, id), reportScope(actor)));
  if (!r) throw notFound('Report');
  return { ...r.r, clientName: r.clientName };
}

/* --------------------------------------------------------- daily updates */

const dailySchema = z.object({
  completed: z.string().trim().min(1, 'Required').max(10000),
  inProgress: z.string().max(10000).optional(),
  blockers: z.string().max(5000).optional(),
  plannedNext: z.string().max(5000).optional(),
});

export async function submitDailyUpdate(actor: Actor, date: string, raw: Record<string, unknown>) {
  if (actor.kind !== 'user' || actor.clientId) throw invalid('Only team members submit daily updates.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw invalid('Invalid date.');
  const input = dailySchema.safeParse(raw);
  if (!input.success) throw invalid('Describe what you completed today.', { completed: 'Required' });
  await db
    .insert(dailyReports)
    .values({ orgId: actor.orgId, userId: actor.id, reportDate: date, ...input.data })
    .onConflictDoUpdate({ target: [dailyReports.userId, dailyReports.reportDate], set: { ...input.data } });
}

export async function dailyUpdates(actor: Actor, date: string, team: boolean) {
  return db
    .select({ d: dailyReports, name: users.name })
    .from(dailyReports)
    .innerJoin(users, eq(users.id, dailyReports.userId))
    .where(
      and(
        eq(dailyReports.orgId, actor.orgId),
        eq(dailyReports.reportDate, date),
        team ? undefined : eq(dailyReports.userId, actor.id ?? ''),
      ),
    )
    .orderBy(asc(users.name));
}

export const reportPeriods = {
  yesterday(tz: string, now = new Date()) {
    const local = new Date(now.toLocaleString('en-US', { timeZone: tz }));
    const d = format(subDays(local, 1), 'yyyy-MM-dd');
    return { start: d, end: d };
  },
  lastWeek(tz: string, now = new Date()) {
    const local = new Date(now.toLocaleString('en-US', { timeZone: tz }));
    const dow = (local.getDay() + 6) % 7; // Monday = 0
    const thisMonday = subDays(local, dow);
    return {
      start: format(subDays(thisMonday, 7), 'yyyy-MM-dd'),
      end: format(subDays(thisMonday, 1), 'yyyy-MM-dd'),
    };
  },
  lastMonth(tz: string, now = new Date()) {
    const local = new Date(now.toLocaleString('en-US', { timeZone: tz }));
    const firstThis = new Date(local.getFullYear(), local.getMonth(), 1);
    const firstPrev = new Date(local.getFullYear(), local.getMonth() - 1, 1);
    return { start: format(firstPrev, 'yyyy-MM-dd'), end: format(subDays(firstThis, 1), 'yyyy-MM-dd') };
  },
};
