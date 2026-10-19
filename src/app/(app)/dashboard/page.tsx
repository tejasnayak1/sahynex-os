import Link from 'next/link';
import { redirect } from 'next/navigation';
import { and, asc, eq } from 'drizzle-orm';
import { TrendChart } from '@/components/client/charts';
import { DemoBadge, LinkButton, Notice, PageHeader, Panel, Select, Stat, buttonClass } from '@/components/ui';
import { db, schema } from '@/db';
import { formatMoney, formatNumber, formatPercent, todayIn } from '@/lib/format';
import { pctChange } from '@/lib/metrics';
import { dateRange, readParams } from '@/lib/params';
import { can } from '@/server/actor';
import { requireActor } from '@/server/auth/current';
import { clientOptions } from '@/server/services/clients';
import { actionCentre, executiveDashboard, myWork } from '@/server/services/dashboard';
import { getOrg } from '@/server/services/org';
import { ActionCentre } from './action-centre';
import { FilterForm } from '@/components/client/filter-form';

export const metadata = { title: 'Dashboard' };

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireActor();
  const sp = await readParams(searchParams);
  const org = await getOrg(db, actor.orgId);
  const ac = await actionCentre(actor);

  // Team members start from their personal Home page; only external reviewers use this view.
  if (!can(actor, 'dashboard.executive') && !actor.clientId) redirect('/home');
  if (!can(actor, 'dashboard.executive')) {
    const mw = await myWork(actor);
    const [submitted] = actor.clientId
      ? [null]
      : await db
          .select({ id: schema.dailyReports.id })
          .from(schema.dailyReports)
          .where(
            and(
              eq(schema.dailyReports.userId, actor.id),
              eq(schema.dailyReports.reportDate, todayIn(org.timezone)),
            ),
          );
    return (
      <>
        <PageHeader
          title={`Good to see you, ${actor.name.split(' ')[0]}`}
          description={
            actor.clientId
              ? 'Items shared with you for review.'
              : 'Your work, what is overdue, and what needs your attention.'
          }
        />
        {mw && !actor.clientId ? (
          <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label="Open tasks" value={mw.tasks.open} href="/tasks?view=mine" />
            <Stat label="Overdue" value={mw.tasks.overdue} href="/tasks?view=mine&overdue=1" />
            <Stat label="Due in 24h" value={mw.tasks.dueToday} href="/tasks?view=mine" />
            <Stat label="Blocked" value={mw.tasks.blocked} href="/tasks?view=mine&status=blocked" />
            <Stat label="Done in 7 days" value={mw.tasks.doneWeek} />
          </div>
        ) : null}
        {!actor.clientId && !submitted ? (
          <div className="mb-5">
            <Notice tone="info" title="Daily update not submitted yet">
              Share what you completed, what’s in progress and any blockers.{' '}
              <Link className="font-medium text-accent underline" href="/reports/daily">
                Submit today’s update
              </Link>
            </Notice>
          </div>
        ) : null}
        <Panel title="Needs your attention" bodyClassName="p-0">
          <ActionCentre data={ac} currency={org.currency} />
        </Panel>
      </>
    );
  }

  const range = dateRange(sp, org.timezone);
  const d = await executiveDashboard(actor, {
    from: range.from,
    to: range.to,
    clientId: sp.client || undefined,
    teamId: sp.team || undefined,
  });
  const [clients, teams] = await Promise.all([
    clientOptions(actor),
    db.select().from(schema.teams).where(eq(schema.teams.orgId, actor.orgId)).orderBy(asc(schema.teams.name)),
  ]);
  const cur = org.currency;
  const c = d.campaigns.cur;
  const p = d.campaigns.prev;
  const demo = d.campaigns.demoCampaigns > 0;
  return (
    <>
      <PageHeader
        title="Executive dashboard"
        description={`${d.period.from} to ${d.period.to} · compared with the previous ${d.period.days} days`}
        actions={
          <FilterForm
            action="/dashboard"
            className="flex flex-wrap items-center gap-2"
            label="Dashboard filters"
          >
            <Select
              name="range"
              ariaLabel="Date range"
              defaultValue={range.preset === 'custom' ? '30d' : range.preset}
              options={[
                { value: '7d', label: 'Last 7 days' },
                { value: '30d', label: 'Last 30 days' },
                { value: '90d', label: 'Last 90 days' },
                { value: 'mtd', label: 'Month to date' },
              ]}
              className="w-40"
            />
            <Select
              name="client"
              ariaLabel="Client"
              defaultValue={sp.client}
              placeholder="All clients"
              options={clients.map((x) => ({ value: x.id, label: x.name }))}
              className="w-48"
            />
            <Select
              name="team"
              ariaLabel="Team"
              defaultValue={sp.team}
              placeholder="All teams"
              options={teams.map((t) => ({ value: t.id, label: t.name }))}
              className="w-36"
            />
            <button className={buttonClass('secondary')} type="submit">
              Apply
            </button>
          </FilterForm>
        }
      />
      {demo ? (
        <div className="mb-4">
          <Notice tone="demo" title="Campaign figures include demo data">
            Synthetic metrics from demo campaigns are shown with a “Demo data” label. Connect Meta Ads /
            Google Ads in Settings → Integrations for real figures.
          </Notice>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat
          label="Leads"
          value={formatNumber(d.leads.cur.total)}
          delta={pctChange(d.leads.cur.total, d.leads.prev.total)}
          href="/leads"
        />
        <Stat
          label="Qualified leads"
          value={formatNumber(d.leads.cur.qualified)}
          delta={pctChange(d.leads.cur.qualified, d.leads.prev.qualified)}
          href="/leads?qualification=qualified"
        />
        <Stat
          label="Campaign spend"
          value={formatMoney(c.spendMinor, cur, { compact: true })}
          delta={pctChange(c.spendMinor, p.spendMinor)}
          demo={demo}
          href="/campaigns"
        />
        <Stat
          label="Cost per lead"
          value={formatMoney(c.cplMinor, cur)}
          delta={pctChange(c.cplMinor, p.cplMinor)}
          invert
          demo={demo}
          sub={c.cplMinor == null ? 'No leads or spend' : undefined}
        />
        <Stat
          label="Cost per qualified lead"
          value={formatMoney(c.cpqlMinor, cur)}
          delta={pctChange(c.cpqlMinor, p.cpqlMinor)}
          invert
          demo={demo}
        />
        <Stat
          label="Admissions (verified)"
          value={d.conversions.admissions == null ? 'Unavailable' : formatNumber(d.conversions.admissions)}
          sub={
            d.conversions.applications != null
              ? `${d.conversions.applications} applications`
              : 'No verified records'
          }
        />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat
          label="Weighted pipeline"
          value={formatMoney(d.pipeline.weighted, cur, { compact: true })}
          sub={`${d.pipeline.open} open deals`}
          href="/pipeline"
        />
        <Stat
          label="Won revenue"
          value={formatMoney(d.pipeline.wonValue, cur, { compact: true })}
          delta={pctChange(d.pipeline.wonValue, d.pipeline.wonValuePrev)}
          sub={`${d.pipeline.won} deals`}
        />
        <Stat
          label="Proposals sent"
          value={d.pipeline.proposalsSent}
          sub={formatMoney(d.pipeline.proposalValue, cur, { compact: true })}
        />
        <Stat
          label="Active clients / projects"
          value={`${d.counts.activeClients} / ${d.counts.activeProjects}`}
          href="/projects?status=active"
        />
        <Stat
          label="Tasks done / overdue"
          value={`${d.counts.tasksDone} / ${d.counts.tasksOverdue}`}
          href="/tasks?overdue=1"
        />
        <Stat
          label="Pending client approvals"
          value={d.counts.pendingClientApprovals}
          sub={`${d.counts.pendingInternalApprovals} internal · ${d.counts.reportsInReview} reports to review`}
          href="/approvals"
        />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Panel title="Leads and spend" actions={<DemoBadge show={demo} />}>
            <TrendChart data={d.series} currency={cur} />
          </Panel>
          <Panel
            title="Targets vs actual"
            actions={<span className="text-[12.5px] text-muted">For the selected period</span>}
          >
            {d.targets.length ? (
              <ul className="space-y-3">
                {d.targets.map((t) => {
                  const pctv = t.actual == null || !t.target ? null : t.actual / t.target;
                  return (
                    <li key={t.id}>
                      <div className="flex items-baseline justify-between gap-3 text-[13.5px]">
                        <span className="truncate">{t.name}</span>
                        <span className="shrink-0 tabular text-muted">
                          <span className="font-medium text-ink">
                            {t.actual == null ? 'Unavailable' : formatNumber(t.actual)}
                          </span>{' '}
                          / {formatNumber(t.target)}
                        </span>
                      </div>
                      <div
                        className="mt-1 h-1.5 rounded-full bg-surface-2"
                        role="progressbar"
                        aria-valuenow={Math.round((pctv ?? 0) * 100)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={t.name}
                      >
                        <div
                          className={`h-1.5 rounded-full ${pctv != null && pctv >= 1 ? 'bg-ok' : 'bg-accent'}`}
                          style={{ width: `${Math.min(100, (pctv ?? 0) * 100)}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-muted">
                No targets set. Add KPI targets in Settings → KPIs to track progress here.
              </p>
            )}
          </Panel>
          <Panel
            title="Campaign efficiency"
            actions={
              <LinkButton size="sm" href="/campaigns">
                All campaigns
              </LinkButton>
            }
          >
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                ['CTR', formatPercent(c.ctr, 2)],
                ['CPC', formatMoney(c.cpcMinor, cur)],
                ['Platform CPL', formatMoney(c.platformCplMinor, cur)],
                ['Landing-page conversion', formatPercent(c.lpConversion)],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-[12.5px] text-muted">{k}</dt>
                  <dd className="text-[17px] font-semibold tabular">{v}</dd>
                </div>
              ))}
            </dl>
          </Panel>
        </div>
        <div className="space-y-5">
          <Panel
            title="Action centre"
            bodyClassName="p-0"
            actions={<span className="text-[12.5px] text-muted">Highest priority first</span>}
          >
            <ActionCentre data={ac} currency={cur} />
          </Panel>
          <Panel title="System health">
            <ul className="space-y-1.5 text-[13.5px]">
              <li className="flex justify-between">
                <span>Automation failures (7 days)</span>
                <Link
                  href="/automation"
                  className={d.counts.workflowFailures ? 'font-medium text-bad' : 'text-muted'}
                >
                  {d.counts.workflowFailures}
                </Link>
              </li>
              <li className="flex justify-between">
                <span>Open incidents</span>
                <Link
                  href="/campaigns/monitoring"
                  className={d.counts.openIncidents ? 'font-medium text-bad' : 'text-muted'}
                >
                  {d.counts.openIncidents}
                </Link>
              </li>
              {d.showFinance ? (
                <li className="flex justify-between">
                  <span>Profitability by project</span>
                  <Link href="/finance?tab=profitability" className="text-accent">
                    View
                  </Link>
                </li>
              ) : null}
            </ul>
          </Panel>
        </div>
      </div>
      <p className="mt-6 text-[12.5px] text-muted">
        Definitions: CPL = spend ÷ CRM leads attributed to campaigns; qualified = leads meeting the configured
        qualification score. Missing data is shown as “Unavailable”, never as zero.{' '}
        <Link href="/reports/definitions" className="underline">
          All metric definitions
        </Link>
      </p>
    </>
  );
}
