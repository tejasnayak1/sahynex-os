'use client';
import Link from 'next/link';
import { ActionForm, SubmitButton } from '@/components/client/action-form';
import { Dialog } from '@/components/client/dialog';
import { cn, inputClass } from '@/components/ui';
import { deleteViewAction, saveViewAction } from './view-actions';

export function SavedViews({
  module,
  path,
  query,
  views,
}: {
  module: string;
  path: string;
  query: string;
  views: Array<{ id: string; name: string; query: string }>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {views.map((v) => (
        <span
          key={v.id}
          className={cn(
            'inline-flex items-center rounded-full border text-[13px]',
            v.query === query ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-surface',
          )}
        >
          <Link href={`${path}?${v.query}`} className="py-1 pl-3 pr-1.5">
            {v.name}
          </Link>
          <ActionForm action={deleteViewAction}>
            <input type="hidden" name="id" value={v.id} />
            <input type="hidden" name="path" value={path} />
            <button
              type="submit"
              aria-label={`Delete saved view ${v.name}`}
              className="rounded-full px-1.5 py-1 text-faint hover:text-bad"
            >
              ×
            </button>
          </ActionForm>
        </span>
      ))}
      {query ? (
        <Dialog trigger="Save this view" title="Save current filters" triggerSize="sm" triggerVariant="ghost">
          {(close) => (
            <ActionForm action={saveViewAction} onSuccess={close} className="space-y-3">
              <input type="hidden" name="module" value={module} />
              <input type="hidden" name="path" value={path} />
              <input type="hidden" name="query" value={query} />
              <label htmlFor="viewname" className="text-[13px] font-medium">
                Name
              </label>
              <input
                id="viewname"
                name="name"
                required
                maxLength={60}
                className={inputClass}
                placeholder="e.g. My overdue admissions leads"
              />
              <SubmitButton>Save view</SubmitButton>
            </ActionForm>
          )}
        </Dialog>
      ) : null}
    </div>
  );
}
