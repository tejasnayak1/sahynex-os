import { Suspense } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Handshake,
  IndianRupee,
  Instagram,
  Linkedin,
  ListPlus,
  Mail,
  MapPin,
  Phone,
  SquareCheckBig,
  TrendingUp,
  UserPlus,
  Users,
  Video,
} from 'lucide-react';
import { ActionButton } from '@/components/client/auto-submit';
import { cn } from '@/components/ui';
import { db, schema } from '@/db';
import { formatDate, formatMoney, formatNumber, relativeTime, todayIn } from '@/lib/format';
import { can } from '@/server/actor';
import { requireActor } from '@/server/auth/current';
import { briefBlock, callsAndProgress, googleBlock, instagramBlock } from '@/server/services/briefing';
import { upcomingRenewals } from '@/server/services/clients';
import { executiveDashboard, homeToday } from '@/server/services/dashboard';
import { approvalQueue } from '@/server/services/deliverables';
import { getOrg } from '@/server/services/org';
import { disconnectGoogleAction } from './actions';
import { DailyBriefingCard, IntelCard, IntelCardSkeleton, type Alert } from './briefing-sections';
import { RowMenu, TaskCheck } from './home-client';

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
    ? new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: tz })
        .format(new Date(d))
        .toUpperCase()
    : '';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const AVATAR_TONES = [
  'bg-[#cdeee9] text-[#126b63]',
  'bg-[#dcdcfb] text-[#4b4bb5]',
  'bg-[#d6e8fb] text-[#2b5f9e]',
  'bg-[#f7dfe9] text-[#a33a68]',
  'bg-[#fbecd3] text-[#94600f]',
];
function initials(name: string) {
  return (
    name
      .replace(/\(.*\)|DEMO ·/g, '')
      .trim()
      .split(/\s+/)
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?'
  );
}
function Avatar({ name, className }: { name: string; className?: string }) {
  const tone = AVATAR_TONES[[...name].reduce((s, c) => s + c.charCodeAt(0), 0) % AVATAR_TONES.length];
  return (
    <span
      aria-hidden
      className={cn(
        'grid h-11 w-11 shrink-0 place-items-center rounded-full text-[14px] font-semibold',
        tone,
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

function Card({
  id,
  icon,
  title,
  badge,
  action,
  children,
  className,
}: {
  id?: string;
  icon: React.ReactNode;
  title: string;
  badge?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={cn(
        'flex min-w-0 scroll-mt-24 flex-col rounded-2xl border border-line bg-surface',
        className,
      )}
    >
      <header className="flex items-center gap-3 px-5 pt-4 pb-3">
        <span className="text-accent">{icon}</span>
        <h2 className="text-[17px] font-semibold">{title}</h2>
        {badge}
        <div className="ml-auto text-[14px]">{action}</div>
      </header>
      <div className="flex-1 px-3 pb-3">{children}</div>
    </section>
  );
}

function ViewAll({
  href,
  children = 'View all',
  external,
}: {
  href: string;
  children?: React.ReactNode;
  external?: boolean;
}) {
  const cls = 'inline-flex items-center gap-1.5 font-medium text-accent hover:underline';
  return external ? (
    <a href={href} target="_blank" rel="noreferrer noopener" className={cls}>
      {children} <ArrowRight size={15} aria-hidden />
    </a>
  ) : (
    <Link href={href} className={cls}>
      {children} <ArrowRight size={15} aria-hidden />
    </Link>
  );
}

function Quiet({ children }: { children: React.ReactNode }) {
  return <p className="px-2 py-3 text-[14px] text-muted">{children}</p>;
}

function DemoTag() {
  return (
    <span className="rounded-full bg-demo-soft px-2 py-0.5 text-[11.5px] font-medium text-demo">
      Sample data
    </span>
  );
}

const Row = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <li className={cn('flex items-center gap-3 rounded-xl bg-surface-2/70 px-3 py-2.5', className)}>
    {children}
  </li>
);

const PRIORITY_PILL: Record<string, string> = {
  urgent: 'bg-bad-soft text-bad',
  high: 'bg-bad-soft text-bad',
  medium: 'bg-warn-soft text-warn',
  low: 'bg-ok-soft text-ok',
};
const DOTS = ['bg-[#4f8cff]', 'bg-[#a66bff]', 'bg-[#4fd08f]', 'bg-[#f0b860]'];

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
  const today = todayIn(tz);
  const [home, brief, google, ig, cp, queue, glance, submitted, renewals] = await Promise.all([
    homeToday(actor),
    briefBlock(actor),
    googleBlock(actor),
    instagramBlock(actor),
    callsAndProgress(actor),
    approvalQueue(actor),
    exec
      ? executiveDashboard(actor, {
          from: new Date(Date.parse(today) - 29 * 86_400_000).toISOString().slice(0, 10),
          to: today,
        })
      : Promise.resolve(null),
    db
      .select({ id: schema.dailyReports.id })
      .from(schema.dailyReports)
      .where(and(eq(schema.dailyReports.userId, actor.id), eq(schema.dailyReports.reportDate, today))),
    can(actor, 'clients.read.all') || can(actor, 'clients.read.assigned')
      ? upcomingRenewals(actor, 30)
      : Promise.resolve([]),
  ]);
  if (!home) redirect('/dashboard');
  const now = new Date();
  const dateLabel = new Intl.DateTimeFormat('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
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
    })),
  ].sort((a, b) => (a.allDay ? -1 : b.allDay ? 1 : Date.parse(a.start ?? '') - Date.parse(b.start ?? '')));
  const nextUp = schedule.find((s) => !s.allDay && s.start && Date.parse(s.end ?? s.start) > now.getTime());

  const { overdue, dueToday } = home.taskCounts;
  const due = dueToday + overdue;
  const highCount = home.tasks.filter((x) => x.priority === 'high' || x.priority === 'urgent').length;
  const unread = google.state === 'ready' ? google.unreadCount : null;

  const showIntel = can(actor, 'campaigns.read') || exec;
  const blockedCount = home.tasks.filter((x) => x.status === 'blocked').length;
  const alerts: Alert[] = [
    overdue ? { tone: 'bad', text: `${plural(overdue, 'overdue task')}`, href: '/tasks?view=mine' } : null,
    blockedCount
      ? { tone: 'warn', text: `${plural(blockedCount, 'blocked task')}`, href: '/tasks?view=mine' }
      : null,
    queue.length
      ? {
          tone: 'warn',
          text: `${plural(queue.length, 'item')} waiting for your approval`,
          href: '/approvals',
        }
      : null,
    ...renewals.slice(0, 2).map(
      (r): Alert => ({
        tone: 'info',
        text: `${r.name} renews ${r.renewalDate ? formatDate(r.renewalDate) : 'soon'}`,
        href: `/clients/${r.id}`,
      }),
    ),
    !submitted.length
      ? { tone: 'muted', text: 'Today’s update not written yet', href: '/reports/daily' }
      : null,
  ].filter(Boolean) as Alert[];
  const urgent = overdue + blockedCount + queue.length;

  const summaryParts = [
    plural(schedule.length, 'meeting'),
    `${due} task${due === 1 ? '' : 's'} due`,
    unread != null ? `${formatNumber(unread)} new email${unread === 1 ? '' : 's'}` : null,
  ].filter(Boolean) as string[];
  const computedSummary = `${summaryParts.join(', ')} and ${urgent ? `${plural(urgent, 'item')} needing attention` : 'no urgent issues'}.`;

  const googleNotice: Record<string, string> = {
    connected: 'Google connected. Your inbox and calendar now appear here.',
    cancelled: 'Google connection cancelled — nothing was connected.',
    invalid: 'That Google sign-in link expired. Try connecting again.',
    failed:
      'Google didn’t complete the connection. Try again; if it keeps failing, ask your administrator to check the Google setup.',
    not_configured: 'Google sign-in isn’t set up on this server yet.',
  };
  const gq = typeof sp.google === 'string' ? sp.google : null;

  const quick = [
    can(actor, 'leads.write') && { href: '/leads/new', label: 'New lead', icon: UserPlus },
    can(actor, 'tasks.write') && { href: '/tasks/new', label: 'New task', icon: ListPlus },
    can(actor, 'deals.write') && { href: '/deals/new', label: 'New deal', icon: Handshake },
  ].filter(Boolean) as Array<{ href: string; label: string; icon: typeof UserPlus }>;

  const leadsChange =
    glance && glance.leads.prev.total
      ? Math.round(((glance.leads.cur.total - glance.leads.prev.total) / glance.leads.prev.total) * 100)
      : null;

  return (
    <div className="mx-auto max-w-[1480px]">
      {gq && googleNotice[gq] ? (
        <p
          role="status"
          className={cn(
            'mb-5 rounded-xl border px-4 py-2.5 text-[13.5px]',
            gq === 'connected' ? 'border-ok/30 bg-ok-soft' : 'border-warn/30 bg-warn-soft',
          )}
        >
          {googleNotice[gq]}
        </p>
      ) : null}

      {/* Greeting */}
      <header className="mb-6 flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-0">
          <h1 className="text-[30px] leading-tight font-semibold tracking-[-0.02em] sm:text-[34px]">
            {greeting(tz)}, {actor.name.replace(/\s*\(.*\)/, '').split(' ')[0]}
          </h1>
          <p className="mt-2 text-[16px] text-ink-2">
            Today you have{' '}
            <a
              href="#schedule"
              className="text-accent underline decoration-accent/40 underline-offset-4 hover:decoration-accent"
            >
              {plural(schedule.length, 'meeting')}
            </a>{' '}
            on your calendar and{' '}
            <a
              href="#tasks"
              className="text-accent underline decoration-accent/40 underline-offset-4 hover:decoration-accent"
            >
              {due} task{due === 1 ? '' : 's'} due
            </a>
            {cp.calls.length ? (
              <>
                , with{' '}
                <a
                  href="#calls"
                  className="text-accent underline decoration-accent/40 underline-offset-4 hover:decoration-accent"
                >
                  {plural(cp.calls.length, 'call')}
                </a>{' '}
                to make
              </>
            ) : null}
            .
          </p>
        </div>
        <div className="flex flex-col items-start gap-3 sm:items-end">
          <p className="text-[14px] text-muted">{dateLabel}</p>
          {quick.length ? (
            <div className="flex flex-wrap gap-2">
              {quick.map((q) => (
                <Link
                  key={q.href}
                  href={q.href}
                  className="inline-flex h-10 items-center gap-2 rounded-lg border border-accent/25 bg-accent-soft/60 px-3.5 text-[14px] font-medium text-ink transition-colors hover:border-accent/60"
                >
                  <q.icon size={16} aria-hidden className="text-accent" /> {q.label}
                </Link>
              ))}
            </div>
          ) : null}
        </div>
      </header>

      {/* Daily briefing + marketing intelligence */}
      <div className={cn('mb-5 grid gap-5', showIntel && 'xl:grid-cols-2')}>
        <DailyBriefingCard
          brief={brief}
          dateLabel={dateLabel}
          summary={brief.state === 'ready' ? brief.content.summary : computedSummary}
          stats={[
            {
              icon: 'calendar',
              value: String(schedule.length),
              label: schedule.length === 1 ? 'Meeting today' : 'Meetings today',
              sub: nextUp
                ? `Next at ${t(nextUp.start).toLowerCase()}`
                : schedule.length
                  ? 'All done'
                  : 'Clear calendar',
              href: '#schedule',
            },
            {
              icon: 'tasks',
              value: String(due),
              label: 'Tasks due',
              sub: overdue ? `${overdue} overdue` : highCount ? `${highCount} high priority` : 'On track',
              href: '#tasks',
            },
            {
              icon: 'mail',
              value: unread == null ? '—' : formatNumber(unread),
              label: 'Unread emails',
              sub: unread == null ? 'Connect Google' : 'in your inbox',
              href: '#inbox',
            },
            {
              icon: 'phone',
              value: String(cp.calls.length),
              label: 'Calls pending',
              sub: cp.calls.length ? 'waiting for you' : 'All caught up!',
              href: '#calls',
            },
          ]}
          alerts={alerts}
          t={t}
        />
        {showIntel ? (
          <Suspense fallback={<IntelCardSkeleton />}>
            <IntelCard brief={brief} tz={tz} />
          </Suspense>
        ) : null}
      </div>

      {exec && glance ? (
        <div className="mb-5 flex flex-wrap items-center gap-x-7 gap-y-2 rounded-2xl border border-line bg-surface px-6 py-4 text-[15px]">
          <span className="text-ink-2">Last 30 days</span>
          <span className="hidden h-5 w-px bg-line sm:block" aria-hidden />
          <span className="flex items-center gap-2 tabular">
            <Users size={18} className="text-accent" aria-hidden />
            <b className="text-[18px] font-semibold">{formatNumber(glance.leads.cur.total)}</b>
            <span className="text-muted">leads</span>
          </span>
          <span className="hidden h-5 w-px bg-line sm:block" aria-hidden />
          <span className="flex items-center gap-2 tabular">
            <TrendingUp size={18} className="text-accent" aria-hidden />
            <b className="text-[18px] font-semibold">
              {glance.campaigns.cur.cplMinor == null
                ? '—'
                : formatMoney(glance.campaigns.cur.cplMinor, org.currency)}
            </b>
            <span className="text-muted">
              per lead{glance.campaigns.demoCampaigns > 0 ? ' (sample)' : ''}
            </span>
          </span>
          <span className="hidden h-5 w-px bg-line sm:block" aria-hidden />
          <span className="flex items-center gap-2 tabular">
            <IndianRupee size={18} className="text-accent" aria-hidden />
            <b className="text-[18px] font-semibold">
              {formatMoney(glance.pipeline.wonValue, org.currency, { compact: true }).replace('₹', '')}
            </b>
            <span className="text-muted">won</span>
          </span>
          <span className="hidden h-5 w-px bg-line sm:block" aria-hidden />
          <span className="flex items-center gap-2 tabular">
            <ArrowUpRight size={18} className="text-accent" aria-hidden />
            <b className="text-[18px] font-semibold">
              {leadsChange == null ? '—' : `${leadsChange > 0 ? '+' : ''}${leadsChange}%`}
            </b>
            <span className="text-muted">leads vs previous 30 days</span>
          </span>
          <Link
            href="/dashboard"
            className="ml-auto inline-flex items-center gap-1.5 font-medium text-accent hover:underline"
          >
            Open executive dashboard <ArrowRight size={16} aria-hidden />
          </Link>
        </div>
      ) : null}

      {/* Row 1: the day */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card
          id="schedule"
          icon={<CalendarDays size={24} strokeWidth={1.7} />}
          title="Today’s schedule"
          badge={google.state === 'ready' && google.demo ? <DemoTag /> : undefined}
          action={
            google.state === 'ready' && !google.demo ? (
              <ViewAll href="https://calendar.google.com/calendar/r/day" external>
                View calendar
              </ViewAll>
            ) : (
              <ViewAll href="/tasks?view=calendar">View calendar</ViewAll>
            )
          }
        >
          {schedule.length ? (
            <ul className="space-y-2">
              {schedule.map((s, i) => {
                const past = !s.allDay && Date.parse(s.end ?? s.start ?? '') < now.getTime();
                const external = !!s.href && s.href.startsWith('http');
                return (
                  <Row key={s.key} className={cn(nextUp?.key === s.key && 'ring-1 ring-accent/50')}>
                    <span
                      aria-hidden
                      className={cn(
                        'h-2.5 w-2.5 shrink-0 rounded-full',
                        past ? 'bg-faint' : DOTS[i % DOTS.length],
                      )}
                    />
                    <span className="w-[86px] shrink-0 rounded-lg bg-surface px-2 py-1.5 text-center text-[14px] font-semibold tabular">
                      {s.allDay ? 'All day' : t(s.start)}
                    </span>
                    <div className="min-w-0 flex-1">
                      {s.href && !external ? (
                        <Link
                          href={s.href}
                          className="block truncate text-[15px] font-medium hover:underline"
                        >
                          {s.title}
                        </Link>
                      ) : s.href ? (
                        <a
                          href={s.href}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="block truncate text-[15px] font-medium hover:underline"
                        >
                          {s.title}
                        </a>
                      ) : (
                        <p className="truncate text-[15px] font-medium">{s.title}</p>
                      )}
                      {s.where ? (
                        <p className="mt-0.5 flex items-center gap-1 truncate text-[13px] text-muted">
                          <MapPin size={13} aria-hidden /> {s.where}
                        </p>
                      ) : null}
                    </div>
                    {s.join && !past ? (
                      <a
                        href={s.join}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-line-strong px-2.5 py-1 text-[13px] font-medium hover:border-accent"
                      >
                        <Video size={14} aria-hidden /> Join
                      </a>
                    ) : null}
                    <RowMenu
                      label={`More for ${s.title}`}
                      items={[
                        { label: external ? 'Open in Google Calendar' : 'Open', href: s.href ?? undefined },
                        { label: 'Copy join link', copy: s.join ?? undefined },
                      ]}
                    />
                  </Row>
                );
              })}
            </ul>
          ) : (
            <Quiet>Nothing scheduled today.</Quiet>
          )}
          <GoogleFooter google={google} purpose="calendar" />
        </Card>

        <Card
          id="tasks"
          icon={<SquareCheckBig size={24} strokeWidth={1.7} />}
          title="Tasks"
          badge={
            cp.progress.total ? (
              <span className="text-[13px] text-muted tabular">
                {cp.progress.done}/{cp.progress.total} done today
              </span>
            ) : undefined
          }
          action={<ViewAll href="/tasks?view=mine">All my tasks</ViewAll>}
        >
          {home.tasks.length ? (
            <ul className="space-y-1">
              {home.tasks.map((task) => {
                const dueDay = task.dueAt ? todayIn(tz, task.dueAt) : null;
                const late = !!task.dueAt && task.dueAt < now && dueDay !== today;
                const label = late
                  ? 'Overdue'
                  : dueDay === today
                    ? 'Today'
                    : dueDay
                      ? formatDate(dueDay)
                      : 'No date';
                return (
                  <li
                    key={task.id}
                    className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-surface-2/70"
                  >
                    {task.status === 'blocked' ? (
                      <span className="h-5 w-5 shrink-0" aria-hidden />
                    ) : (
                      <TaskCheck id={task.id} title={task.title} />
                    )}
                    <Link
                      href={`/tasks/${task.id}`}
                      className="min-w-0 flex-1 truncate text-[15px] hover:underline"
                    >
                      {task.title}
                    </Link>
                    {task.status === 'blocked' ? (
                      <span className="rounded-md bg-bad-soft px-2 py-1 text-[12px] font-medium text-bad">
                        Blocked
                      </span>
                    ) : (
                      <span
                        className={cn(
                          'rounded-md px-2 py-1 text-[12px] font-medium capitalize',
                          PRIORITY_PILL[task.priority] ?? PRIORITY_PILL.medium,
                        )}
                      >
                        {task.priority}
                      </span>
                    )}
                    <span
                      className={cn(
                        'w-[78px] shrink-0 rounded-md px-2 py-1 text-center text-[12px] font-medium',
                        late ? 'bg-bad-soft text-bad' : 'bg-surface-2 text-ink-2',
                      )}
                    >
                      {label}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Quiet>{cp.progress.done ? 'All done for today. Nice work.' : 'No tasks due today.'}</Quiet>
          )}
        </Card>

        <Card
          id="calls"
          icon={<Phone size={24} strokeWidth={1.7} />}
          title="Calls to make"
          action={<ViewAll href="/leads?view=mine" />}
        >
          {cp.calls.length ? (
            <ul className="space-y-2">
              {cp.calls.map((c) => {
                const late = !!c.nextActionAt && c.nextActionAt < now;
                const what =
                  c.stage === 'new'
                    ? `New lead${c.interest ? ` · ${c.interest}` : ''}`
                    : `${c.nextAction ?? 'Follow up'}${c.interest ? ` · ${c.interest}` : ''}`;
                return (
                  <Row key={c.id}>
                    <Avatar name={c.name} />
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/leads/${c.id}`}
                        className="block truncate text-[15px] font-semibold hover:underline"
                      >
                        {c.name}
                      </Link>
                      <p className={cn('truncate text-[13px]', late ? 'text-bad' : 'text-muted')}>
                        {what}
                        {late && c.nextActionAt ? ` · due ${relativeTime(c.nextActionAt)}` : ''}
                      </p>
                    </div>
                    <span className="hidden text-[13.5px] text-ink-2 tabular xl:inline">{c.phone}</span>
                    <a
                      href={`tel:${c.phone}`}
                      aria-label={`Call ${c.name}`}
                      className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent-soft text-accent transition-colors hover:bg-accent hover:text-accent-ink"
                    >
                      <Phone size={17} aria-hidden />
                    </a>
                  </Row>
                );
              })}
            </ul>
          ) : (
            <Quiet>No calls waiting. New leads with a phone number will show up here.</Quiet>
          )}
        </Card>
      </div>

      {/* Row 2: what's come in */}
      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Card
          id="inbox"
          icon={<Mail size={24} strokeWidth={1.7} />}
          title="Inbox"
          badge={
            <>
              {google.state === 'ready' && google.unreadCount != null ? (
                <span className="rounded-full bg-bad-soft px-2.5 py-0.5 text-[12.5px] font-medium text-bad tabular">
                  {formatNumber(google.unreadCount)} unread
                </span>
              ) : null}
              {google.state === 'ready' && google.demo ? <DemoTag /> : null}
            </>
          }
          action={
            google.state === 'ready' ? (
              <ViewAll href="https://mail.google.com/mail/u/0/#inbox" external />
            ) : undefined
          }
        >
          {google.state === 'ready' ? (
            google.recent.length ? (
              <ul className="space-y-2">
                {google.recent.slice(0, 4).map((m) => (
                  <Row key={m.id} className="items-start">
                    <span
                      aria-hidden
                      className={cn(
                        'mt-4 h-2 w-2 shrink-0 rounded-full',
                        m.unread ? 'bg-accent' : 'bg-transparent',
                      )}
                    />
                    <Avatar name={m.from} className="mt-0.5 h-10 w-10 bg-white text-[#1d2a30]" />
                    <a href={m.link} target="_blank" rel="noreferrer noopener" className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span
                          className={cn('truncate text-[14.5px]', m.unread ? 'font-semibold' : 'font-medium')}
                        >
                          {m.from}
                        </span>
                        <span className="shrink-0 text-[12.5px] text-muted">
                          {m.date ? t(m.date).toLowerCase() : ''}
                        </span>
                      </span>
                      <span className="block truncate text-[13.5px]">{m.subject}</span>
                      <span className="block truncate text-[12.5px] text-muted">{m.snippet}</span>
                    </a>
                    <RowMenu
                      label={`More for ${m.subject}`}
                      items={[{ label: 'Open in Gmail', href: m.link }]}
                    />
                  </Row>
                ))}
              </ul>
            ) : (
              <Quiet>No new mail in the last day.</Quiet>
            )
          ) : null}
          <GoogleFooter google={google} purpose="inbox" />
        </Card>

        <Card
          icon={<Linkedin size={24} strokeWidth={1.7} />}
          title="LinkedIn messages"
          badge={google.state === 'ready' && google.demo ? <DemoTag /> : undefined}
          action={<ViewAll href="https://www.linkedin.com/messaging/" external />}
        >
          {google.state === 'ready' ? (
            google.linkedin.length ? (
              <ul className="space-y-2">
                {google.linkedin.slice(0, 4).map((m) => {
                  const parsed = parseLinkedIn(m.subject);
                  return (
                    <Row key={m.id} className="items-start">
                      <Avatar name={parsed.name} className="mt-0.5" />
                      <a href={m.link} target="_blank" rel="noreferrer noopener" className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-[14.5px] font-semibold">{parsed.name}</span>
                          <span className="shrink-0 text-[12.5px] text-muted">
                            {m.date ? relativeTime(new Date(m.date)) : ''}
                          </span>
                        </span>
                        <span className="block truncate text-[13.5px] text-accent">{parsed.kind}</span>
                        <span className="block truncate text-[12.5px] text-muted">{m.snippet}</span>
                      </a>
                      <RowMenu
                        label={`More for ${m.subject}`}
                        items={[{ label: 'Open the alert email', href: m.link }]}
                      />
                    </Row>
                  );
                })}
              </ul>
            ) : (
              <Quiet>No LinkedIn messages in the last 3 days.</Quiet>
            )
          ) : (
            <Quiet>Shown from LinkedIn’s email alerts once Google is connected.</Quiet>
          )}
          <p className="px-2 pt-2 text-[12px] text-faint">
            From the message alerts LinkedIn emails you — LinkedIn doesn’t let apps read your inbox.
          </p>
        </Card>

        <Card
          icon={<Instagram size={24} strokeWidth={1.7} />}
          title="Instagram today"
          badge={ig.state === 'ready' && ig.demo ? <DemoTag /> : undefined}
          action={
            ig.state === 'ready' && ig.username && !ig.demo ? (
              <ViewAll href={`https://www.instagram.com/${ig.username}/`} external />
            ) : undefined
          }
        >
          {ig.state === 'ready' ? (
            <>
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2 2xl:grid-cols-4">
                <Stat value={ig.followers == null ? '—' : formatNumber(ig.followers)} label="Followers" />
                <Stat
                  value={
                    ig.followerChange == null || !ig.prevFollowers
                      ? '—'
                      : `${ig.followerChange >= 0 ? '↑' : '↓'} ${Math.abs((ig.followerChange / ig.prevFollowers) * 100).toFixed(1)}%`
                  }
                  label="from yesterday"
                  tone={ig.followerChange == null ? undefined : ig.followerChange >= 0 ? 'ok' : 'bad'}
                />
                <Stat value={`${ig.monthPosts}${ig.monthPostsCapped ? '+' : ''}`} label="Posts this month" />
                <Stat
                  value={ig.recentLikes == null ? '—' : formatNumber(ig.recentLikes)}
                  label="Likes, recent posts"
                />
              </dl>
              {ig.recent.length ? (
                <>
                  <p className="mt-4 mb-2 px-2 text-[14px] font-semibold">Recent posts</p>
                  <ul className="space-y-2">
                    {ig.recent.slice(0, 3).map((m) => (
                      <Row key={m.id}>
                        {m.thumb ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={m.thumb}
                            alt=""
                            className="h-12 w-12 shrink-0 rounded-lg object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <span
                            aria-hidden
                            className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-[linear-gradient(135deg,#feda75,#d62976,#4f5bd5)] text-white"
                          >
                            <Instagram size={18} />
                          </span>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[14.5px] font-medium">{m.caption ?? 'Untitled post'}</p>
                          <p className="text-[12.5px] text-muted tabular">
                            {m.likes == null ? '—' : formatNumber(m.likes)} likes ·{' '}
                            {m.comments == null ? '—' : formatNumber(m.comments)} comments
                          </p>
                        </div>
                        <span className="hidden shrink-0 text-[12.5px] text-muted sm:inline">
                          {relativeTime(new Date(m.timestamp))}
                        </span>
                        <RowMenu
                          label="More for this post"
                          items={[{ label: 'Open on Instagram', href: m.permalink ?? undefined }]}
                        />
                      </Row>
                    ))}
                  </ul>
                </>
              ) : null}
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
        </Card>
      </div>
    </div>
  );
}

function Stat({ value, label, tone }: { value: string; label: string; tone?: 'ok' | 'bad' }) {
  return (
    <div className="rounded-xl bg-surface-2/70 px-3 py-2.5">
      <dd
        className={cn(
          'text-[20px] leading-tight font-semibold tabular',
          tone === 'ok' && 'text-ok',
          tone === 'bad' && 'text-bad',
        )}
      >
        {value}
      </dd>
      <dt className="text-[12.5px] text-muted">{label}</dt>
    </div>
  );
}

/** "Rahul Shenoy sent you a message" → { name, kind }. Falls back to the subject itself. */
function parseLinkedIn(subject: string) {
  const s = subject.replace(/^DEMO · /, '');
  const patterns: Array<[RegExp, string]> = [
    [/^(.+?) sent you a message/i, 'Message'],
    [/^New InMail from (.+)$/i, 'InMail'],
    [/^(.+?) wants to connect/i, 'Connection request'],
    [/^(.+?) accepted your invitation/i, 'Invitation accepted'],
    [/^(.+?) (?:just )?messaged you/i, 'Message'],
  ];
  for (const [re, kind] of patterns) {
    const m = s.match(re);
    if (m) return { name: m[1].trim(), kind };
  }
  return { name: s.split(/[:,]/)[0].slice(0, 40), kind: 'LinkedIn alert' };
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
      <div className="mt-2 flex items-center justify-between gap-2 px-2 text-[12px] text-faint">
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
      <div className="px-2 pt-1">
        <Quiet>{purpose === 'inbox' ? 'See new mail at a glance.' : 'Bring in your Google Calendar.'}</Quiet>
        <a
          href="/api/google/connect"
          className="inline-flex h-9 items-center rounded-lg bg-accent px-3.5 text-[13.5px] font-medium text-accent-ink"
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
      <div className="px-2">
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
