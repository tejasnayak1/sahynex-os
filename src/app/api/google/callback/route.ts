import { NextResponse } from 'next/server';
import { getCurrentActor } from '@/server/auth/current';
import { emailFromIdToken, exchangeCode, verifyState } from '@/server/integrations/google-user';
import { saveGoogleConnection } from '@/server/services/briefing';

/** Google redirects here after the person approves read-only access. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (status: string) => NextResponse.redirect(new URL(`/home?google=${status}`, req.url));
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.redirect(new URL('/login?next=%2Fhome', req.url));
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
