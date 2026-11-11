import { NextResponse, type NextRequest } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';
import { LOCALE_COOKIE, LOCALE_HEADER, PREFIXABLE_PATHS } from '@/i18n/config';
import { RETURN_TO_HEADER } from '@/lib/redirects';

// Runs before every page (not API routes or static files):
// - fast path for the studio: visitors without a session cookie go to sign-in
//   before any studio code downloads, and come back to the page they asked
//   for. A cookie can be forged, so every page and API route still verifies
//   the session on the server (src/server/session.ts);
// - the /he public pages;
// - a Content-Security-Policy with a fresh nonce per page: only this app's
//   own scripts run (Next.js puts the nonce on its scripts), nothing can frame
//   the site or post forms elsewhere, plugins are off.

const DEV = process.env.NODE_ENV !== 'production';

function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    // 'strict-dynamic': scripts the app's nonce'd scripts load are trusted too (code-split chunks).
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${DEV ? " 'unsafe-eval'" : ''}`,
    // Inline style attributes and the chart component's <style> element.
    "style-src 'self' 'unsafe-inline'",
    // Images people work on are blob:/data: URLs in the browser; profile photos come from Google.
    "img-src 'self' data: blob: https://*.googleusercontent.com",
    "font-src 'self' data:",
    "connect-src 'self'",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "frame-src 'none'",
    "frame-ancestors 'self'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join('; ');
}

/** Pass the request on with these headers, under a per-request CSP. */
function next(headers: Headers) {
  const nonce = btoa(crypto.randomUUID());
  const policy = contentSecurityPolicy(nonce);
  // Next.js reads the nonce from the request's policy and applies it to its scripts.
  headers.set('content-security-policy', policy);
  headers.set('x-nonce', nonce);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', policy);
  return response;
}

/**
 * Hebrew public pages live under /he (for search engines and shared links):
 * src/app/he/* re-exports the same pages, and this header — always set here,
 * never taken from the client — tells them to render in Hebrew; the choice is
 * remembered in a cookie. Anything else under /he goes to its unprefixed
 * address. (No URL rewrite: behind nginx a rewrite became an https proxy
 * request to the app's own plain-http port.)
 */
function localePrefix(request: NextRequest, headers: Headers) {
  const { pathname } = request.nextUrl;
  const rest = pathname === '/he' ? '/' : pathname.slice(3);
  let response: NextResponse;
  if ((PREFIXABLE_PATHS as readonly string[]).includes(rest)) {
    headers.set(LOCALE_HEADER, 'he');
    response = next(headers);
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

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only this proxy says which language a page is in, or where a studio page
  // should come back to: whatever a client sent in these headers is dropped.
  const headers = new Headers(request.headers);
  headers.delete(LOCALE_HEADER);
  headers.delete(RETURN_TO_HEADER);
  headers.delete('x-nonce');

  if (pathname === '/he' || pathname.startsWith('/he/')) return localePrefix(request, headers);

  const studio = pathname === '/app' || pathname.startsWith('/app/') || pathname === '/admin' || pathname.startsWith('/admin/');
  if (!studio) return next(headers);

  const wanted = request.nextUrl.pathname + request.nextUrl.search;
  if (getSessionCookie(request, { cookiePrefix: 'sc' })) {
    headers.set(RETURN_TO_HEADER, wanted);
    return next(headers);
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
