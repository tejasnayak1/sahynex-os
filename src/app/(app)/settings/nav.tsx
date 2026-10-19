'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/components/ui';

export function SettingsNav({ items }: { items: Array<{ href: string; label: string }> }) {
  const path = usePathname();
  return (
    <nav aria-label="Settings" className="flex gap-1 overflow-x-auto md:flex-col">
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          aria-current={path.startsWith(i.href) ? 'page' : undefined}
          className={cn(
            'whitespace-nowrap rounded-md px-3 py-2 text-[13.5px]',
            path.startsWith(i.href)
              ? 'bg-accent-soft font-medium text-accent'
              : 'text-ink-2 hover:bg-surface-2',
          )}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
