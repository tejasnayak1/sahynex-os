import { and, eq, gt, lt } from 'drizzle-orm';
import { db, schema } from '@/db';
import type { Permission } from '@/lib/permissions';
import type { UserActor } from '../actor';
import { randomToken, sha256 } from '../crypto';

const { sessions, users, roles, rolePermissions } = schema;

export const SESSION_COOKIE = 'sx_session';
export const SESSION_TTL_DAYS = 14;
const RENEW_THRESHOLD_MS = 7 * 24 * 3600 * 1000;

export async function createSession(
  userId: string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 3600 * 1000);
  await db.insert(sessions).values({
    id: sha256(token),
    userId,
    expiresAt,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent?.slice(0, 300) ?? null,
  });
  return { token, expiresAt };
}

export async function loadActorForUser(userId: string): Promise<UserActor | null> {
  const row = await db
    .select({ user: users, role: roles })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(eq(users.id, userId))
    .limit(1);
  const r = row[0];
  if (!r || !r.user.isActive) return null;
  const perms = await db
    .select({ key: rolePermissions.permissionKey })
    .from(rolePermissions)
    .where(eq(rolePermissions.roleId, r.role.id));
  return {
    kind: 'user',
    id: r.user.id,
    orgId: r.user.orgId,
    name: r.user.name,
    email: r.user.email,
    roleKey: r.role.key,
    roleName: r.role.name,
    jobTitle: r.user.jobTitle,
    clientId: r.user.clientId,
    permissions: new Set(perms.map((p) => p.key as Permission)),
  };
}

/** Validates a raw session token. Renews (sliding expiry) when close to expiry. */
export async function validateSessionToken(
  token: string,
): Promise<{ actor: UserActor; renewedExpiresAt: Date | null } | null> {
  if (!token || token.length > 200) return null;
  const id = sha256(token);
  const [s] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())))
    .limit(1);
  if (!s) return null;
  const actor = await loadActorForUser(s.userId);
  if (!actor) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }
  let renewedExpiresAt: Date | null = null;
  if (s.expiresAt.getTime() - Date.now() < RENEW_THRESHOLD_MS) {
    renewedExpiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 3600 * 1000);
    await db.update(sessions).set({ expiresAt: renewedExpiresAt }).where(eq(sessions.id, id));
  }
  return { actor, renewedExpiresAt };
}

export async function invalidateSession(token: string) {
  await db.delete(sessions).where(eq(sessions.id, sha256(token)));
}

export async function invalidateAllUserSessions(userId: string) {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export async function purgeExpiredSessions() {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}
