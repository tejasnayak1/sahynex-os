import Link from 'next/link';
import { addDays, addMonths, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from 'date-fns';
import { ActionForm, SubmitButton } from '@/components/client/action-form';
import { InlineSelect } from '@/components/client/auto-submit';
import { BulkBar, SelectAll, SelectedCount } from '@/components/client/select-all';
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
import { teamOptions } from '@/server/services/admin';
import { projectOptions } from '@/server/services/projects';
import {
  BULK_STATUSES,
  listTasks,
  OPEN_STATUSES,
  PRIORITIES,
  TASK_STATUSES,
  teamWorkload,
} from '@/server/services/tasks';
import { listSavedViews } from '@/server/services/views';
import { SavedViews } from '../_shared/saved-views';
import { bulkTaskAction, taskStatusAction, updateTaskAction } from './actions';

export const metadata = { title: 'Tasks & team' };

const STATUS_LABEL: Record<string, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  blocked: 'Blocked',
  in_review: 'In review',
  done: 'Done',
  cancelled: 'Cancelled',
};

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePagePermission('tasks.read.all', 'tasks.read.assigned');
  const sp = await readParams(searchParams);
  const view = sp.view ?? 'list';
  const [team, projects, saved] = await Promise.all([
    teamOptions(actor.orgId),
    projectOptions(actor),
    listSavedViews(actor, 'tasks'),
  ]);
  const currentQuery = new URLSearchParams(
    Object.entries(sp).filter(([k, v]) => v && k !== 'page') as [string, string][],
  ).toString();
  const canWorkload = can(actor, 'team.workload');
  const canEdit = can(actor, 'tasks.write');
  const canAssign = can(actor, 'tasks.assign');
  const views = [
    { key: 'list', label: 'List' },
    { key: 'mine', label: 'My tasks' },
    { key: 'board', label: 'Board' },
    { key: 'calendar', label: 'Calendar' },
    ...(canWorkload ? [{ key: 'workload', label: 'Team workload' }] : []),
  ];
  const keep = (extra: Record<string, string>) => {
    const q = new URLSearchParams(
      Object.entries({ projectId: sp.projectId, ownerId: sp.ownerId, ...extra }).filter(([, v]) => v) as [
        string,
        string,
      ][],
    );
    return `/tasks?${q}`;
  };
  const header = (
    <>
      <PageHeader
        title="Tasks & team"
        description="Who is doing what, by when — and what is blocked."
        actions={
          <>
            <LinkButton href="/reports/daily">Daily update</LinkButton>
            {can(actor, 'tasks.write') ? (
              <LinkButton
                href={`/tasks/new${sp.projectId ? `?projectId=${sp.projectId}` : ''}`}
                variant="primary"
              >
                New task
              </LinkButton>
            ) : null}
          </>
        }
      />
      <nav className="mb-3 flex gap-1 border-b border-line" aria-label="Task views">
        {views.map((v) => (
          <Link
            key={v.key}
            href={keep({ view: v.key })}
            aria-current={view === v.key ? 'page' : undefined}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-[13.5px] font-medium',
              view === v.key ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {v.label}
          </Link>
        ))}
      </nav>
      <div className="mb-3">
        <SavedViews module="tasks" path="/tasks" query={currentQuery} views={saved} />
      </div>
    </>
  );
  const filters = (extra?: React.ReactNode) => (
    <FilterBar
      action="/tasks"
      q={sp.q}
      placeholder="Title or ref"
      reset={Object.keys(sp).filter((k) => k !== 'view').length > 0}
    >
      <input type="hidden" name="view" value={view} />
      <Select
        name="projectId"
        ariaLabel="Project"
        defaultValue={sp.projectId}
        placeholder="Any project"
        options={projects.map((p) => ({ value: p.id, label: `${p.ref} · ${p.name}` }))}
        className="w-56"
      />
      {view !== 'mine' ? (
        <Select
          name="ownerId"
          ariaLabel="Owner"
          defaultValue={sp.ownerId}
          placeholder="Anyone"
          options={[
            { value: 'unassigned', label: 'Unassigned' },
            ...team.map((t) => ({ value: t.id, label: t.name })),
          ]}
          className="w-48"
        />
      ) : null}
      {extra}
    </FilterBar>
  );

  if (view === 'workload' && canWorkload) {
    const rows = await teamWorkload(actor);
    return (
      <>
        {header}
        <p className="mb-3 max-w-[75ch] text-muted">
          Open work is measured in effort points (task size), not task counts. Use it to balance load — not as
          a performance score; quality and responsibility matter as much as volume.
        </p>
        <Table>
          <thead>
            <tr>
              <Th>Person</Th>
              <Th align="right">Open tasks</Th>
              <Th align="right">Open effort</Th>
              <Th>Due this week (effort)</Th>
              <Th align="right">Overdue</Th>
              <Th align="right">Blocked</Th>
              <Th align="right">Done (7 days)</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const cap = Math.max(1, Math.round(r.capacity / 4));
              const load = r.dueThisWeekPoints / cap;
              return (
                <tr key={r.userId}>
                  <Td>
                    <Link
                      className="font-medium text-ink hover:underline"
                      href={`/tasks?view=list&ownerId=${r.userId}`}
                    >
                      {r.name}
                    </Link>
                  </Td>
                  <Td align="right" className="tabular">
                    {r.open}
                  </Td>
                  <Td align="right" className="tabular">
                    {r.openPoints}
                  </Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-32 rounded-full bg-surface-2" aria-hidden>
                        <div
                          className={cn(
                            'h-1.5 rounded-full',
                            load > 1 ? 'bg-bad' : load > 0.8 ? 'bg-warn' : 'bg-accent',
                          )}
                          style={{ width: `${Math.min(100, load * 100)}%` }}
                        />
                      </div>
                      <span className="tabular text-[12.5px] text-muted">
                        {r.dueThisWeekPoints} / ~{cap}
                      </span>
                    </div>
                  </Td>
                  <Td align="right" className={r.overdue ? 'font-medium text-bad tabular' : 'tabular'}>
                    {r.overdue}
                  </Td>
                  <Td align="right" className={r.blocked ? 'text-bad tabular' : 'tabular'}>
                    {r.blocked}
                  </Td>
                  <Td align="right" className="tabular">
                    {r.doneLast7}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        <p className="mt-2 text-[12.5px] text-muted">
          Weekly guide capacity ≈ one effort point per 4 hours of each person’s weekly capacity (Settings →
          Users).
        </p>
      </>
    );
  }

  if (view === 'board') {
    const res = await listTasks(actor, {
      page: 1,
      pageSize: 200,
      dir: 'asc',
      sort: 'dueAt',
      q: sp.q,
      projectId: sp.projectId,
      ownerId: sp.ownerId,
      from: undefined,
    });
    const cols = ['todo', 'in_progress', 'blocked', 'in_review', 'done'] as const;
    return (
      <>
        {header}
        {filters()}
        <div className="-mx-3 overflow-x-auto px-3 pb-4 sm:-mx-6 sm:px-6">
          <div className="flex min-w-max gap-3">
            {cols.map((c) => {
              const items = res.rows.filter((t) => t.status === c).slice(0, c === 'done' ? 20 : 100);
              return (
                <section
                  key={c}
                  aria-label={STATUS_LABEL[c]}
                  className="w-[268px] rounded-lg border border-line bg-surface-2"
                >
                  <header className="flex items-center justify-between border-b border-line px-3 py-2">
                    <h2 className="text-[13.5px] font-semibold">{STATUS_LABEL[c]}</h2>
                    <span className="text-[12.5px] text-muted tabular">
                      {res.rows.filter((t) => t.status === c).length}
                    </span>
                  </header>
                  <ul className="flex flex-col gap-2 p-2">
                    {items.map((t) => {
                      const late = t.dueAt && t.dueAt < new Date() && c !== 'done';
                      return (
                        <li key={t.id} className="rounded-md border border-line bg-surface p-2.5">
                          <Link
                            href={`/tasks/${t.id}`}
                            className="block leading-snug text-ink hover:underline"
                          >
                            {t.title}
                          </Link>
                          <p className="mt-0.5 truncate text-[12px] text-muted">{t.projectName ?? t.ref}</p>
                          <div className="mt-1.5 flex items-center justify-between text-[12px]">
                            <span className={late ? 'font-medium text-bad' : 'text-muted'}>
                              {t.dueAt ? relativeTime(t.dueAt) : 'No due date'}
                            </span>
                            <span className="text-muted">{t.ownerName?.split(' ')[0] ?? '—'}</span>
                          </div>
                          {c !== 'done' && c !== 'blocked' ? (
                            <div className="mt-2">
                              <InlineSelect
                                action={taskStatusAction}
                                name="status"
                                value={t.status}
                                label={`Status of ${t.title}`}
                                hidden={{ id: t.id }}
                                className="h-7 w-full text-[12.5px]"
                                options={['todo', 'in_progress', 'in_review', 'done'].map((s) => ({
                                  value: s,
                                  label: STATUS_LABEL[s],
                                }))}
                              />
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                    {!items.length ? (
                      <li className="px-1 py-2 text-[12.5px] text-faint">Nothing here</li>
                    ) : null}
                  </ul>
                </section>
              );
            })}
          </div>
        </div>
        <p className="text-[12.5px] text-muted">
          Blocking a task requires a note — open the task to mark it blocked.
        </p>
      </>
    );
  }

  if (view === 'calendar') {
    const month =
      sp.month && /^\d{4}-\d{2}$/.test(sp.month)
        ? new Date(`${sp.month}-01T00:00:00`)
        : startOfMonth(new Date());
    const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
    const gridEnd = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
    const res = await listTasks(actor, {
      page: 1,
      pageSize: 200,
      dir: 'asc',
      sort: 'dueAt',
      projectId: sp.projectId,
      ownerId: sp.ownerId,
      from: gridStart,
      to: addDays(gridEnd, 1),
    });
    const days: Date[] = [];
    for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) days.push(d);
    const byDay = new Map<string, typeof res.rows>();
    for (const t of res.rows) {
      const k = t.dueAt ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(t.dueAt) : '';
      byDay.set(k, [...(byDay.get(k) ?? []), t]);
    }
    return (
      <>
        {header}
        <div className="mb-3 flex items-center gap-2">
          <LinkButton
            size="sm"
            href={keep({ view: 'calendar', month: format(addMonths(month, -1), 'yyyy-MM') })}
          >
            Previous
          </LinkButton>
          <h2 className="min-w-36 text-center font-semibold">{format(month, 'MMMM yyyy')}</h2>
          <LinkButton
            size="sm"
            href={keep({ view: 'calendar', month: format(addMonths(month, 1), 'yyyy-MM') })}
          >
            Next
          </LinkButton>
          <LinkButton size="sm" variant="ghost" href={keep({ view: 'calendar' })}>
            Today
          </LinkButton>
        </div>
        <div className="overflow-x-auto">
          <div
            className="grid min-w-[760px] grid-cols-7 overflow-hidden rounded-lg border border-line bg-line"
            style={{ gap: 1 }}
          >
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
              <div key={d} className="bg-surface-2 px-2 py-1.5 text-[12.5px] font-medium text-muted">
                {d}
              </div>
            ))}
            {days.map((d) => {
              const k = format(d, 'yyyy-MM-dd');
              const items = byDay.get(k) ?? [];
              const inMonth = d.getMonth() === month.getMonth();
              const today = k === format(new Date(), 'yyyy-MM-dd');
              return (
                <div key={k} className={cn('min-h-[104px] bg-surface p-1.5', !inMonth && 'bg-surface-2')}>
                  <div
                    className={cn(
                      'mb-1 text-[12px] tabular',
                      today
                        ? 'inline-grid h-5 w-5 place-items-center rounded-full bg-accent text-accent-ink'
                        : inMonth
                          ? 'text-ink-2'
                          : 'text-faint',
                    )}
                  >
                    {d.getDate()}
                  </div>
                  <ul className="space-y-0.5">
                    {items.slice(0, 4).map((t) => (
                      <li key={t.id}>
                        <Link
                          href={`/tasks/${t.id}`}
                          className={cn(
                            'block truncate rounded px-1 text-[12px] hover:bg-surface-2',
                            t.status === 'done'
                              ? 'text-faint line-through'
                              : t.status === 'blocked'
                                ? 'text-bad'
                                : 'text-ink',
                          )}
                          title={t.title}
                        >
                          {t.title}
                        </Link>
                      </li>
                    ))}
                    {items.length > 4 ? (
                      <li className="px-1 text-[11.5px] text-muted">+{items.length - 4} more</li>
                    ) : null}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      </>
    );
  }

  const p = paging(sp, { sort: 'dueAt', dir: 'asc' });
  const res = await listTasks(actor, {
    ...p,
    status: sp.status,
    priority: sp.priority,
    projectId: sp.projectId,
    ownerId: sp.ownerId,
    mine: view === 'mine',
    overdue: sp.overdue === '1',
    open: !sp.status && sp.all !== '1',
  });
  return (
    <>
      {header}
      {filters(
        <>
          <Select
            name="status"
            ariaLabel="Status"
            defaultValue={sp.status}
            placeholder="Open tasks"
            options={TASK_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
            className="w-40"
          />
          <Select
            name="priority"
            ariaLabel="Priority"
            defaultValue={sp.priority}
            placeholder="Any priority"
            options={PRIORITIES.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))}
            className="w-36"
          />
          <label className="flex h-9 items-center gap-1.5 text-[13.5px]">
            <input
              type="checkbox"
              name="overdue"
              value="1"
              defaultChecked={sp.overdue === '1'}
              className="h-4 w-4 accent-[var(--accent)]"
            />{' '}
            Overdue only
          </label>
        </>,
      )}
      {res.rows.length ? (
        <>
          {canEdit ? (
            <ActionForm action={bulkTaskAction} id="task-bulk">
              <BulkBar form="task-bulk">
                <SelectedCount form="task-bulk" />
                <span className="text-muted">·</span>
                <Select
                  name="bulkStatus"
                  ariaLabel="Set status of selected tasks"
                  placeholder="Set status…"
                  options={BULK_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
                  className="h-8 w-40 text-[13px]"
                />
                <Select
                  name="bulkPriority"
                  ariaLabel="Set priority of selected tasks"
                  placeholder="Set priority…"
                  options={PRIORITIES.map((p) => ({ value: p, label: p[0].toUpperCase() + p.slice(1) }))}
                  className="h-8 w-36 text-[13px]"
                />
                {canAssign ? (
                  <Select
                    name="bulkOwnerId"
                    ariaLabel="Reassign selected tasks to"
                    placeholder="Reassign to…"
                    options={team.map((t) => ({ value: t.id, label: t.name }))}
                    className="h-8 w-48 text-[13px]"
                  />
                ) : null}
                <SubmitButton
                  size="sm"
                  variant="secondary"
                  confirm="Apply this change to every selected task? Owners are notified of reassignments."
                >
                  Apply to selected
                </SubmitButton>
              </BulkBar>
            </ActionForm>
          ) : null}
          <Table>
            <thead>
              <tr>
                {canEdit ? (
                  <Th className="w-8">
                    <SelectAll form="task-bulk" label="Select all tasks on this page" />
                  </Th>
                ) : null}
                <SortTh label="Task" field="title" params={sp} base="/tasks" />
                <Th>Project / context</Th>
                <Th>Owner</Th>
                <SortTh label="Priority" field="priority" params={sp} base="/tasks" />
                <SortTh label="Status" field="status" params={sp} base="/tasks" />
                <SortTh label="Due" field="dueAt" params={sp} base="/tasks" />
              </tr>
            </thead>
            <tbody>
              {res.rows.map((t) => {
                const late =
                  t.dueAt && t.dueAt < new Date() && (OPEN_STATUSES as readonly string[]).includes(t.status);
                const statusOptions = TASK_STATUSES.filter(
                  (s) => s !== 'blocked' || t.status === 'blocked',
                ).map((s) => ({ value: s, label: STATUS_LABEL[s] }));
                return (
                  <tr key={t.id} className="hover:bg-surface-2">
                    {canEdit ? (
                      <Td>
                        <input
                          type="checkbox"
                          name="ids"
                          value={t.id}
                          form="task-bulk"
                          aria-label={`Select ${t.ref} ${t.title}`}
                          className="h-4 w-4 accent-[var(--accent)]"
                        />
                      </Td>
                    ) : null}
                    <Td>
                      <Link href={`/tasks/${t.id}`} className="text-ink hover:underline">
                        {t.title}
                      </Link>
                      <div className="text-[12.5px] text-muted">
                        {t.ref}
                        {t.recurrence ? ` · repeats ${t.recurrence}` : ''}
                        {t.isDemo ? (
                          <>
                            {' '}
                            <Badge tone="demo">Demo</Badge>
                          </>
                        ) : null}
                      </div>
                    </Td>
                    <Td className="max-w-[220px] truncate">
                      {t.projectName ?? (t.leadId ? 'Lead follow-up' : t.dealId ? 'Sales' : '—')}
                    </Td>
                    <Td>{t.ownerName ?? <span className="text-warn">Unassigned</span>}</Td>
                    <Td>
                      {canEdit ? (
                        <InlineSelect
                          action={updateTaskAction}
                          name="priority"
                          value={t.priority}
                          hidden={{ id: t.id }}
                          label={`Priority of ${t.ref}`}
                          options={PRIORITIES.map((p) => ({
                            value: p,
                            label: p[0].toUpperCase() + p.slice(1),
                          }))}
                          successMessage="Priority updated"
                        />
                      ) : (
                        <StatusBadge status={t.priority} />
                      )}
                    </Td>
                    <Td>
                      {canEdit ? (
                        <InlineSelect
                          action={taskStatusAction}
                          name="status"
                          value={t.status}
                          hidden={{ id: t.id }}
                          label={`Status of ${t.ref}`}
                          options={statusOptions}
                        />
                      ) : (
                        <StatusBadge status={t.status} label={STATUS_LABEL[t.status]} />
                      )}
                    </Td>
                    <Td className={late ? 'font-medium text-bad' : ''}>
                      <span title={t.dueAt ? formatDateTime(t.dueAt) : undefined}>
                        {t.dueAt ? relativeTime(t.dueAt) : '—'}
                      </span>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          {canEdit ? (
            <p className="mt-2 text-[12.5px] text-muted">
              To mark a task blocked, open it and describe the blocker — the project owner is notified.
            </p>
          ) : null}
        </>
      ) : (
        <EmptyState
          title={view === 'mine' ? 'Nothing assigned to you' : 'No tasks match'}
          body={
            view === 'mine'
              ? 'New assignments will show up here and in your notifications.'
              : 'Try clearing the filters.'
          }
        />
      )}
      <Pagination total={res.total} page={res.page} pageSize={res.pageSize} base="/tasks" params={sp} />
    </>
  );
}
