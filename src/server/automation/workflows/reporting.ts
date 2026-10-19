import { endOfMonth, format, startOfMonth } from 'date-fns';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { schema } from '@/db';
import { deliverReport, generateReport, reportPeriods } from '../../services/reports';
import { notify, usersWithRoles } from '../../services/notifications';
import type { WorkflowDefinition } from '../types';

const { reports, clients, projects, kpis, kpiRecords, leads, conversionEvents } = schema;

/** Workflow 8 — Daily report (+ KPI tracking). */
export const dailyReport: WorkflowDefinition = {
  key: 'reports.daily',
  name: 'Daily digest & KPI tracking',
  description:
    'Each morning: build yesterday’s internal digest from validated data (leads, pipeline, delivery, campaigns, exceptions), deliver it to the configured roles, and record month-to-date KPI values.',
  trigger: { type: 'schedule', cron: '55 7 * * *' },
  conditions: ['Internal report — approved automatically (it is never shared externally)'],
  actions: [
    'Generate digest for the previous day',
    'Deliver in-app (and email if configured)',
    'Record month-to-date KPI actuals',
  ],
  defaultConfig: {},
  timeoutSeconds: 180,
  handler: async (ctx) => {
    const { start, end } = reportPeriods.yesterday(ctx.timezone, ctx.now);
    const { report } = await generateReport(
      ctx.orgId,
      { type: 'daily_digest', periodStart: start, periodEnd: end },
      null,
    );
    if (report.status === 'draft' || report.status === 'in_review')
      await ctx.db
        .update(reports)
        .set({ status: 'approved', approvedAt: ctx.now })
        .where(eq(reports.id, report.id));
    const delivery =
      report.status === 'delivered'
        ? { status: 'skipped' as const }
        : await deliverReport(ctx.orgId, report.id, ctx.log);
    // KPI tracking: month-to-date actuals for measurable KPI keys.
    const local = new Date(`${end}T00:00:00Z`);
    const ms = format(startOfMonth(local), 'yyyy-MM-dd');
    const me = format(endOfMonth(local), 'yyyy-MM-dd');
    const tracked = await ctx.db
      .select()
      .from(kpis)
      .where(
        and(
          eq(kpis.orgId, ctx.orgId),
          inArray(kpis.key, ['leads', 'qualified_leads', 'applications', 'admissions']),
        ),
      );
    for (const k of tracked) {
      let value: number;
      if (k.key === 'leads' || k.key === 'qualified_leads') {
        const [r] = await ctx.db
          .select({
            n:
              k.key === 'leads'
                ? sql<number>`count(*)::int`
                : sql<number>`count(*) filter (where ${leads.qualificationStatus} = 'qualified')::int`,
          })
          .from(leads)
          .where(
            and(
              eq(leads.orgId, ctx.orgId),
              eq(leads.isTest, false),
              isNull(leads.deletedAt),
              k.clientId ? eq(leads.clientId, k.clientId) : isNull(leads.clientId),
              sql`${leads.createdAt} >= ((${ms}::date)::timestamp at time zone ${ctx.timezone}) and ${leads.createdAt} < (((${end}::date + 1)::timestamp) at time zone ${ctx.timezone})`,
            ),
          );
        value = r.n;
      } else {
        const [r] = await ctx.db
          .select({ n: sql<number>`count(*)::int` })
          .from(conversionEvents)
          .where(
            and(
              eq(conversionEvents.orgId, ctx.orgId),
              eq(conversionEvents.verified, true),
              eq(conversionEvents.type, k.key === 'admissions' ? 'admission' : 'application'),
              k.clientId ? eq(conversionEvents.clientId, k.clientId) : undefined,
              sql`${conversionEvents.occurredAt} >= ((${ms}::date)::timestamp at time zone ${ctx.timezone}) and ${conversionEvents.occurredAt} < (((${end}::date + 1)::timestamp) at time zone ${ctx.timezone})`,
            ),
          );
        value = r.n;
      }
      await ctx.db
        .insert(kpiRecords)
        .values({
          kpiId: k.id,
          periodStart: ms,
          periodEnd: me,
          value: String(value),
          source: 'automation:reports.daily (month to date)',
        })
        .onConflictDoUpdate({
          target: [kpiRecords.kpiId, kpiRecords.periodStart],
          set: { value: String(value), source: 'automation:reports.daily (month to date)' },
        });
    }
    return {
      status: 'succeeded',
      summary: `Digest for ${end} ${delivery.status === 'delivered' ? 'delivered' : 'already delivered'}; ${tracked.length} KPI(s) recorded.`,
      data: { reportId: report.id },
    };
  },
};

