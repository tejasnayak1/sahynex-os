import { NextResponse } from 'next/server';
import { getCurrentActor } from '@/server/auth/current';
import { authUrl, googleConfigured, signState } from '@/server/integrations/google-user';

/** Starts the person's own Google (Gmail + Calendar, read-only) connection. */
export async function GET(req: Request) {
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.redirect(new URL('/login?next=%2Fhome', req.url));
  if (actor.clientId) return NextResponse.redirect(new URL('/home', req.url));
  if (!googleConfigured().ok) return NextResponse.redirect(new URL('/home?google=not_configured', req.url));
  return NextResponse.redirect(authUrl(signState(actor.id)));
}
