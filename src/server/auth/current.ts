import 'server-only';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import type { Permission } from '@/lib/permissions';
import { can, type UserActor } from '../actor';
import { SESSION_COOKIE, validateSessionToken } from './session';

export const cookieOptions = (expires: Date) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  expires,
});

/** Current signed-in user for this request (memoised per request). */
export const getCurrentActor = cache(async (): Promise<UserActor | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const res = await validateSessionToken(token);
  if (!res) return null;
  if (res.renewedExpiresAt) {
    try {
      const remember = store.get('sx_remember')?.value !== '0';
      const opts = cookieOptions(res.renewedExpiresAt);
      store.set(SESSION_COOKIE, token, remember ? opts : { ...opts, expires: undefined });
    } catch {
      // Cookies are read-only during Server Component render; renewal is persisted on the next action.
    }
  }
  return res.actor;
});

/** For pages and server actions: redirects to login when signed out. */
export async function requireActor(): Promise<UserActor> {
  const actor = await getCurrentActor();
  if (!actor) redirect('/login');
  return actor;
}

/** For pages: renders the 403 page when permission is missing. */
export async function requirePagePermission(...perms: Permission[]): Promise<UserActor> {
  const actor = await requireActor();
  if (!perms.some((p) => can(actor, p))) redirect('/forbidden');
  return actor;
}

export async function requestMeta() {
  const h = await headers();
  return {
    ip: h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || null,
    userAgent: h.get('user-agent'),
  };
}
