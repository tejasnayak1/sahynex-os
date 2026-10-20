'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronDown, Search } from 'lucide-react';
import { cn } from '@/components/ui';

type Opt = { value: string; label: string };

/** The board's filter row: search plus dropdowns, applied as you change them (kept in the URL). */
export function BoardFilters({
  clients,
  projects,
  people,
}: {
  clients: Opt[];
  projects: Opt[];
  people: Opt[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get('q') ?? '');
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const apply = (patch: Record<string, string>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.set('view', 'board');
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const select = (name: string, label: string, options: Opt[]) => (
    <label className="relative">
      <span className="sr-only">{label}</span>
      <select
        name={name}
        value={sp.get(name) ?? ''}
        onChange={(e) => apply({ [name]: e.target.value })}
        className={cn(
          'h-11 w-[150px] appearance-none truncate rounded-xl border bg-surface pr-9 pl-3.5 text-[14.5px] transition-colors hover:border-line-strong focus:border-accent focus:outline-none',
          sp.get(name) ? 'border-accent/60 text-ink' : 'border-line text-ink-2',
        )}
      >
        <option value="">{label}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={16}
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted"
      />
    </label>
  );

  const active = ['q', 'clientId', 'projectId', 'ownerId', 'due', 'priority', 'status'].some((k) =>
    sp.get(k),
  );

  return (
    <div
      className={cn('mb-5 flex flex-wrap items-center gap-2.5', pending && 'opacity-80')}
      aria-busy={pending}
    >
      <label className="relative min-w-[220px] flex-1 sm:max-w-[360px]">
        <span className="sr-only">Search tasks</span>
        <Search
          size={17}
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted"
        />
        <input
          type="search"
          value={q}
          onChange={(e) => {
            const v = e.target.value;
            setQ(v);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => apply({ q: v }), 350);
          }}
          placeholder="Search tasks, titles, projects…"
          className="h-11 w-full rounded-xl border border-line bg-surface pr-3 pl-10 text-[14.5px] placeholder:text-muted focus:border-accent focus:outline-none"
        />
      </label>
      {select('clientId', 'Client', clients)}
      {select('projectId', 'Project', projects)}
      {select('ownerId', 'Assignee', [{ value: 'unassigned', label: 'Unassigned' }, ...people])}
      {select('due', 'Due date', [
        { value: 'overdue', label: 'Overdue' },
        { value: 'today', label: 'Due today' },
        { value: 'week', label: 'Due in 7 days' },
        { value: 'none', label: 'No due date' },
      ])}
      {select('priority', 'Priority', [
        { value: 'urgent', label: 'Urgent' },
        { value: 'high', label: 'High' },
        { value: 'medium', label: 'Medium' },
        { value: 'low', label: 'Low' },
      ])}
      {select('status', 'Status', [
        { value: 'todo', label: 'To do' },
        { value: 'in_progress', label: 'In progress' },
        { value: 'blocked', label: 'Blocked' },
        { value: 'in_review', label: 'In review' },
        { value: 'done', label: 'Done' },
      ])}
      {active ? (
        <button
          type="button"
          onClick={() => {
            setQ('');
            apply({ q: '', clientId: '', projectId: '', ownerId: '', due: '', priority: '', status: '' });
          }}
          className="px-2 text-[14.5px] text-muted hover:text-ink"
        >
          Clear filters
        </button>
      ) : null}
    </div>
  );
}
