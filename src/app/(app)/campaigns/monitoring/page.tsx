import Link from 'next/link';
import { ActionButton } from '@/components/client/auto-submit';
import { EmptyState, PageHeader, Panel, StatusBadge, Table, Td, Th, cn } from '@/components/ui';
import { formatDateTime, relativeTime } from '@/lib/format';
import { readParams } from '@/lib/params';
import { can } from '@/server/actor';
import { requirePagePermission } from '@/server/auth/current';
import { teamOptions } from '@/server/services/admin';
import { campaignOptions } from '@/server/services/campaigns';
import { clientOptions } from '@/server/services/clients';
import { listIncidents, listMonitors, recentChecks } from '@/server/services/monitoring';
import { toggleMonitorAction } from '../actions';
import { IncidentActions, NewMonitor } from '../forms';

export const metadata = { title: 'Landing-page monitoring' };

export default async function MonitoringPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePagePermission('campaigns.read', 'monitoring.manage');
  const sp = await readParams(searchParams);
  const [monitors, incidents, clients, campaigns, team] = await Promise.all([
    listMonitors(actor),
    listIncidents(actor, sp.all !== '1'),
    clientOptions(actor),
    campaignOptions(actor),
    teamOptions(actor.orgId),
  ]);
  const checks = await Promise.all(monitors.map((m) => recentChecks(m.p.id, 12)));
  const canManage = can(actor, 'monitoring.manage');
  return (
    <>
      <PageHeader
        title="Campaigns & performance"
        description="Availability and conversion monitoring for landing pages. Failures open incidents for the responsible owner; fixes are verified by the next check."
        actions={canManage ? <NewMonitor clients={clients} campaigns={campaigns} team={team} /> : null}
      />
      <nav className="mb-3 flex gap-1 border-b border-line" aria-label="Sections">
        {[
          ['/campaigns', 'Campaigns'],
          ['/campaigns/conversions', 'Outcomes'],
          ['/campaigns/monitoring', 'Landing-page monitoring'],
        ].map(([h, l]) => (
          <Link
            key={h}
            href={h}
            aria-current={h === '/campaigns/monitoring' ? 'page' : undefined}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-[13.5px] font-medium',
              h === '/campaigns/monitoring'
                ? 'border-accent text-ink'
                : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {l}
          </Link>
        ))}
      </nav>
      <Panel
        title="Incidents"
        className="mb-5"
        bodyClassName="p-0"
        actions={
          <Link
            href={sp.all === '1' ? '/campaigns/monitoring' : '/campaigns/monitoring?all=1'}
            className="text-[13px] text-accent hover:underline"
          >
            {sp.all === '1' ? 'Show open only' : 'Show closed too'}
          </Link>
        }
      >
        {incidents.length ? (
          <Table className="rounded-none border-0">
            <thead>
              <tr>
                <Th>Incident</Th>
                <Th>Status</Th>
                <Th>Owner</Th>
                <Th>Opened</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {incidents.map(({ i, ownerName }) => (
                <tr key={i.id} id={`incident-${i.id}`} className={sp.incident === i.id ? 'bg-warn-soft' : ''}>
                  <Td>
                    <span className="font-medium text-ink">{i.title}</span>
                    {i.notes ? (
                      <div className="whitespace-pre-line text-[12.5px] text-muted">{i.notes}</div>
                    ) : null}
                  </Td>
                  <Td>
                    <StatusBadge status={i.status} />
                  </Td>
                  <Td>{ownerName ?? '—'}</Td>
                  <Td title={formatDateTime(i.openedAt)}>{relativeTime(i.openedAt)}</Td>
                  <Td>{canManage ? <IncidentActions id={i.id} status={i.status} /> : null}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <p className="p-4 text-muted">No open incidents.</p>
        )}
      </Panel>
      {monitors.length ? (
        <Table>
          <thead>
            <tr>
              <Th>Page</Th>
              <Th>Status</Th>
              <Th>Recent checks</Th>
              <Th>Last checked</Th>
              <Th>Owner</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {monitors.map(({ p, clientName, ownerName }, i) => (
              <tr key={p.id}>
                <Td>
                  <span className="font-medium text-ink">{p.name}</span>
                  <div className="max-w-[340px] truncate text-[12.5px] text-muted">
                    {p.url}
                    {clientName ? ` · ${clientName}` : ''}
                  </div>
                </Td>
                <Td>
                  {p.isActive ? <StatusBadge status={p.lastStatus} /> : <StatusBadge status="paused" />}
                </Td>
                <Td>
                  <div
                    className="flex gap-0.5"
                    aria-label={`${checks[i].filter((c) => c.ok).length} of ${checks[i].length} recent checks passed`}
                  >
                    {[...checks[i]].reverse().map((c) => (
                      <span
                        key={c.id}
                        title={`${formatDateTime(c.checkedAt)} · ${c.ok ? `OK ${c.responseMs}ms` : c.error}`}
                        className={cn('h-4 w-1.5 rounded-sm', c.ok ? 'bg-ok' : 'bg-bad')}
                      />
                    ))}
                  </div>
                </Td>
                <Td>{p.lastCheckedAt ? relativeTime(p.lastCheckedAt) : 'Not yet'}</Td>
                <Td>{ownerName ?? '—'}</Td>
                <Td>
                  {canManage ? (
                    <ActionButton
                      action={toggleMonitorAction}
                      hidden={{ id: p.id, active: p.isActive ? 'false' : 'true' }}
                      variant="ghost"
                    >
                      {p.isActive ? 'Pause' : 'Resume'}
                    </ActionButton>
                  ) : null}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <EmptyState
          title="No pages monitored"
          body="Add your clients’ landing pages so broken pages and missing conversions are caught quickly."
        />
      )}
    </>
  );
}
