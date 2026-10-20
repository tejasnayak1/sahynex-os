import { appUrl } from '@/lib/app-url';
import { NextResponse } from 'next/server';
import { getCurrentActor } from '@/server/auth/current';
import { authUrl, googleConfigured, signState } from '@/server/integrations/google-user';

/** Starts the person's own Google (Gmail + Calendar, read-only) connection. */
export async function GET(req: Request) {
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.redirect(appUrl('/login?next=%2Fhome', req));
  if (actor.clientId) return NextResponse.redirect(appUrl('/home', req));
  if (!googleConfigured().ok) return NextResponse.redirect(appUrl('/home?google=not_configured', req));
  return NextResponse.redirect(authUrl(signState(actor.id)));
}
