'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import { EllipsisVertical } from 'lucide-react';
import { cn } from '../ui';

/** A compact "⋮" menu. Children are the menu items (links, buttons, action buttons). */
export function MoreMenu({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current?.open && !ref.current.contains(e.target as Node)) ref.current.removeAttribute('open');
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  return (
    <details ref={ref} className={cn('relative shrink-0', className)}>
      <summary
        aria-label={label}
        className="grid h-8 w-8 cursor-pointer list-none place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink [&::-webkit-details-marker]:hidden"
      >
        <EllipsisVertical size={17} aria-hidden />
      </summary>
      <div className="absolute right-0 z-30 mt-1 flex w-52 flex-col rounded-lg border border-line bg-surface p-1 shadow-[0_12px_32px_rgb(0_0_0/0.35)] [&>*]:justify-start [&_a]:flex [&_a]:items-center [&_a]:gap-2 [&_a]:rounded-md [&_a]:px-2.5 [&_a]:py-1.5 [&_a]:text-[13.5px] [&_a:hover]:bg-surface-2">
        {children}
      </div>
    </details>
  );
}
