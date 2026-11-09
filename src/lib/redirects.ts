// Where to send someone after signing in. Only internal studio and admin paths
// are allowed, so a crafted link (?callbackURL=https://evil.example, //evil,
// /\evil…) can never turn sign-in into a redirect to another site.

export const DEFAULT_AFTER_SIGN_IN = '/app';

const ALLOWED = /^\/(app|admin)(\/|\?|$)/;
const ORIGIN = 'http://internal.invalid';

export function safeCallbackPath(input: unknown): string {
  if (typeof input !== 'string' || input.length > 512) return DEFAULT_AFTER_SIGN_IN;
  if (!input.startsWith('/') || input.startsWith('//') || input.includes('\\')) return DEFAULT_AFTER_SIGN_IN;
  if ([...input].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f)) return DEFAULT_AFTER_SIGN_IN;
  let url: URL;
  try {
    url = new URL(input, ORIGIN);
  } catch {
    return DEFAULT_AFTER_SIGN_IN;
  }
  if (url.origin !== ORIGIN) return DEFAULT_AFTER_SIGN_IN;
  const path = url.pathname + url.search;
  return ALLOWED.test(path) ? path : DEFAULT_AFTER_SIGN_IN;
}

/** The sign-in page, set to come back to `returnTo` afterwards. */
export const signInPath = (returnTo: string): string => `/sign-in?callbackURL=${encodeURIComponent(safeCallbackPath(returnTo))}`;
