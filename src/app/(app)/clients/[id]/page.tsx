import Link from 'next/link';
import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  ClipboardList,
  FileText,
  FolderOpen,
  Globe,
  Mail,
  MapPin,
  Megaphone,
  NotebookPen,
  Palette,
  Phone,
  Trash2,
  Users,
} from 'lucide-react';
import { ActionButton, InlineSelect } from '@/components/client/auto-submit';
import { MoreMenu } from '@/components/client/more-menu';
import { Badge, LinkButton, StatusBadge, cn } from '@/components/ui';
import { db } from '@/db';
import { formatDate, formatDateTime, formatMoney, humanize, relativeTime, todayIn } from '@/lib/format';
import { can } from '@/server/actor';
import { requirePagePermission } from '@/server/auth/current';
import { teamOptions } from '@/server/services/admin';
import {
  clientActivity,
  clientDocuments,
  clientInvoices,
  clientNotes,
  clientTasks,
  getClient,
  projectProgress,
} from '@/server/services/clients';
import { getOrg } from '@/server/services/org';
import { listReports } from '@/server/services/reports';
import { deleteClientNoteAction, removeContactAction, updateClientAction } from '../actions';
import { AddContact, AddNote, EditClient, EditContact, EditOneBudget } from '../client-form';

export const metadata = { title: 'Client' };

/* One layout for every client. */

const TABS = [
  'overview',
  'projects',
  'tasks',
  'campaigns',
  'reports',
  'finance',
  'documents',
  'activity',
] as const;
type Tab = (typeof TABS)[number];

const TYPE_LABEL: Record<string, string> = {
  admissions_campaign: 'Admissions',
  brand_film: 'Video Production',
  website_build: 'Web Development',
  social_retainer_month: 'Monthly Retainer',
};
const PROJECT_TILE = ['bg-[#7b5cff]', 'bg-[#8a63f2]', 'bg-[#f2783f]', 'bg-[#3fb6d4]', 'bg-[#4fd08f]'];
const AVATAR = [
  'bg-[#efe1ff] text-[#7b3fd6]',
  'bg-[#e1e9ff] text-[#2f4fb8]',
  'bg-[#dff5ef] text-[#146650]',
  'bg-[#ffe7e0] text-[#9a3412]',
];

function initials(name: string) {
  return name
    .replace(/\(.*\)|^(dr|mr|mrs|ms|prof)\.?\s+/gi, '')
    .trim()
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}
const tone = (s: string, list: string[]) =>
  list[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % list.length];

function Card({
  icon,
  title,
  action,
  children,
  className,
}: {
  icon: React.ReactNode;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-2xl border border-line bg-surface', className)}>
      <header className="flex items-center gap-3 border-b border-line px-6 py-4">
        <span className="text-accent">{icon}</span>
        <h2 className="text-[17px] font-semibold">{title}</h2>
        {action ? <div className="ml-auto flex items-center gap-2">{action}</div> : null}
      </header>
      <div className="p-6">{children}</div>
    </section>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-[13.5px] text-muted">{label}</dt>
      <dd className="mt-1.5 text-[15px] break-words text-ink">{children}</dd>
    </div>
  );
}

const Dash = () => <span className="text-faint">—</span>;

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-muted">{children}</p>;
}

