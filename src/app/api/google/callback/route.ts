import { appUrl } from '@/lib/app-url';
import { NextResponse } from 'next/server';
import { getCurrentActor } from '@/server/auth/current';
import { cookies } from 'next/headers';
import { authenticateWithGoogle } from '@/server/auth/login';
import { cookieOptions, requestMeta } from '@/server/auth/current';
import { SESSION_COOKIE } from '@/server/auth/session';
import { isAppError } from '@/server/errors';
import {
  emailFromIdToken,
  exchangeCode,
  exchangeLoginCode,
  GOOGLE_LOGIN_COOKIE,
  REMEMBER_COOKIE,
  verifyState,
} from '@/server/integrations/google-user';
import { saveGoogleConnection } from '@/server/services/briefing';

/** Google redirects here after the person approves read-only access. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const state0 = url.searchParams.get('state') ?? '';
  // "Sign in with Google" shares this redirect URI; its state is pinned in a cookie.
  if (verifyState(state0, 'login') || verifyState(state0, 'login-session'))
    return googleLogin(req, url, state0);
  const back = (status: string) => NextResponse.redirect(appUrl(`/home?google=${status}`, req));
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.redirect(appUrl('/login?next=%2Fhome', req));
  if (url.searchParams.get('error')) return back('cancelled');
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state') ?? '';
  if (!code || !verifyState(state, actor.id)) return back('invalid');
  try {
    const t = await exchangeCode(code);
    await saveGoogleConnection(actor, {
      refreshToken: t.refreshToken,
      email: emailFromIdToken(t.idToken),
      scopes: t.scope,
    });
    return back('connected');
  } catch (e) {
    console.error('[google callback]', e instanceof Error ? e.message : e);
    return back('failed');
  }
}

async function googleLogin(req: Request, url: URL, state: string) {
  const store = await cookies();
  const pinned = store.get(GOOGLE_LOGIN_COOKIE)?.value;
  store.delete(GOOGLE_LOGIN_COOKIE);
  const fail = (code: string) => NextResponse.redirect(appUrl(`/login?google=${code}`, req));
  if (!pinned || pinned !== state) return fail('invalid');
  if (url.searchParams.get('error')) return fail('cancelled');
  const code = url.searchParams.get('code');
  if (!code) return fail('invalid');
  try {
    const email = await exchangeLoginCode(code);
    if (!email) return fail('unverified');
    const { token, expiresAt } = await authenticateWithGoogle(email, await requestMeta());
    const remember = verifyState(state, 'login');
    store.set(
      SESSION_COOKIE,
      token,
      remember ? cookieOptions(expiresAt) : { ...cookieOptions(expiresAt), expires: undefined },
    );
    store.set(REMEMBER_COOKIE, remember ? '1' : '0', { ...cookieOptions(expiresAt), httpOnly: true });
    return NextResponse.redirect(appUrl('/home', req));
  } catch (e) {
    if (isAppError(e) && e.code === 'UNAUTHENTICATED') return fail('no_account');
    console.error('[google login]', e instanceof Error ? e.message : e);
    return fail('failed');
  }
}
