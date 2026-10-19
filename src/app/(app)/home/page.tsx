import Link from 'next/link';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { ActionButton } from '@/components/client/auto-submit';
import { LinkButton, cn } from '@/components/ui';
import { db, schema } from '@/db';
import { formatMoney, formatNumber, relativeTime, todayIn } from '@/lib/format';
import { can } from '@/server/actor';
import { requireActor } from '@/server/auth/current';
import { briefBlock, callsAndProgress, googleBlock, instagramBlock } from '@/server/services/briefing';
import { executiveDashboard, homeToday } from '@/server/services/dashboard';
import { approvalQueue } from '@/server/services/deliverables';
import { getOrg } from '@/server/services/org';
import { taskStatusAction } from '../tasks/actions';
import { disconnectGoogleAction, generateBriefAction } from './actions';

export const metadata = { title: 'Home' };

/* ----------------------------------------------------------- helpers */

function greeting(tz: string) {
  const h = Number(
    new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: tz }).format(new Date()),
  );
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

const timeFmt = (tz: string) => (d: string | Date | null) =>
  d
    ? new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(
        new Date(d),
      )
    : '';

function Section({
  title,
  aside,
  children,
  className,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('flex min-w-0 flex-col rounded-xl border border-line bg-surface', className)}>
      <header className="flex items-baseline justify-between gap-3 px-5 pt-4 pb-3">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {aside ? <div className="text-[13px] text-muted">{aside}</div> : null}
      </header>
      <div className="flex-1 px-5 pb-4">{children}</div>
    </section>
  );
}

function Quiet({ children }: { children: React.ReactNode }) {
  return <p className="py-2 text-[14px] text-muted">{children}</p>;
}

function DemoTag() {
  return (
    <span className="rounded-full bg-demo-soft px-2 py-0.5 text-[11.5px] font-medium text-demo">
      Sample data
    </span>
  );
}

