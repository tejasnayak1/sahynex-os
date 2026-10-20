'use server';
import { cookies } from 'next/headers';
import { authenticate } from '@/server/auth/login';
import { cookieOptions, requestMeta } from '@/server/auth/current';
import { SESSION_COOKIE } from '@/server/auth/session';
import { isAppError } from '@/server/errors';
import { REMEMBER_COOKIE } from '@/server/integrations/google-user';
import type { ActionState } from '@/server/action';

export async function loginAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const email = String(fd.get('email') ?? '');
  const password = String(fd.get('password') ?? '');
  const next = String(fd.get('next') ?? '/home');
  if (!email || !password) return { ok: false, error: 'Enter your email and password.', at: Date.now() };
  try {
    const { token, expiresAt } = await authenticate(email, password, await requestMeta());
    const remember = fd.get('remember') === 'on';
    const store = await cookies();
    // Without "Remember me" the session cookie ends when the browser closes.
    store.set(
      SESSION_COOKIE,
      token,
      remember ? cookieOptions(expiresAt) : { ...cookieOptions(expiresAt), expires: undefined },
    );
    store.set(REMEMBER_COOKIE, remember ? '1' : '0', { ...cookieOptions(expiresAt) });
    // Only allow same-site relative redirects.
    return {
      ok: true,
      redirectTo: next.startsWith('/') && !next.startsWith('//') ? next : '/home',
      at: Date.now(),
    };
  } catch (e) {
    if (isAppError(e)) return { ok: false, error: e.message, at: Date.now() };
    console.error('[login]', e);
    return { ok: false, error: 'Sign-in is unavailable right now. Try again shortly.', at: Date.now() };
  }
}
