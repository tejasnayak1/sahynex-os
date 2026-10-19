'use client';
import { useEffect, useRef, useTransition, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';

const DEBOUNCE_MS = 350;

/**
 * GET filter form that applies itself: text inputs after a short pause, selects and checkboxes
 * immediately. Navigation is client-side (no full reload) and the filters stay in the URL, so
 * they persist, are shareable and survive reloads. Without JavaScript it is an ordinary GET form.
 */
export function FilterForm({
  action,
  children,
  className,
  label,
}: {
  action: string;
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastQuery = useRef<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  const apply = () => {
    const form = ref.current;
    if (!form) return;
    const qs = new URLSearchParams();
    for (const [k, v] of new FormData(form).entries())
      if (typeof v === 'string' && v.trim() !== '') qs.append(k, v.trim());
    const query = qs.toString();
    if (query === lastQuery.current) return;
    lastQuery.current = query;
    startTransition(() => router.replace(`${action}${query ? `?${query}` : ''}`, { scroll: false }));
  };

  useEffect(() => {
    // Seed with the current state so the first identical change is not re-applied.
    const form = ref.current;
    if (!form) return;
    const qs = new URLSearchParams();
    for (const [k, v] of new FormData(form).entries())
      if (typeof v === 'string' && v.trim() !== '') qs.append(k, v.trim());
    lastQuery.current = qs.toString();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [pathname]);

  return (
    <form
      ref={ref}
      action={action}
      method="get"
      role="search"
      aria-label={label}
      aria-busy={pending}
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        if (timer.current) clearTimeout(timer.current);
        lastQuery.current = null;
        apply();
      }}
      onChange={(e) => {
        const t = e.target as HTMLInputElement;
        if (t.type === 'text' || t.type === 'search' || t.tagName === 'TEXTAREA') return;
        if (timer.current) clearTimeout(timer.current);
        apply();
      }}
      onInput={(e) => {
        const t = e.target as HTMLInputElement;
        if (!(t.type === 'text' || t.type === 'search')) return;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(apply, DEBOUNCE_MS);
      }}
    >
      {children}
      <span className="sr-only" aria-live="polite">
        {pending ? 'Updating results…' : ''}
      </span>
    </form>
  );
}
