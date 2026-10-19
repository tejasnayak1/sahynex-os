import Link from 'next/link';
import { Badge, DescList, PageHeader, Panel, StatusBadge } from '@/components/ui';
import { formatDateTime, humanize, toDateTimeLocal, todayIn } from '@/lib/format';
import { can } from '@/server/actor';
import { requirePagePermission } from '@/server/auth/current';
import { teamOptions } from '@/server/services/admin';
import { getTask, listComments, listTasks } from '@/server/services/tasks';
import {
  AddDependency,
  CommentBox,
  Collaborators,
  EditTask,
  LogTime,
  RemoveDependency,
  StatusControls,
} from './panels';

export const metadata = { title: 'Task' };

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePagePermission('tasks.read.all', 'tasks.read.assigned');
  const { id } = await params;
  const d = await getTask(actor, id);
  const t = d.task;
  const [team, comments, siblings] = await Promise.all([
    teamOptions(actor.orgId),
    listComments(actor.orgId, 'task', id),
    t.projectId
      ? listTasks(actor, {
          page: 1,
          pageSize: 200,
          dir: 'asc',
          sort: 'dueAt',
          projectId: t.projectId,
          open: true,
        })
      : Promise.resolve({ rows: [] }),
  ]);
  const canWrite = can(actor, 'tasks.write');
  const mayChange =
    canWrite &&
    (t.ownerId === actor.id || t.createdById === actor.id || can(actor, 'tasks.assign') || !t.ownerId);
  const depOptions = siblings.rows
    .filter((s) => s.id !== id && !d.dependsOn.some((x) => x.id === s.id))
    .map((s) => ({ id: s.id, label: `${s.ref} · ${s.title}` }));
  const late = t.dueAt && t.dueAt < new Date() && !['done', 'cancelled'].includes(t.status);
  return (
    <>
      <PageHeader
        crumbs={[
          { label: 'Tasks & team', href: '/tasks' },
          ...(t.projectId ? [{ label: d.projectName ?? 'Project', href: `/projects/${t.projectId}` }] : []),
          { label: t.ref },
        ]}
        title={t.title}
        meta={
          <>
            <StatusBadge status={t.status} />
            <StatusBadge status={t.priority} label={`${humanize(t.priority)} priority`} />
            <span className={late ? 'font-medium text-bad' : ''}>Due {formatDateTime(t.dueAt)}</span>
            {t.isDemo ? <Badge tone="demo">Demo data</Badge> : null}
          </>
        }
        actions={
          mayChange ? (
            <EditTask
              t={{ ...t, dueAt: toDateTimeLocal(t.dueAt) }}
              team={team}
              canAssign={can(actor, 'tasks.assign')}
            />
          ) : null
        }
      />
      {mayChange ? (
        <div className="mb-5">
          <StatusControls id={t.id} status={t.status} />
        </div>
      ) : null}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          {t.status === 'blocked' && t.blockerNote ? (
            <div className="rounded-md border border-bad/30 bg-bad-soft px-3.5 py-2.5">
              <p className="font-medium">Blocked</p>
              <p className="text-ink-2">{t.blockerNote}</p>
            </div>
          ) : null}
          <Panel title="Description">
            <p className="whitespace-pre-line text-ink-2">{t.description || 'No description.'}</p>
            {t.completionNote ? (
              <p className="mt-3 border-t border-line pt-3 text-ink-2">
                <span className="font-medium text-ink">Completion note: </span>
                {t.completionNote}
              </p>
            ) : null}
          </Panel>
          <Panel title="Dependencies">
            <div className="space-y-3">
              <div>
                <p className="mb-1 text-[13px] text-muted">Waits on</p>
                {d.dependsOn.length ? (
                  <ul className="space-y-1">
                    {d.dependsOn.map((x) => (
                      <li key={x.id} className="flex items-center justify-between gap-2">
                        <Link href={`/tasks/${x.id}`} className="hover:underline">
                          {x.ref} · {x.title}
                        </Link>
                        <span className="flex items-center gap-1">
                          <StatusBadge status={x.status} />
                          {mayChange ? <RemoveDependency id={t.id} dependsOn={x.id} /> : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-faint">Nothing</p>
                )}
              </div>
              <div>
                <p className="mb-1 text-[13px] text-muted">Blocks</p>
                {d.blocks.length ? (
                  <ul className="space-y-1">
                    {d.blocks.map((x) => (
                      <li key={x.id} className="flex items-center justify-between">
                        <Link href={`/tasks/${x.id}`} className="hover:underline">
                          {x.ref} · {x.title}
                        </Link>
                        <StatusBadge status={x.status} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-faint">Nothing</p>
                )}
              </div>
              {mayChange && t.projectId && depOptions.length ? (
                <AddDependency id={t.id} options={depOptions} />
              ) : null}
            </div>
          </Panel>
          <Panel title={`Comments (${comments.length})`}>
            <ol className="mb-4 space-y-3">
              {comments.map(({ c, authorName }) => (
                <li key={c.id}>
                  <p className="text-[12.5px] text-muted">
                    {authorName ?? 'System'} · {formatDateTime(c.createdAt)}
                  </p>
                  <p className="whitespace-pre-line">{c.body}</p>
                </li>
              ))}
            </ol>
            {canWrite ? <CommentBox id={t.id} /> : null}
          </Panel>
          <Panel title="Activity history" bodyClassName="p-0">
            <ol className="divide-y divide-line">
              {d.history.map((h) => (
                <li key={h.id} className="flex justify-between gap-3 px-4 py-2 text-[13px]">
                  <span>
                    {humanize(h.action.replace('task.', ''))}
                    {h.after && typeof h.after === 'object' ? (
                      <span className="text-muted">
                        {' '}
                        —{' '}
                        {Object.entries(h.after as Record<string, unknown>)
                          .filter(([, v]) => v != null && typeof v !== 'object')
                          .map(([k, v]) => `${k}: ${String(v).slice(0, 60)}`)
                          .join(', ')}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-muted">
                    {h.actorName ?? h.actorLabel ?? 'System'} · {formatDateTime(h.createdAt)}
                  </span>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
        <div className="space-y-5">
          <Panel title="Details">
            <DescList
              cols={1}
              items={[
                ['Owner', d.ownerName ?? 'Unassigned'],
                ['Created by', d.creatorName ?? 'Automation'],
                [
                  'Project',
                  t.projectId ? (
                    <Link className="hover:underline" href={`/projects/${t.projectId}`}>
                      {d.projectName}
                    </Link>
                  ) : (
                    '—'
                  ),
                ],
                ['Client', d.clientName ?? '—'],
                ...(t.leadId
                  ? ([
                      [
                        'Lead',
                        <Link key="l" className="hover:underline" href={`/leads/${t.leadId}`}>
                          {d.leadName}
                        </Link>,
                      ],
                    ] as Array<[string, React.ReactNode]>)
                  : []),
                ...(t.dealId
                  ? ([
                      [
                        'Deal',
                        <Link key="d" className="hover:underline" href={`/deals/${t.dealId}`}>
                          {d.dealTitle}
                        </Link>,
                      ],
                    ] as Array<[string, React.ReactNode]>)
                  : []),
                ...(t.deliverableId
                  ? ([
                      [
                        'Deliverable',
                        <Link key="dv" className="hover:underline" href={`/content/${t.deliverableId}`}>
                          Open deliverable
                        </Link>,
                      ],
                    ] as Array<[string, React.ReactNode]>)
                  : []),
                ['Effort', `${t.effortPoints} point(s)`],
                ['Repeats', t.recurrence ? humanize(t.recurrence) : 'No'],
                ['Completed', t.completedAt ? formatDateTime(t.completedAt) : '—'],
                ['Source', t.sourceKey ? 'Created by automation' : 'Created manually'],
              ]}
            />
          </Panel>
          <Panel
            title="Collaborators"
            actions={
              mayChange ? (
                <Collaborators id={t.id} team={team} current={d.collaborators.map((c) => c.id)} />
              ) : null
            }
          >
            {d.collaborators.length ? (
              <ul className="space-y-1">
                {d.collaborators.map((c) => (
                  <li key={c.id}>{c.name}</li>
                ))}
              </ul>
            ) : (
              <p className="text-faint">None</p>
            )}
          </Panel>
          <Panel
            title="Time"
            actions={
              <span className="text-[12.5px] text-muted tabular">
                {(d.minutesLogged / 60).toFixed(1)} h logged
              </span>
            }
          >
            {canWrite ? <LogTime id={t.id} today={todayIn()} /> : null}
          </Panel>
        </div>
      </div>
    </>
  );
}
