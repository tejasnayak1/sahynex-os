import Link from 'next/link';
import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { humanize } from '@/lib/format';
import { FilterForm } from './client/filter-form';

export const cn = (...a: Parameters<typeof clsx>) => twMerge(clsx(...a));

/* -------------------------------------------------------------- layout */

export function PageHeader({
  title,
  description,
  actions,
  crumbs,
  meta,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  crumbs?: Array<{ label: string; href?: string }>;
  meta?: ReactNode;
}) {
  return (
    <div className="mb-5">
      {crumbs?.length ? (
        <nav aria-label="Breadcrumb" className="mb-1.5 text-[13px] text-muted">
          <ol className="flex flex-wrap items-center gap-1">
            {crumbs.map((c, i) => (
              <li key={i} className="flex items-center gap-1">
                {i > 0 && (
                  <span aria-hidden className="text-faint">
                    /
                  </span>
                )}
                {c.href ? (
                  <Link className="hover:text-ink" href={c.href}>
                    {c.label}
                  </Link>
                ) : (
                  <span aria-current="page">{c.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.01em] text-ink">{title}</h1>
          {description ? <p className="mt-1 max-w-[70ch] text-muted">{description}</p> : null}
          {meta ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-muted">{meta}</div>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

export function Panel({
  title,
  actions,
  children,
  className,
  bodyClassName,
  id,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn('rounded-lg border border-line bg-surface', className)}>
      {title || actions ? (
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          {title ? <h2 className="text-[14px] font-semibold text-ink">{title}</h2> : <span />}
          {actions}
        </div>
      ) : null}
      <div className={cn('p-4', bodyClassName)}>{children}</div>
    </section>
  );
}

export function DescList({ items, cols = 2 }: { items: Array<[string, ReactNode]>; cols?: 1 | 2 | 3 }) {
  return (
    <dl
      className={cn(
        'grid gap-x-6 gap-y-3',
        cols === 1 ? 'grid-cols-1' : cols === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-3',
      )}
    >
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-[12.5px] text-muted">{k}</dt>
          <dd className="mt-0.5 break-words text-ink">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-line-strong bg-surface px-5 py-8">
      <p className="font-medium text-ink">{title}</p>
      {body ? <p className="max-w-[60ch] text-muted">{body}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

export function Notice({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'warn' | 'bad' | 'ok' | 'demo';
  title?: ReactNode;
  children?: ReactNode;
}) {
  const tones = {
    info: 'border-info/30 bg-info-soft text-ink',
    warn: 'border-warn/30 bg-warn-soft text-ink',
    bad: 'border-bad/30 bg-bad-soft text-ink',
    ok: 'border-ok/30 bg-ok-soft text-ink',
    demo: 'border-demo/30 bg-demo-soft text-ink',
  };
  return (
    <div
      role={tone === 'bad' ? 'alert' : 'status'}
      className={cn('rounded-md border px-3.5 py-2.5 text-[13.5px]', tones[tone])}
    >
      {title ? <p className="font-medium">{title}</p> : null}
      {children ? <div className={title ? 'mt-0.5 text-ink-2' : ''}>{children}</div> : null}
    </div>
  );
}

/* --------------------------------------------------------------- buttons */

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
const btn: Record<BtnVariant, string> = {
  primary: 'bg-accent text-accent-ink hover:brightness-110 border border-transparent',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-surface-2',
  ghost: 'text-ink-2 hover:bg-surface-2 border border-transparent',
  danger: 'bg-bad text-white hover:brightness-110 border border-transparent',
};
export const buttonClass = (variant: BtnVariant = 'secondary', size: 'sm' | 'md' = 'md') =>
  cn(
    'inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-55',
    size === 'sm' ? 'h-7 px-2.5 text-[13px]' : 'h-9 px-3.5 text-[14px]',
    btn[variant],
  );

export function LinkButton({
  href,
  children,
  variant = 'secondary',
  size = 'md',
  className,
}: {
  href: string;
  children: ReactNode;
  variant?: BtnVariant;
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <Link href={href} className={cn(buttonClass(variant, size), className)}>
      {children}
    </Link>
  );
}

/* --------------------------------------------------------------- badges */

const STATUS_TONE: Record<string, 'neutral' | 'info' | 'ok' | 'warn' | 'bad' | 'accent' | 'demo'> = {
  new: 'info',
  contacted: 'accent',
  qualified: 'ok',
  unqualified: 'neutral',
  converted: 'ok',
  lost: 'neutral',
  pending: 'neutral',
  disqualified: 'neutral',
  new_prospect: 'info',
  discovery_completed: 'accent',
  proposal_preparation: 'accent',
  proposal_sent: 'accent',
  negotiation: 'warn',
  won: 'ok',
  todo: 'neutral',
  in_progress: 'info',
  blocked: 'bad',
  in_review: 'warn',
  done: 'ok',
  cancelled: 'neutral',
  planning: 'info',
  active: 'ok',
  on_hold: 'warn',
  completed: 'neutral',
  onboarding: 'info',
  paused: 'warn',
  churned: 'neutral',
  draft: 'neutral',
  internal_review: 'warn',
  submitted_to_client: 'info',
  changes_requested: 'bad',
  revised: 'accent',
  approved: 'ok',
  scheduled: 'accent',
  published: 'ok',
  approved_decision: 'ok',
  withdrawn: 'neutral',
  queued: 'neutral',
  running: 'info',
  succeeded: 'ok',
  failed: 'bad',
  dead: 'bad',
  skipped: 'neutral',
  open: 'bad',
  acknowledged: 'warn',
  resolved: 'accent',
  closed: 'neutral',
  up: 'ok',
  down: 'bad',
  unknown: 'neutral',
  healthy: 'ok',
  degraded: 'warn',
  error: 'bad',
  disconnected: 'neutral',
  live: 'ok',
  demo: 'demo',
  sent: 'info',
  partially_paid: 'warn',
  paid: 'ok',
  overdue: 'bad',
  void: 'neutral',
  accepted: 'ok',
  rejected: 'bad',
  superseded: 'neutral',
  submitted: 'warn',
  delivered: 'ok',
  in_review_report: 'warn',
  low: 'neutral',
  medium: 'info',
  high: 'warn',
  urgent: 'bad',
  fresh: 'ok',
  stale: 'warn',
  never: 'neutral',
};
const TONE_CLASS = {
  neutral: 'bg-surface-2 text-ink-2 border-line',
  info: 'bg-info-soft text-info border-info/25',
  ok: 'bg-ok-soft text-ok border-ok/25',
  warn: 'bg-warn-soft text-warn border-warn/25',
  bad: 'bg-bad-soft text-bad border-bad/25',
  accent: 'bg-accent-soft text-accent border-accent/25',
  demo: 'bg-demo-soft text-demo border-demo/30',
};

export function Badge({
  children,
  tone = 'neutral',
  className,
  title,
}: {
  children: ReactNode;
  tone?: keyof typeof TONE_CLASS;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-[5px] border px-1.5 py-[1px] text-[12px] font-medium leading-[18px]',
        TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status, label }: { status: string | null | undefined; label?: string }) {
  if (!status) return <span className="text-faint">—</span>;
  return <Badge tone={STATUS_TONE[status] ?? 'neutral'}>{label ?? humanize(status)}</Badge>;
}

export function DemoBadge({ show = true }: { show?: boolean }) {
  if (!show) return null;
  return (
    <Badge tone="demo" title="Demo data — synthetic, not real business results">
      Demo data
    </Badge>
  );
}

/* --------------------------------------------------------------- tables */

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-x-auto rounded-lg border border-line bg-surface', className)}>
      <table className="w-full min-w-[640px] border-collapse text-left text-[13.5px]">{children}</table>
    </div>
  );
}
export function Th({
  children,
  className,
  align,
}: {
  children?: ReactNode;
  className?: string;
  align?: 'right';
}) {
  return (
    <th
      scope="col"
      className={cn(
        'h-9 border-b border-line bg-surface-2 px-3 text-[12.5px] font-medium text-muted',
        align === 'right' && 'text-right',
        className,
      )}
    >
      {children}
    </th>
  );
}
export function Td({
  children,
  className,
  align,
  title,
}: {
  children?: ReactNode;
  className?: string;
  align?: 'right';
  title?: string;
}) {
  return (
    <td
      title={title}
      className={cn(
        'h-10 border-b border-line px-3 py-1.5 align-middle text-ink-2',
        align === 'right' && 'text-right',
        className,
      )}
    >
      {children}
    </td>
  );
}

/** Sortable column header built from the current query string. */
export function SortTh({
  label,
  field,
  params,
  base,
  align,
}: {
  label: string;
  field: string;
  params: Record<string, string | undefined>;
  base: string;
  align?: 'right';
}) {
  const active = params.sort === field;
  const dir = active && params.dir === 'asc' ? 'desc' : 'asc';
  const qs = new URLSearchParams(
    Object.entries({ ...params, sort: field, dir, page: '1' }).filter(([, v]) => v) as [string, string][],
  );
  return (
    <Th align={align}>
      <Link
        href={`${base}?${qs}`}
        className={cn('inline-flex items-center gap-1 hover:text-ink', active && 'text-ink')}
        aria-sort={active ? (params.dir === 'asc' ? 'ascending' : 'descending') : undefined}
      >
        {label}
        <span aria-hidden className="text-[10px]">
          {active ? (params.dir === 'asc' ? '▲' : '▼') : ''}
        </span>
      </Link>
    </Th>
  );
}

export function Pagination({
  total,
  page,
  pageSize,
  base,
  params,
}: {
  total: number;
  page: number;
  pageSize: number;
  base: string;
  params: Record<string, string | undefined>;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) =>
    `${base}?${new URLSearchParams(Object.entries({ ...params, page: String(p) }).filter(([, v]) => v) as [string, string][])}`;
  const from = total ? (page - 1) * pageSize + 1 : 0;
  return (
    <div className="mt-3 flex items-center justify-between text-[13px] text-muted">
      <span className="tabular">
        {from.toLocaleString('en-IN')}–{Math.min(page * pageSize, total).toLocaleString('en-IN')} of{' '}
        {total.toLocaleString('en-IN')}
      </span>
      <div className="flex gap-1.5">
        {page > 1 ? (
          <LinkButton size="sm" href={href(page - 1)}>
            Previous
          </LinkButton>
        ) : (
          <span
            aria-disabled="true"
            className={cn(
              buttonClass('secondary', 'sm'),
              'cursor-default border-line text-faint hover:bg-surface',
            )}
          >
            Previous
          </span>
        )}
        {page < pages ? (
          <LinkButton size="sm" href={href(page + 1)}>
            Next
          </LinkButton>
        ) : (
          <span
            aria-disabled="true"
            className={cn(
              buttonClass('secondary', 'sm'),
              'cursor-default border-line text-faint hover:bg-surface',
            )}
          >
            Next
          </span>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- forms */

export const inputClass =
  'h-9 w-full rounded-md border border-line-strong bg-surface px-2.5 text-[14px] text-ink placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:opacity-60 aria-[invalid=true]:border-bad';
export const textareaClass = inputClass.replace('h-9', 'min-h-[84px] py-2');

export function Field({
  label,
  name,
  error,
  hint,
  children,
  required,
  className,
}: {
  label: string;
  name: string;
  error?: string;
  hint?: ReactNode;
  children: ReactNode;
  required?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <label htmlFor={name} className="text-[13px] font-medium text-ink-2">
        {label}
        {required ? <span className="text-bad"> *</span> : null}
      </label>
      {children}
      {error ? (
        <p id={`${name}-error`} className="text-[12.5px] text-bad">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[12.5px] text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function Select({
  name,
  options,
  defaultValue,
  placeholder,
  required,
  id,
  className,
  ariaLabel,
}: {
  name: string;
  options: Array<{ value: string; label: string }>;
  defaultValue?: string | null;
  placeholder?: string;
  required?: boolean;
  id?: string;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <select
      id={id ?? name}
      name={name}
      defaultValue={defaultValue ?? ''}
      required={required}
      aria-label={ariaLabel}
      className={cn(inputClass, 'pr-8', className)}
    >
      {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** GET filter bar — filters live in the URL so they persist, are shareable and survive reloads. */
export function FilterBar({
  action,
  children,
  q,
  placeholder = 'Search…',
  reset,
}: {
  action: string;
  children?: ReactNode;
  q?: string;
  placeholder?: string;
  reset?: boolean;
}) {
  return (
    <FilterForm action={action} className="mb-3 flex flex-wrap items-end gap-2">
      <div className="w-full sm:w-64">
        <label htmlFor="q" className="sr-only">
          Search
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={q}
          placeholder={placeholder}
          className={inputClass}
          autoComplete="off"
        />
      </div>
      {children}
      <button type="submit" className={buttonClass('secondary')}>
        Apply
      </button>
      {reset ? (
        <Link href={action} className={buttonClass('ghost')}>
          Clear
        </Link>
      ) : null}
    </FilterForm>
  );
}

export function Stat({
  label,
  value,
  sub,
  delta,
  invert,
  href,
  demo,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  delta?: number | null;
  invert?: boolean;
  href?: string;
  demo?: boolean;
}) {
  const good = delta == null ? null : invert ? delta < 0 : delta > 0;
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] text-muted">{label}</span>
        {demo ? <DemoBadge /> : null}
      </div>
      <div className="mt-1 text-[24px] font-semibold leading-tight tracking-[-0.02em] text-ink tabular">
        {value}
      </div>
      <div className="mt-0.5 flex items-center gap-2 text-[12.5px] text-muted">
        {delta != null ? (
          <span className={good ? 'text-ok' : delta === 0 ? 'text-muted' : 'text-bad'}>
            {delta > 0 ? '+' : ''}
            {(delta * 100).toFixed(0)}% vs previous
          </span>
        ) : null}
        {sub}
      </div>
    </>
  );
  return href ? (
    <Link
      href={href}
      className="block rounded-lg border border-line bg-surface p-3.5 hover:border-line-strong"
    >
      {body}
    </Link>
  ) : (
    <div className="rounded-lg border border-line bg-surface p-3.5">{body}</div>
  );
}

export function Tabs({
  tabs,
  current,
  base,
}: {
  tabs: Array<{ key: string; label: string; count?: number }>;
  current: string;
  base: string;
}) {
  return (
    <nav className="mb-4 flex gap-1 overflow-x-auto border-b border-line" aria-label="Sections">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={`${base}${base.includes('?') ? '&' : '?'}tab=${t.key}`}
          aria-current={t.key === current ? 'page' : undefined}
          className={cn(
            '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[13.5px] font-medium',
            t.key === current ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink',
          )}
        >
          {t.label}
          {t.count != null ? <span className="ml-1.5 text-faint tabular">{t.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