/** Ring showing today's task completion. */
function ProgressRing({ done, total }: { done: number; total: number }) {
  const pct = total ? done / total : 0;
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <div
      className="flex items-center gap-3"
      role="img"
      aria-label={total ? `${done} of ${total} tasks done today` : 'No tasks due today'}
    >
      <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden>
        <circle cx="32" cy="32" r={r} fill="none" stroke="var(--line)" strokeWidth="6" />
        {total ? (
          <circle
            cx="32"
            cy="32"
            r={r}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${c * pct} ${c}`}
            transform="rotate(-90 32 32)"
          />
        ) : null}
        <text x="32" y="37" textAnchor="middle" className="fill-ink text-[15px] font-semibold tabular">
          {total ? `${Math.round(pct * 100)}%` : '–'}
        </text>
      </svg>
      <div className="leading-tight">
        <p className="text-[15px] font-semibold tabular">
          {total ? `${done} of ${total} done` : 'Nothing due'}
        </p>
        <p className="text-[13px] text-muted">today’s tasks</p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- page */

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireActor();
  if (actor.clientId) redirect('/approvals');
  const sp = await searchParams;
  const org = await getOrg(db, actor.orgId);
  const tz = org.timezone;
  const t = timeFmt(tz);
  const exec = can(actor, 'dashboard.executive');
  const [home, brief, google, ig, cp, queue, glance, submitted] = await Promise.all([
    homeToday(actor),
    briefBlock(actor),
    googleBlock(actor),
    instagramBlock(actor),
    callsAndProgress(actor),
    approvalQueue(actor),
    exec
      ? (() => {
          const to = todayIn(tz);
          const from = new Date(Date.parse(to) - 29 * 86_400_000).toISOString().slice(0, 10);
          return executiveDashboard(actor, { from, to });
        })()
      : Promise.resolve(null),
    db
      .select({ id: schema.dailyReports.id })
      .from(schema.dailyReports)
      .where(and(eq(schema.dailyReports.userId, actor.id), eq(schema.dailyReports.reportDate, todayIn(tz)))),
  ]);
  if (!home) redirect('/dashboard');
  const now = new Date();
  const dateLabel = new Intl.DateTimeFormat('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: tz,
  }).format(now);

  // One timeline for the day: Google Calendar events + meetings booked in Sahynex OS.
  const schedule = [
    ...(google.state === 'ready'
      ? google.calendar.map((e) => ({
          key: `g${e.id}`,
          title: e.title,
          start: e.start,
          end: e.end,
          allDay: e.allDay,
          where: e.meetLink ? 'Google Meet' : e.location,
          join: e.meetLink,
          href: e.link,
          demo: google.demo,
        }))
      : []),
    ...home.meetings.map((m) => ({
      key: `m${m.id}`,
      title: m.title,
      start: m.startAt.toISOString(),
      end: null as string | null,
      allDay: false,
      where: m.location && /^https?:/.test(m.location) ? 'Video call' : m.location,
      join: m.location && /^https?:/.test(m.location) ? m.location : null,
      href: m.dealId ? `/deals/${m.dealId}` : `/leads/${m.leadId}`,
      demo: false,
    })),
  ].sort((a, b) => (a.allDay ? -1 : b.allDay ? 1 : Date.parse(a.start ?? '') - Date.parse(b.start ?? '')));
  const nextUp = schedule.find((s) => !s.allDay && s.start && Date.parse(s.end ?? s.start) > now.getTime());

  const quick = [
    can(actor, 'leads.write') && { href: '/leads/new', label: 'New lead' },
    can(actor, 'tasks.write') && { href: '/tasks/new', label: 'New task' },
    can(actor, 'deals.write') && { href: '/deals/new', label: 'New deal' },
  ].filter(Boolean) as Array<{ href: string; label: string }>;

  const { overdue, dueToday } = home.taskCounts;
  const lineParts = [
    schedule.length
      ? `${schedule.length} thing${schedule.length === 1 ? '' : 's'} on your calendar`
      : 'a clear calendar',
    dueToday + overdue
      ? `${dueToday + overdue} task${dueToday + overdue === 1 ? '' : 's'} to finish`
      : 'no tasks due',
  ];
  if (cp.calls.length) lineParts.push(`${cp.calls.length} call${cp.calls.length === 1 ? '' : 's'} to make`);
  const dayLine = `Today you have ${lineParts.slice(0, -1).join(', ')}${lineParts.length > 1 ? ' and ' : ''}${lineParts.at(-1)}.`;

  const googleNotice: Record<string, string> = {
    connected: 'Google connected. Your inbox and calendar now appear here.',
    cancelled: 'Google connection cancelled — nothing was connected.',
    invalid: 'That Google sign-in link expired. Try connecting again.',
    failed:
      'Google didn’t complete the connection. Try again; if it keeps failing, ask your administrator to check the Google setup.',
    not_configured: 'Google sign-in isn’t set up on this server yet.',
  };
  const gq = typeof sp.google === 'string' ? sp.google : null;

  return (
    <div className="mx-auto max-w-6xl">
      {gq && googleNotice[gq] ? (
        <p
          role="status"
          className={cn(
            'mb-5 rounded-lg border px-4 py-2.5 text-[13.5px]',
            gq === 'connected' ? 'border-ok/30 bg-ok-soft' : 'border-warn/30 bg-warn-soft',
          )}
        >
          {googleNotice[gq]}
        </p>
      ) : null}

      {/* Greeting */}
      <header className="mb-7 flex flex-wrap items-end justify-between gap-6">
        <div className="max-w-[60ch]">
          <p className="text-[14px] text-muted">{dateLabel}</p>
          <h1 className="mt-1 text-[32px] leading-[1.15] font-semibold tracking-[-0.02em]">
            {greeting(tz)}, {actor.name.split(' ')[0]}
          </h1>
          <p className="mt-2 text-[16px] text-ink-2">{dayLine}</p>
          {nextUp ? (
            <p className="mt-1 text-[14px] text-muted">
              Next up at {t(nextUp.start)}: <span className="text-ink">{nextUp.title}</span>
            </p>
          ) : null}
        </div>
        <div className="flex flex-col items-start gap-3 sm:items-end">
          <ProgressRing done={cp.progress.done} total={cp.progress.total} />
          {quick.length ? (
            <div className="flex flex-wrap gap-2">
              {quick.map((q) => (
                <LinkButton key={q.href} href={q.href} size="sm">
                  {q.label}
                </LinkButton>
              ))}
            </div>
          ) : null}
        </div>
      </header>

      {/* The morning brief — the one bold element on the page */}
      <section
        aria-labelledby="brief-title"
        className="mb-6 rounded-2xl bg-accent px-6 py-6 text-accent-ink sm:px-8 sm:py-7"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="brief-title" className="text-[17px] font-semibold">
            Your morning brief
          </h2>
          <div className="flex items-center gap-2 text-[12.5px]">
            {brief.state === 'ready' ? (
              <>
                <span className="rounded-full bg-accent-ink/15 px-2.5 py-0.5">
                  {brief.demo
                    ? 'Sample — written by rules, not AI'
                    : `Written by AI at ${t(brief.createdAt)}`}
                </span>
                <ActionButton
                  action={generateBriefAction}
                  hidden={{ force: '1' }}
                  variant="ghost"
                  successMessage="Brief refreshed"
                >
                  <span className="text-accent-ink">Refresh</span>
                </ActionButton>
              </>
            ) : null}
          </div>
        </div>

        {brief.state === 'ready' ? (
          <>
            <p className="mt-4 max-w-[68ch] text-[19px] leading-[1.55]">{brief.content.summary}</p>
            <div className="mt-6 grid gap-8 md:grid-cols-2">
              {brief.content.priorities.length ? (
                <div>
                  <h3 className="text-[14px] font-semibold opacity-90">Do these first</h3>
                  <ol className="mt-2 space-y-2 text-[15px] leading-snug">
                    {brief.content.priorities.map((p, i) => (
                      <li key={i} className="flex gap-3">
                        <span className="mt-[1px] flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-ink/15 text-[12px] font-semibold tabular">
                          {i + 1}
                        </span>
                        <span>{p}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}
              {brief.content.strategies.length ? (
                <div>
                  <h3 className="text-[14px] font-semibold opacity-90">Ideas for today</h3>
                  <ul className="mt-2 space-y-3 text-[15px] leading-snug">
                    {brief.content.strategies.map((s, i) => (
                      <li key={i}>
                        <p className="font-semibold">{s.title}</p>
                        <p className="opacity-90">{s.why}</p>
                        <p className="mt-0.5 opacity-90">Try: {s.action}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
            {brief.content.social.length || brief.content.trends.length ? (
              <div className="mt-6 grid gap-8 border-t border-accent-ink/20 pt-5 md:grid-cols-2">
                {brief.content.social.length ? (
                  <div>
                    <h3 className="text-[14px] font-semibold opacity-90">Social media</h3>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-[14.5px]">
                      {brief.content.social.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {brief.content.trends.length ? (
                  <div>
                    <h3 className="text-[14px] font-semibold opacity-90">Trends to watch</h3>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-[14.5px]">
                      {brief.content.trends.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
            <p className="mt-5 text-[12.5px] opacity-90">
              Suggestions, not facts — check before acting. Built from your tasks, leads, campaigns,
              Instagram, calendar and email subjects.
            </p>
          </>
        ) : brief.state === 'empty' ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
            <p className="max-w-[60ch] text-[16px] leading-relaxed opacity-90">
              Get a short read on your day: what to do first, fresh marketing ideas, and what’s moving on
              social media.
              {brief.demo ? ' (Sample mode — written by rules, not AI.)' : ''}
            </p>
            <ActionButton
              action={generateBriefAction}
              size="md"
              variant="secondary"
              successMessage="Your brief is ready"
            >
              Write today’s brief
            </ActionButton>
          </div>
        ) : (
          <p className="mt-3 max-w-[60ch] text-[16px] leading-relaxed opacity-90">
            Your daily brief appears here once the AI assistant is connected.{' '}
            {brief.canConfigure ? (
              <Link href="/settings/integrations" className="font-semibold underline underline-offset-2">
                Connect it in Settings
              </Link>
            ) : (
              'Ask an administrator to connect it.'
            )}
          </p>
        )}
      </section>

      {exec && glance ? (
        <Link
          href="/dashboard"
          className="mb-6 flex flex-wrap items-baseline gap-x-8 gap-y-1 rounded-xl border border-line bg-surface px-5 py-3.5 hover:border-line-strong"
        >
          <span className="text-[14px] text-muted">Last 30 days</span>
          <span className="tabular">
            <b className="text-[17px] font-semibold">{formatNumber(glance.leads.cur.total)}</b>{' '}
            <span className="text-muted">leads</span>
          </span>
          <span className="tabular">
            <b className="text-[17px] font-semibold">
              {formatMoney(glance.campaigns.cur.cplMinor, org.currency)}
            </b>{' '}
            <span className="text-muted">
              per lead{glance.campaigns.demoCampaigns > 0 ? ' (sample)' : ''}
            </span>
          </span>
          <span className="tabular">
            <b className="text-[17px] font-semibold">
              {formatMoney(glance.pipeline.wonValue, org.currency, { compact: true })}
            </b>{' '}
            <span className="text-muted">won</span>
          </span>
          <span className="ml-auto text-[14px] font-medium text-accent">Open executive dashboard</span>
        </Link>
      ) : null}

      {/* Row 1: the day */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Section
          title="Today’s schedule"
          aside={google.state === 'ready' && google.demo ? <DemoTag /> : undefined}
        >
          {schedule.length ? (
            <ol className="relative ml-[5px] border-l-2 border-line">
              {schedule.map((s) => {
                const past = !s.allDay && Date.parse(s.end ?? s.start ?? '') < now.getTime();
                const current = nextUp?.key === s.key;
                return (
                  <li key={s.key} className={cn('relative pb-4 pl-5 last:pb-0', past && 'opacity-55')}>
                    <span
                      aria-hidden
                      className={cn(
                        'absolute top-[5px] -left-[7px] h-3 w-3 rounded-full border-2 border-surface',
                        current ? 'bg-accent' : 'bg-line-strong',
                      )}
                    />
                    <p className="text-[13px] text-muted tabular">
                      {s.allDay ? 'All day' : `${t(s.start)}${s.end ? ` – ${t(s.end)}` : ''}`}
                    </p>
                    {s.href && !s.href.startsWith('http') ? (
                      <Link href={s.href} className="font-medium hover:underline">
                        {s.title}
                      </Link>
                    ) : s.href ? (
                      <a
                        href={s.href}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="font-medium hover:underline"
                      >
                        {s.title}
                      </a>
                    ) : (
                      <p className="font-medium">{s.title}</p>
                    )}
                    {s.join ? (
                      <a
                        href={s.join}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="mt-0.5 block text-[13px] font-medium text-accent hover:underline"
                      >
                        Join {s.where ?? 'call'}
                      </a>
                    ) : s.where ? (
                      <p className="text-[13px] text-muted">{s.where}</p>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          ) : (
            <Quiet>Nothing scheduled today.</Quiet>
          )}
          <GoogleFooter google={google} purpose="calendar" />
        </Section>

        <Section
          title="Tasks"
          aside={
            <Link href="/tasks?view=mine" className="text-accent hover:underline">
              All my tasks
            </Link>
          }
        >
          <div
            className={cn('mb-3 h-2 rounded-full bg-surface-2', !cp.progress.total && 'hidden')}
            aria-hidden
          >
            <div
              className="h-2 rounded-full bg-accent"
              style={{ width: `${cp.progress.total ? (cp.progress.done / cp.progress.total) * 100 : 0}%` }}
            />
          </div>
          {home.tasks.length ? (
            <ul className="-mx-2">
              {home.tasks.map((task) => {
                const late = !!task.dueAt && task.dueAt < now;
                return (
                  <li
                    key={task.id}
                    className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-2"
                  >
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/tasks/${task.id}`}
                        className="block truncate text-[14.5px] hover:underline"
                      >
                        {task.title}
                      </Link>
                      <p className={cn('truncate text-[12.5px]', late ? 'text-bad' : 'text-muted')}>
                        {late ? 'Overdue, ' : 'Due '}
                        {task.dueAt ? relativeTime(task.dueAt) : ''}
                        {task.status === 'blocked' ? ', blocked' : ''}
                      </p>
                    </div>
                    {task.status !== 'blocked' ? (
                      <ActionButton
                        action={taskStatusAction}
                        hidden={{ id: task.id, status: 'done' }}
                        successMessage="Task done"
                      >
                        Done
                      </ActionButton>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <Quiet>{cp.progress.done ? 'All done for today. Nice work.' : 'No tasks due today.'}</Quiet>
          )}
          {queue.length ? (
            <Link
              href="/approvals"
              className="mt-3 block rounded-lg bg-warn-soft px-3 py-2 text-[13.5px] hover:underline"
            >
              {queue.length} item{queue.length === 1 ? '' : 's'} waiting for your approval
            </Link>
          ) : null}
          {!submitted.length ? (
            <Link href="/reports/daily" className="mt-3 block text-[13.5px] text-accent hover:underline">
              Write today’s update
            </Link>
          ) : null}
        </Section>

        <Section
          title="Calls to make"
          aside={
            home.leads.length > cp.calls.length ? (
              <Link href="/leads?view=mine" className="text-accent hover:underline">
                My leads
              </Link>
            ) : undefined
          }
        >
          {cp.calls.length ? (
            <ul className="-mx-2">
              {cp.calls.map((c) => {
                const late = !!c.nextActionAt && c.nextActionAt < now;
                return (
                  <li key={c.id} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-2">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/leads/${c.id}`}
                        className="block truncate text-[14.5px] font-medium hover:underline"
                      >
                        {c.name}
                      </Link>
                      <p className={cn('truncate text-[12.5px]', late ? 'text-bad' : 'text-muted')}>
                        {c.stage === 'new'
                          ? 'First call'
                          : `${c.nextAction ?? 'Follow up'}${c.nextActionAt ? `, ${relativeTime(c.nextActionAt)}` : ''}`}
                      </p>
                    </div>
                    <a
                      href={`tel:${c.phone}`}
                      className="shrink-0 rounded-md border border-line-strong px-2.5 py-1 text-[13px] font-medium tabular hover:bg-surface-2"
                      aria-label={`Call ${c.name}`}
                    >
                      Call
                    </a>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Quiet>No calls waiting. New leads with a phone number will show up here.</Quiet>
          )}
        </Section>
      </div>

      {/* Row 2: what's come in */}
      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Section
          title="Inbox"
          aside={
            google.state === 'ready' ? (
              <span className="flex items-center gap-2">
                {google.demo ? <DemoTag /> : null}
                {google.unreadCount != null ? `${google.unreadCount} unread` : null}
              </span>
            ) : undefined
          }
        >
          {google.state === 'ready' ? (
            google.recent.length ? (
              <ul className="-mx-2">
                {google.recent.slice(0, 5).map((m) => (
                  <li key={m.id}>
                    <a
                      href={m.link}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="block rounded-lg px-2 py-2 hover:bg-surface-2"
                    >
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={cn('truncate text-[14px]', m.unread && 'font-semibold')}>
                          {m.from}
                        </span>
                        <span className="shrink-0 text-[12px] text-faint">{m.date ? t(m.date) : ''}</span>
                      </span>
                      <span className="block truncate text-[13.5px]">{m.subject}</span>
                      <span className="block truncate text-[12.5px] text-muted">{m.snippet}</span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <Quiet>No new mail in the last day.</Quiet>
            )
          ) : null}
          <GoogleFooter google={google} purpose="inbox" />
        </Section>

        <Section
          title="LinkedIn messages"
          aside={google.state === 'ready' && google.demo ? <DemoTag /> : undefined}
        >
          {google.state === 'ready' ? (
            google.linkedin.length ? (
              <ul className="-mx-2">
                {google.linkedin.map((m) => (
                  <li key={m.id}>
                    <a
                      href={m.link}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="block rounded-lg px-2 py-2 hover:bg-surface-2"
                    >
                      <span className="block truncate text-[14px] font-medium">{m.subject}</span>
                      <span className="block truncate text-[12.5px] text-muted">{m.snippet}</span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <Quiet>No LinkedIn messages in the last 3 days.</Quiet>
            )
          ) : (
            <Quiet>Shown from LinkedIn’s email alerts once Google is connected.</Quiet>
          )}
          <p className="mt-2 text-[12px] text-faint">
            LinkedIn doesn’t let apps read your inbox, so these come from the message alerts LinkedIn emails
            you.
          </p>
        </Section>

        <Section title="Instagram today" aside={ig.state === 'ready' && ig.demo ? <DemoTag /> : undefined}>
          {ig.state === 'ready' ? (
            <>
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
                <div>
                  <p className="text-[26px] leading-none font-semibold tabular">
                    {ig.followers == null ? 'Unavailable' : formatNumber(ig.followers)}
                  </p>
                  <p className="mt-1 text-[13px] text-muted">
                    followers
                    {ig.followerChange != null ? (
                      <span
                        className={cn('ml-1.5 font-medium', ig.followerChange >= 0 ? 'text-ok' : 'text-bad')}
                      >
                        {ig.followerChange >= 0 ? '+' : ''}
                        {formatNumber(ig.followerChange)} since yesterday
                      </span>
                    ) : null}
                  </p>
                </div>
                <div>
                  <p className="text-[18px] leading-none font-semibold tabular">{ig.postsLast24h}</p>
                  <p className="mt-1 text-[13px] text-muted">posts in 24h</p>
                </div>
                <div>
                  <p className="text-[18px] leading-none font-semibold tabular">
                    {ig.engagementRecent == null ? 'Unavailable' : formatNumber(ig.engagementRecent)}
                  </p>
                  <p className="mt-1 text-[13px] text-muted">avg likes + comments</p>
                </div>
              </div>
              {ig.top ? (
                <div className="mt-4 rounded-lg bg-surface-2 px-3 py-2.5">
                  <p className="text-[12.5px] text-muted">Best recent post</p>
                  <p className="mt-0.5 line-clamp-2 text-[14px]">{ig.top.caption ?? 'Untitled post'}</p>
                  <p className="mt-1 text-[12.5px] text-muted tabular">
                    {formatNumber(ig.top.likes ?? 0)} likes, {formatNumber(ig.top.comments ?? 0)} comments
                  </p>
                </div>
              ) : null}
              {ig.username ? <p className="mt-3 text-[12.5px] text-faint">@{ig.username}</p> : null}
            </>
          ) : ig.state === 'error' ? (
            <Quiet>Instagram didn’t respond: {ig.message}</Quiet>
          ) : (
            <Quiet>
              {ig.reason}{' '}
              {ig.canConfigure ? (
                <Link href="/settings/integrations" className="font-medium text-accent hover:underline">
                  Connect Instagram
                </Link>
              ) : (
                'Ask an administrator to connect it.'
              )}
            </Quiet>
          )}
        </Section>
      </div>
    </div>
  );
}

/** Connection state and actions for the person's own Google account. */
function GoogleFooter({
  google,
  purpose,
}: {
  google: Awaited<ReturnType<typeof googleBlock>>;
  purpose: 'calendar' | 'inbox';
}) {
  if (google.state === 'ready')
    return purpose === 'inbox' && !google.demo ? (
      <div className="mt-3 flex items-center justify-between gap-2 text-[12px] text-faint">
        <span className="truncate">{google.email ? `Connected as ${google.email}` : 'Google connected'}</span>
        <ActionButton
          action={disconnectGoogleAction}
          variant="ghost"
          confirm="Disconnect your Google account from Sahynex OS?"
        >
          Disconnect
        </ActionButton>
      </div>
    ) : null;
  if (google.state === 'not_connected')
    return (
      <div className="mt-2">
        <Quiet>{purpose === 'inbox' ? 'See new mail at a glance.' : 'Bring in your Google Calendar.'}</Quiet>
        <a
          href="/api/google/connect"
          className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-[13px] font-medium text-accent-ink"
        >
          Connect Google
        </a>
        <p className="mt-2 text-[12px] text-faint">
          Read-only. Sahynex OS never sends, deletes or changes anything.
        </p>
      </div>
    );
  if (google.state === 'error')
    return (
      <div className="mt-2">
        <Quiet>Google stopped responding: {google.message}</Quiet>
        <a href="/api/google/connect" className="text-[13px] font-medium text-accent hover:underline">
          Reconnect Google
        </a>
      </div>
    );
  return (
    <Quiet>
      {google.reason}{' '}
      {google.canConfigure ? (
        <Link href="/settings/integrations" className="font-medium text-accent hover:underline">
          Set it up
        </Link>
      ) : null}
    </Quiet>
  );
}
