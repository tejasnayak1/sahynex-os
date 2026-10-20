'use client';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { buttonClass, cn } from '../ui';

/** Accessible modal using the native <dialog> element (focus trapping, Esc to close). */
export function Dialog({
  trigger,
  title,
  children,
  triggerVariant = 'secondary',
  triggerSize = 'md',
  wide,
  triggerClassName,
  guardUnsaved,
  triggerLabel,
}: {
  trigger: ReactNode;
  title: string;
  children: (close: () => void) => ReactNode;
  triggerVariant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  triggerSize?: 'sm' | 'md';
  wide?: boolean;
  triggerClassName?: string;
  /** Ask before closing if anything inside was edited (closing after a successful save never asks). */
  guardUnsaved?: boolean;
  /** Accessible name for the trigger when its visible text is ambiguous (e.g. "Edit"). */
  triggerLabel?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const dirty = useRef(false);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const close = () => setOpen(false);
  const requestClose = () => {
    if (guardUnsaved && dirty.current && !window.confirm('Discard your unsaved changes?')) return false;
    setOpen(false);
    return true;
  };
  return (
    <>
      <button
        type="button"
        className={cn(buttonClass(triggerVariant, triggerSize), triggerClassName)}
        onClick={() => {
          dirty.current = false;
          setOpen(true);
        }}
        aria-label={triggerLabel}
      >
        {trigger}
      </button>
      <dialog
        ref={ref}
        onClose={close}
        onCancel={(e) => {
          // Esc: keep the dialog open if the person chooses not to discard their edits.
          if (!requestClose()) e.preventDefault();
        }}
        aria-labelledby={titleId}
        className={cn(
          'm-auto w-[calc(100vw-32px)] rounded-lg border border-line bg-surface p-0 text-ink shadow-[0_20px_60px_rgb(10_20_30/0.25)]',
          wide ? 'max-w-3xl' : 'max-w-lg',
        )}
      >
        {open ? (
          <div className="flex max-h-[85vh] flex-col">
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <h2 id={titleId} className="text-[16px] font-semibold">
                {title}
              </h2>
              <button
                type="button"
                onClick={requestClose}
                className={buttonClass('ghost', 'sm')}
                aria-label="Close dialog"
              >
                ✕
              </button>
            </div>
            <div
              className="overflow-y-auto px-5 py-4"
              onInput={() => (dirty.current = true)}
              onChange={() => (dirty.current = true)}
            >
              {children(close)}
            </div>
          </div>
        ) : null}
      </dialog>
    </>
  );
}
