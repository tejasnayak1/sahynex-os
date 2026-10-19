'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import {
  BarChart3,
  Bell,
  Briefcase,
  Building2,
  CheckCircle2,
  ChevronsLeft,
  ChevronsRight,
  FileText,
  Gauge,
  IndianRupee,
  KanbanSquare,
  ListChecks,
  Megaphone,
  Menu,
  Plus,
  Search,
  Settings,
  Target,
  Users,
  Workflow,
  X,
  Moon,
  Sun,
  LogOut,
  KeyRound,
} from 'lucide-react';
import { cn } from '../ui';

const ICONS = {
  Gauge,
  Users,
  KanbanSquare,
  Building2,
  Briefcase,
  ListChecks,
  Megaphone,
  FileText,
  CheckCircle2,
  BarChart3,
  Workflow,
  IndianRupee,
  Bell,
  Settings,
  Target,
};
export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; badge?: number };

const localListeners = new Set<() => void>();
/** Per-viewer UI preference in localStorage (falls back to the default if storage is unavailable). */
function useLocal(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const v = useSyncExternalStore(
    (cb) => {
      localListeners.add(cb);
      return () => localListeners.delete(cb);
    },
    () => {
      try {
        const s = localStorage.getItem(key);
        return s === null ? initial : s === '1';
      } catch {
        return initial;
      }
    },
    () => initial,
  );
  return [
    v,
    (x) => {
      try {
        localStorage.setItem(key, x ? '1' : '0');
      } catch {}
      localListeners.forEach((l) => l());
    },
  ];
}

