import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db, schema, type DBOrTx } from '@/db';
import type { Actor } from '../actor';
import { forbidden } from '../errors';

const { notifications, users, roles } = schema;

export type NotifyInput = {
  orgId: string;
  userId: string;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  severity?: 'info' | 'warning' | 'high';
  /** Same dedupe key for the same user is stored once — retries never produce duplicate notifications. */
  dedupeKey?: string | null;
};

/** Returns true when a new notification was created (false = deduplicated). */
export async function notify(tx: DBOrTx, n: NotifyInput): Promise<boolean> {
  const res = await tx
    .insert(notifications)
    .values({
      orgId: n.orgId,
      userId: n.userId,
      type: n.type,
      title: n.title.slice(0, 300),
      body: n.body ?? null,
      link: n.link ?? null,
      severity: n.severity ?? 'info',
      dedupeKey: n.dedupeKey ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: notifications.id });
  return res.length > 0;
}

/** Active users holding any of the given role keys (e.g. escalate to ['coo','ceo']). */
export async function usersWithRoles(tx: DBOrTx, orgId: string, roleKeys: string[]) {
  if (!roleKeys.length) return [];
  return tx
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(and(eq(users.orgId, orgId), eq(users.isActive, true), inArray(roles.key, roleKeys)));
}

export async function listNotifications(actor: Actor, opts: { unreadOnly?: boolean; limit?: number } = {}) {
  if (actor.kind !== 'user') throw forbidden();
  return db
    .select()
    .from(notifications)
    .where(
      and(eq(notifications.userId, actor.id), opts.unreadOnly ? isNull(notifications.readAt) : undefined),
    )
    .orderBy(desc(notifications.createdAt))
    .limit(Math.min(opts.limit ?? 50, 200));
}

export async function unreadCount(actor: Actor): Promise<number> {
  if (actor.kind !== 'user') return 0;
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, actor.id), isNull(notifications.readAt)));
  return r?.n ?? 0;
}

export async function markRead(actor: Actor, ids: string[] | 'all') {
  if (actor.kind !== 'user') throw forbidden();
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.userId, actor.id),
        isNull(notifications.readAt),
        ids === 'all'
          ? undefined
          : inArray(notifications.id, ids.length ? ids : ['00000000-0000-0000-0000-000000000000']),
      ),
    );
}
