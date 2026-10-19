import Link from 'next/link';
import {
  Badge,
  EmptyState,
  FilterBar,
  LinkButton,
  Notice,
  PageHeader,
  Pagination,
  Select,
  StatusBadge,
  Table,
  Td,
  Th,
  cn,
} from '@/components/ui';
import { db } from '@/db';
import { formatMoney, formatNumber, formatPercent, humanize } from '@/lib/format';
import { dateRange, paging, readParams } from '@/lib/params';
import { can } from '@/server/actor';
import { requirePagePermission } from '@/server/auth/current';
import { listCampaigns } from '@/server/services/campaigns';
import { clientOptions } from '@/server/services/clients';
import { getOrg } from '@/server/services/org';

export const metadata = { title: 'Campaigns & performance' };

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePagePermission('campaigns.read');
  const sp = await readParams(searchParams);
  const org = await getOrg(db, actor.orgId);
  const range = dateRange(sp, org.timezone);
  const res = await listCampaigns(
    actor,
    { ...paging(sp, { pageSize: 50 }), clientId: sp.clientId, platform: sp.platform, status: sp.status },
    range.from,
    range.to,
  );
  const clients = await clientOptions(actor);
  const cur = org.currency;
  const anyDemo = res.rows.some((r) => r.isDemo);
  const stale = res.rows.filter((r) => r.freshness.state !== 'fresh' && r.status === 'active');
  const nav = (
    <nav className="mb-3 flex gap-1 border-b border-line" aria-label="Sections">
      {[
        ['/campaigns', 'Campaigns'],
        ['/campaigns/conversions', 'Outcomes'],
        ['/campaigns/monitoring', 'Landing-page monitoring'],
      ].map(([h, l]) => (
        <Link
          key={h}
          href={h}
          aria-current={h === '/campaigns' ? 'page' : undefined}
          className={cn(
            '-mb-px border-b-2 px-3 py-2 text-[13.5px] font-medium',
            h === '/campaigns' ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink',
          )}
        >
          {l}
        </Link>
      ))}
    </nav>
  );
  return (
    <>
      <PageHeader
        title="Campaigns & performance"
        description={`${range.from} to ${range.to}. Platform metrics use each platform’s own definitions and attribution; CPL uses leads that reached the CRM.`}
        actions={
          can(actor, 'campaigns.write') ? (
            <LinkButton href="/campaigns/new" variant="primary">
              New campaign
            </LinkButton>
          ) : null
        }
      />
      {nav}
      {anyDemo ? (
        <div className="mb-3">
          <Notice tone="demo" title="Demo data present">
            Campaigns labelled “Demo” use synthetic metrics. Connect Meta Ads / Google Ads in Settings →
            Integrations to sync real data.
          </Notice>
        </div>
      ) : null}
      {stale.length ? (
        <div className="mb-3">
          <Notice tone="warn" title={`${stale.length} active campaign(s) have stale or missing data`}>
            {stale.map((s) => s.name).join(', ')}. Alerts are paused for these until data refreshes.
          </Notice>
        </div>
      ) : null}
      <FilterBar action="/campaigns" q={sp.q} reset={Object.keys(sp).length > 0}>
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
          name="clientId"
          ariaLabel="Client"
          defaultValue={sp.clientId}
          placeholder="Any client"
          options={clients.map((c) => ({ value: c.id, label: c.name }))}
          className="w-48"
        />
        <Select
          name="platform"
          ariaLabel="Platform"
          defaultValue={sp.platform}
          placeholder="Any platform"
          options={[
            { value: 'meta', label: 'Meta' },
            { value: 'google_ads', label: 'Google Ads' },
            { value: 'other', label: 'Other' },
          ]}
          className="w-40"
        />
        <Select
          name="status"
          ariaLabel="Status"
          defaultValue={sp.status}
          placeholder="Any status"
          options={[
            { value: 'active', label: 'Active' },
            { value: 'paused', label: 'Paused' },
            { value: 'ended', label: 'Ended' },
          ]}
          className="w-36"
        />
      </FilterBar>
      {res.rows.length ? (
        <Table>
          <thead>
            <tr>
              <Th>Campaign</Th>
              <Th align="right">Spend</Th>
              <Th align="right">Budget used</Th>
              <Th align="right">CTR</Th>
              <Th align="right">CPC</Th>
              <Th align="right">Platform leads</Th>
              <Th align="right">CRM leads</Th>
              <Th align="right">CPL</Th>
              <Th align="right">Qualified</Th>
              <Th align="right">Cost / qualified</Th>
              <Th>Data</Th>
            </tr>
          </thead>
          <tbody>
            {res.rows.map((c) => {
              const m = c.metrics;
              const over =
                c.cplThresholdMinor &&
                m.cplMinor != null &&
                m.crmLeads >= c.minLeadsForAlert &&
                m.cplMinor > c.cplThresholdMinor;
              return (
                <tr key={c.id} className="hover:bg-surface-2">
                  <Td>
                    <Link
                      href={`/campaigns/${c.id}?range=${range.preset}`}
                      className="font-medium text-ink hover:underline"
                    >
                      {c.name}
                    </Link>
                    <div className="flex items-center gap-1.5 text-[12.5px] text-muted">
                      {c.clientName} · {humanize(c.platform)} <StatusBadge status={c.status} />
                      {c.isDemo ? <Badge tone="demo">Demo</Badge> : null}
                    </div>
                  </Td>
                  <Td align="right" className="tabular">
                    {formatMoney(m.spendMinor, cur)}
                  </Td>
                  <Td align="right" className="tabular text-muted">
                    {c.budgetMinor && m.spendMinor != null
                      ? formatPercent(m.spendMinor / c.budgetMinor, 0)
                      : '—'}
                  </Td>
                  <Td align="right" className="tabular">
                    {formatPercent(m.ctr, 2)}
                  </Td>
                  <Td align="right" className="tabular">
                    {formatMoney(m.cpcMinor, cur)}
                  </Td>
                  <Td align="right" className="tabular">
                    {formatNumber(m.platformLeads)}
                  </Td>
                  <Td align="right" className="tabular">
                    {formatNumber(m.crmLeads)}
                  </Td>
                  <Td
                    align="right"
                    className={cn('tabular', over && 'font-semibold text-bad')}
                    title={
                      c.cplThresholdMinor ? `Threshold ${formatMoney(c.cplThresholdMinor, cur)}` : undefined
                    }
                  >
                    {formatMoney(m.cplMinor, cur)}
                  </Td>
                  <Td align="right" className="tabular">
                    {formatNumber(m.qualifiedLeads)}
                  </Td>
                  <Td align="right" className="tabular">
                    {formatMoney(m.cpqlMinor, cur)}
                  </Td>
                  <Td>
                    <StatusBadge status={c.freshness.state} label={c.freshness.label} />
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      ) : (
        <EmptyState
          title="No campaigns"
          body="Add a campaign for a client and map it to its Meta or Google Ads campaign ID to sync metrics."
        />
      )}
      <Pagination total={res.total} page={res.page} pageSize={res.pageSize} base="/campaigns" params={sp} />
      <p className="mt-3 text-[12.5px] text-muted">
        “—” means unavailable (no data or zero denominator), never zero. Reach is platform-reported and is not
        deduplicated across days.
      </p>
    </>
  );
}
