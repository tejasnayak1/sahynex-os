'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActionState } from '@/server/action';
import { ActionForm, FormField, SubmitButton } from '@/components/client/action-form';
import { cn, inputClass, textareaClass } from '@/components/ui';
import {
  approveAction,
  commentaryAction,
  dailyUpdateAction,
  generateAction,
  submitReviewAction,
} from './actions';

export function GenerateReport({
  types,
  clients,
  defaults,
}: {
  types: Array<{ value: string; label: string }>;
  clients: Array<{ id: string; name: string }>;
  defaults: { start: string; end: string };
}) {
  const [type, setType] = useState(types[0]?.value ?? 'monthly_client');
  return (
    <ActionForm
      action={generateAction}
      className="grid gap-3 sm:grid-cols-[1.2fr_1fr_150px_150px_auto] sm:items-end"
    >
      <FormField label="Report" name="type">
        <select
          id="type"
          name="type"
          value={type}
          onChange={(e) => setType(e.target.value)}
          className={inputClass}
        >
          {types.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </FormField>
      <FormField label="Client" name="clientId">
        <select
          id="clientId"
          name="clientId"
          disabled={!['monthly_client', 'weekly_campaign'].includes(type)}
          required={type === 'monthly_client'}
          className={inputClass}
          defaultValue=""
        >
          <option value="">{type === 'monthly_client' ? 'Choose…' : 'All clients'}</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </FormField>
      <FormField label="From" name="periodStart">
        <input
          id="periodStart"
          name="periodStart"
          type="date"
          defaultValue={defaults.start}
          required
          className={inputClass}
        />
      </FormField>
      <FormField label="To" name="periodEnd">
        <input
          id="periodEnd"
          name="periodEnd"
          type="date"
          defaultValue={defaults.end}
          required
          className={inputClass}
        />
      </FormField>
      <SubmitButton pendingText="Generating…">Generate draft</SubmitButton>
    </ActionForm>
  );
}

/** Commentary with debounced autosave and a visible save status. Drafts survive navigation via the server. */
export function Commentary({ id, value, editable }: { id: string; value: string; editable: boolean }) {
  const [text, setText] = useState(value);
  const [status, setStatus] = useState<'saved' | 'unsaved' | 'saving' | 'error'>('saved');
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(value);
  const save = useCallback(
    async (v: string) => {
      setStatus('saving');
      const fd = new FormData();
      fd.set('id', id);
      fd.set('commentary', v);
      const res = await commentaryAction(null, fd).catch(
        () =>
          ({
            ok: false,
            error: 'Network error — your text is still here; it will retry when you type again.',
          }) as ActionState,
      );
      if (latest.current !== v) return; // a newer edit is pending
      if (res?.ok) {
        setStatus('saved');
        setErr(null);
      } else {
        setStatus('error');
        setErr(res?.error ?? 'Could not save.');
      }
    },
    [id],
  );
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (status === 'unsaved' || status === 'saving') e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [status]);
  if (!editable) return <p className="whitespace-pre-line text-ink-2">{value || 'No commentary.'}</p>;
  return (
    <div className="space-y-1.5">
      <label htmlFor="commentary" className="sr-only">
        Commentary
      </label>
      <textarea
        id="commentary"
        value={text}
        onChange={(e) => {
          const v = e.target.value;
          setText(v);
          latest.current = v;
          setStatus('unsaved');
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => void save(v), 900);
        }}
        className={cn(textareaClass, 'min-h-40')}
        placeholder="Interpretation and recommendations, written by the account team. Keep claims tied to the measured figures above."
      />
      <p aria-live="polite" className={cn('text-[12.5px]', status === 'error' ? 'text-bad' : 'text-muted')}>
        {status === 'saved'
          ? 'All changes saved'
          : status === 'saving'
            ? 'Saving…'
            : status === 'unsaved'
              ? 'Unsaved changes'
              : err}
      </p>
    </div>
  );
}

export function ReviewButtons({
  id,
  status,
  canApprove,
  canSubmit,
  demo,
  isClient,
}: {
  id: string;
  status: string;
  canApprove: boolean;
  canSubmit: boolean;
  demo: boolean;
  isClient: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => window.print()}
        className="inline-flex h-9 items-center rounded-md border border-line-strong bg-surface px-3.5 text-[14px] font-medium hover:bg-surface-2"
      >
        Print / save PDF
      </button>
      {canSubmit && status === 'draft' ? (
        <ActionForm action={submitReviewAction}>
          <input type="hidden" name="id" value={id} />
          <SubmitButton variant="secondary">Send for review</SubmitButton>
        </ActionForm>
      ) : null}
      {canApprove && (status === 'draft' || status === 'in_review') && !(demo && isClient) ? (
        <ActionForm action={approveAction}>
          <input type="hidden" name="id" value={id} />
          <SubmitButton
            confirm={
              isClient
                ? 'Approve and deliver this report to the client? Approved reports cannot be edited.'
                : 'Approve this report?'
            }
          >
            Approve & deliver
          </SubmitButton>
        </ActionForm>
      ) : null}
    </div>
  );
}

export function DailyUpdateForm({
  date,
  existing,
}: {
  date: string;
  existing?: {
    completed: string;
    inProgress: string | null;
    blockers: string | null;
    plannedNext: string | null;
  };
}) {
  return (
    <ActionForm action={dailyUpdateAction} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="date" value={date} />
      <FormField label="Completed today" name="completed" required className="sm:col-span-2">
        <textarea
          id="completed"
          name="completed"
          required
          defaultValue={existing?.completed}
          className={textareaClass}
        />
      </FormField>
      <FormField label="In progress" name="inProgress">
        <textarea
          id="inProgress"
          name="inProgress"
          defaultValue={existing?.inProgress ?? ''}
          className={textareaClass}
        />
      </FormField>
      <FormField label="Blockers" name="blockers" hint="Anything you need from someone else.">
        <textarea
          id="blockers"
          name="blockers"
          defaultValue={existing?.blockers ?? ''}
          className={textareaClass}
        />
      </FormField>
      <FormField label="Planned next" name="plannedNext" className="sm:col-span-2">
        <textarea
          id="plannedNext"
          name="plannedNext"
          defaultValue={existing?.plannedNext ?? ''}
          className={textareaClass}
        />
      </FormField>
      <div>
        <SubmitButton>{existing ? 'Update' : 'Submit update'}</SubmitButton>
      </div>
    </ActionForm>
  );
}
