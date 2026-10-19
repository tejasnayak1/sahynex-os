import { Badge, Notice, PageHeader, Panel, StatusBadge, cn } from '@/components/ui';
import { formatDate, formatDateTime, formatPercent } from '@/lib/format';
import { pctChange } from '@/lib/metrics';
import { can } from '@/server/actor';
import { requirePagePermission } from '@/server/auth/current';
import { getReport, REPORT_LABEL } from '@/server/services/reports';
import { Commentary, ReviewButtons } from '../forms';

export const metadata = { title: 'Report' };

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePagePermission('reports.read');
  const { id } = await params;
  const r = await getReport(actor, id);
  const editable =
    can(actor, 'reports.generate') && (r.status === 'draft' || r.status === 'in_review') && !actor.clientId;
  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Reports & analytics', href: '/reports' }, { label: REPORT_LABEL[r.type] }]}
        title={r.title}
        meta={
          <>
            <StatusBadge
              status={r.status === 'in_review' ? 'in_review_report' : r.status}
              label={r.status.replace('_', ' ').replace(/^./, (c) => c.toUpperCase())}
            />
            <span>
              Reporting period {formatDate(r.periodStart)} – {formatDate(r.periodEnd)}
            </span>
            <span>Generated {formatDateTime(r.generatedAt)}</span>
            {r.content.demoDataIncluded ? <Badge tone="demo">Contains demo data</Badge> : null}
          </>
        }
        actions={
          !actor.clientId ? (
            <ReviewButtons
              id={r.id}
              status={r.status}
              canApprove={can(actor, 'reports.approve')}
              canSubmit={can(actor, 'reports.generate')}
              demo={r.content.demoDataIncluded}
              isClient={!!r.clientId}
            />
          ) : (
            <ReviewButtons
              id={r.id}
              status="delivered"
              canApprove={false}
              canSubmit={false}
              demo={false}
              isClient
            />
          )
        }
      />
      {r.content.demoDataIncluded && r.clientId ? (
        <div className="mb-4">
          <Notice tone="demo" title="This report contains demo data">
            It can’t be approved for a client. Connect real data sources and regenerate.
          </Notice>
        </div>
      ) : null}
      {r.deliveryError ? (
        <div className="mb-4">
          <Notice tone="warn" title="Delivery note">
            {r.deliveryError}
          </Notice>
        </div>
      ) : null}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          {r.content.exceptions.length ? (
            <Panel title="Exceptions">
              <ul className="list-disc space-y-1 pl-5 text-ink-2">
                {r.content.exceptions.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </Panel>
          ) : null}
          {r.content.sections.map((s) => (
            <Panel key={s.title} title={s.title} bodyClassName="p-0">
              {s.notes?.length ? (
                <div className="border-b border-line px-4 py-2 text-[13px] text-muted">
                  {s.notes.join(' ')}
                </div>
              ) : null}
              {s.metrics.length ? (
                <table className="w-full text-[13.5px]">
                  <tbody>
                    {s.metrics.map((m) => {
                      const change = m.previous !== undefined ? pctChange(m.value, m.previous ?? null) : null;
                      return (
                        <tr key={m.key} className="border-b border-line last:border-0">
                          <th
                            scope="row"
                            className="w-[38%] px-4 py-2.5 text-left align-top font-medium text-ink"
                          >
                            {m.label}
                            <div className="mt-0.5 text-[12px] font-normal text-muted">{m.definition}</div>
                          </th>
                          <td
                            className={cn('px-4 py-2.5 align-top tabular', m.value == null && 'text-muted')}
                          >
                            {m.display}
                            {change != null ? (
                              <span className="ml-2 text-[12.5px] text-muted">
                                ({change > 0 ? '+' : ''}
                                {formatPercent(change, 0)} vs prior period)
                              </span>
                            ) : null}
                          </td>
                          <td className="hidden px-4 py-2.5 text-right align-top text-[12px] text-muted md:table-cell">
                            {m.source}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <p className="p-4 text-muted">No data.</p>
              )}
            </Panel>
          ))}
          <Panel
            title="Commentary"
            actions={
              <span className="text-[12.5px] text-muted">
                Interpretation — separate from measured figures
              </span>
            }
          >
            <Commentary id={r.id} value={r.commentary ?? ''} editable={editable} />
          </Panel>
        </div>
        <div className="space-y-5">
          <Panel title="Data freshness" bodyClassName="p-0">
            <ul className="divide-y divide-line">
              {r.content.freshness.map((f, i) => (
                <li key={i} className="flex items-start justify-between gap-2 px-4 py-2 text-[13px]">
                  <span className="min-w-0">
                    {f.source}
                    <div className="text-[12px] text-muted">
                      {f.lastSuccessAt
                        ? `Last successful refresh ${formatDateTime(f.lastSuccessAt)}`
                        : 'Never refreshed'}
                    </div>
                  </span>
                  {f.stale ? <Badge tone="warn">Stale</Badge> : <Badge tone="ok">Fresh</Badge>}
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="About this report">
            <p className="text-[13px] text-muted">
              Figures are computed from stored records when the report is generated. “Unavailable” means data
              was missing — it is never shown as zero. Approved reports are frozen; regenerating does not
              change what was delivered.
            </p>
          </Panel>
        </div>
      </div>
    </>
  );
}
