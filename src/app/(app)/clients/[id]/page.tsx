import Link from 'next/link';
import { ActionButton } from '@/components/client/auto-submit';
import { Badge, DescList, LinkButton, PageHeader, Panel, StatusBadge, Table, Td, Th } from '@/components/ui';
import { db } from '@/db';
import { formatDate, formatMoney, humanize } from '@/lib/format';
import { can } from '@/server/actor';
import { requirePagePermission } from '@/server/auth/current';
import { teamOptions } from '@/server/services/admin';
import { getClient } from '@/server/services/clients';
import { listReports } from '@/server/services/reports';
import { getOrg } from '@/server/services/org';
import { removeContactAction } from '../actions';
import { AddContact, EditClient } from '../client-form';

export const metadata = { title: 'Client' };

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePagePermission('clients.read.all', 'clients.read.assigned');
  const { id } = await params;
  const d = await getClient(actor, id);
  const org = await getOrg(db, actor.orgId);
  const [team, reports] = await Promise.all([
    teamOptions(actor.orgId),
    can(actor, 'reports.read') ? listReports(actor, undefined, id) : Promise.resolve([]),
  ]);
  const c = d.client;
  const canWrite = can(actor, 'clients.write');
  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Clients', href: '/clients' }, { label: c.name }]}
        title={c.name}
        meta={
          <>
            <StatusBadge status={c.status} />
            <span>{humanize(c.orgType)}</span>
            {c.city ? <span>{c.city}</span> : null}
            {c.isDemo ? <Badge tone="demo">Demo data</Badge> : null}
          </>
        }
        actions={
          <>
            {can(actor, 'projects.write') ? (
              <LinkButton size="sm" href={`/projects/new?clientId=${c.id}`}>
                New project
              </LinkButton>
            ) : null}
            {canWrite ? <EditClient c={c} team={team} /> : null}
          </>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <Panel title="Account">
            <DescList
              items={[
                ['Legal name', c.legalName ?? '—'],
                ['Account owner', d.ownerName ?? '—'],
                ['Services engaged', c.services.join(', ') || '—'],
                [
                  'Website',
                  c.website ? (
                    <a
                      href={c.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent hover:underline"
                    >
                      {c.website}
                    </a>
                  ) : (
                    '—'
                  ),
                ],
                [
                  'Contract',
                  c.contractStart ? `${formatDate(c.contractStart)} → ${formatDate(c.contractEnd)}` : '—',
                ],
                ['Renewal', formatDate(c.renewalDate)],
                ...(can(actor, 'projects.commercials')
                  ? ([['Commercial terms', c.commercialTerms ?? '—']] as Array<[string, string]>)
                  : []),
                ['Notes', c.notes ?? '—'],
              ]}
            />
          </Panel>
          <Panel title="Projects" bodyClassName="p-0">
            {d.projects.length ? (
              <Table className="rounded-none border-0">
                <thead>
                  <tr>
                    <Th>Project</Th>
                    <Th>Status</Th>
                    <Th>Owner</Th>
                    <Th>Dates</Th>
                  </tr>
                </thead>
                <tbody>
                  {d.projects.map((p) => (
                    <tr key={p.id}>
                      <Td>
                        <Link href={`/projects/${p.id}`} className="font-medium text-ink hover:underline">
                          {p.name}
                        </Link>
                        <div className="text-[12.5px] text-muted">{p.ref}</div>
                      </Td>
                      <Td>
                        <StatusBadge status={p.status} />
                      </Td>
                      <Td>{p.ownerName}</Td>
                      <Td>
                        {formatDate(p.startDate)} → {formatDate(p.endDate)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <p className="p-4 text-muted">No projects yet.</p>
            )}
          </Panel>
          {d.campaigns.length ? (
            <Panel title="Campaigns" bodyClassName="p-0">
              <ul className="divide-y divide-line">
                {d.campaigns.map((x) => (
                  <li key={x.id} className="flex items-center justify-between px-4 py-2.5">
                    <Link href={`/campaigns/${x.id}`} className="hover:underline">
                      {x.name}
                    </Link>
                    <span className="flex items-center gap-2 text-[12.5px] text-muted">
                      {humanize(x.platform)}
                      <StatusBadge status={x.status} />
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
          {d.contracts.length || d.deals.length ? (
            <Panel title="Commercial history" bodyClassName="p-0">
              <ul className="divide-y divide-line">
                {d.deals.map((x) => (
                  <li key={x.id} className="flex items-center justify-between px-4 py-2.5">
                    <Link href={`/deals/${x.id}`} className="hover:underline">
                      {x.title}
                    </Link>
                    <span className="flex items-center gap-2 text-[12.5px] text-muted tabular">
                      {formatMoney(x.valueMinor, org.currency)}
                      <StatusBadge status={x.stage} />
                    </span>
                  </li>
                ))}
                {d.contracts.map((x) => (
                  <li key={x.id} className="flex items-center justify-between px-4 py-2.5">
                    <span>{x.title}</span>
                    <span className="text-[12.5px] text-muted">
                      {formatDate(x.startDate)} → {formatDate(x.endDate)}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>
        <div className="space-y-5">
          <Panel
            title="Contacts & approvers"
            bodyClassName="p-0"
            actions={canWrite ? <AddContact clientId={c.id} /> : null}
          >
            {d.contacts.length ? (
              <ul className="divide-y divide-line">
                {d.contacts.map((ct) => (
                  <li key={ct.id} className="px-4 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{ct.name}</span>
                      <span className="flex gap-1">
                        {ct.isPrimary ? <Badge tone="accent">Primary</Badge> : null}
                        {ct.isApprover ? <Badge tone="ok">Approver</Badge> : null}
                        {ct.userId ? <Badge tone="info">Portal</Badge> : null}
                      </span>
                    </div>
                    <p className="text-[12.5px] text-muted">
                      {[ct.designation, ct.email, ct.phone].filter(Boolean).join(' · ')}
                    </p>
                    {canWrite ? (
                      <div className="mt-1">
                        <ActionButton
                          action={removeContactAction}
                          hidden={{ id: ct.id }}
                          variant="ghost"
                          confirm={`Remove ${ct.name}?`}
                        >
                          Remove
                        </ActionButton>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-4 text-muted">
                No contacts. Add the person who approves creative and receives reports.
              </p>
            )}
          </Panel>
          {reports.length ? (
            <Panel title="Reports" bodyClassName="p-0">
              <ul className="divide-y divide-line">
                {reports.slice(0, 8).map(({ r }) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                    <Link href={`/reports/${r.id}`} className="min-w-0 truncate hover:underline">
                      {r.title}
                    </Link>
                    <StatusBadge status={r.status} />
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>
      </div>
    </>
  );
}
