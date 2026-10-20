'use client';
import { useRef, useState, useTransition } from 'react';
import { Check, Copy, EllipsisVertical, ExternalLink } from 'lucide-react';
import { toast } from '@/components/client/toast';
import { cn } from '@/components/ui';
import { taskStatusAction } from '../tasks/actions';

/** A small "⋮" menu with real actions only (open a link, copy a link). */
export function RowMenu({
  label,
  items,
}: {
  label: string;
  items: Array<{ label: string; href?: string; copy?: string }>;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const shown = items.filter((i) => i.href || i.copy);
  if (!shown.length) return <span className="w-8" aria-hidden />;
  return (
    <details ref={ref} className="relative shrink-0">
      <summary
        aria-label={label}
        className="grid h-8 w-8 cursor-pointer list-none place-items-center rounded-md text-muted hover:bg-surface hover:text-ink [&::-webkit-details-marker]:hidden"
      >
        <EllipsisVertical size={17} aria-hidden />
      </summary>
      <div className="absolute right-0 z-20 mt-1 w-48 rounded-lg border border-line bg-surface p-1 shadow-[0_12px_32px_rgb(0_0_0/0.35)]">
        {shown.map((i) =>
          i.href ? (
            <a
              key={i.label}
              href={i.href}
              target={i.href.startsWith('http') ? '_blank' : undefined}
              rel="noreferrer noopener"
              onClick={() => ref.current?.removeAttribute('open')}
              className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13.5px] hover:bg-surface-2"
            >
              <ExternalLink size={14} aria-hidden /> {i.label}
            </a>
          ) : (
            <button
              key={i.label}
              type="button"
              onClick={async () => {
                ref.current?.removeAttribute('open');
                try {
                  await navigator.clipboard.writeText(i.copy!);
                  toast('Copied');
                } catch {
                  toast('Couldn’t copy', 'bad');
                }
              }}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13.5px] hover:bg-surface-2"
            >
              <Copy size={14} aria-hidden /> {i.label}
            </button>
          ),
        )}
      </div>
    </details>
  );
}

/** Ticking the box marks the task done (through the normal, permission-checked task update). */
export function TaskCheck({ id, title }: { id: string; title: string }) {
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={`Mark “${title}” done`}
      disabled={pending || done}
      onClick={() =>
        start(async () => {
          setDone(true);
          const fd = new FormData();
          fd.set('id', id);
          fd.set('status', 'done');
          const res = await taskStatusAction(null, fd);
          if (res?.ok) toast('Task done');
          else {
            setDone(false);
            toast(res?.error ?? 'Couldn’t update the task', 'bad');
          }
        })
      }
      className={cn(
        'grid h-5 w-5 shrink-0 place-items-center rounded-[5px] border-2 transition-colors',
        done ? 'border-accent bg-accent text-accent-ink' : 'border-line-strong hover:border-accent',
      )}
    >
      {done ? <Check size={13} strokeWidth={3} aria-hidden /> : null}
    </button>
  );
}
