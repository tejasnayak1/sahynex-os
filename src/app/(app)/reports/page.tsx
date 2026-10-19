import Link from 'next/link';
import {
  Badge,
  EmptyState,
  PageHeader,
  Panel,
  Select,
  StatusBadge,
  Table,
  Td,
  Th,
  buttonClass,
  LinkButton,
} from '@/components/ui';
import { db } from '@/db';
import { formatDate, formatDateTime } from '@/lib/format';
import { readParams } from '@/lib/params';
import { can } from '@/server/actor';
import { requirePagePermission } from '@/server/auth/current';
import { clientOptions } from '@/server/services/clients';
import { getOrg } from '@/server/services/org';
import { listReports, REPORT_LABEL, reportPeriods } from '@/server/services/reports';
import { GenerateReport } from './forms';
import { FilterForm } from '@/components/client/filter-form';

export const metadata = { title: 'Reports & analytics' };

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePagePermission('reports.read');
  const sp = await readParams(searchParams);
  const org = await getOrg(db, actor.orgId);
  const rows = await listReports(actor, sp.type, sp.clientId);
  const clients = actor.clientId ? [] : await clientOptions(actor);
  const types = (Object.keys(REPORT_LABEL) as Array<keyof typeof REPORT_LABEL>).filter(
    (t) =>
      t === 'monthly_client' ||
      t === 'weekly_campaign' ||
      (t === 'executive' ? can(actor, 'finance.read') : can(actor, 'dashboard.executive')),
  );
  const lm = reportPeriods.lastMonth(org.timezone);
  return (
    <>
      <PageHeader
        title="Reports & analytics"
        description="Every report shows its period, sources, data freshness and metric definitions. Client reports are reviewed internally before anyone outside Sahynex sees them."
        actions={
          !actor.clientId ? (
            <>
              <LinkButton href="/reports/daily">Daily updates</LinkButton>
              <LinkButton href="/reports/definitions">Metric definitions</LinkButton>
            </>
          ) : null
        }
      />
      {can(actor, 'reports.generate') ? (
        <Panel title="Generate a report" className="mb-5">
          <GenerateReport
            types={types.map((t) => ({ value: t, label: REPORT_LABEL[t] }))}
            clients={clients}
            defaults={lm}
          />
        </Panel>
      ) : null}
      {!actor.clientId ? (
        <FilterForm action="/reports" className="mb-3 flex flex-wrap gap-2" label="Filter reports">
          <Select
            name="type"
            ariaLabel="Type"
            defaultValue={sp.type}
            placeholder="All report types"
            options={Object.entries(REPORT_LABEL).map(([value, label]) => ({ value, label }))}
            className="w-60"
          />
          <Select
            name="clientId"
            ariaLabel="Client"
            defaultValue={sp.clientId}
            placeholder="All clients"
            options={clients.map((c) => ({ value: c.id, label: c.name }))}
            className="w-52"
          />
          <button className={buttonClass('secondary')}>Apply</button>
        </FilterForm>
      ) : null}
      {rows.length ? (
        <Table>
          <thead>
            <tr>
              <Th>Report</Th>
              <Th>Period</Th>
              <Th>Status</Th>
              <Th>Generated</Th>
              <Th>Delivered</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ r }) => (
              <tr key={r.id} className="hover:bg-surface-2">
                <Td>
                  <Link href={`/reports/${r.id}`} className="font-medium text-ink hover:underline">
                    {r.title}
                  </Link>
                  <div className="text-[12.5px] text-muted">
                    {REPORT_LABEL[r.type]}{' '}
                    {r.content.demoDataIncluded ? <Badge tone="demo">Contains demo data</Badge> : null}
                  </div>
                </Td>
                <Td>
                  {formatDate(r.periodStart)} → {formatDate(r.periodEnd)}
                </Td>
                <Td>
                  <StatusBadge
                    status={r.status === 'in_review' ? 'in_review_report' : r.status}
                    label={r.status.replace('_', ' ').replace(/^./, (c) => c.toUpperCase())}
                  />
                </Td>
                <Td>{formatDateTime(r.generatedAt)}</Td>
                <Td>{r.deliveredAt ? formatDateTime(r.deliveredAt) : '—'}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <EmptyState
          title="No reports yet"
          body={
            actor.clientId
              ? 'Approved reports from Sahynex will appear here.'
              : 'Daily digests and client reports are drafted automatically on schedule; you can also generate one above.'
          }
        />
      )}
    </>
  );
}
