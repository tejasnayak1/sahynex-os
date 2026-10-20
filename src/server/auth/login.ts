import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { AppError } from '../errors';
import { rateLimit } from '../rate-limit';
import { writeAudit } from '../audit';
import { verifyPassword, hashPassword } from './password';
import { createSession } from './session';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
// Pre-computed dummy hash so unknown-email logins take similar time (avoids user enumeration).
let dummyHash: Promise<string> | null = null;

export async function authenticate(
  email: string,
  password: string,
  meta: { ip?: string | null; userAgent?: string | null },
) {
  const normalized = email.trim().toLowerCase();
  await rateLimit(`login:ip:${meta.ip ?? 'unknown'}`, Number(process.env.LOGIN_RATE_LIMIT_IP ?? 30), 15 * 60);
  await rateLimit(`login:email:${normalized}`, Number(process.env.LOGIN_RATE_LIMIT_EMAIL ?? 10), 15 * 60);

  const candidates = await db.select().from(schema.users).where(eq(schema.users.email, normalized)).limit(2);
  if (candidates.length !== 1) {
    dummyHash ??= hashPassword('dummy-password-for-timing');
    await verifyPassword(await dummyHash, password);
    throw new AppError('UNAUTHENTICATED', 'Incorrect email or password.');
  }
  const user = candidates[0];
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AppError(
      'UNAUTHENTICATED',
      'This account is temporarily locked after repeated failed sign-ins. Try again later.',
    );
  }
  const ok = user.isActive && (await verifyPassword(user.passwordHash, password));
  if (!ok) {
    const failed = user.failedLoginCount + 1;
    await db
      .update(schema.users)
      .set({
        failedLoginCount: failed >= MAX_FAILED ? 0 : failed,
        lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : user.lockedUntil,
      })
      .where(eq(schema.users.id, user.id));
    if (failed >= MAX_FAILED) {
      await writeAudit(db, {
        orgId: user.orgId,
        actorId: null,
        actorLabel: 'system',
        action: 'auth.locked',
        entityType: 'user',
        entityId: user.id,
        ip: meta.ip,
      });
    }
    throw new AppError('UNAUTHENTICATED', 'Incorrect email or password.');
  }
  await db
    .update(schema.users)
    .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() })
    .where(and(eq(schema.users.id, user.id)));
  const session = await createSession(user.id, meta);
  await writeAudit(db, {
    orgId: user.orgId,
    actorId: user.id,
    action: 'auth.login',
    entityType: 'user',
    entityId: user.id,
    ip: meta.ip,
  });
  return { user, ...session };
}

/**
 * Sign in with Google: only for an existing, active account with exactly this email. Google has
 * already verified the address; nothing is created automatically.
 */
export async function authenticateWithGoogle(
  email: string,
  meta: { ip?: string | null; userAgent?: string | null },
) {
  const normalized = email.trim().toLowerCase();
  await rateLimit(`login:ip:${meta.ip ?? 'unknown'}`, Number(process.env.LOGIN_RATE_LIMIT_IP ?? 30), 15 * 60);
  const candidates = await db.select().from(schema.users).where(eq(schema.users.email, normalized)).limit(2);
  const user = candidates.length === 1 ? candidates[0] : null;
  if (!user || !user.isActive)
    throw new AppError('UNAUTHENTICATED', 'There’s no active Sahynex OS account for that Google email.');
  if (user.lockedUntil && user.lockedUntil > new Date())
    throw new AppError('UNAUTHENTICATED', 'This account is temporarily locked. Try again later.');
  const session = await createSession(user.id, meta);
  await writeAudit(db, {
    orgId: user.orgId,
    actorId: user.id,
    action: 'auth.login_google',
    entityType: 'user',
    entityId: user.id,
    ip: meta.ip ?? null,
  });
  return session;
}
