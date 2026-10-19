import { differenceInCalendarDays, format, parseISO, subDays } from 'date-fns';
import { and, asc, desc, eq, gte, inArray, isNull, lt, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { db, schema } from '@/db';
import { deriveCampaignMetrics } from '@/lib/metrics';
import { assertCan, can, type Actor } from '../actor';
import {
  campaignScope,
  clientScope,
  dealScope,
  deliverableScope,
  leadScope,
  projectScope,
  reportScope,
  taskScope,
} from '../access';
import { campaignTotals, sumTotals } from './campaigns';
import { getOrg } from './org';

const {
  leads,
  deals,
  proposals,
  clients,
  projects,
  tasks,
  approvals,
  deliverables,
  reports,
  automationExecutions,
  automations,
  incidents,
  campaigns,
  conversionEvents,
  users,
  handovers,
  campaignMetrics,
  monitoredPages,
} = schema;

export type DashboardFilters = { from: string; to: string; clientId?: string; teamId?: string };

function teamOwner(col: SQL | AnyColumn, teamId?: string) {
  return teamId ? sql`${col} in (select id from users where team_id = ${teamId})` : undefined;
}

export async function executiveDashboard(actor: Actor, f: DashboardFilters) {
  assertCan(actor, 'dashboard.executive');
  const org = await getOrg(db, actor.orgId);
  const tz = org.timezone;
  const days = differenceInCalendarDays(parseISO(f.to), parseISO(f.from)) + 1;
  const prevTo = format(subDays(parseISO(f.from), 1), 'yyyy-MM-dd');
  const prevFrom = format(subDays(parseISO(f.from), days), 'yyyy-MM-dd');
  const range = (from: string, to: string) => ({
    a: sql`(${from}::date)::timestamp at time zone ${tz}`,
    b: sql`((${to}::date + 1)::timestamp) at time zone ${tz}`,
  });
  const cur = range(f.from, f.to);
  const prev = range(prevFrom, prevTo);
  const clientFilter = (col: SQL | AnyColumn) => (f.clientId ? sql`${col} = ${f.clientId}` : undefined);

  const leadAgg = async (r: { a: SQL; b: SQL }) =>
    (
      await db
        .select({
          total: sql<number>`count(*)::int`,
          qualified: sql<number>`count(*) filter (where ${leads.qualificationStatus} = 'qualified')::int`,
        })
        .from(leads)
        .where(
          and(
            leadScope(actor),
            eq(leads.isTest, false),
            sql`${leads.createdAt} >= ${r.a} and ${leads.createdAt} < ${r.b}`,
            clientFilter(leads.clientId),
            teamOwner(leads.ownerId, f.teamId),
          ),
        )
    )[0];

  const [leadsCur, leadsPrev] = await Promise.all([leadAgg(cur), leadAgg(prev)]);

  const [pipeline] = await db
    .select({
      open: sql<number>`count(*) filter (where ${deals.stage} not in ('won','lost'))::int`,
      openValue: sql<number>`coalesce(sum(${deals.valueMinor}) filter (where ${deals.stage} not in ('won','lost')),0)::bigint`,
      weighted: sql<number>`coalesce(sum(${deals.valueMinor} * ${deals.probability} / 100.0) filter (where ${deals.stage} not in ('won','lost')),0)::bigint`,
      won: sql<number>`count(*) filter (where ${deals.stage} = 'won' and ${deals.wonAt} >= ${cur.a} and ${deals.wonAt} < ${cur.b})::int`,
      wonValue: sql<number>`coalesce(sum(${deals.valueMinor}) filter (where ${deals.stage} = 'won' and ${deals.wonAt} >= ${cur.a} and ${deals.wonAt} < ${cur.b}),0)::bigint`,
      wonValuePrev: sql<number>`coalesce(sum(${deals.valueMinor}) filter (where ${deals.stage} = 'won' and ${deals.wonAt} >= ${prev.a} and ${deals.wonAt} < ${prev.b}),0)::bigint`,
    })
    .from(deals)
    .where(and(dealScope(actor), teamOwner(deals.ownerId, f.teamId)));
  const [prop] = await db
    .select({
      n: sql<number>`count(*)::int`,
      value: sql<number>`coalesce(sum(${proposals.valueMinor}),0)::bigint`,
    })
    .from(proposals)
    .innerJoin(deals, eq(deals.id, proposals.dealId))
    .where(and(dealScope(actor), sql`${proposals.sentAt} >= ${cur.a} and ${proposals.sentAt} < ${cur.b}`));

  const campIds = (
    await db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(and(campaignScope(actor), f.clientId ? eq(campaigns.clientId, f.clientId) : undefined))
  ).map((c) => c.id);
  const [cTot, pTot] = await Promise.all([
    campaignTotals(db, campIds, f.from, f.to, tz),
    campaignTotals(db, campIds, prevFrom, prevTo, tz),
  ]);
  const campCur = deriveCampaignMetrics(sumTotals([...cTot.values()]));
  const campPrev = deriveCampaignMetrics(sumTotals([...pTot.values()]));
  const demoCampaigns = campIds.length
    ? (
        await db
          .select({ n: sql<number>`count(*)::int` })
          .from(campaigns)
          .where(and(inArray(campaigns.id, campIds), eq(campaigns.isDemo, true)))
      )[0].n
    : 0;

  const conv = await db
    .select({ type: conversionEvents.type, n: sql<number>`count(*)::int` })
    .from(conversionEvents)
    .where(
      and(
        eq(conversionEvents.orgId, actor.orgId),
        eq(conversionEvents.verified, true),
        inArray(
          conversionEvents.clientId,
          sql`(select ${clients.id} from ${clients} where ${clientScope(actor)})`,
        ),
        clientFilter(conversionEvents.clientId),
        sql`${conversionEvents.occurredAt} >= ${cur.a} and ${conversionEvents.occurredAt} < ${cur.b}`,
      ),
    )
    .groupBy(conversionEvents.type);

  // Note: each count is its own query so every column renders fully qualified (Drizzle drops table
  // prefixes inside single-table select lists, which would make correlated subqueries ambiguous).
  const count = async (q: Promise<Array<{ n: number }>>) => (await q)[0]?.n ?? 0;
  const n = sql<number>`count(*)::int`;
  const teamTasks = f.teamId
    ? sql`${tasks.ownerId} in (select id from users where team_id = ${f.teamId})`
    : undefined;
  const [
    activeClients,
    activeProjects,
    tasksDone,
    tasksOverdue,
    pendingClientApprovals,
    pendingInternalApprovals,
    reportsInReview,
    workflowFailures,
    openIncidents,
  ] = await Promise.all([
    count(
      db
        .select({ n })
        .from(clients)
        .where(and(clientScope(actor), eq(clients.status, 'active'))),
    ),
    count(
      db
        .select({ n })
        .from(projects)
        .where(
          and(
            projectScope(actor),
            eq(projects.status, 'active'),
            f.clientId ? eq(projects.clientId, f.clientId) : undefined,
          ),
        ),
    ),
    count(
      db
        .select({ n })
        .from(tasks)
        .where(
          and(
            taskScope(actor),
            eq(tasks.status, 'done'),
            sql`${tasks.completedAt} >= ${cur.a} and ${tasks.completedAt} < ${cur.b}`,
            teamTasks,
          ),
        ),
    ),
    count(
      db
        .select({ n })
        .from(tasks)
        .where(
          and(
            taskScope(actor),
            inArray(tasks.status, ['todo', 'in_progress', 'blocked', 'in_review']),
            lt(tasks.dueAt, new Date()),
            teamTasks,
          ),
        ),
    ),
    count(
      db
        .select({ n })
        .from(approvals)
        .innerJoin(deliverables, eq(deliverables.id, approvals.deliverableId))
        .where(
          and(deliverableScope(actor), eq(approvals.decision, 'pending'), eq(approvals.stage, 'client')),
        ),
    ),
    count(
      db
        .select({ n })
        .from(approvals)
        .innerJoin(deliverables, eq(deliverables.id, approvals.deliverableId))
        .where(
          and(deliverableScope(actor), eq(approvals.decision, 'pending'), eq(approvals.stage, 'internal')),
        ),
    ),
    count(
      db
        .select({ n })
        .from(reports)
        .where(and(reportScope(actor), inArray(reports.status, ['draft', 'in_review']))),
    ),
    count(
      db
        .select({ n })
        .from(automationExecutions)
        .where(
          and(
            eq(automationExecutions.orgId, actor.orgId),
            eq(automationExecutions.status, 'dead'),
            sql`${automationExecutions.finishedAt} > now() - interval '7 days'`,
          ),
        ),
    ),
    count(
      db
        .select({ n })
        .from(incidents)
        .where(and(eq(incidents.orgId, actor.orgId), inArray(incidents.status, ['open', 'acknowledged']))),
    ),
  ]);
  const counts = {
    activeClients,
    activeProjects,
    tasksDone,
    tasksOverdue,
    pendingClientApprovals,
    pendingInternalApprovals,
    reportsInReview,
    workflowFailures,
    openIncidents,
  };

  // Daily series for trend charts.
  const leadSeries = await db
    .select({
      d: sql<string>`(${leads.createdAt} at time zone ${tz})::date::text`,
      n: sql<number>`count(*)::int`,
      q: sql<number>`count(*) filter (where ${leads.qualificationStatus} = 'qualified')::int`,
    })
    .from(leads)
    .where(
      and(
        leadScope(actor),
        eq(leads.isTest, false),
        sql`${leads.createdAt} >= ${cur.a} and ${leads.createdAt} < ${cur.b}`,
        clientFilter(leads.clientId),
        teamOwner(leads.ownerId, f.teamId),
      ),
    )
    .groupBy(sql`1`);
  const spendSeries = campIds.length
    ? await db
        .select({
          d: sql<string>`${campaignMetrics.date}::text`,
          spend: sql<number>`sum(${campaignMetrics.spendMinor})::bigint`,
        })
        .from(campaignMetrics)
        .where(
          and(
            inArray(campaignMetrics.campaignId, campIds),
            gte(campaignMetrics.date, f.from),
            sql`${campaignMetrics.date} <= ${f.to}`,
          ),
        )
        .groupBy(campaignMetrics.date)
    : [];
  const series: Array<{ date: string; leads: number; qualified: number; spend: number | null }> = [];
  const lm = new Map(leadSeries.map((r) => [r.d, r]));
  const sm = new Map(spendSeries.map((r) => [r.d, Number(r.spend)]));
  for (let i = 0; i < days; i++) {
    const d = format(subDays(parseISO(f.to), days - 1 - i), 'yyyy-MM-dd');
    series.push({
      date: d,
      leads: lm.get(d)?.n ?? 0,
      qualified: lm.get(d)?.q ?? 0,
      spend: sm.has(d) ? sm.get(d)! : null,
    });
  }

  // Target vs actual: client KPIs with targets for this period (monthly lead targets).
  const targets = await db
    .select({
      id: schema.kpis.id,
      name: schema.kpis.name,
      key: schema.kpis.key,
      target: schema.kpis.target,
      clientId: schema.kpis.clientId,
      clientName: clients.name,
      unit: schema.kpis.unit,
    })
    .from(schema.kpis)
    .leftJoin(clients, eq(clients.id, schema.kpis.clientId))
    .where(
      and(
        eq(schema.kpis.orgId, actor.orgId),
        sql`${schema.kpis.target} is not null`,
        f.clientId ? eq(schema.kpis.clientId, f.clientId) : undefined,
      ),
    );
  const targetRows = [];
  for (const t of targets) {
    let actual: number | null = null;
    if (t.key === 'leads' || t.key === 'qualified_leads') {
      const [r] = await db
        .select({
          n:
            t.key === 'leads'
              ? sql<number>`count(*)::int`
              : sql<number>`count(*) filter (where ${leads.qualificationStatus} = 'qualified')::int`,
        })
        .from(leads)
        .where(
          and(
            eq(leads.orgId, actor.orgId),
            eq(leads.isTest, false),
            isNull(leads.deletedAt),
            t.clientId ? eq(leads.clientId, t.clientId) : isNull(leads.clientId),
            sql`${leads.createdAt} >= ${cur.a} and ${leads.createdAt} < ${cur.b}`,
          ),
        );
      actual = r.n;
    } else if (t.key === 'admissions' || t.key === 'applications') {
      const [r] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(conversionEvents)
        .where(
          and(
            eq(conversionEvents.orgId, actor.orgId),
            eq(conversionEvents.verified, true),
            eq(conversionEvents.type, t.key === 'admissions' ? 'admission' : 'application'),
            t.clientId ? eq(conversionEvents.clientId, t.clientId) : undefined,
            sql`${conversionEvents.occurredAt} >= ${cur.a} and ${conversionEvents.occurredAt} < ${cur.b}`,
          ),
        );
      actual = r.n;
    }
    targetRows.push({ ...t, target: Number(t.target), actual });
  }

  return {
    period: { from: f.from, to: f.to, prevFrom, prevTo, days },
    leads: { cur: leadsCur, prev: leadsPrev },
    pipeline: {
      open: pipeline.open,
      openValue: Number(pipeline.openValue),
      weighted: Number(pipeline.weighted),
      won: pipeline.won,
      wonValue: Number(pipeline.wonValue),
      wonValuePrev: Number(pipeline.wonValuePrev),
      proposalsSent: prop.n,
      proposalValue: Number(prop.value),
    },
    campaigns: { cur: campCur, prev: campPrev, count: campIds.length, demoCampaigns },
    conversions: {
      applications: conv.find((c) => c.type === 'application')?.n ?? null,
      admissions: conv.find((c) => c.type === 'admission')?.n ?? null,
    },
    counts,
    series,
    targets: targetRows,
    currency: org.currency,
    showFinance: can(actor, 'finance.read'),
  };
}

/** Prioritised action centre: what needs attention now, across modules the actor can see. */
export async function actionCentre(actor: Actor, limit = 6) {
  const org = await getOrg(db, actor.orgId);
  const sla = org.parsedSettings.leads.firstContactSlaHours;
  const mine = actor.kind === 'user' && !can(actor, 'dashboard.executive');
  const ownerFilter = (col: SQL | AnyColumn) =>
    mine && actor.kind === 'user' ? sql`${col} = ${actor.id}` : undefined;
  const [
    overdueTasks,
    uncontacted,
    staleDeals,
    pendingApprovals,
    openIncidents,
    failures,
    upcoming,
    handoverQueue,
  ] = await Promise.all([
    db
      .select({
        id: tasks.id,
        title: tasks.title,
        dueAt: tasks.dueAt,
        ownerName: users.name,
        priority: tasks.priority,
      })
      .from(tasks)
      .leftJoin(users, eq(users.id, tasks.ownerId))
      .where(
        and(
          taskScope(actor),
          inArray(tasks.status, ['todo', 'in_progress', 'blocked', 'in_review']),
          lt(tasks.dueAt, new Date()),
          ownerFilter(tasks.ownerId),
        ),
      )
      .orderBy(asc(tasks.dueAt))
      .limit(limit),
    db
      .select({
        id: leads.id,
        name: leads.name,
        ref: leads.ref,
        createdAt: leads.createdAt,
        ownerName: users.name,
      })
      .from(leads)
      .leftJoin(users, eq(users.id, leads.ownerId))
      .where(
        and(
          leadScope(actor),
          eq(leads.stage, 'new'),
          eq(leads.isTest, false),
          sql`${leads.createdAt} < now() - make_interval(hours => ${sla})`,
          ownerFilter(leads.ownerId),
        ),
      )
      .orderBy(asc(leads.createdAt))
      .limit(limit),
    db
      .select({
        id: deals.id,
        title: deals.title,
        lastInteractionAt: deals.lastInteractionAt,
        ownerName: users.name,
        valueMinor: deals.valueMinor,
      })
      .from(deals)
      .leftJoin(users, eq(users.id, deals.ownerId))
      .where(
        and(
          dealScope(actor),
          sql`${deals.stage} not in ('won','lost')`,
          sql`${deals.lastInteractionAt} < now() - make_interval(days => ${org.parsedSettings.sales.staleDealDays})`,
          ownerFilter(deals.ownerId),
        ),
      )
      .orderBy(asc(deals.lastInteractionAt))
      .limit(limit),
    db
      .select({
        id: approvals.id,
        deliverableId: deliverables.id,
        title: deliverables.title,
        stage: approvals.stage,
        submittedAt: approvals.submittedAt,
      })
      .from(approvals)
      .innerJoin(deliverables, eq(deliverables.id, approvals.deliverableId))
      .where(
        and(
          deliverableScope(actor),
          eq(approvals.decision, 'pending'),
          actor.clientId
            ? eq(approvals.stage, 'client')
            : can(actor, 'approvals.internal')
              ? undefined
              : sql`false`,
        ),
      )
      .orderBy(asc(approvals.submittedAt))
      .limit(limit),
    can(actor, 'monitoring.manage') || can(actor, 'dashboard.executive')
      ? db
          .select({
            id: incidents.id,
            title: incidents.title,
            openedAt: incidents.openedAt,
            status: incidents.status,
          })
          .from(incidents)
          .where(and(eq(incidents.orgId, actor.orgId), inArray(incidents.status, ['open', 'acknowledged'])))
          .orderBy(desc(incidents.openedAt))
          .limit(limit)
      : Promise.resolve([]),
    can(actor, 'automation.read')
      ? db
          .select({
            key: automations.key,
            name: automations.name,
            n: sql<number>`count(*)::int`,
            last: sql<Date>`max(${automationExecutions.finishedAt})`,
          })
          .from(automationExecutions)
          .innerJoin(automations, eq(automations.id, automationExecutions.automationId))
          .where(
            and(
              eq(automationExecutions.orgId, actor.orgId),
              eq(automationExecutions.status, 'dead'),
              sql`${automationExecutions.finishedAt} > now() - interval '7 days'`,
            ),
          )
          .groupBy(automations.key, automations.name)
          .limit(limit)
      : Promise.resolve([]),
    db
      .select({ id: tasks.id, title: tasks.title, dueAt: tasks.dueAt, ownerName: users.name })
      .from(tasks)
      .leftJoin(users, eq(users.id, tasks.ownerId))
      .where(
        and(
          taskScope(actor),
          inArray(tasks.status, ['todo', 'in_progress', 'blocked', 'in_review']),
          gte(tasks.dueAt, new Date()),
          lt(tasks.dueAt, sql`now() + interval '3 days'`),
          ownerFilter(tasks.ownerId),
        ),
      )
      .orderBy(asc(tasks.dueAt))
      .limit(limit),
    can(actor, 'deals.approve_commercials')
      ? db
          .select({
            dealId: handovers.dealId,
            projectName: handovers.projectName,
            submittedAt: handovers.submittedAt,
          })
          .from(handovers)
          .where(and(eq(handovers.orgId, actor.orgId), eq(handovers.status, 'submitted')))
      : Promise.resolve([]),
  ]);
  return {
    overdueTasks,
    uncontacted,
    staleDeals,
    pendingApprovals,
    openIncidents,
    failures,
    upcoming,
    handoverQueue,
    slaHours: sla,
  };
}

/** "My work" summary for non-executive users. */
export async function myWork(actor: Actor) {
  if (actor.kind !== 'user') return null;
  const [t] = await db
    .select({
      open: sql<number>`count(*) filter (where ${tasks.status} in ('todo','in_progress','blocked','in_review'))::int`,
      overdue: sql<number>`count(*) filter (where ${tasks.status} in ('todo','in_progress','blocked','in_review') and ${tasks.dueAt} < now())::int`,
      dueToday: sql<number>`count(*) filter (where ${tasks.status} in ('todo','in_progress','blocked','in_review') and ${tasks.dueAt} >= now() and ${tasks.dueAt} < now() + interval '1 day')::int`,
      blocked: sql<number>`count(*) filter (where ${tasks.status} = 'blocked')::int`,
      doneWeek: sql<number>`count(*) filter (where ${tasks.status} = 'done' and ${tasks.completedAt} > now() - interval '7 days')::int`,
    })
    .from(tasks)
    .where(and(eq(tasks.ownerId, actor.id), isNull(tasks.deletedAt)));
  const [l] =
    can(actor, 'leads.read.own') || can(actor, 'leads.read.all')
      ? await db
          .select({
            followUps: sql<number>`count(*) filter (where ${leads.nextActionAt} < now() and ${leads.stage} not in ('converted','lost','unqualified'))::int`,
            newLeads: sql<number>`count(*) filter (where ${leads.stage} = 'new')::int`,
          })
          .from(leads)
          .where(and(eq(leads.ownerId, actor.id), isNull(leads.deletedAt), eq(leads.isTest, false)))
      : [{ followUps: 0, newLeads: 0 }];
  return { tasks: t, leads: l };
}

export async function monitorSummary(actor: Actor) {
  return db
    .select({
      up: sql<number>`count(*) filter (where ${monitoredPages.lastStatus} = 'up')::int`,
      down: sql<number>`count(*) filter (where ${monitoredPages.lastStatus} = 'down')::int`,
      total: sql<number>`count(*)::int`,
    })
    .from(monitoredPages)
    .where(and(eq(monitoredPages.orgId, actor.orgId), eq(monitoredPages.isActive, true)));
}

/**
 * The personal "Home" page: what this person should do today. Only their own work — tasks they
 * own that are overdue or due today, their leads waiting for a follow-up, and today's meetings.
 * Day boundaries are in the organisation's timezone.
 */
export async function homeToday(actor: Actor) {
  if (actor.kind !== 'user') return null;
  const org = await getOrg(db, actor.orgId);
  const { fromDateTimeLocal, todayIn } = await import('@/lib/format');
  const today = todayIn(org.timezone);
  const startOfDay = fromDateTimeLocal(`${today}T00:00`, org.timezone);
  const endOfDay = fromDateTimeLocal(`${today}T23:59:59`, org.timezone);
  const open = ['todo', 'in_progress', 'blocked', 'in_review'] as const;
  const canLeads = can(actor, 'leads.read.own') || can(actor, 'leads.read.all');
  const [taskRows, [taskCounts], leadRows, meetingRows] = await Promise.all([
    db
      .select({
        id: tasks.id,
        ref: tasks.ref,
        title: tasks.title,
        dueAt: tasks.dueAt,
        status: tasks.status,
        priority: tasks.priority,
        projectName: projects.name,
      })
      .from(tasks)
      .leftJoin(projects, eq(projects.id, tasks.projectId))
      .where(
        and(
          eq(tasks.ownerId, actor.id),
          isNull(tasks.deletedAt),
          inArray(tasks.status, [...open]),
          lt(tasks.dueAt, endOfDay),
          // Meetings have their own section on Home; don't list them twice.
          sql`coalesce(${tasks.sourceKey}, '') not like 'meeting:%'`,
        ),
      )
      .orderBy(asc(tasks.dueAt))
      .limit(10),
    db
      .select({
        dueToday: sql<number>`count(*) filter (where ${tasks.dueAt} >= ${startOfDay} and ${tasks.dueAt} <= ${endOfDay})::int`,
        overdue: sql<number>`count(*) filter (where ${tasks.dueAt} < now())::int`,
        later: sql<number>`count(*) filter (where ${tasks.dueAt} > ${endOfDay} or ${tasks.dueAt} is null)::int`,
      })
      .from(tasks)
      .where(and(eq(tasks.ownerId, actor.id), isNull(tasks.deletedAt), inArray(tasks.status, [...open]))),
    canLeads
      ? db
          .select({
            id: leads.id,
            ref: leads.ref,
            name: leads.name,
            stage: leads.stage,
            nextAction: leads.nextAction,
            nextActionAt: leads.nextActionAt,
            organisationName: leads.organisationName,
          })
          .from(leads)
          .where(
            and(
              eq(leads.ownerId, actor.id),
              isNull(leads.deletedAt),
              eq(leads.isTest, false),
              inArray(leads.stage, ['new', 'contacted', 'qualified']),
              sql`(${leads.stage} = 'new' or ${leads.nextActionAt} <= ${endOfDay})`,
            ),
          )
          .orderBy(sql`${leads.nextActionAt} asc nulls first`)
          .limit(8)
      : Promise.resolve([]),
    db
      .select({
        id: schema.meetings.id,
        title: schema.meetings.title,
        startAt: schema.meetings.startAt,
        location: schema.meetings.location,
        dealId: schema.meetings.dealId,
        leadId: schema.meetings.leadId,
      })
      .from(schema.meetings)
      .where(
        and(
          eq(schema.meetings.organizerId, actor.id),
          eq(schema.meetings.status, 'scheduled'),
          gte(schema.meetings.startAt, startOfDay),
          lt(schema.meetings.startAt, endOfDay),
        ),
      )
      .orderBy(asc(schema.meetings.startAt)),
  ]);
  return { today, tasks: taskRows, taskCounts, leads: leadRows, meetings: meetingRows };
}