export default async function ClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const actor = await requirePagePermission('clients.read.all', 'clients.read.assigned');
  const { id } = await params;
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? '') ? (sp.tab as Tab) : 'overview';
  const d = await getClient(actor, id);
  const org = await getOrg(db, actor.orgId);
  const c = d.client;
  const canWrite = can(actor, 'clients.write');
  const canFinance = can(actor, 'finance.read');
  const [team, progress, notes] = await Promise.all([
    teamOptions(actor.orgId),
    projectProgress(
      actor,
      d.projects.map((p) => p.id),
    ),
    tab === 'overview' ? clientNotes(actor, id) : Promise.resolve([]),
  ]);
  const base = `/clients/${c.id}`;
  const tabs: Array<[Tab, string]> = [
    ['overview', 'Overview'],
    ['projects', 'Projects'],
    ['tasks', 'Tasks'],
    ...(can(actor, 'campaigns.read') ? ([['campaigns', 'Campaigns']] as Array<[Tab, string]>) : []),
    ...(can(actor, 'reports.read') ? ([['reports', 'Reports']] as Array<[Tab, string]>) : []),
    ...(canFinance ? ([['finance', 'Finance']] as Array<[Tab, string]>) : []),
    ['documents', 'Documents'],
    ['activity', 'Activity'],
  ];

  return (
    <div className="mx-auto max-w-[1480px]">
      <nav aria-label="Breadcrumb" className="mb-4 text-[14.5px] text-muted">
        <Link href="/clients" className="hover:text-ink hover:underline">
          Clients
        </Link>{' '}
        / <span className="text-ink-2">{c.name}</span>
      </nav>

      {/* Header */}
      <header className="mb-6 flex flex-wrap items-center gap-5">
        <span
          aria-hidden
          className="grid h-24 w-24 shrink-0 place-items-center rounded-2xl bg-white text-[30px] font-bold tracking-tight text-[#1d4f4a] shadow-[0_6px_20px_rgb(0_0_0/0.25)]"
        >
          {initials(c.name)}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-[32px] leading-tight font-semibold tracking-[-0.02em] sm:text-[38px]">
            {c.name}
          </h1>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[15.5px] text-ink-2">
            <span
              className={cn(
                'rounded-full px-3 py-0.5 text-[14px] font-medium',
                c.status === 'active'
                  ? 'bg-ok-soft text-ok'
                  : c.status === 'churned'
                    ? 'bg-bad-soft text-bad'
                    : 'bg-info-soft text-info',
              )}
            >
              {humanize(c.status)}
            </span>
            <span>{humanize(c.orgType)}</span>
            {c.city ? (
              <>
                <span aria-hidden>·</span>
                <span>{c.city}</span>
              </>
            ) : null}
            {c.isDemo ? <Badge tone="demo">Demo data</Badge> : null}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <MoreMenu label="More client actions">
            {c.website ? (
              <a href={c.website} target="_blank" rel="noopener noreferrer">
                <Globe size={14} aria-hidden /> Open website
              </a>
            ) : null}
            <a href={`${base}?tab=activity`}>
              <ClipboardList size={14} aria-hidden /> View activity
            </a>
            <a href={`/reports?clientId=${c.id}`}>
              <BarChart3 size={14} aria-hidden /> Client reports
            </a>
          </MoreMenu>
          {can(actor, 'projects.write') ? (
            <LinkButton href={`/projects/new?clientId=${c.id}`} className="h-11 px-5 text-[15px]">
              New project
            </LinkButton>
          ) : null}
          {canWrite ? <EditClient c={c} team={team} primary /> : null}
        </div>
      </header>

      {/* Tabs */}
      <nav
        aria-label="Client sections"
        className="mb-6 overflow-x-auto rounded-2xl border border-line bg-surface px-3"
      >
        <ul className="flex min-w-max">
          {tabs.map(([k, label]) => (
            <li key={k}>
              <Link
                href={k === 'overview' ? base : `${base}?tab=${k}`}
                aria-current={tab === k ? 'page' : undefined}
                className={cn(
                  'block border-b-2 px-5 py-4 text-[15px] transition-colors',
                  tab === k
                    ? 'border-accent font-medium text-accent'
                    : 'border-transparent text-ink-2 hover:text-ink',
                )}
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {tab === 'overview' ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.75fr)_minmax(360px,1fr)]">
          <div className="min-w-0 space-y-5">
            <Card
              icon={<FileText size={24} strokeWidth={1.6} />}
              title="Account information"
              action={canWrite ? <EditClient c={c} team={team} label="Edit" /> : null}
            >
              <dl className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1.1fr_1.2fr]">
                <Field label="Legal name">{c.legalName ?? <Dash />}</Field>
                <Field label="Account owner">
                  <span className="font-medium">{d.ownerName ?? '—'}</span>
                </Field>
                <Field label="Type">{humanize(c.orgType)}</Field>
                <Field label="Location">
                  {c.city ? (
                    <span className="inline-flex items-center gap-2">
                      <MapPin size={16} className="text-muted" aria-hidden /> {c.city}
                    </span>
                  ) : (
                    <Dash />
                  )}
                </Field>
                <Field label="Website" className="lg:col-span-2">
                  {c.website ? (
                    <a
                      href={c.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-accent hover:underline"
                    >
                      <Globe size={16} aria-hidden /> {c.website}
                    </a>
                  ) : (
                    <Dash />
                  )}
                </Field>
                <Field label="Services engaged" className="lg:col-span-2">
                  {c.services.length ? (
                    <span className="flex flex-wrap gap-2">
                      {c.services.slice(0, 3).map((s) => (
                        <span
                          key={s}
                          className="rounded-lg border border-accent/25 bg-accent-soft/60 px-2.5 py-1 text-[13px] text-ink"
                        >
                          {s}
                        </span>
                      ))}
                      {c.services.length > 3 ? (
                        <span
                          title={c.services.slice(3).join(', ')}
                          className="rounded-lg border border-line bg-surface-2 px-2.5 py-1 text-[13px] text-ink-2"
                        >
                          +{c.services.length - 3}
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    <Dash />
                  )}
                </Field>
                <Field label="Contract period">
                  {c.contractStart ? (
                    <span className="inline-flex items-center gap-2">
                      <CalendarDays size={16} className="text-muted" aria-hidden />
                      {formatDate(c.contractStart)} → {c.contractEnd ? formatDate(c.contractEnd) : '—'}
                    </span>
                  ) : (
                    <Dash />
                  )}
                </Field>
                <Field label="Renewal date">
                  {c.renewalDate ? (
                    <span className="inline-flex items-center gap-2">
                      <CalendarDays size={16} className="text-muted" aria-hidden />{' '}
                      {formatDate(c.renewalDate)}
                      {(() => {
                        const days = Math.round(
                          (Date.parse(c.renewalDate) - Date.parse(todayIn(org.timezone))) / 86_400_000,
                        );
                        return days >= 0 && days <= 30 ? (
                          <span className="text-[12.5px] text-warn">in {days}d</span>
                        ) : null;
                      })()}
                    </span>
                  ) : (
                    <Dash />
                  )}
                </Field>
                <Field label="Commercial terms">
                  {can(actor, 'projects.commercials') ? (
                    c.commercialTerms ? (
                      <span className="line-clamp-2">{c.commercialTerms}</span>
                    ) : (
                      <Dash />
                    )
                  ) : (
                    <span className="text-faint">Restricted</span>
                  )}
                </Field>
                <Field label="Notes">
                  {c.notes ? <span className="line-clamp-2">{c.notes}</span> : <Dash />}
                </Field>
              </dl>

              <div className="mt-7 rounded-2xl border border-line bg-surface-2/60 p-4 sm:p-5">
                <h3 className="mb-4 flex items-center gap-2.5 text-[16px] font-semibold">
                  <BarChart3 size={22} className="text-accent" aria-hidden /> Marketing and branding budget
                </h3>
                <div className="grid gap-4 md:grid-cols-2">
                  {(['marketing', 'branding'] as const).map((k) => {
                    const minor = k === 'marketing' ? c.marketingBudgetMinor : c.brandingBudgetMinor;
                    const period = k === 'marketing' ? c.marketingBudgetPeriod : c.brandingBudgetPeriod;
                    const set = minor != null && period != null;
                    return (
                      <div key={k} className="rounded-xl border border-line bg-surface p-4">
                        <div className="flex items-start gap-3">
                          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
                            {k === 'marketing' ? (
                              <Megaphone size={22} aria-hidden />
                            ) : (
                              <Palette size={22} aria-hidden />
                            )}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-[15px] font-medium text-accent">
                              {k === 'marketing' ? 'Marketing budget' : 'Branding budget'}
                            </p>
                            {set ? (
                              <>
                                <p className="mt-1 text-[26px] leading-tight font-semibold tabular">
                                  {formatMoney(minor, org.currency).replace('₹', '₹ ')}
                                </p>
                                <p className="text-[14px] text-muted">
                                  {period === 'monthly' ? 'per month' : 'per year'}
                                </p>
                              </>
                            ) : (
                              <p className="mt-1 text-[20px] text-faint">Not set</p>
                            )}
                          </div>
                          {canWrite ? <EditOneBudget c={c} kind={k} /> : null}
                        </div>
                        <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3">
                          <span className="text-[13.5px] text-muted">Budget period</span>
                          {canWrite && set ? (
                            <InlineSelect
                              action={updateClientAction}
                              name={`${k}BudgetPeriod`}
                              value={period}
                              label={`${k === 'marketing' ? 'Marketing' : 'Branding'} budget period`}
                              hidden={{
                                id: c.id,
                                _scope: 'budgets',
                                [`${k}BudgetMinor`]: String(minor / 100),
                              }}
                              successMessage="Budget period saved"
                              className="h-9 w-36"
                              options={[
                                { value: 'monthly', label: 'Monthly' },
                                { value: 'annual', label: 'Annual' },
                              ]}
                            />
                          ) : (
                            <span className="text-[14px]">{period ? humanize(period) : '—'}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </Card>

            <Card
              icon={<FolderOpen size={24} strokeWidth={1.6} />}
              title="Projects"
              action={
                <>
                  <Link
                    href={`${base}?tab=projects`}
                    className="inline-flex items-center gap-1.5 text-[14.5px] font-medium text-accent hover:underline"
                  >
                    View all <ArrowRight size={15} aria-hidden />
                  </Link>
                  {can(actor, 'projects.write') ? (
                    <LinkButton
                      href={`/projects/new?clientId=${c.id}`}
                      variant="primary"
                      className="h-10 px-4"
                    >
                      New project
                    </LinkButton>
                  ) : null}
                </>
              }
            >
              <ProjectsTable projects={d.projects.slice(0, 6)} progress={progress} />
            </Card>
          </div>

          <div className="min-w-0 space-y-5">
            <Card
              icon={<Users size={24} strokeWidth={1.6} />}
              title="Contacts & approvers"
              action={canWrite ? <AddContact clientId={c.id} /> : null}
            >
              {d.contacts.length ? (
                <ul className="-mx-2 space-y-3">
                  {d.contacts.map((ct) => (
                    <li key={ct.id} className="rounded-xl border border-line bg-surface-2/60 p-4">
                      <div className="flex items-start gap-3.5">
                        <span
                          aria-hidden
                          className={cn(
                            'grid h-12 w-12 shrink-0 place-items-center rounded-full text-[18px] font-semibold',
                            tone(ct.name, AVATAR),
                          )}
                        >
                          {initials(ct.name).slice(0, 1)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-[16px] font-semibold">{ct.name}</p>
                              {ct.designation ? (
                                <p className="text-[13.5px] text-muted">{ct.designation}</p>
                              ) : null}
                            </div>
                            <span className="flex flex-wrap gap-1.5">
                              {ct.isPrimary ? (
                                <span className="rounded-lg border border-info/30 bg-info-soft px-2.5 py-1 text-[13px] font-medium text-info">
                                  Primary
                                </span>
                              ) : null}
                              {ct.isApprover ? (
                                <span className="rounded-lg border border-ok/30 bg-ok-soft px-2.5 py-1 text-[13px] font-medium text-ok">
                                  Approver
                                </span>
                              ) : null}
                              {ct.userId ? <Badge tone="info">Portal</Badge> : null}
                            </span>
                          </div>
                          <div className="mt-2.5 flex flex-wrap items-end justify-between gap-3">
                            <div className="min-w-0 space-y-1 text-[14px]">
                              {ct.email ? (
                                <a
                                  href={`mailto:${ct.email}`}
                                  className="block truncate text-ink-2 hover:text-accent hover:underline"
                                >
                                  {ct.email}
                                </a>
                              ) : null}
                              {ct.phone ? (
                                <a
                                  href={`tel:${ct.phone}`}
                                  className="flex items-center gap-1.5 text-ink-2 tabular hover:text-accent"
                                >
                                  <Phone size={14} aria-hidden /> {ct.phone}
                                </a>
                              ) : null}
                            </div>
                            {canWrite ? (
                              <div className="flex items-center gap-1.5">
                                <EditContact ct={ct} />
                                <ActionButton
                                  action={removeContactAction}
                                  hidden={{ id: ct.id }}
                                  variant="danger-soft"
                                  className="h-8 px-3"
                                  confirm={`Remove ${ct.name} from ${c.name}? This can’t be undone.`}
                                >
                                  <Trash2 size={14} aria-hidden /> Remove
                                </ActionButton>
                                <MoreMenu label={`More for ${ct.name}`}>
                                  {ct.email ? (
                                    <a href={`mailto:${ct.email}`}>
                                      <Mail size={14} aria-hidden /> Send email
                                    </a>
                                  ) : null}
                                  {ct.phone ? (
                                    <a href={`tel:${ct.phone}`}>
                                      <Phone size={14} aria-hidden /> Call
                                    </a>
                                  ) : null}
                                  {!ct.email && !ct.phone ? (
                                    <span className="px-2.5 py-1.5 text-[13px] text-muted">
                                      No contact details
                                    </span>
                                  ) : null}
                                </MoreMenu>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted">
                  No contacts. Add the person who approves creative and receives reports.
                </p>
              )}
            </Card>

            <Card
              icon={<NotebookPen size={24} strokeWidth={1.6} />}
              title="Notes"
              action={canWrite ? <AddNote clientId={c.id} /> : null}
            >
              {notes.length ? (
                <ol className="relative space-y-5 border-l border-line pl-6">
                  {notes.map((n) => (
                    <li key={n.id} className="relative">
                      <span
                        aria-hidden
                        className="absolute top-3 -left-[29px] h-2.5 w-2.5 rounded-full bg-accent ring-4 ring-surface"
                      />
                      <div className="flex items-start gap-3">
                        <span
                          aria-hidden
                          className={cn(
                            'grid h-9 w-9 shrink-0 place-items-center rounded-full text-[13px] font-semibold',
                            tone(n.authorName, AVATAR),
                          )}
                        >
                          {initials(n.authorName).slice(0, 1)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                            <p className="font-semibold">{n.title}</p>
                            <time className="text-[12.5px] text-muted" dateTime={n.createdAt.toISOString()}>
                              {formatDateTime(n.createdAt)}
                            </time>
                          </div>
                          {n.body ? (
                            <p className="mt-1 text-[14px] whitespace-pre-line text-ink-2">{n.body}</p>
                          ) : null}
                          <p className="mt-1 text-[12px] text-faint">{n.authorName}</p>
                        </div>
                        {canWrite ? (
                          <MoreMenu label={`More for note ${n.title}`}>
                            <ActionButton
                              action={deleteClientNoteAction}
                              hidden={{ id: n.id }}
                              variant="ghost"
                              confirm="Delete this note?"
                            >
                              <Trash2 size={14} aria-hidden /> Delete note
                            </ActionButton>
                          </MoreMenu>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-muted">
                  No notes yet. Record meetings, decisions and budget conversations here.
                </p>
              )}
            </Card>
          </div>
        </div>
      ) : (
        <TabPanel tab={tab} actor={actor} clientId={c.id} d={d} progress={progress} currency={org.currency} />
      )}
    </div>
  );
}

function ProjectsTable({
  projects,
  progress,
}: {
  projects: Awaited<ReturnType<typeof getClient>>['projects'];
  progress: Map<string, { done: number; total: number }>;
}) {
  if (!projects.length) return <Empty>No projects yet.</Empty>;
  return (
    <div className="-mx-6 -my-2 overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-[14.5px]">
        <thead>
          <tr className="text-[13.5px] text-muted">
            {['Project name', 'Type', 'Start date', 'End date', 'Status', 'Progress', 'Owner'].map((h) => (
              <th key={h} className="px-3 py-3 font-normal whitespace-nowrap first:pl-6 last:pr-6">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {projects.map((p, i) => {
            const pr = progress.get(p.id);
            const pct = pr && pr.total ? Math.round((pr.done / pr.total) * 100) : null;
            return (
              <tr key={p.id} className="border-t border-line">
                <td className="py-3 pr-3 pl-6">
                  <Link
                    href={`/projects/${p.id}`}
                    className="flex items-center gap-3 font-medium hover:underline"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white',
                        PROJECT_TILE[i % PROJECT_TILE.length],
                      )}
                    >
                      <FolderOpen size={16} />
                    </span>
                    {p.name}
                  </Link>
                </td>
                <td className="px-3 py-3 text-ink-2">{TYPE_LABEL[p.templateKey ?? ''] ?? 'Custom'}</td>
                <td className="px-3 py-3 whitespace-nowrap text-ink-2">
                  {p.startDate ? formatDate(p.startDate) : '—'}
                </td>
                <td className="px-3 py-3 whitespace-nowrap text-ink-2">
                  {p.endDate ? formatDate(p.endDate) : '—'}
                </td>
                <td className="px-3 py-3">
                  <StatusBadge status={p.status} />
                </td>
                <td className="px-3 py-3">
                  {pct == null ? (
                    <span className="text-[13px] text-faint">No tasks</span>
                  ) : (
                    <span className="flex items-center gap-2.5">
                      <span className="h-2 w-20 rounded-full bg-surface-2" aria-hidden>
                        <span className="block h-2 rounded-full bg-accent" style={{ width: `${pct}%` }} />
                      </span>
                      <span className="text-[13.5px] tabular">{pct}%</span>
                    </span>
                  )}
                </td>
                <td className="px-3 py-3">
                  {p.ownerName ? (
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className={cn(
                          'grid h-8 w-8 place-items-center rounded-full text-[12px] font-semibold',
                          tone(p.ownerName, AVATAR),
                        )}
                      >
                        {initials(p.ownerName)}
                      </span>
                      {p.ownerName.replace(/\s*\(.*\)/, '').split(' ')[0]}
                    </span>
                  ) : (
                    <span className="text-faint">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

async function TabPanel({
  tab,
  actor,
  clientId,
  d,
  progress,
  currency,
}: {
  tab: Exclude<Tab, 'overview'>;
  actor: Awaited<ReturnType<typeof requirePagePermission>>;
  clientId: string;
  d: Awaited<ReturnType<typeof getClient>>;
  progress: Map<string, { done: number; total: number }>;
  currency: string;
}) {
  const wrap = (icon: React.ReactNode, title: string, body: React.ReactNode) => (
    <Card icon={icon} title={title}>
      {body}
    </Card>
  );
  const listRow =
    'flex items-center justify-between gap-3 rounded-xl border border-line bg-surface-2/60 px-4 py-3';

  if (tab === 'projects')
    return wrap(
      <FolderOpen size={24} />,
      'Projects',
      <ProjectsTable projects={d.projects} progress={progress} />,
    );

  if (tab === 'tasks') {
    const rows = await clientTasks(actor, clientId);
    return wrap(
      <ClipboardList size={24} />,
      'Tasks',
      rows.length ? (
        <ul className="space-y-2">
          {rows.map((t) => (
            <li key={t.id} className={listRow}>
              <div className="min-w-0">
                <Link href={`/tasks/${t.id}`} className="block truncate font-medium hover:underline">
                  {t.title}
                </Link>
                <p className="truncate text-[13px] text-muted">
                  {t.projectName ?? t.ref} · {t.ownerName ?? 'Unassigned'}
                </p>
              </div>
              <span className="flex shrink-0 items-center gap-2 text-[13px] text-muted">
                {t.dueAt ? relativeTime(t.dueAt) : 'No date'}
                <StatusBadge status={t.status} />
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>No tasks for this client.</Empty>
      ),
    );
  }

  if (tab === 'campaigns')
    return wrap(
      <Megaphone size={24} />,
      'Campaigns',
      d.campaigns.length ? (
        <ul className="space-y-2">
          {d.campaigns.map((x) => (
            <li key={x.id} className={listRow}>
              <Link href={`/campaigns/${x.id}`} className="truncate font-medium hover:underline">
                {x.name}
              </Link>
              <span className="flex items-center gap-2 text-[13px] text-muted">
                {humanize(x.platform)} <StatusBadge status={x.status} />
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>No campaigns linked to this client.</Empty>
      ),
    );

  if (tab === 'reports') {
    const reports = await listReports(actor, undefined, clientId);
    return wrap(
      <BarChart3 size={24} />,
      'Reports',
      reports.length ? (
        <ul className="space-y-2">
          {reports.map(({ r }) => (
            <li key={r.id} className={listRow}>
              <Link href={`/reports/${r.id}`} className="truncate font-medium hover:underline">
                {r.title}
              </Link>
              <StatusBadge status={r.status} />
            </li>
          ))}
        </ul>
      ) : (
        <Empty>No reports for this client yet.</Empty>
      ),
    );
  }

  if (tab === 'finance') {
    const invoices = await clientInvoices(actor, clientId);
    return wrap(
      <FileText size={24} />,
      'Invoices',
      invoices.length ? (
        <ul className="space-y-2">
          {invoices.map((inv) => (
            <li key={inv.id} className={listRow}>
              <div>
                <p className="font-medium">{inv.number}</p>
                <p className="text-[13px] text-muted">
                  Issued {formatDate(inv.issueDate)} · due {formatDate(inv.dueDate)}
                </p>
              </div>
              <span className="flex items-center gap-3 tabular">
                {formatMoney(inv.amountMinor + inv.taxMinor + inv.passThroughMinor, currency)}
                <StatusBadge status={inv.status} />
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>No invoices for this client.</Empty>
      ),
    );
  }

  if (tab === 'documents') {
    const docs = await clientDocuments(actor, clientId);
    return wrap(
      <FolderOpen size={24} />,
      'Documents',
      docs.length ? (
        <ul className="space-y-2">
          {docs.map((f) => (
            <li key={f.id} className={listRow}>
              <div className="min-w-0">
                <a href={`/api/files/${f.id}`} className="block truncate font-medium hover:underline">
                  {f.fileName}
                </a>
                <p className="truncate text-[13px] text-muted">
                  {f.deliverableTitle ? `${f.deliverableTitle}${f.version ? ` · v${f.version}` : ''} · ` : ''}
                  {(f.sizeBytes / 1024 / 1024).toFixed(1)} MB · {f.uploadedBy ?? 'Unknown'}
                </p>
              </div>
              <span className="shrink-0 text-[13px] text-muted">{relativeTime(f.createdAt)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>No files yet. Files uploaded to this client’s deliverables appear here.</Empty>
      ),
    );
  }

  const activity = await clientActivity(actor, clientId);
  return wrap(
    <ClipboardList size={24} />,
    'Activity',
    activity.length ? (
      <ol className="space-y-2">
        {activity.map((a) => (
          <li key={a.id} className={listRow}>
            <span>
              <span className="font-medium">{a.actorName ?? a.actorLabel ?? 'System'}</span>{' '}
              <span className="text-ink-2">{humanize(a.action.replace(/^client\./, ''))}</span>
            </span>
            <time className="shrink-0 text-[13px] text-muted">{formatDateTime(a.createdAt)}</time>
          </li>
        ))}
      </ol>
    ) : (
      <Empty>No activity recorded yet.</Empty>
    ),
  );
}
