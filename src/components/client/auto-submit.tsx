'use client';
import { useActionState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { ActionState } from '@/server/action';
import { inputClass, cn } from '../ui';
import { toast } from './toast';

/** Inline select that saves on change (e.g. status, owner). Shows pending state and errors. */
export function InlineSelect({
  action,
  name,
  value,
  options,
  hidden,
  label,
  className,
  successMessage,
}: {
  action: (p: ActionState, fd: FormData) => Promise<ActionState>;
  name: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  hidden?: Record<string, string>;
  label: string;
  className?: string;
  successMessage?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  const router = useRouter();
  useEffect(() => {
    if (!state?.at) return;
    if (state.ok) {
      toast(state.message ?? successMessage ?? 'Saved');
      if (state.redirectTo) router.push(state.redirectTo);
    } else if (state.error) {
      toast(state.error, 'bad');
      ref.current?.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.at]);
  return (
    <form ref={ref} action={formAction}>
      {Object.entries(hidden ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <select
        key={value}
        aria-label={label}
        name={name}
        defaultValue={value}
        disabled={pending}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className={cn(inputClass, 'h-8 w-auto py-0 text-[13px]', className)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </form>
  );
}

/** One-click action button bound to a server action, with optional confirmation. */
export function ActionButton({
  action,
  children,
  hidden,
  confirm,
  variant = 'secondary',
  size = 'sm',
  successMessage,
}: {
  action: (p: ActionState, fd: FormData) => Promise<ActionState>;
  children: React.ReactNode;
  hidden?: Record<string, string>;
  confirm?: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  successMessage?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const router = useRouter();
  useEffect(() => {
    if (!state?.at) return;
    if (state.ok) {
      if (state.message || successMessage) toast(state.message ?? successMessage!);
      if (state.redirectTo) router.push(state.redirectTo);
    } else if (state.error) toast(state.error, 'bad');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.at]);
  return (
    <form action={formAction} className="inline">
      {Object.entries(hidden ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <button
        type="submit"
        disabled={pending}
        onClick={(e) => {
          if (confirm && !window.confirm(confirm)) e.preventDefault();
        }}
        className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors disabled:opacity-55 ${size === 'sm' ? 'h-7 px-2.5 text-[13px]' : 'h-9 px-3.5 text-[14px]'} ${variant === 'primary' ? 'bg-accent text-accent-ink' : variant === 'danger' ? 'bg-bad text-white' : variant === 'ghost' ? 'text-ink-2 hover:bg-surface-2' : 'border border-line-strong bg-surface text-ink hover:bg-surface-2'}`}
      >
        {pending ? 'Working…' : children}
      </button>
    </form>
  );
}
