import Link from 'next/link';
import { ActionButton } from '@/components/client/auto-submit';
import {
  Badge,
  DescList,
  LinkButton,
  PageHeader,
  Panel,
  StatusBadge,
  Table,
  Td,
  Th,
  cn,
} from '@/components/ui';
import { db } from '@/db';
import { formatDate, formatMoney, humanize, relativeTime } from '@/lib/format';
import { can } from '@/server/actor';
import { requirePagePermission } from '@/server/auth/current';
import { teamOptions } from '@/server/services/admin';
import { listDeliverables } from '@/server/services/deliverables';
import { getOrg } from '@/server/services/org';
import { getProject, listTemplates } from '@/server/services/projects';
import { listTasks } from '@/server/services/tasks';
import { toggleMilestoneAction } from '../actions';
import { AddMilestone, ApplyTemplate, EditProject, Members, ProjectStatus } from '../project-form';

export const metadata = { title: 'Project' };

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePagePermission('projects.read.all', 'projects.read.assigned');
  const { id } = await params;
  const d = await getProject(actor, id);
  const p = d.project;
  const org = await getOrg(db, actor.orgId);
  const [team, templates, taskList, dels] = await Promise.all([
    teamOptions(actor.orgId),
    listTemplates(actor.orgId),
    listTasks(actor, { page: 1, pageSize: 100, dir: 'asc', sort: 'dueAt', projectId: id }),
    can(actor, 'content.read')
      ? listDeliverables(actor, { page: 1, pageSize: 50, dir: 'desc', projectId: id })
      : Promise.resolve({ rows: [] }),
  ]);
  const canWrite = can(actor, 'projects.write');
  const progress = d.taskStats.total ? d.taskStats.done / d.taskStats.total : 0;
  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Projects', href: '/projects' }, { label: p.ref }]}
        title={p.name}
        meta={
          <>
            <Link href={`/clients/${p.clientId}`} className="hover:underline">
              {d.clientName}
            </Link>
            <span>Owner {d.ownerName ?? '—'}</span>
            <span>
              {formatDate(p.startDate)} → {formatDate(p.endDate)}
            </span>
            {p.isDemo ? <Badge tone="demo">Demo data</Badge> : null}
          </>
        }
        actions={
          <>
            {canWrite ? <ProjectStatus id={p.id} status={p.status} /> : <StatusBadge status={p.status} />}
            {canWrite ? (
              <EditProject p={p} team={team} commercials={can(actor, 'projects.commercials')} />
            ) : null}
          </>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <Panel
            title="Tasks"
            bodyClassName="p-0"
            actions={
              <div className="flex gap-2">
                <LinkButton size="sm" href={`/tasks?projectId=${p.id}&view=board`}>
                  Board
                </LinkButton>
                {can(actor, 'tasks.write') ? (
                  <LinkButton size="sm" href={`/tasks/new?projectId=${p.id}`}>
                    Add task
                  </LinkButton>
                ) : null}
              </div>
            }
          >
            <div className="flex items-center gap-3 border-b border-line px-4 py-2.5 text-[13px]">
              <div
                className="h-1.5 flex-1 rounded-full bg-surface-2"
                role="progressbar"
                aria-label="Tasks complete"
                aria-valuenow={Math.round(progress * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div className="h-1.5 rounded-full bg-ok" style={{ width: `${progress * 100}%` }} />
              </div>
              <span className="tabular text-muted">
                {d.taskStats.done}/{d.taskStats.total} done ·{' '}
                <span className={d.taskStats.overdue ? 'text-bad' : ''}>{d.taskStats.overdue} overdue</span> ·{' '}
                {d.taskStats.blocked} blocked
              </span>
            </div>
            {taskList.rows.length ? (
              <Table className="rounded-none border-0">
                <thead>
                  <tr>
                    <Th>Task</Th>
                    <Th>Owner</Th>
                    <Th>Status</Th>
                    <Th>Due</Th>
                  </tr>
                </thead>
                <tbody>
                  {taskList.rows.map((t) => {
                    const late = t.dueAt && t.dueAt < new Date() && !['done', 'cancelled'].includes(t.status);
                    return (
                      <tr key={t.id} className="hover:bg-surface-2">
                        <Td>
                          <Link href={`/tasks/${t.id}`} className="text-ink hover:underline">
                            {t.title}
                          </Link>
                          {t.blockerNote && t.status === 'blocked' ? (
                            <div className="text-[12.5px] text-bad">{t.blockerNote}</div>
                          ) : null}
                        </Td>
                        <Td>{t.ownerName ?? '—'}</Td>
                        <Td>
                          <StatusBadge status={t.status} />
                        </Td>
                        <Td className={cn(late && 'font-medium text-bad')}>
                          {t.dueAt ? relativeTime(t.dueAt) : '—'}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            ) : (
              <div className="p-4">
                <p className="mb-2 text-muted">No tasks yet. Generate them from a template:</p>
                {canWrite ? (
                  <ApplyTemplate id={p.id} templates={templates.map((t) => ({ key: t.key, name: t.name }))} />
                ) : null}
              </div>
            )}
          </Panel>
          {dels.rows.length ? (
            <Panel
              title="Deliverables"
              bodyClassName="p-0"
              actions={
                can(actor, 'content.write') ? (
                  <LinkButton size="sm" href={`/content/new?projectId=${p.id}`}>
                    New deliverable
                  </LinkButton>
                ) : null
              }
            >
              <ul className="divide-y divide-line">
                {dels.rows.map((x) => (
                  <li key={x.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                    <Link href={`/content/${x.id}`} className="min-w-0 truncate hover:underline">
                      {x.title}
                    </Link>
                    <span className="flex items-center gap-2 text-[12.5px] text-muted">
                      v{x.currentVersion}
                      <StatusBadge status={x.status} />
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
          <Panel title="Scope & objectives">
            <DescList
              cols={1}
              items={[
                [
                  'Scope',
                  <span key="s" className="whitespace-pre-line">
                    {p.scope ?? '—'}
                  </span>,
                ],
                [
                  'Objectives',
                  <span key="o" className="whitespace-pre-line">
                    {p.objectives ?? '—'}
                  </span>,
                ],
                [
                  'Risks & dependencies',
                  <span key="r" className="whitespace-pre-line">
                    {p.risks ?? '—'}
                  </span>,
                ],
              ]}
            />
          </Panel>
        </div>
        <div className="space-y-5">
          <Panel title="Delivery readiness">
            <ul className="space-y-1.5 text-[13.5px]">
              {d.readiness.checks.map((c) => (
                <li key={c.label} className="flex gap-2">
                  <span aria-hidden className={c.ok ? 'text-ok' : 'text-faint'}>
                    {c.ok ? '●' : '○'}
                  </span>
                  <span>
                    {c.label}
                    <span className="sr-only">{c.ok ? ' — done' : ' — missing'}</span>
                  </span>
                </li>
              ))}
            </ul>
            {p.status === 'planning' ? (
              <p className="mt-2 text-[12.5px] text-muted">
                {d.readiness.ready
                  ? 'Ready to move to active delivery.'
                  : 'Complete these before active delivery.'}
              </p>
            ) : null}
          </Panel>
          <Panel title="Details">
            <DescList
              cols={1}
              items={[
                ['Reporting', humanize(p.reportingCadence)],
                [
                  'Client approval',
                  p.approvalRequired ? 'Required for deliverables' : 'Internal review only',
                ],
                ...(can(actor, 'projects.commercials')
                  ? ([
                      ['Budget', formatMoney(p.budgetMinor, org.currency)],
                      ['Contract value', formatMoney(p.revenueMinor, org.currency)],
                    ] as Array<[string, string]>)
                  : []),
                ['Template', p.templateKey ? humanize(p.templateKey) : '—'],
                ['Handover', p.handoverId ? 'From approved sales handover' : 'Created manually'],
              ]}
            />
          </Panel>
          <Panel
            title="Team"
            actions={canWrite ? <Members id={p.id} team={team} members={d.members.map((m) => m.id)} /> : null}
          >
            <ul className="space-y-1 text-[13.5px]">
              {d.members.map((m) => (
                <li key={m.id} className="flex justify-between">
                  <span>{m.name}</span>
                  <span className="text-muted">{m.role}</span>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="Milestones">
            <ul className="mb-3 space-y-1.5">
              {d.milestones.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2 text-[13.5px]">
                  <span className={m.completedAt ? 'text-muted line-through' : ''}>{m.name}</span>
                  <span className="flex items-center gap-2 text-[12.5px] text-muted">
                    {formatDate(m.dueDate)}
                    {canWrite ? (
                      <ActionButton action={toggleMilestoneAction} hidden={{ id: m.id }} variant="ghost">
                        {m.completedAt ? 'Reopen' : 'Done'}
                      </ActionButton>
                    ) : null}
                  </span>
                </li>
              ))}
              {!d.milestones.length ? <li className="text-muted">No milestones.</li> : null}
            </ul>
            {canWrite ? <AddMilestone projectId={p.id} /> : null}
          </Panel>
        </div>
      </div>
    </>
  );
}
