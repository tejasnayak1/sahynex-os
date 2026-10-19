import Link from 'next/link';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { ActionButton } from '@/components/client/auto-submit';
import { LinkButton, Panel, StatusBadge, cn } from '@/components/ui';
import { db, schema } from '@/db';
import { formatDateTime, formatMoney, formatNumber, relativeTime, todayIn } from '@/lib/format';
import { can } from '@/server/actor';
import { requireActor } from '@/server/auth/current';
import { executiveDashboard, homeToday } from '@/server/services/dashboard';
import { approvalQueue } from '@/server/services/deliverables';
import { getOrg } from '@/server/services/org';
import { taskStatusAction } from '../tasks/actions';

export const metadata = { title: 'Home' };

function greeting(tz: string) {
  const h = Number(
    new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: tz }).format(new Date()),
  );
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/** One plain list row: what it is, a little context, and one action on the right. */
function Row({
  href,
  title,
  meta,
  late,
  action,
}: {
  href: string;
  title: string;
  meta: React.ReactNode;
  late?: boolean;
  action?: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span aria-hidden className={cn('h-2 w-2 shrink-0 rounded-full', late ? 'bg-bad' : 'bg-line-strong')} />
      <div className="min-w-0 flex-1">
        <Link href={href} className="block truncate font-medium text-ink hover:underline">
          {title}
        </Link>
        <div className={cn('truncate text-[12.5px]', late ? 'text-bad' : 'text-muted')}>{meta}</div>
      </div>
      {action}
    </li>
  );
}

