import Link from 'next/link';
import {
  Badge,
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
} from '@/components/ui';
import { formatDate } from '@/lib/format';
import { paging, readParams } from '@/lib/params';
import { can } from '@/server/actor';
import { requirePagePermission } from '@/server/auth/current';
import { teamOptions } from '@/server/services/admin';
import { clientOptions } from '@/server/services/clients';
import { listProjects } from '@/server/services/projects';

export const metadata = { title: 'Projects' };

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePagePermission('projects.read.all', 'projects.read.assigned');
  const sp = await readParams(searchParams);
  const res = await listProjects(actor, {
    ...paging(sp),
    status: sp.status,
    clientId: sp.clientId,
    ownerId: sp.ownerId,
  });
  const [clients, team] = await Promise.all([clientOptions(actor), teamOptions(actor.orgId)]);
  return (
    <>
      <PageHeader
        title="Projects"
        description="Client engagements, their owners, deadlines and delivery health."
        actions={
          can(actor, 'projects.write') ? (
            <LinkButton href="/projects/new" variant="primary">
              New project
            </LinkButton>
          ) : null
        }
      />
      <FilterBar action="/projects" q={sp.q} reset={Object.keys(sp).length > 0}>
        <Select
          name="status"
          ariaLabel="Status"
          defaultValue={sp.status}
          placeholder="Any status"
          options={['planning', 'active', 'on_hold', 'completed', 'cancelled'].map((s) => ({
            value: s,
            label: s.replace('_', ' ').replace(/^./, (c) => c.toUpperCase()),
          }))}
          className="w-40"
        />
        <Select
          name="clientId"
          ariaLabel="Client"
          defaultValue={sp.clientId}
          placeholder="Any client"
          options={clients.map((c) => ({ value: c.id, label: c.name }))}
          className="w-52"
        />
        <Select
          name="ownerId"
          ariaLabel="Owner"
          defaultValue={sp.ownerId}
          placeholder="Any owner"
          options={team.map((t) => ({ value: t.id, label: t.name }))}
          className="w-48"
        />
      </FilterBar>
      {res.rows.length ? (
        <Table>
          <thead>
            <tr>
              <SortTh label="Project" field="name" params={sp} base="/projects" />
              <Th>Client</Th>
              <SortTh label="Status" field="status" params={sp} base="/projects" />
              <Th>Owner</Th>
              <Th align="right">Open tasks</Th>
              <Th align="right">Overdue</Th>
              <SortTh label="Ends" field="end" params={sp} base="/projects" />
            </tr>
          </thead>
          <tbody>
            {res.rows.map((p) => (
              <tr key={p.id} className="hover:bg-surface-2">
                <Td>
                  <Link href={`/projects/${p.id}`} className="font-medium text-ink hover:underline">
                    {p.name}
                  </Link>
                  <div className="text-[12.5px] text-muted">
                    {p.ref} {p.isDemo ? <Badge tone="demo">Demo</Badge> : null}
                  </div>
                </Td>
                <Td>{p.clientName}</Td>
                <Td>
                  <StatusBadge status={p.status} />
                </Td>
                <Td>{p.ownerName ?? '—'}</Td>
                <Td align="right" className="tabular">
                  {p.openTasks}
                </Td>
                <Td align="right" className={p.overdueTasks ? 'font-medium text-bad tabular' : 'tabular'}>
                  {p.overdueTasks}
                </Td>
                <Td>{formatDate(p.endDate)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <EmptyState
          title="No projects found"
          body="Projects are created automatically when a won deal’s handover is approved, or manually here."
        />
      )}
      <Pagination total={res.total} page={res.page} pageSize={res.pageSize} base="/projects" params={sp} />
    </>
  );
}