/** Workflow 9 — Client reports (weekly campaign summary + monthly client report). */
export const clientReports: WorkflowDefinition = {
  key: 'reports.client',
  name: 'Weekly & monthly client reports',
  description:
    'Each morning: on Mondays, draft weekly campaign summaries; on the 1st, draft last month’s report for every active client with a monthly reporting cadence. Drafts are routed to the account owner for internal review — nothing is sent to a client without approval.',
  trigger: { type: 'schedule', cron: '10 6 * * *' },
  conditions: [
    'Monday → weekly summaries',
    '1st of month → monthly client reports',
    'Client is active and has a project with monthly reporting',
  ],
  actions: ['Generate drafts from reconciled data', 'Notify account owner and approvers for review'],
  defaultConfig: { weeklyDay: 1 },
  configFields: [{ key: 'weeklyDay', label: 'Weekly summary day (0=Sun … 6=Sat)', type: 'number' }],
  timeoutSeconds: 300,
  handler: async (ctx) => {
    const local = new Date(ctx.now.toLocaleString('en-US', { timeZone: ctx.timezone }));
    const generated: string[] = [];
    const approvers = await usersWithRoles(ctx.db, ctx.orgId, ['coo', 'ceo']);
    const route = async (reportId: string, title: string, ownerId: string | null) => {
      for (const u of new Set([ownerId, ...approvers.map((a) => a.id)].filter(Boolean) as string[]))
        await notify(ctx.db, {
          orgId: ctx.orgId,
          userId: u,
          type: 'report.draft',
          title: `Draft ready for review: ${title}`,
          link: `/reports/${reportId}`,
          dedupeKey: `report-draft:${reportId}`,
        });
    };
    if (local.getDay() === Number(ctx.config.weeklyDay ?? 1) || ctx.payload.manual) {
      const { start, end } = reportPeriods.lastWeek(ctx.timezone, ctx.now);
      const { report } = await generateReport(
        ctx.orgId,
        { type: 'weekly_campaign', periodStart: start, periodEnd: end },
        null,
      );
      await route(report.id, report.title, null);
      generated.push(report.title);
    }
    if (local.getDate() === 1 || ctx.payload.manual) {
      const { start, end } = reportPeriods.lastMonth(ctx.timezone, ctx.now);
      const eligible = await ctx.db
        .selectDistinct({ id: clients.id, ownerId: clients.accountOwnerId })
        .from(clients)
        .innerJoin(projects, eq(projects.clientId, clients.id))
        .where(
          and(
            eq(clients.orgId, ctx.orgId),
            eq(clients.status, 'active'),
            eq(projects.reportingCadence, 'monthly'),
            inArray(projects.status, ['active', 'completed']),
          ),
        );
      for (const c of eligible) {
        const { report, regenerated } = await generateReport(
          ctx.orgId,
          { type: 'monthly_client', clientId: c.id, periodStart: start, periodEnd: end },
          null,
        );
        if (regenerated) await route(report.id, report.title, c.ownerId);
        generated.push(report.title);
      }
    }
    return {
      status: generated.length ? 'succeeded' : 'skipped',
      summary: generated.length ? `Drafted: ${generated.join('; ')}` : 'Nothing scheduled today.',
    };
  },
};

/** Delivery of approved reports through the configured channel. */
export const reportDelivery: WorkflowDefinition = {
  key: 'reports.deliver',
  name: 'Report delivery',
  description:
    'When a report is approved, deliver it to its recipients (client approvers or internal roles) in-app and by email when SMTP is configured, and log the outcome.',
  trigger: { type: 'event', events: ['report.approved'] },
  conditions: ['Report status is approved at run time'],
  actions: [
    'Notify portal users / internal recipients',
    'Email when configured',
    'Record delivery channel and any delivery warning',
  ],
  defaultConfig: {},
  handler: async (ctx) => {
    const r = await deliverReport(ctx.orgId, String(ctx.payload.reportId), ctx.log);
    if (r.status === 'skipped') return { status: 'skipped', summary: r.reason };
    return {
      status: 'succeeded',
      summary: `Delivered via ${r.channel}${'warning' in r && r.warning ? ` (${r.warning})` : ''}.`,
    };
  },
};