export function AppShell({
  nav,
  user,
  unread,
  quickCreate,
  children,
  orgName,
}: {
  nav: NavItem[];
  user: { name: string; role: string };
  unread: number;
  quickCreate: Array<{ href: string; label: string }>;
  children: ReactNode;
  orgName: string;
}) {
  const [collapsed, setCollapsed] = useLocal('sx.sidebar.collapsed', false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const [menuPath, setMenuPath] = useState(pathname);
  if (menuPath !== pathname) {
    // Close the mobile menu after navigation (state adjustment during render, no effect needed).
    setMenuPath(pathname);
    setMobileOpen(false);
  }
  const active = (href: string) =>
    href === '/dashboard' ? pathname === href : pathname === href || pathname.startsWith(href + '/');

  const sidebar = (
    <nav aria-label="Main" className="flex h-full flex-col">
      <div
        className={cn(
          'flex h-14 items-center gap-2 border-b border-line px-3',
          collapsed && 'lg:justify-center lg:px-0',
        )}
      >
        <span
          aria-hidden
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-accent text-[13px] font-bold text-accent-ink"
        >
          S
        </span>
        <span className={cn('truncate font-semibold tracking-[-0.01em]', collapsed && 'lg:hidden')}>
          Sahynex <span className="font-normal text-muted">OS</span>
        </span>
      </div>
      <ul className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {nav.map((n) => {
          const Icon = ICONS[n.icon];
          return (
            <li key={n.href}>
              <Link
                href={n.href}
                title={collapsed ? n.label : undefined}
                aria-current={active(n.href) ? 'page' : undefined}
                className={cn(
                  'flex h-9 items-center gap-2.5 rounded-md px-2.5 text-[13.5px] font-medium text-ink-2 hover:bg-surface-2 hover:text-ink',
                  active(n.href) && 'bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent',
                  collapsed && 'lg:justify-center lg:px-0',
                )}
              >
                <Icon size={17} strokeWidth={1.9} aria-hidden className="shrink-0" />
                <span className={cn('flex-1 truncate', collapsed && 'lg:sr-only')}>{n.label}</span>
                {n.badge ? (
                  <span
                    className={cn(
                      'rounded-full bg-bad px-1.5 text-[11px] leading-[18px] text-white tabular',
                      collapsed && 'lg:hidden',
                    )}
                  >
                    {n.badge > 99 ? '99+' : n.badge}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="hidden border-t border-line p-2 lg:block">
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="flex h-8 w-full items-center justify-center gap-2 rounded-md text-[13px] text-muted hover:bg-surface-2"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? (
            <ChevronsRight size={16} />
          ) : (
            <>
              <ChevronsLeft size={16} /> Collapse
            </>
          )}
        </button>
      </div>
    </nav>
  );

  return (
    <div className="flex min-h-dvh">
      <aside
        className={cn(
          'sticky top-0 hidden h-dvh shrink-0 border-r border-line bg-surface lg:block',
          collapsed ? 'w-[64px]' : 'w-[232px]',
        )}
      >
        {sidebar}
      </aside>
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-[264px] border-r border-line bg-surface">
            {sidebar}
          </aside>
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="app-topbar sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-surface/95 px-3 backdrop-blur sm:px-5">
          <button
            type="button"
            className="grid h-9 w-9 place-items-center rounded-md hover:bg-surface-2 lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <Menu size={18} />
          </button>
          <span className="hidden truncate text-[13px] text-muted md:block">{orgName}</span>
          <div className="flex-1" />
          <CommandPalette />
          <QuickCreate items={quickCreate} />
          <Link
            href="/notifications"
            className="relative grid h-9 w-9 place-items-center rounded-md hover:bg-surface-2"
            aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
          >
            <Bell size={18} />
            {unread ? (
              <span className="absolute right-1 top-1 min-w-4 rounded-full bg-bad px-1 text-center text-[10px] leading-4 text-white tabular">
                {unread > 99 ? '99+' : unread}
              </span>
            ) : null}
          </Link>
          <UserMenu user={user} />
        </header>
        <main id="main" className="mx-auto w-full max-w-[1440px] flex-1 px-3 py-5 sm:px-6">
          {children}
        </main>
      </div>
    </div>
  );
}

function useClickAway(ref: React.RefObject<HTMLElement | null>, onAway: () => void) {
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onAway();
    };
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onAway();
    };
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => {
      document.removeEventListener('mousedown', h);
      document.removeEventListener('keydown', k);
    };
  }, [ref, onAway]);
}

function QuickCreate({ items }: { items: Array<{ href: string; label: string }> }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickAway(ref, () => setOpen(false));
  if (!items.length) return null;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="inline-flex h-9 items-center gap-1.5 rounded-md bg-accent px-3 text-[13.5px] font-medium text-accent-ink hover:brightness-110"
      >
        <Plus size={16} aria-hidden /> <span className="hidden sm:inline">New</span>
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 mt-1.5 w-52 rounded-md border border-line bg-surface p-1 shadow-[0_10px_30px_rgb(10_20_30/0.14)]"
        >
          {items.map((i) => (
            <Link
              key={i.href}
              role="menuitem"
              href={i.href}
              onClick={() => setOpen(false)}
              className="block rounded px-2.5 py-1.5 text-[13.5px] hover:bg-surface-2"
            >
              {i.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function UserMenu({ user }: { user: { name: string; role: string } }) {
  const [open, setOpen] = useState(false);
  // Only read inside the open menu (client-side), so this lazy read cannot cause a hydration mismatch.
  const [dark, setDark] = useState(
    () => typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark',
  );
  const ref = useRef<HTMLDivElement>(null);
  useClickAway(ref, () => setOpen(false));
  const toggleTheme = () => {
    const next = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('sx.theme', next);
    } catch {}
    setDark(!dark);
  };
  const initials = user.name
    .replace(/\(.*\)/, '')
    .trim()
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Account menu"
        className="grid h-9 w-9 place-items-center rounded-full border border-line bg-surface-2 text-[12px] font-semibold text-ink-2"
      >
        {initials}
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 mt-1.5 w-64 rounded-md border border-line bg-surface p-1 shadow-[0_10px_30px_rgb(10_20_30/0.14)]"
        >
          <div className="border-b border-line px-2.5 py-2">
            <p className="truncate font-medium">{user.name}</p>
            <p className="truncate text-[12.5px] text-muted">{user.role}</p>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={toggleTheme}
            className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-[13.5px] hover:bg-surface-2"
          >
            {dark ? <Sun size={15} /> : <Moon size={15} />} {dark ? 'Light theme' : 'Dark theme'}
          </button>
          <Link
            role="menuitem"
            href="/settings/account"
            className="flex items-center gap-2 rounded px-2.5 py-1.5 text-[13.5px] hover:bg-surface-2"
          >
            <KeyRound size={15} /> Change password
          </Link>
          <form action="/api/auth/logout" method="post">
            <button
              type="submit"
              role="menuitem"
              className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-[13.5px] hover:bg-surface-2"
            >
              <LogOut size={15} /> Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

type Hit = { type: string; id: string; title: string; subtitle: string | null; href: string };

function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState(0);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const close = () => {
    setOpen(false);
    setQ('');
    setHits([]);
    setErr(null);
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === 'Escape') {
        setOpen(false);
        setQ('');
        setHits([]);
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 10);
  }, [open]);
  useEffect(() => {
    if (q.trim().length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        if (!res.ok)
          throw new Error(
            res.status === 401 ? 'Session expired — sign in again.' : 'Search failed. Try again.',
          );
        setHits((await res.json()).results);
        setSel(0);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setErr((e as Error).message);
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);
  const shown = q.trim().length < 2 ? [] : hits;
  const go = (h: Hit) => {
    close();
    router.push(h.href);
  };
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 items-center gap-2 rounded-md border border-line bg-surface-2 px-2.5 text-[13px] text-muted hover:border-line-strong sm:w-64"
        aria-label="Search (Ctrl+K)"
      >
        <Search size={15} aria-hidden />{' '}
        <span className="hidden flex-1 text-left sm:inline">Search records</span>
        <kbd className="hidden rounded border border-line px-1 text-[11px] sm:inline">Ctrl K</kbd>
      </button>
      {open ? (
        <div
          className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 px-4 pt-[12vh]"
          onMouseDown={(e) => e.target === e.currentTarget && close()}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Search"
            className="w-full max-w-xl overflow-hidden rounded-lg border border-line bg-surface shadow-[0_20px_60px_rgb(10_20_30/0.3)]"
          >
            <div className="flex items-center gap-2 border-b border-line px-3">
              <Search size={16} className="text-muted" aria-hidden />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setSel((s) => Math.min(s + 1, shown.length - 1));
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setSel((s) => Math.max(s - 1, 0));
                  }
                  if (e.key === 'Enter' && shown[sel]) go(shown[sel]);
                }}
                placeholder="Leads, deals, clients, projects, tasks…"
                aria-label="Search"
                role="combobox"
                aria-expanded={shown.length > 0}
                aria-controls="search-results"
                className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint"
              />
              <button type="button" onClick={close} aria-label="Close search" className="text-muted">
                <X size={16} />
              </button>
            </div>
            <ul id="search-results" role="listbox" className="max-h-[50vh] overflow-y-auto p-1">
              {err ? <li className="px-3 py-3 text-bad">{err}</li> : null}
              {!err && q.trim().length >= 2 && !loading && shown.length === 0 ? (
                <li className="px-3 py-3 text-muted">No matching records you have access to.</li>
              ) : null}
              {q.trim().length < 2 ? (
                <li className="px-3 py-3 text-muted">Type at least two characters.</li>
              ) : null}
              {shown.map((h, i) => (
                <li key={h.type + h.id} role="option" aria-selected={i === sel}>
                  <button
                    type="button"
                    onMouseEnter={() => setSel(i)}
                    onClick={() => go(h)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded px-3 py-2 text-left',
                      i === sel && 'bg-surface-2',
                    )}
                  >
                    <span className="w-20 shrink-0 text-[12px] capitalize text-muted">{h.type}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-ink">{h.title}</span>
                      {h.subtitle ? (
                        <span className="block truncate text-[12.5px] text-muted">{h.subtitle}</span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </>
  );
}
