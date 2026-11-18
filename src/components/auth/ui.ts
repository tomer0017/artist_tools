import { localizedPath } from '@/i18n/config';
import type { Locale } from '@/lib/locale';

// Shared, non-component pieces of the auth pages (importable from server and
// client components alike).

export const PRIMARY_BUTTON =
  'flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60';

/** After an email sign-in (or a verification link it sends), come back through /email-verified to `callbackPath`. */
export const verifiedReturn = (callbackPath: string, locale: Locale = 'en') =>
  `${localizedPath('/email-verified', locale)}?next=${encodeURIComponent(callbackPath)}`;

const KNOWN = [
  'INVALID_EMAIL_OR_PASSWORD',
  'INVALID_USERNAME_OR_PASSWORD',
  'ACCOUNT_SUSPENDED',
  'INVALID_EMAIL',
  'TOO_MANY_ATTEMPTS',
  'INVALID_TOKEN',
  'PASSWORD_TOO_SHORT',
  'PASSWORD_TOO_LONG',
  'PASSWORD_TOO_COMMON',
  'PASSWORD_TOO_PREDICTABLE',
  'PASSWORD_PERSONAL',
  'SIGNUPS_PAUSED',
] as const;
export type AuthErrorKey = (typeof KNOWN)[number] | 'TOO_MANY_ATTEMPTS_USERNAME' | 'DISABLED' | 'RATE_LIMITED' | 'UNKNOWN';

/** Which message (auth.errors.*) to show for an error the auth server returned — never the raw code. */
export function authErrorKey(error: { status?: number; code?: string } | null | undefined): AuthErrorKey {
  const code = error?.code;
  if (code && (KNOWN as readonly string[]).includes(code)) return code as AuthErrorKey;
  if (code === 'EMAIL_PASSWORD_DISABLED' || code === 'EMAIL_PASSWORD_SIGN_UP_DISABLED') return 'DISABLED';
  if (error?.status === 429) return 'RATE_LIMITED';
  return 'UNKNOWN';
}

export const isPasswordError = (key: AuthErrorKey) => key.startsWith('PASSWORD_');

/**
 * The message for a failed username sign-in. A malformed username gets the
 * same words as a wrong password (no such account can exist), and a pause
 * does not suggest a reset by email, which username accounts do not have.
 */
export function usernameErrorKey(error: { status?: number; code?: string } | null | undefined): AuthErrorKey {
  if (error?.code === 'USERNAME_TOO_SHORT' || error?.code === 'USERNAME_TOO_LONG' || error?.code === 'INVALID_USERNAME') return 'INVALID_USERNAME_OR_PASSWORD';
  const key = authErrorKey(error);
  return key === 'TOO_MANY_ATTEMPTS' ? 'TOO_MANY_ATTEMPTS_USERNAME' : key;
}

// Codes a failed Google sign-in brings back to /sign-in (?error=…).
const SIGN_IN_ERRORS = [
  'access_denied',
  'account_not_linked',
  'not_invited',
  'email_not_verified',
  'signups_paused',
  'unable_to_create_user',
  'unable_to_create_session',
] as const;
export type SignInErrorKey = (typeof SIGN_IN_ERRORS)[number] | 'unable_to_create_user_open' | 'generic';

/**
 * Which message (auth.errors.*) explains `error` on the sign-in page — never
 * the code itself. With open registration no message mentions invitations.
 */
export function signInErrorKey(error: string | undefined, registration: 'open' | 'invite'): SignInErrorKey | null {
  if (!error) return null;
  if (!(SIGN_IN_ERRORS as readonly string[]).includes(error)) return 'generic';
  if (registration === 'open' && error === 'not_invited') return 'generic';
  if (registration === 'open' && error === 'unable_to_create_user') return 'unable_to_create_user_open';
  return error as SignInErrorKey;
}