function AllClear({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-6 text-muted">{children}</p>;
}

export default async function HomePage() {
  const actor = await requireActor();
  // External reviewers only ever see what was shared with them.
  if (actor.clientId) redirect('/approvals');
  const org = await getOrg(db, actor.orgId);
  const exec = can(actor, 'dashboard.executive');
  const [data, queue, glance, submitted] = await Promise.all([
    homeToday(actor),
    approvalQueue(actor),
    exec
      ? (() => {
          const to = todayIn(org.timezone);
          const from = new Date(Date.parse(to) - 29 * 86_400_000).toISOString().slice(0, 10);
          return executiveDashboard(actor, { from, to });
        })()
      : Promise.resolve(null),
    db
      .select({ id: schema.dailyReports.id })
      .from(schema.dailyReports)
      .where(
        and(
          eq(schema.dailyReports.userId, actor.id),
          eq(schema.dailyReports.reportDate, todayIn(org.timezone)),
        ),
      ),
  ]);
  if (!data) redirect('/dashboard');
  const now = new Date();
  const dateLabel = new Intl.DateTimeFormat('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: org.timezone,
  }).format(now);
  const quick = [
    can(actor, 'leads.write') && { href: '/leads/new', label: 'Lead' },
    can(actor, 'tasks.write') && { href: '/tasks/new', label: 'Task' },
    can(actor, 'deals.write') && { href: '/deals/new', label: 'Deal' },
    can(actor, 'content.write') && { href: '/content/new', label: 'Deliverable' },
  ].filter(Boolean) as Array<{ href: string; label: string }>;
  const { overdue, dueToday, later } = data.taskCounts;
  const summary =
    overdue + dueToday === 0
      ? 'Nothing due today.'
      : [
          dueToday ? `${dueToday} task${dueToday === 1 ? '' : 's'} due today` : null,
          overdue ? `${overdue} overdue` : null,
        ]
          .filter(Boolean)
          .join(' · ');

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[13px] text-muted">{dateLabel}</p>
          <h1 className="mt-0.5 text-[26px] font-semibold tracking-[-0.01em]">
            {greeting(org.timezone)}, {actor.name.split(' ')[0]}
          </h1>
          <p className="mt-1 text-ink-2">{summary}</p>
        </div>
        {quick.length ? (
          <div className="flex flex-wrap gap-2" aria-label="Add new">
            {quick.map((q) => (
              <LinkButton key={q.href} href={q.href} size="sm">
                + {q.label}
              </LinkButton>
            ))}
          </div>
        ) : null}
      </header>

      {glance ? (
        <Link
          href="/dashboard"
          className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-line bg-surface px-4 py-3 hover:bg-surface-2"
        >
          <span className="text-[13px] font-medium text-muted">Last 30 days</span>
          <span className="tabular">
            <b className="font-semibold">{formatNumber(glance.leads.cur.total)}</b>{' '}
            <span className="text-muted">leads</span>
          </span>
          <span className="tabular">
            <b className="font-semibold">{formatMoney(glance.campaigns.cur.cplMinor, org.currency)}</b>{' '}
            <span className="text-muted">per lead</span>
            {glance.campaigns.demoCampaigns > 0 ? <span className="text-muted"> (demo)</span> : null}
          </span>
          <span className="tabular">
            <b className="font-semibold">
              {formatMoney(glance.pipeline.wonValue, org.currency, { compact: true })}
            </b>{' '}
            <span className="text-muted">won</span>
          </span>
          <span className="ml-auto text-[13px] font-medium text-accent">Business dashboard →</span>
        </Link>
      ) : null}

      {!submitted.length ? (
        <p className="mb-5 rounded-lg border border-line bg-surface px-4 py-3 text-[13.5px]">
          Haven’t shared today’s update yet?{' '}
          <Link href="/reports/daily" className="font-medium text-accent underline">
            Write your daily update
          </Link>{' '}
          — two minutes: what you finished, what’s next, anything blocking you.
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Panel
          title="Your tasks for today"
          bodyClassName="p-0"
          actions={
            <Link href="/tasks?view=mine" className="text-[13px] text-accent hover:underline">
              All my tasks{later ? ` (${later} later)` : ''}
            </Link>
          }
        >
          {data.tasks.length ? (
            <ul className="divide-y divide-line">
              {data.tasks.map((t) => {
                const late = !!t.dueAt && t.dueAt < now;
                return (
                  <Row
                    key={t.id}
                    href={`/tasks/${t.id}`}
                    title={t.title}
                    late={late}
                    meta={
                      <>
                        {late ? 'Overdue · ' : 'Due '}
                        {t.dueAt ? relativeTime(t.dueAt) : ''}
                        {t.projectName ? ` · ${t.projectName}` : ''}
                        {t.status === 'blocked' ? ' · Blocked' : ''}
                      </>
                    }
                    action={
                      t.status !== 'blocked' ? (
                        <ActionButton
                          action={taskStatusAction}
                          hidden={{ id: t.id, status: 'done' }}
                          successMessage="Nice — task done"
                        >
                          Done
                        </ActionButton>
                      ) : (
                        <StatusBadge status="blocked" />
                      )
                    }
                  />
                );
              })}
            </ul>
          ) : (
            <AllClear>You’re all caught up for today. 🎉</AllClear>
          )}
        </Panel>

        <div className="space-y-5">
          {data.meetings.length ? (
            <Panel title="Today’s meetings" bodyClassName="p-0">
              <ul className="divide-y divide-line">
                {data.meetings.map((m) => (
                  <Row
                    key={m.id}
                    href={m.dealId ? `/deals/${m.dealId}` : `/leads/${m.leadId}`}
                    title={m.title}
                    meta={`${formatDateTime(m.startAt)}${m.location ? ` · ${m.location}` : ''}`}
                  />
                ))}
              </ul>
            </Panel>
          ) : null}

          {can(actor, 'leads.read.own') || can(actor, 'leads.read.all') ? (
            <Panel
              title="Leads to follow up"
              bodyClassName="p-0"
              actions={
                <Link href="/leads?view=mine" className="text-[13px] text-accent hover:underline">
                  My leads
                </Link>
              }
            >
              {data.leads.length ? (
                <ul className="divide-y divide-line">
                  {data.leads.map((l) => {
                    const late = !!l.nextActionAt && l.nextActionAt < now;
                    return (
                      <Row
                        key={l.id}
                        href={`/leads/${l.id}`}
                        title={l.name}
                        late={late}
                        meta={
                          l.stage === 'new'
                            ? 'New — make first contact'
                            : `${l.nextAction ?? 'Follow up'} · ${l.nextActionAt ? relativeTime(l.nextActionAt) : ''}`
                        }
                      />
                    );
                  })}
                </ul>
              ) : (
                <AllClear>No follow-ups waiting.</AllClear>
              )}
            </Panel>
          ) : null}

          {queue.length ? (
            <Panel title="Waiting for your approval" bodyClassName="p-0">
              <ul className="divide-y divide-line">
                {queue.slice(0, 5).map((q) => (
                  <Row
                    key={q.ap.id}
                    href={`/content/${q.deliverableId}`}
                    title={q.title}
                    meta={`${q.clientName} · sent ${relativeTime(q.ap.submittedAt)}`}
                  />
                ))}
              </ul>
              {queue.length > 5 ? (
                <p className="border-t border-line px-4 py-2.5 text-[13px]">
                  <Link href="/approvals" className="text-accent hover:underline">
                    See all {queue.length} approvals
                  </Link>
                </p>
              ) : null}
            </Panel>
          ) : null}
        </div>
      </div>
    </div>
  );
}
