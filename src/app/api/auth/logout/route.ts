import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { SESSION_COOKIE, invalidateSession } from '@/server/auth/session';
import { sameOrigin } from '@/server/http';

export async function POST(req: Request) {
  if (!sameOrigin(req))
    return NextResponse.json({ error: { message: 'Cross-site request rejected.' } }, { status: 403 });
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await invalidateSession(token);
  store.delete(SESSION_COOKIE);
  return NextResponse.redirect(new URL('/login', req.url), 303);
}
