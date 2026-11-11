import { NextResponse, type NextRequest } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';
import { LOCALE_COOKIE, LOCALE_HEADER, PREFIXABLE_PATHS } from '@/i18n/config';
import { RETURN_TO_HEADER } from '@/lib/redirects';

// Fast path only: visitors without a session cookie go to sign-in before any
// studio code downloads, and come back to the page they asked for. A cookie
// can be forged, so every page and API route still verifies the session on the
// server (src/server/session.ts). Also serves the /he public pages.

/**
 * Hebrew public pages live under /he (for search engines and shared links):
 * src/app/he/* re-exports the same pages, and this header — always set here,
 * never taken from the client — tells them to render in Hebrew; the choice is
 * remembered in a cookie. Anything else under /he goes to its unprefixed
 * address. (No URL rewrite: behind nginx a rewrite became an https proxy
 * request to the app's own plain-http port.)
 */
function localePrefix(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const rest = pathname === '/he' ? '/' : pathname.slice(3);
  let response: NextResponse;
  if ((PREFIXABLE_PATHS as readonly string[]).includes(rest)) {
    const headers = withHeader(request, LOCALE_HEADER, 'he');
    headers.delete(RETURN_TO_HEADER);
    response = NextResponse.next({ request: { headers } });
  } else {
    const url = request.nextUrl.clone();
    url.pathname = rest;
    response = NextResponse.redirect(url);
  }
  // Visiting a /he page remembers Hebrew; a server action posted from one
  // (e.g. the language switch choosing English) must not undo its own choice.
  if (request.method === 'GET') response.cookies.set(LOCALE_COOKIE, 'he', { path: '/', sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 });
  return response;
}

function withHeader(request: NextRequest, name: string, value: string) {
  const headers = new Headers(request.headers);
  headers.set(name, value);
  return headers;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === '/he' || pathname.startsWith('/he/')) return localePrefix(request);

  // Only this proxy says which language a page is in, or where a studio page
  // should come back to: whatever a client sent in these headers is dropped.
  const headers = new Headers(request.headers);
  headers.delete(LOCALE_HEADER);
  headers.delete(RETURN_TO_HEADER);

  const studio = pathname === '/app' || pathname.startsWith('/app/') || pathname === '/admin' || pathname.startsWith('/admin/');
  if (!studio) return NextResponse.next({ request: { headers } });

  const wanted = request.nextUrl.pathname + request.nextUrl.search;
  if (getSessionCookie(request, { cookiePrefix: 'sc' })) {
    headers.set(RETURN_TO_HEADER, wanted);
    return NextResponse.next({ request: { headers } });
  }
  const url = request.nextUrl.clone();
  url.pathname = '/sign-in';
  url.search = `?callbackURL=${encodeURIComponent(wanted)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except static files and API routes (which never render pages).
  matcher: ['/((?!_next/|api/|images/|favicon|.*\\.[a-z0-9]+$).*)'],
};
