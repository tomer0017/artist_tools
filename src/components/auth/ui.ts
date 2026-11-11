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
  'INVALID_EMAIL',
  'TOO_MANY_ATTEMPTS',
  'INVALID_TOKEN',
  'PASSWORD_TOO_SHORT',
  'PASSWORD_TOO_LONG',
  'PASSWORD_TOO_COMMON',
  'PASSWORD_TOO_PREDICTABLE',
  'PASSWORD_PERSONAL',
] as const;
export type AuthErrorKey = (typeof KNOWN)[number] | 'DISABLED' | 'RATE_LIMITED' | 'UNKNOWN';

/** Which message (auth.errors.*) to show for an error the auth server returned — never the raw code. */
export function authErrorKey(error: { status?: number; code?: string } | null | undefined): AuthErrorKey {
  const code = error?.code;
  if (code && (KNOWN as readonly string[]).includes(code)) return code as AuthErrorKey;
  if (code === 'EMAIL_PASSWORD_DISABLED' || code === 'EMAIL_PASSWORD_SIGN_UP_DISABLED') return 'DISABLED';
  if (error?.status === 429) return 'RATE_LIMITED';
  return 'UNKNOWN';
}

export const isPasswordError = (key: AuthErrorKey) => key.startsWith('PASSWORD_');
