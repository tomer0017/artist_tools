// Shared, non-component pieces of the auth pages (importable from server and
// client components alike).

export const PRIMARY_BUTTON =
  'flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60';

export const PASSWORD_HINT = 'At least 12 characters. A short sentence or a few unrelated words work well.';

/** After an email sign-in (or a verification link it sends), come back through /email-verified to `callbackPath`. */
export const verifiedReturn = (callbackPath: string) => `/email-verified?next=${encodeURIComponent(callbackPath)}`;

/** What to tell people for an error the auth server returned (never the raw code). */
export function authErrorMessage(error: { status?: number; code?: string; message?: string } | null | undefined): string {
  if (!error) return 'Something went wrong. Please try again.';
  if (error.code?.startsWith('PASSWORD_') && error.message) return error.message;
  switch (error.code) {
    case 'INVALID_EMAIL_OR_PASSWORD':
      return 'That email address and password do not match. Try again, or reset your password.';
    case 'INVALID_EMAIL':
      return 'Please enter a valid email address.';
    case 'TOO_MANY_ATTEMPTS':
      return error.message ?? 'Too many attempts. Please wait and try again.';
    case 'INVALID_TOKEN':
      return 'This link has expired or was already used. Please ask for a new one.';
    case 'EMAIL_PASSWORD_DISABLED':
    case 'EMAIL_PASSWORD_SIGN_UP_DISABLED':
      return 'Email sign-in is not available on this server.';
  }
  if (error.status === 429) return 'Too many attempts from this network. Please wait a minute and try again.';
  return 'Something went wrong. Please check your connection and try again.';
}
