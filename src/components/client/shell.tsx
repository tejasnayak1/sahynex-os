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
  House,
  IndianRupee,
  KanbanSquare,
  ListChecks,
  Megaphone,
  Menu,
  Search,
  Settings,
  Target,
  Users,
  Workflow,
  X,
  Moon,
  Sun,
  LogOut,
  ChevronDown,
  KeyRound,
} from 'lucide-react';
import { cn } from '../ui';

const ICONS = {
  Search,
  Gauge,
  House,
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

/** Opens the search palette from anywhere (e.g. the sidebar). */
export const openSearch = () => window.dispatchEvent(new Event('sx:open-search'));

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
  children,
  orgName,
}: {
  nav: NavItem[];
  user: { name: string; role: string; title?: string | null };
  unread: number;
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
      <div className={cn('flex h-16 items-center gap-2.5 px-5', collapsed && 'lg:justify-center lg:px-0')}>
        <BrandMark className="h-8 w-[22px] shrink-0" />
        <span
          className={cn('truncate text-[18px] font-semibold tracking-[-0.01em]', collapsed && 'lg:hidden')}
        >
          Sahynex OS
        </span>
      </div>
      <ul className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
        {nav.map((n) => {
          const Icon = ICONS[n.icon];
          if (n.href === '#search')
            return (
              <li key={n.href}>
                <button
                  type="button"
                  onClick={openSearch}
                  title={collapsed ? n.label : undefined}
                  className={cn(
                    'flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-[14.5px] font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink',
                    collapsed && 'lg:justify-center lg:px-0',
                  )}
                >
                  <Icon size={19} strokeWidth={1.7} aria-hidden className="shrink-0" />
                  <span className={cn('flex-1 truncate', collapsed && 'lg:sr-only')}>{n.label}</span>
                </button>
              </li>
            );
          return (
            <li key={n.href}>
              <Link
                href={n.href}
                title={collapsed ? n.label : undefined}
                aria-current={active(n.href) ? 'page' : undefined}
                className={cn(
                  'flex h-10 items-center gap-3 rounded-lg px-3 text-[14.5px] font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink',
                  active(n.href) && 'bg-accent-soft text-ink hover:bg-accent-soft [&>svg]:text-accent',
                  collapsed && 'lg:justify-center lg:px-0',
                )}
              >
                <Icon size={19} strokeWidth={1.7} aria-hidden className="shrink-0" />
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
          'sticky top-0 hidden h-dvh shrink-0 border-r border-line bg-sidebar lg:block',
          collapsed ? 'w-[68px]' : 'w-[248px]',
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
          <aside className="absolute inset-y-0 left-0 w-[264px] border-r border-line bg-sidebar">
            {sidebar}
          </aside>
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="app-topbar sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-canvas/90 px-3 backdrop-blur sm:px-6">
          <button
            type="button"
            className="grid h-9 w-9 place-items-center rounded-md hover:bg-surface-2 lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <Menu size={18} />
          </button>
          <div className="flex min-w-0 flex-1 justify-center">
            <CommandPalette />
          </div>
          <Link
            href="/notifications"
            className="relative grid h-10 w-10 place-items-center rounded-full text-ink-2 hover:bg-surface-2"
            aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
          >
            <Bell size={20} strokeWidth={1.7} />
            {unread ? (
              <span
                aria-hidden
                className="absolute top-2 right-2.5 h-2 w-2 rounded-full bg-bad ring-2 ring-canvas"
              />
            ) : null}
          </Link>
          <UserMenu user={user} orgName={orgName} />
        </header>
        <main id="main" className="mx-auto w-full max-w-[1520px] flex-1 px-3 py-6 sm:px-7">
          {children}
        </main>
      </div>
    </div>
  );
}

/** The Sahynex mark: a brighter rendering on dark surfaces, the original on light ones. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn('relative inline-block', className)} aria-hidden>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/logo-mark-on-dark.png"
        alt=""
        className="absolute inset-0 hidden h-full w-full object-contain dark:block"
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/logo-mark.png"
        alt=""
        className="absolute inset-0 h-full w-full object-contain dark:hidden"
      />
    </span>
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

function UserMenu({
  user,
  orgName,
}: {
  user: { name: string; role: string; title?: string | null };
  orgName: string;
}) {
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
        className="flex items-center gap-2.5 rounded-full py-1 pr-2 pl-1 hover:bg-surface-2"
      >
        <span className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-accent to-[#2b6f8f] text-[13px] font-semibold text-white ring-2 ring-surface">
          {initials}
        </span>
        <span className="hidden min-w-0 text-left leading-tight md:block">
          <span className="block max-w-[160px] truncate text-[14px] font-semibold text-ink">
            {user.name.replace(/\s*\(.*\)\s*/, '')}
          </span>
          <span className="block max-w-[160px] truncate text-[12.5px] text-muted">
            {user.title || user.role.split('/')[0].trim()}
          </span>
        </span>
        <ChevronDown size={16} aria-hidden className="hidden text-muted md:block" />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 mt-1.5 w-64 rounded-md border border-line bg-surface p-1 shadow-[0_10px_30px_rgb(10_20_30/0.14)]"
        >
          <div className="border-b border-line px-2.5 py-2">
            <p className="truncate font-medium">{user.name}</p>
            <p className="truncate text-[12.5px] text-muted">{user.role}</p>
            {orgName ? <p className="truncate text-[12px] text-faint">{orgName}</p> : null}
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
    const o = () => setOpen(true);
    window.addEventListener('keydown', k);
    window.addEventListener('sx:open-search', o);
    return () => {
      window.removeEventListener('keydown', k);
      window.removeEventListener('sx:open-search', o);
    };
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
        className="flex h-11 w-full max-w-[620px] items-center gap-2.5 rounded-xl border border-line bg-surface px-3.5 text-[14px] text-muted transition-colors hover:border-line-strong"
        aria-label="Search (Ctrl+K)"
      >
        <Search size={17} aria-hidden />{' '}
        <span className="hidden flex-1 truncate text-left sm:inline">
          Search leads, clients, projects, tasks…
        </span>
        <kbd className="hidden rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-[11.5px] sm:inline">
          ⌘ K
        </kbd>
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
