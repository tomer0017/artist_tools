// ─── Usernames ────────────────────────────────────────────────────────────────
// Accounts that an administrator creates for invited testers sign in with a
// username and a password instead of Google (ADR-0012). There is no public
// registration for them. A username is 3–30 letters, digits, dots or
// underscores; it is stored in lower case (sign-in ignores case) and shown as
// it was typed ("Tomerfree").
//
// Better Auth needs an email address on every account, so a username account
// gets a reserved placeholder under `.invalid` (RFC 2606): a domain that can
// never receive mail, so no message is ever delivered to it, and that no
// Google account can ever have, so a Google sign-in can never meet, merge with
// or take over a username account. Pages show the username instead.

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 30;
const USERNAME_PATTERN = /^[a-zA-Z0-9_.]+$/;

/** The domain of username accounts' placeholder addresses. */
export const USERNAME_EMAIL_DOMAIN = 'users.studio-companion.invalid';

export type UsernameProblem = 'too_short' | 'too_long' | 'invalid';

/** Why a username cannot be used, or null when it can (the same rules as Better Auth's username plugin). */
export function usernameProblem(username: string): UsernameProblem | null {
  if (username.length < USERNAME_MIN_LENGTH) return 'too_short';
  if (username.length > USERNAME_MAX_LENGTH) return 'too_long';
  return USERNAME_PATTERN.test(username) ? null : 'invalid';
}

/** The stored (lower-case) form of a username; sign-in compares this. */
export const normalizeUsername = (username: string) => username.trim().toLowerCase();

/** The placeholder address of a username account. */
export const usernameEmail = (username: string) => `${normalizeUsername(username)}@${USERNAME_EMAIL_DOMAIN}`;

/** Whether an address is a username account's placeholder (never a real mailbox). */
export const isUsernameEmail = (email: string | null | undefined) => typeof email === 'string' && email.toLowerCase().endsWith(`@${USERNAME_EMAIL_DOMAIN}`);

/** How to name an account on screen: its username when it has one, else its email address. */
export const accountIdentity = (account: { email: string; username?: string | null }) => account.username || account.email;
