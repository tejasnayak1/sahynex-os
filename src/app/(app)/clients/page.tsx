import Link from 'next/link';
import {
  EmptyState,
  FilterBar,
  LinkButton,
  PageHeader,
  Pagination,
  Select,
  SortTh,
  StatusBadge,
  Table,
  Td,
  Th,
  Badge,
} from '@/components/ui';
import { formatDate } from '@/lib/format';
import { paging, readParams } from '@/lib/params';
import { can } from '@/server/actor';
import { requirePagePermission } from '@/server/auth/current';
import { teamOptions } from '@/server/services/admin';
import { listClients } from '@/server/services/clients';

export const metadata = { title: 'Clients' };

/** Renewal within the next 60 days. */
function soon(d: string | null, now = new Date()) {
  if (!d) return false;
  const t = new Date(d).getTime() - now.getTime();
  return t > 0 && t < 60 * 86400000;
}

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePagePermission('clients.read.all', 'clients.read.assigned');
  const sp = await readParams(searchParams);
  const p = paging(sp, { sort: 'name', dir: 'asc' });
  const res = await listClients(actor, {
    ...p,
    status: sp.status,
    ownerId: sp.ownerId,
    renewalWithinDays: sp.renewal ? Number(sp.renewal) : undefined,
  });
  const team = await teamOptions(actor.orgId);
  return (
    <>
      <PageHeader
        title="Clients"
        description="Institutions and organisations Sahynex works with."
        actions={
          can(actor, 'clients.write') ? (
            <LinkButton href="/clients/new" variant="primary">
              New client
            </LinkButton>
          ) : null
        }
      />
      <FilterBar action="/clients" q={sp.q} placeholder="Name or city" reset={Object.keys(sp).length > 0}>
        <Select
          name="status"
          ariaLabel="Status"
          defaultValue={sp.status}
          placeholder="Any status"
          options={['onboarding', 'active', 'paused', 'churned'].map((s) => ({
            value: s,
            label: s[0].toUpperCase() + s.slice(1),
          }))}
          className="w-40"
        />
        <Select
          name="ownerId"
          ariaLabel="Account owner"
          defaultValue={sp.ownerId}
          placeholder="Any owner"
          options={team.map((t) => ({ value: t.id, label: t.name }))}
          className="w-48"
        />
        <Select
          name="renewal"
          ariaLabel="Renewal"
          defaultValue={sp.renewal}
          placeholder="Any renewal date"
          options={[
            { value: '30', label: 'Renewing in 30 days' },
            { value: '90', label: 'Renewing in 90 days' },
          ]}
          className="w-48"
        />
      </FilterBar>
      {res.rows.length ? (
        <Table>
          <thead>
            <tr>
              <SortTh label="Client" field="name" params={sp} base="/clients" />
              <Th>Status</Th>
              <Th>Services</Th>
              <Th>Account owner</Th>
              <Th align="right">Active projects</Th>
              <SortTh label="Renewal" field="renewal" params={sp} base="/clients" />
            </tr>
          </thead>
          <tbody>
            {res.rows.map((c) => (
              <tr key={c.id} className="hover:bg-surface-2">
                <Td>
                  <Link href={`/clients/${c.id}`} className="font-medium text-ink hover:underline">
                    {c.name}
                  </Link>
                  <div className="text-[12.5px] text-muted">
                    {c.city ?? ''} {c.isDemo ? <Badge tone="demo">Demo</Badge> : null}
                  </div>
                </Td>
                <Td>
                  <StatusBadge status={c.status} />
                </Td>
                <Td className="max-w-[260px] truncate">{c.services.join(', ') || '—'}</Td>
                <Td>{c.ownerName ?? '—'}</Td>
                <Td align="right" className="tabular">
                  {c.activeProjects}
                </Td>
                <Td className={soon(c.renewalDate) ? 'font-medium text-warn' : ''}>
                  {formatDate(c.renewalDate)}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <EmptyState
          title="No clients found"
          body="Clients are created from won deals (handover) or added here."
          action={
            can(actor, 'clients.write') ? (
              <LinkButton href="/clients/new" variant="primary">
                New client
              </LinkButton>
            ) : undefined
          }
        />
      )}
      <Pagination total={res.total} page={res.page} pageSize={res.pageSize} base="/clients" params={sp} />
    </>
  );
}
