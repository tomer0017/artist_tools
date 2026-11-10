import { NextResponse, type NextRequest } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';
import { RETURN_TO_HEADER } from '@/lib/redirects';

// Fast path only: visitors without a session cookie go to sign-in before any
// studio code downloads, and come back to the page they asked for. A cookie
// can be forged, so every page and API route still verifies the session on the
// server (src/server/session.ts).

export function proxy(request: NextRequest) {
  const wanted = request.nextUrl.pathname + request.nextUrl.search;
  if (getSessionCookie(request, { cookiePrefix: 'sc' })) {
    // Always set here from the real URL, so a client cannot supply its own.
    const headers = new Headers(request.headers);
    headers.set(RETURN_TO_HEADER, wanted);
    return NextResponse.next({ request: { headers } });
  }
  const url = request.nextUrl.clone();
  url.pathname = '/sign-in';
  url.search = `?callbackURL=${encodeURIComponent(wanted)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/app', '/app/:path*', '/admin', '/admin/:path*'],
};
