import { NextResponse } from 'next/server';
import { isAppError } from './errors';

export function jsonError(e: unknown) {
  if (isAppError(e))
    return NextResponse.json(
      { error: { code: e.code, message: e.message, fields: e.fieldErrors } },
      { status: e.status },
    );
  const ref = Math.random().toString(36).slice(2, 8).toUpperCase();
  console.error(`[api error ${ref}]`, e);
  return NextResponse.json(
    { error: { code: 'INTERNAL', message: `Unexpected error (ref ${ref}).` } },
    { status: 500 },
  );
}

/** CSRF defence for cookie-authenticated mutating route handlers: require a same-origin request. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (!origin) return req.headers.get('sec-fetch-site') === 'same-origin';
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
