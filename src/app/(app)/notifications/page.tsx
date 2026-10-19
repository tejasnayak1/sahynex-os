import Link from 'next/link';
import { ActionButton } from '@/components/client/auto-submit';
import { EmptyState, PageHeader, cn } from '@/components/ui';
import { formatDateTime, relativeTime } from '@/lib/format';
import { readParams } from '@/lib/params';
import { requireActor } from '@/server/auth/current';
import { listNotifications } from '@/server/services/notifications';
import { markReadAction } from './actions';

export const metadata = { title: 'Notifications' };

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireActor();
  const sp = await readParams(searchParams);
  const unread = sp.filter !== 'all';
  const items = await listNotifications(actor, { unreadOnly: unread, limit: 100 });
  return (
    <>
      <PageHeader
        title="Notifications"
        description="Assignments, reminders, escalations and alerts for you."
        actions={
          <ActionButton action={markReadAction} hidden={{ all: '1' }} size="md">
            Mark all as read
          </ActionButton>
        }
      />
      <nav className="mb-3 flex gap-1.5" aria-label="Filter">
        {[
          ['unread', 'Unread'],
          ['all', 'All'],
        ].map(([k, l]) => (
          <Link
            key={k}
            href={`/notifications?filter=${k}`}
            aria-current={(k === 'all') !== unread ? 'page' : undefined}
            className={cn(
              'rounded-full border px-3 py-1 text-[13px]',
              (k === 'all') !== unread
                ? 'border-accent bg-accent-soft text-accent'
                : 'border-line bg-surface',
            )}
          >
            {l}
          </Link>
        ))}
      </nav>
      {items.length ? (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {items.map((n) => (
            <li key={n.id} className={cn('flex gap-3 px-4 py-3', !n.readAt && 'bg-accent-soft/40')}>
              <span
                aria-hidden
                className={cn(
                  'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                  n.severity === 'high'
                    ? 'bg-bad'
                    : n.severity === 'warning'
                      ? 'bg-warn'
                      : n.readAt
                        ? 'bg-line-strong'
                        : 'bg-accent',
                )}
              />
              <div className="min-w-0 flex-1">
                {n.link ? (
                  <Link href={n.link} className="font-medium text-ink hover:underline">
                    {n.title}
                  </Link>
                ) : (
                  <span className="font-medium">{n.title}</span>
                )}
                {n.body ? <p className="text-[13px] text-ink-2">{n.body}</p> : null}
                <p className="text-[12px] text-muted" title={formatDateTime(n.createdAt)}>
                  {relativeTime(n.createdAt)}
                </p>
              </div>
              {!n.readAt ? (
                <ActionButton action={markReadAction} hidden={{ ids: n.id }} variant="ghost">
                  Mark read
                </ActionButton>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title={unread ? 'You’re all caught up' : 'No notifications yet'}
          body="Assignments, reminders and alerts will appear here."
        />
      )}
    </>
  );
}
