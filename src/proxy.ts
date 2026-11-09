import { NextResponse, type NextRequest } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';

// Fast path only: visitors without a session cookie go to sign-in before any
// studio code downloads, and come back to the page they asked for. A cookie
// can be forged, so every page and API route still verifies the session on the
// server (src/server/session.ts).

export function proxy(request: NextRequest) {
  if (getSessionCookie(request, { cookiePrefix: 'sc' })) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = '/sign-in';
  url.search = `?callbackURL=${encodeURIComponent(request.nextUrl.pathname + request.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/app', '/app/:path*', '/admin', '/admin/:path*'],
};
