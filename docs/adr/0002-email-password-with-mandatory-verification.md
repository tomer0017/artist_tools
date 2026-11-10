# 0002 — Email/password through Better Auth, verification before access

**Status:** Accepted (2026-11-10)

## Context
Google is the only sign-in today. Artists without (or unwilling to use) a
Google account need email and password. Passwords bring credential stuffing,
enumeration, reset abuse and pre-registration of someone else's address.

## Decision
- Use Better Auth's `emailAndPassword` with `requireEmailVerification: true`.
  With it the library answers a sign-up for an existing address with the same
  response as a new one (and spends the same hashing work), never signs in
  before verification, and lets us notify the real owner
  (`onExistingUserSignUp`).
- Hashing: the library's scrypt (`node:crypto`), not a custom scheme.
- Policy: 12–128 characters; reject common passwords, long repeats and
  sequences, and passwords containing the address's name part or the product
  name. No composition rules, no forced rotation (NIST SP 800-63B). Enforced on
  the server for sign-up, reset, change and set.
- Tokens: verification links are signed and expire in 24 hours; reset tokens
  are single-use, expire in 30 minutes, and are stored hashed
  (`verification.storeIdentifier: 'hashed'`). A completed reset revokes every
  session.
- The registration gate (invite/open) applies to email sign-ups by address;
  the account stays unusable until verified.
- Unverified accounts are deleted after 24 hours by the nightly maintenance
  command, so a stranger cannot hold an address hostage.
- The whole method sits behind `AUTH_EMAIL_PASSWORD=on` (default off), and the
  server refuses to start with it on but no mail transport.

## Consequences
- Residual risk: someone registers a victim's address and the victim clicks
  the verification link anyway. The email says so plainly ("if you did not
  create this account, ignore this email"), the account is empty, and a reset
  by the real owner revokes the other person's sessions and password.
- Hashed reset tokens mean in-flight tokens are lost when the setting is first
  enabled (OAuth state lives 10 minutes; no resets exist yet).
- Passkeys and TOTP 2FA can be added later through Better Auth plugins.

## Alternatives considered
- Verification-first registration (link before any account exists): removes
  pre-registration entirely but replaces the library's flow with custom code.
  Revisit if R6 materialises.
- Magic links only: no passwords at all, but every sign-in depends on email
  delivery, which we cannot offer reliably without a domain yet.
