import Link from 'next/link';
import { SpendLeadsChart } from '@/components/client/charts';
import {
  Badge,
  DescList,
  Notice,
  PageHeader,
  Panel,
  Select,
  Stat,
  StatusBadge,
  Table,
  Td,
  Th,
  buttonClass,
} from '@/components/ui';
import { db } from '@/db';
import { formatDateTime, formatMoney, formatNumber, formatPercent, humanize } from '@/lib/format';
import { METRIC_DEFINITIONS } from '@/lib/metrics';
import { dateRange, readParams } from '@/lib/params';
import { can } from '@/server/actor';
import { requirePagePermission } from '@/server/auth/current';
import { teamOptions } from '@/server/services/admin';
import { getCampaign } from '@/server/services/campaigns';
import { getOrg } from '@/server/services/org';
import { EditCampaign, ImportMetrics } from '../forms';
import { FilterForm } from '@/components/client/filter-form';

export const metadata = { title: 'Campaign' };

export default async function CampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePagePermission('campaigns.read');
  const { id } = await params;
  const sp = await readParams(searchParams);
  const org = await getOrg(db, actor.orgId);
  const range = dateRange(sp, org.timezone);
  const d = await getCampaign(actor, id, range.from, range.to);
  const c = d.campaign;
  const m = d.metrics;
  const cur = org.currency;
  const team = await teamOptions(actor.orgId);
  const demo = c.isDemo || d.dataSources.includes('demo');
  const chart = d.reconciliation.map((r, i) => ({
    date: r.date,
    spend: d.daily[i].spendMinor,
    crmLeads: r.crmLeads,
    platformLeads: r.platformLeads,
  }));
  const gapDays = d.reconciliation.filter(
    (r) => r.gap != null && r.gap > Math.max(2, (r.platformLeads ?? 0) * 0.25),
  );
  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Campaigns', href: '/campaigns' }, { label: c.name }]}
        title={c.name}
        meta={
          <>
            <Link className="hover:underline" href={`/clients/${c.clientId}`}>
              {d.clientName}
            </Link>
            <span>{humanize(c.platform)}</span>
            <StatusBadge status={c.status} />
            <StatusBadge status={d.freshness.state} label={d.freshness.label} />
            {demo ? <Badge tone="demo">Demo data</Badge> : null}
          </>
        }
        actions={
          <>
            <FilterForm action={`/campaigns/${id}`} className="flex gap-2">
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
              <button className={buttonClass('secondary')}>Apply</button>
            </FilterForm>
            {can(actor, 'campaigns.write') ? (
              <>
                <ImportMetrics id={c.id} />
                <EditCampaign c={c} team={team} thresholds={can(actor, 'campaigns.thresholds')} />
              </>
            ) : null}
          </>
        }
      />
      {c.lastSyncError ? (
        <div className="mb-4">
          <Notice tone="bad" title="Last sync failed">
            {c.lastSyncError}
          </Notice>
        </div>
      ) : null}
      {!c.externalId ? (
        <div className="mb-4">
          <Notice tone="warn" title="Not mapped to a platform campaign">
            Add the platform campaign ID so metrics can sync, or import a CSV export.
          </Notice>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Stat
          label="Spend"
          value={formatMoney(m.spendMinor, cur)}
          demo={demo}
          sub={
            c.budgetMinor && m.spendMinor != null
              ? `${formatPercent(m.spendMinor / c.budgetMinor, 0)} of budget`
              : undefined
          }
        />
        <Stat label="Impressions" value={formatNumber(m.impressions)} />
        <Stat label="Clicks" value={formatNumber(m.clicks)} sub={`CTR ${formatPercent(m.ctr, 2)}`} />
        <Stat label="CPC" value={formatMoney(m.cpcMinor, cur)} />
        <Stat
          label="Platform leads"
          value={formatNumber(m.platformLeads)}
          sub={`CPL ${formatMoney(m.platformCplMinor, cur)}`}
        />
        <Stat
          label="CRM leads"
          value={formatNumber(m.crmLeads)}
          sub={`CPL ${formatMoney(m.cplMinor, cur)}`}
        />
        <Stat
          label="Qualified"
          value={formatNumber(m.qualifiedLeads)}
          sub={`${formatMoney(m.cpqlMinor, cur)} each`}
        />
        <Stat label="LP conversion" value={formatPercent(m.lpConversion)} />
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <Panel title="Daily spend and leads">
            {chart.length ? (
              <SpendLeadsChart data={chart} currency={cur} />
            ) : (
              <p className="text-muted">No metrics in this period.</p>
            )}
          </Panel>
          <Panel
            title="Platform vs CRM reconciliation"
            bodyClassName="p-0"
            actions={
              gapDays.length ? (
                <Badge tone="warn">{gapDays.length} day(s) with gaps</Badge>
              ) : (
                <Badge tone="ok">Reconciled</Badge>
              )
            }
          >
            <p className="border-b border-line px-4 py-2.5 text-[13px] text-muted">
              Large gaps usually mean a broken form → CRM connection, or platform-counted leads that never
              submitted contact details.
            </p>
            <div className="max-h-80 overflow-y-auto">
              <Table className="rounded-none border-0">
                <thead>
                  <tr>
                    <Th>Date</Th>
                    <Th align="right">Spend</Th>
                    <Th align="right">Platform leads</Th>
                    <Th align="right">CRM leads</Th>
                    <Th align="right">Gap</Th>
                    <Th>Source</Th>
                  </tr>
                </thead>
                <tbody>
                  {[...d.reconciliation].reverse().map((r) => {
                    const day = d.daily.find((x) => x.date === r.date)!;
                    return (
                      <tr key={r.date}>
                        <Td>{r.date}</Td>
                        <Td align="right" className="tabular">
                          {formatMoney(day.spendMinor, cur)}
                        </Td>
                        <Td align="right" className="tabular">
                          {formatNumber(r.platformLeads)}
                        </Td>
                        <Td align="right" className="tabular">
                          {r.crmLeads}
                        </Td>
                        <Td
                          align="right"
                          className={r.gap != null && r.gap > 2 ? 'tabular font-medium text-warn' : 'tabular'}
                        >
                          {r.gap == null ? '—' : r.gap}
                        </Td>
                        <Td>
                          {day.source === 'demo' ? <Badge tone="demo">Demo</Badge> : humanize(day.source)}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </div>
          </Panel>
        </div>
        <div className="space-y-5">
          <Panel title="Setup">
            <DescList
              cols={1}
              items={[
                ['Platform ID', c.externalId ?? '—'],
                ['Objective', c.objective ?? '—'],
                ['Owner', d.ownerName ?? '—'],
                ['Media budget', formatMoney(c.budgetMinor, cur)],
                [
                  'CPL alert',
                  c.cplThresholdMinor
                    ? `${formatMoney(c.cplThresholdMinor, cur)} after ${c.minLeadsForAlert} leads`
                    : 'Not set',
                ],
                ['Daily spend alert', formatMoney(c.dailySpendThresholdMinor, cur)],
                ['Attribution window', c.attributionWindow ?? 'Platform default'],
                ['Last synced', c.lastSyncedAt ? formatDateTime(c.lastSyncedAt) : 'Never'],
              ]}
            />
          </Panel>
          <Panel title="Verified outcomes">
            {d.conversions.length ? (
              <ul className="space-y-1">
                {d.conversions.map((x) => (
                  <li key={x.type} className="flex justify-between">
                    <span>{humanize(x.type)}</span>
                    <span className="tabular">
                      {x.verified} verified
                      {x.unverified ? <span className="text-muted"> · {x.unverified} unverified</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted">No applications or admissions recorded for this campaign.</p>
            )}
            <Link
              href="/campaigns/conversions"
              className="mt-2 inline-block text-[13px] text-accent hover:underline"
            >
              Manage outcomes
            </Link>
          </Panel>
          <Panel title="Definitions">
            <dl className="space-y-2 text-[12.5px]">
              {['ctr', 'cpl', 'platformCpl', 'cpql', 'lpConversion'].map((k) => (
                <div key={k}>
                  <dt className="font-medium text-ink-2">{METRIC_DEFINITIONS[k].label}</dt>
                  <dd className="text-muted">{METRIC_DEFINITIONS[k].definition}</dd>
                </div>
              ))}
            </dl>
          </Panel>
        </div>
      </div>
    </>
  );
}
