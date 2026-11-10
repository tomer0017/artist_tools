# 0003 — Accounts are linked only explicitly, from a signed-in session

**Status:** Accepted (2026-11-10)

## Context
With two sign-in methods, the same address can appear twice. Better Auth by
default links a social sign-in to an existing user with the same verified
email ("implicit linking"). That merges accounts because addresses match,
which the mission forbids and which enables takeover when a provider's email
claim is wrong or an address is recycled.

## Decision
- `accountLinking: { enabled: true, disableImplicitLinking: true }`,
  `allowDifferentEmails: false`, `requireLocalEmailVerified: true`, no
  trusted providers.
- A Google sign-in whose address belongs to a password account is refused;
  the sign-in page explains how to sign in with the password and connect
  Google from the account page.
- Connecting Google: only while signed in, via `linkSocial`; Google must report
  the same, verified address. Adding a password to a Google account: only
  while signed in with a session younger than 10 minutes, through the
  server-only `setPassword`.
- Removing a sign-in method requires another one to remain.
- Every link, unlink and password addition is audited and notified by email.

## Consequences
- No silent merges; a person proves control of both methods in one session.
- A person who first used a password and then taps "Continue with Google" gets
  an explanation instead of an automatic merge — one extra step, by design.

## Alternatives considered
- Implicit linking for verified Google addresses (the library default):
  convenient, but it is exactly the email-match merge the mission rules out.
