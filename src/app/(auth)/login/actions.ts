'use server';
import { cookies } from 'next/headers';
import { authenticate } from '@/server/auth/login';
import { cookieOptions, requestMeta } from '@/server/auth/current';
import { SESSION_COOKIE } from '@/server/auth/session';
import { isAppError } from '@/server/errors';
import type { ActionState } from '@/server/action';

export async function loginAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const email = String(fd.get('email') ?? '');
  const password = String(fd.get('password') ?? '');
  const next = String(fd.get('next') ?? '/dashboard');
  if (!email || !password) return { ok: false, error: 'Enter your email and password.', at: Date.now() };
  try {
    const { token, expiresAt } = await authenticate(email, password, await requestMeta());
    (await cookies()).set(SESSION_COOKIE, token, cookieOptions(expiresAt));
    // Only allow same-site relative redirects.
    return {
      ok: true,
      redirectTo: next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard',
      at: Date.now(),
    };
  } catch (e) {
    if (isAppError(e)) return { ok: false, error: e.message, at: Date.now() };
    console.error('[login]', e);
    return { ok: false, error: 'Sign-in is unavailable right now. Try again shortly.', at: Date.now() };
  }
}
