'use client';
import { useEffect, useRef, useState } from 'react';

/**
 * Header checkbox that selects every row checkbox named `name` belonging to form `form`, shows an
 * indeterminate state for partial selections. Pair it with <SelectedCount> (a polite live region).
 */
export function SelectAll({ form, name = 'ids', label }: { form: string; name?: string; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const boxes = () =>
    Array.from(
      document.querySelectorAll<HTMLInputElement>(`input[type=checkbox][name="${name}"][form="${form}"]`),
    );
  useEffect(() => {
    const sync = () => {
      const all = boxes();
      const n = all.filter((b) => b.checked).length;
      if (ref.current) {
        ref.current.checked = all.length > 0 && n === all.length;
        ref.current.indeterminate = n > 0 && n < all.length;
      }
    };
    document.addEventListener('change', sync);
    sync();
    return () => document.removeEventListener('change', sync);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, name]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      className="h-4 w-4 accent-[var(--accent)]"
      onChange={(e) => {
        const on = e.currentTarget.checked;
        for (const b of boxes()) b.checked = on;
      }}
    />
  );
}

/** Live "n selected" label for a bulk toolbar. */
export function SelectedCount({ form, name = 'ids' }: { form: string; name?: string }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const sync = () =>
      setCount(
        document.querySelectorAll(`input[type=checkbox][name="${name}"][form="${form}"]:checked`).length,
      );
    document.addEventListener('change', sync);
    sync();
    return () => document.removeEventListener('change', sync);
  }, [form, name]);
  return (
    <span className="tabular text-muted" aria-live="polite">
      {count ? `${count} selected` : 'None selected'}
    </span>
  );
}
