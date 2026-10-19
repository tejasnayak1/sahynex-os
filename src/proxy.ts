import { NextResponse, type NextRequest } from 'next/server';

/**
 * Optimistic check only: send visitors without a session cookie to the login page.
 * Real authentication and authorisation happen on the server for every page, action and API.
 */
export function proxy(req: NextRequest) {
  if (!req.cookies.get('sx_session')) {
    const url = new URL('/login', req.url);
    url.searchParams.set('next', req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!login|forbidden|api|_next/static|_next/image|favicon.ico).*)'],
};
