'use client';
import {
  createContext,
  startTransition,
  useActionState,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import type { ActionState } from '@/server/action';
import { buttonClass, cn } from '../ui';
import { toast } from './toast';

const Ctx = createContext<ActionState>(null);
const PendingCtx = createContext(false);

/**
 * Form bound to a server action. Prevents double submission, shows field errors next to inputs,
 * a summary error at the top, success toasts, and follows server-provided redirects.
 */
export function ActionForm({
  action,
  children,
  className,
  successMessage,
  resetOnSuccess,
  onSuccess,
  id,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  children: ReactNode;
  className?: string;
  successMessage?: string;
  resetOnSuccess?: boolean;
  onSuccess?: (s: ActionState) => void;
  id?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  const router = useRouter();
  useEffect(() => {
    if (!state?.at) return;
    if (state.ok) {
      if (successMessage || state.message) toast(state.message ?? successMessage!);
      if (resetOnSuccess) ref.current?.reset();
      onSuccess?.(state);
      if (state.redirectTo) router.push(state.redirectTo);
    } else if (state.error) {
      toast(state.error.split('\n')[0], 'bad');
      if (state.redirectTo) router.push(state.redirectTo);
      const first = state.fieldErrors && Object.keys(state.fieldErrors)[0];
      if (first) (ref.current?.querySelector(`[name="${first}"]`) as HTMLElement | null)?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.at]);
  return (
    <Ctx.Provider value={state}>
      <PendingCtx.Provider value={pending}>
        {/*
        Submitting through onSubmit (instead of <form action>) keeps what the person typed when the
        server rejects the input — React would otherwise reset the form after every action.
      */}
        {/* method="post": if JavaScript has not loaded yet, a submit must never put fields in the URL. */}
        <form
          ref={ref}
          method="post"
          className={className}
          id={id}
          aria-busy={pending}
          onSubmit={(e) => {
            e.preventDefault();
            if (pending) return; // prevent duplicate submissions
            const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
            const fd = new FormData(e.currentTarget, submitter);
            startTransition(() => formAction(fd));
          }}
        >
          {state?.error ? (
            <div
              role="alert"
              className={`mb-3 max-h-60 overflow-y-auto whitespace-pre-line rounded-md border px-3 py-2 text-[13.5px] text-ink ${state.ok ? 'border-warn/40 bg-warn-soft' : 'border-bad/30 bg-bad-soft'}`}
            >
              {state.ok && state.message ? <p className="mb-1 font-medium">{state.message}</p> : null}
              {state.error}
            </div>
          ) : null}
          {state?.ok && state.secret ? (
            <div
              role="status"
              className="mb-3 rounded-md border border-warn/40 bg-warn-soft px-3 py-2 text-[13.5px]"
            >
              <p className="font-medium text-ink">Copy this now — it will not be shown again.</p>
              <code className="mt-1 block select-all break-all rounded bg-surface px-2 py-1 text-[13px] text-ink">
                {state.secret}
              </code>
            </div>
          ) : null}
          {children}
        </form>
      </PendingCtx.Provider>
    </Ctx.Provider>
  );
}

export function useFieldError(name: string) {
  return useContext(Ctx)?.fieldErrors?.[name];
}

export function FieldError({ name }: { name: string }) {
  const e = useFieldError(name);
  return e ? (
    <p id={`${name}-error`} className="text-[12.5px] text-bad">
      {e}
    </p>
  ) : null;
}

/** Label + control + error, reading errors from the enclosing ActionForm. */
export function FormField({
  label,
  name,
  hint,
  required,
  children,
  className,
}: {
  label: string;
  name: string;
  hint?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const err = useFieldError(name);
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)} data-invalid={err ? 'true' : undefined}>
      <label htmlFor={name} className="text-[13px] font-medium text-ink-2">
        {label}
        {required ? <span className="text-bad"> *</span> : null}
      </label>
      <div className="[&_input]:aria-[invalid=true]:border-bad" aria-invalid={err ? true : undefined}>
        {children}
      </div>
      {err ? (
        <p className="text-[12.5px] text-bad">{err}</p>
      ) : hint ? (
        <p className="text-[12.5px] text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function SubmitButton({
  children,
  variant = 'primary',
  size = 'md',
  className,
  pendingText,
  name,
  value,
  confirm,
}: {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  className?: string;
  pendingText?: string;
  name?: string;
  value?: string;
  confirm?: string;
}) {
  const { pending: nativePending } = useFormStatus();
  const pending = useContext(PendingCtx) || nativePending;
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      aria-busy={pending}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
      className={cn(buttonClass(variant, size), className)}
    >
      {pending ? (pendingText ?? 'Saving…') : children}
    </button>
  );
}
