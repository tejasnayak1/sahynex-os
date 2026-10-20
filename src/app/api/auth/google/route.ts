import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { appUrl } from '@/lib/app-url';
import {
  GOOGLE_LOGIN_COOKIE,
  googleConfigured,
  loginAuthUrl,
  signState,
} from '@/server/integrations/google-user';

/** Starts "Sign in with Google". The state is signed and also pinned in a cookie (login-CSRF guard). */
export async function GET(req: Request) {
  if (!googleConfigured().ok) return NextResponse.redirect(appUrl('/login?google=not_configured', req));
  const remember = new URL(req.url).searchParams.get('remember') !== '0';
  const state = signState(remember ? 'login' : 'login-session');
  (await cookies()).set(GOOGLE_LOGIN_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  });
  return NextResponse.redirect(loginAuthUrl(state));
}
