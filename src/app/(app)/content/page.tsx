import Link from 'next/link';
import { addDays, addMonths, format, startOfMonth } from 'date-fns';
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
  cn,
} from '@/components/ui';
import { formatDateTime, relativeTime } from '@/lib/format';
import { paging, readParams } from '@/lib/params';
import { can } from '@/server/actor';
import { requirePagePermission } from '@/server/auth/current';
import { clientOptions } from '@/server/services/clients';
import {
  contentCalendar,
  DELIVERABLE_FORMATS,
  FORMAT_LABEL,
  listDeliverables,
} from '@/server/services/deliverables';

export const metadata = { title: 'Content & deliverables' };
const STATUSES = [
  'draft',
  'internal_review',
  'submitted_to_client',
  'changes_requested',
  'revised',
  'approved',
  'scheduled',
  'published',
];

export default async function ContentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePagePermission('content.read');
  const sp = await readParams(searchParams);
  const view = sp.view === 'calendar' ? 'calendar' : 'list';
  const clients = actor.clientId ? [] : await clientOptions(actor);
  const header = (
    <>
      <PageHeader
        title="Content & deliverables"
        description={
          actor.clientId
            ? 'Creative shared with you for review.'
            : 'Briefs, production, versions, approvals and publishing.'
        }
        actions={
          can(actor, 'content.write') && !actor.clientId ? (
            <LinkButton href="/content/new" variant="primary">
              New deliverable
            </LinkButton>
          ) : null
        }
      />
      <nav className="mb-3 flex gap-1 border-b border-line" aria-label="Views">
        {[
          ['list', 'List'],
          ['calendar', 'Content calendar'],
        ].map(([k, l]) => (
          <Link
            key={k}
            href={`/content?view=${k}`}
            aria-current={view === k ? 'page' : undefined}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-[13.5px] font-medium',
              view === k ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {l}
          </Link>
        ))}
      </nav>
    </>
  );
  if (view === 'calendar') {
    const month =
      sp.month && /^\d{4}-\d{2}$/.test(sp.month)
        ? new Date(`${sp.month}-01T00:00:00`)
        : startOfMonth(new Date());
    const items = await contentCalendar(actor, month, addMonths(month, 1));
    const days = Array.from(
      { length: new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate() },
      (_, i) => addDays(month, i),
    );
    const byDay = new Map<string, typeof items>();
    for (const it of items) {
      const k = format(it.publishAt ?? it.dueAt!, 'yyyy-MM-dd');
      byDay.set(k, [...(byDay.get(k) ?? []), it]);
    }
    return (
      <>
        {header}
        <div className="mb-3 flex items-center gap-2">
          <LinkButton
            size="sm"
            href={`/content?view=calendar&month=${format(addMonths(month, -1), 'yyyy-MM')}`}
          >
            Previous
          </LinkButton>
          <h2 className="min-w-36 text-center font-semibold">{format(month, 'MMMM yyyy')}</h2>
          <LinkButton
            size="sm"
            href={`/content?view=calendar&month=${format(addMonths(month, 1), 'yyyy-MM')}`}
          >
            Next
          </LinkButton>
        </div>
        <div className="rounded-lg border border-line bg-surface">
          <ol className="divide-y divide-line">
            {days
              .filter((d) => byDay.has(format(d, 'yyyy-MM-dd')))
              .map((d) => (
                <li key={d.toISOString()} className="grid gap-2 px-4 py-3 sm:grid-cols-[120px_1fr]">
                  <span className="text-[13px] font-medium text-muted">{format(d, 'EEE d MMM')}</span>
                  <ul className="space-y-1.5">
                    {byDay.get(format(d, 'yyyy-MM-dd'))!.map((it) => (
                      <li key={it.id} className="flex flex-wrap items-center gap-2">
                        <Link href={`/content/${it.id}`} className="font-medium text-ink hover:underline">
                          {it.title}
                        </Link>
                        <span className="text-[12.5px] text-muted">
                          {FORMAT_LABEL[it.format]}
                          {it.channel ? ` · ${it.channel}` : ''} · {it.clientName}
                        </span>
                        <StatusBadge status={it.status} />
                        <span className="text-[12.5px] text-muted">
                          {it.publishAt
                            ? `publish ${formatDateTime(it.publishAt)}`
                            : `due ${formatDateTime(it.dueAt)}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
          </ol>
          {!items.length ? <p className="p-4 text-muted">Nothing due or scheduled this month.</p> : null}
        </div>
      </>
    );
  }
  const res = await listDeliverables(actor, {
    ...paging(sp),
    status: sp.status,
    clientId: sp.clientId,
    format: sp.format,
    projectId: sp.projectId,
  });
  return (
    <>
      {header}
      <FilterBar action="/content" q={sp.q} reset={Object.keys(sp).length > 0}>
        <Select
          name="status"
          ariaLabel="Status"
          defaultValue={sp.status}
          placeholder="Any status"
          options={STATUSES.map((s) => ({
            value: s,
            label: s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()),
          }))}
          className="w-48"
        />
        <Select
          name="format"
          ariaLabel="Format"
          defaultValue={sp.format}
          placeholder="Any format"
          options={DELIVERABLE_FORMATS.map((f) => ({ value: f, label: FORMAT_LABEL[f] }))}
          className="w-48"
        />
        {clients.length ? (
          <Select
            name="clientId"
            ariaLabel="Client"
            defaultValue={sp.clientId}
            placeholder="Any client"
            options={clients.map((c) => ({ value: c.id, label: c.name }))}
            className="w-48"
          />
        ) : null}
      </FilterBar>
      {res.rows.length ? (
        <Table>
          <thead>
            <tr>
              <SortTh label="Deliverable" field="title" params={sp} base="/content" />
              <Th>Client / project</Th>
              <Th>Format</Th>
              <Th>Owner</Th>
              <Th>Status</Th>
              <Th align="right">Version</Th>
              <SortTh label="Due" field="due" params={sp} base="/content" />
            </tr>
          </thead>
          <tbody>
            {res.rows.map((d) => (
              <tr key={d.id} className="hover:bg-surface-2">
                <Td>
                  <Link href={`/content/${d.id}`} className="font-medium text-ink hover:underline">
                    {d.title}
                  </Link>
                  <div className="text-[12.5px] text-muted">
                    {d.ref}
                    {d.revisionCount ? ` · ${d.revisionCount} revision(s)` : ''}{' '}
                    {d.isDemo ? <Badge tone="demo">Demo</Badge> : null}
                  </div>
                </Td>
                <Td>
                  <div>{d.clientName}</div>
                  <div className="text-[12.5px] text-muted">{d.projectName}</div>
                </Td>
                <Td>{FORMAT_LABEL[d.format]}</Td>
                <Td>{d.ownerName ?? '—'}</Td>
                <Td>
                  <StatusBadge status={d.status} />
                </Td>
                <Td align="right" className="tabular">
                  {d.currentVersion ? `v${d.currentVersion}` : '—'}
                </Td>
                <Td>{d.dueAt ? relativeTime(d.dueAt) : '—'}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <EmptyState
          title="No deliverables found"
          body={
            actor.clientId
              ? 'Nothing has been shared with you for review yet.'
              : 'Create a deliverable from a project to start a brief.'
          }
        />
      )}
      <Pagination total={res.total} page={res.page} pageSize={res.pageSize} base="/content" params={sp} />
    </>
  );
}
