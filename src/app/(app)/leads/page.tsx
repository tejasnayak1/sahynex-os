import Link from 'next/link';
import { ActionForm, SubmitButton } from '@/components/client/action-form';
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
import { relativeTime } from '@/lib/format';
import { paging, readParams } from '@/lib/params';
import { can } from '@/server/actor';
import { requirePagePermission } from '@/server/auth/current';
import { teamOptions } from '@/server/services/admin';
import { clientOptions } from '@/server/services/clients';
import { LEAD_STAGES, listLeadSources, listLeads } from '@/server/services/leads';
import { listSavedViews } from '@/server/services/views';
import { SavedViews } from '../_shared/saved-views';
import { bulkAssignAction } from './actions';
import { SelectAll, SelectedCount } from '@/components/client/select-all';

export const metadata = { title: 'CRM & leads' };

const VIEWS = [
  { key: '', label: 'All leads' },
  { key: 'mine', label: 'My leads' },
  { key: 'overdue', label: 'Follow-up due' },
  { key: 'new', label: 'Uncontacted' },
  { key: 'duplicates', label: 'Possible duplicates' },
  { key: 'prospects', label: 'Sahynex prospects' },
];

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePagePermission('leads.read.all', 'leads.read.own');
  const sp = await readParams(searchParams);
  const p = paging(sp, { sort: 'createdAt', dir: 'desc' });
  const view = sp.view ?? '';
  const res = await listLeads(actor, {
    ...p,
    stage: sp.stage ?? (view === 'new' ? 'new' : undefined),
    ownerId: sp.ownerId,
    sourceId: sp.sourceId,
    clientId: view === 'prospects' ? 'none' : sp.clientId,
    qualification: sp.qualification,
    overdue: view === 'overdue' || sp.overdue === '1',
    duplicates: view === 'duplicates' || sp.duplicates === '1',
    mine: view === 'mine',
  });
  const [team, sources, clients, saved] = await Promise.all([
    teamOptions(actor.orgId),
    listLeadSources(actor.orgId),
    clientOptions(actor),
    listSavedViews(actor, 'leads'),
  ]);
  const currentQuery = new URLSearchParams(
    Object.entries(sp).filter(([k, v]) => v && k !== 'page') as [string, string][],
  ).toString();
  const base = '/leads';
  const exportQs = new URLSearchParams(
    Object.entries(sp).filter(([, v]) => v) as [string, string][],
  ).toString();
  const canAssign = can(actor, 'leads.assign');
  return (
    <>
      <PageHeader
        title="CRM & leads"
        description="Every enquiry from every channel, with an owner and a next action."
        actions={
          <>
            {can(actor, 'leads.import') ? <LinkButton href="/leads/import">Import CSV</LinkButton> : null}
            <a
              className="inline-flex h-9 items-center rounded-md border border-line-strong bg-surface px-3.5 text-[14px] font-medium hover:bg-surface-2"
              href={`/api/leads/export?${exportQs}`}
            >
              Export
            </a>
            {can(actor, 'leads.write') ? (
              <LinkButton href="/leads/new" variant="primary">
                New lead
              </LinkButton>
            ) : null}
          </>
        }
      />
      <nav className="mb-3 flex flex-wrap gap-1.5" aria-label="Saved views">
        {VIEWS.map((v) => (
          <Link
            key={v.key}
            href={v.key ? `${base}?view=${v.key}` : base}
            aria-current={view === v.key ? 'page' : undefined}
            className={`rounded-full border px-3 py-1 text-[13px] ${view === v.key ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-surface text-ink-2 hover:border-line-strong'}`}
          >
            {v.label}
          </Link>
        ))}
        <span className="mx-1 h-5 w-px bg-line" aria-hidden />
        <SavedViews module="leads" path={base} query={currentQuery} views={saved} />
      </nav>
      <FilterBar
        action={base}
        q={sp.q}
        placeholder="Name, email, phone, ref…"
        reset={Object.keys(sp).length > 0}
      >
        {view ? <input type="hidden" name="view" value={view} /> : null}
        <Select
          name="stage"
          ariaLabel="Stage"
          defaultValue={sp.stage}
          placeholder="Any stage"
          options={LEAD_STAGES.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))}
          className="w-36"
        />
        <Select
          name="qualification"
          ariaLabel="Qualification"
          defaultValue={sp.qualification}
          placeholder="Any qualification"
          options={[
            { value: 'pending', label: 'Pending' },
            { value: 'qualified', label: 'Qualified' },
            { value: 'disqualified', label: 'Disqualified' },
          ]}
          className="w-44"
        />
        <Select
          name="ownerId"
          ariaLabel="Owner"
          defaultValue={sp.ownerId}
          placeholder="Any owner"
          options={[
            { value: 'unassigned', label: 'Unassigned' },
            ...team.map((t) => ({ value: t.id, label: t.name })),
          ]}
          className="w-48"
        />
        <Select
          name="sourceId"
          ariaLabel="Source"
          defaultValue={sp.sourceId}
          placeholder="Any source"
          options={sources.map((s) => ({ value: s.id, label: s.name }))}
          className="w-40"
        />
        {view !== 'prospects' ? (
          <Select
            name="clientId"
            ariaLabel="Client"
            defaultValue={sp.clientId}
            placeholder="Any client"
            options={[
              { value: 'none', label: 'Sahynex prospects' },
              ...clients.map((c) => ({ value: c.id, label: c.name })),
            ]}
            className="w-48"
          />
        ) : null}
      </FilterBar>

      {res.rows.length === 0 ? (
        <EmptyState
          title={Object.keys(sp).length ? 'No leads match these filters' : 'No leads yet'}
          body={
            Object.keys(sp).length
              ? 'Clear the filters or try a different search.'
              : 'Leads arrive from website forms, Meta Lead Ads and CSV imports, or you can add one manually.'
          }
          action={
            can(actor, 'leads.write') ? (
              <LinkButton href="/leads/new" variant="primary">
                New lead
              </LinkButton>
            ) : undefined
          }
        />
      ) : (
        <ActionForm action={bulkAssignAction} id="lead-bulk">
          {canAssign ? (
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px]">
              <SelectedCount form="lead-bulk" />
              <span className="text-muted">·</span>
              <Select
                name="ownerId"
                ariaLabel="Assign selected leads to"
                placeholder="Assign to…"
                options={team.map((t) => ({ value: t.id, label: t.name }))}
                className="h-8 w-52 text-[13px]"
              />
              <SubmitButton
                size="sm"
                variant="secondary"
                confirm="Reassign the selected leads? Each new owner will be notified."
              >
                Reassign
              </SubmitButton>
            </div>
          ) : null}
          <Table>
            <thead>
              <tr>
                {canAssign ? (
                  <Th className="w-8">
                    <SelectAll form="lead-bulk" label="Select all leads on this page" />
                  </Th>
                ) : null}
                <SortTh label="Lead" field="name" params={sp} base={base} />
                <Th>Interest</Th>
                <Th>Source</Th>
                <SortTh label="Stage" field="stage" params={sp} base={base} />
                <SortTh label="Score" field="score" params={sp} base={base} align="right" />
                <Th>Owner</Th>
                <SortTh label="Next action" field="nextActionAt" params={sp} base={base} />
                <SortTh label="Created" field="createdAt" params={sp} base={base} />
              </tr>
            </thead>
            <tbody>
              {res.rows.map((l) => {
                const overdue =
                  l.nextActionAt &&
                  l.nextActionAt < new Date() &&
                  !['converted', 'lost', 'unqualified'].includes(l.stage);
                return (
                  <tr key={l.id} className="hover:bg-surface-2">
                    {canAssign ? (
                      <Td>
                        <input
                          type="checkbox"
                          name="ids"
                          value={l.id}
                          form="lead-bulk"
                          aria-label={`Select ${l.name}`}
                          className="h-4 w-4 accent-[var(--accent)]"
                        />
                      </Td>
                    ) : null}
                    <Td>
                      <Link href={`/leads/${l.id}`} className="font-medium text-ink hover:underline">
                        {l.name}
                      </Link>
                      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12.5px] text-muted">
                        <span className="whitespace-nowrap">{l.ref}</span>
                        {l.clientName ? (
                          <span>· {l.clientName}</span>
                        ) : l.organisationName ? (
                          <span>· {l.organisationName}</span>
                        ) : null}
                        {l.possibleDuplicateOfId ? <Badge tone="warn">Possible duplicate</Badge> : null}
                        {l.suppressed ? <Badge>Opted out</Badge> : null}
                      </div>
                    </Td>
                    <Td className="max-w-[180px] truncate">{l.interest ?? '—'}</Td>
                    <Td>{l.sourceName ?? '—'}</Td>
                    <Td>
                      <StatusBadge status={l.stage} />
                    </Td>
                    <Td align="right" className="tabular">
                      {l.score ?? '—'}
                    </Td>
                    <Td>{l.ownerName ?? <span className="text-warn">Unassigned</span>}</Td>
                    <Td className={overdue ? 'font-medium text-bad' : ''}>
                      {l.nextActionAt ? relativeTime(l.nextActionAt) : '—'}
                    </Td>
                    <Td className="text-muted">{relativeTime(l.createdAt)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </ActionForm>
      )}
      <Pagination total={res.total} page={res.page} pageSize={res.pageSize} base={base} params={sp} />
    </>
  );
}
