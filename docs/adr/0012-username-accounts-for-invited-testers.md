# 0012 — Username accounts for invited testers, created only by administrators

**Status:** Accepted (2026-11-18)

## Context
Public sign-in on staging is Google only (since 2026-11-16): email and
password are off until real email exists (ADR-0002, docs/ops/email.md).
QA needs real, database-backed accounts on different plans: the owner must be
able to sign in as a Free account and as a Pro account, switch their plans
from the admin dashboard, and hand accounts to invited testers who may not
have, or want to use, a Google account. Public password registration must stay
closed, and no email or SMTP may be involved.

## Decision
- **A second, separate sign-in method: a username and a password**, through
  Better Auth's username plugin (`POST /api/auth/sign-in/username`), switched
  on per environment with `AUTH_USERNAME_PASSWORD=on` (off by default). It does
  not need, enable or open email + password sign-in; Google is unchanged.
- **No registration.** These accounts are created only by an administrator in
  the dashboard (`/admin/users/new`) or by an operator on the server
  (`npm run db -- create-tester`). Creation goes through a Better Auth endpoint
  marked `SERVER_ONLY`, which the router never exposes over HTTP; it runs the
  library's own user creation and password hashing (scrypt) inside an endpoint
  context, so every database hook and validation still applies. Better Auth's
  admin plugin is not installed: its HTTP endpoints would bypass this app's
  role checks, two-factor gate, recent-sign-in rule and audit.
- **Usernames** are 3–30 English letters, digits, dots or underscores, stored
  in lower case (sign-in ignores case) with the given capitals kept for
  display. They are set only at creation: the API refuses `username` on
  `/update-user` and `/sign-up/email`, and the plugin's availability lookup
  (`/is-username-available`) is switched off, because it would tell anyone
  whether a username exists.
- **No email.** Better Auth needs an address on every account, so a username
  account gets a placeholder under `users.studio-companion.invalid` (RFC 2606:
  it can never receive mail and no Google account can have it). It is marked
  verified because there is nothing to verify; nothing is ever sent to it; it
  is not a way to sign in (`/sign-in/email` refuses it); and it can never match
  a Google identity, so a username account can never meet, merge with or take
  over a Google account (and accounts are never linked implicitly anyway,
  ADR-0003). Pages show the username instead.
- **Passwords are generated, never chosen by an admin and never revealed
  again.** 16 random characters from 56 unambiguous ones (about 93 bits), in
  four groups. From the dashboard, a new password is in the reply to the admin
  who asked, shown once. From the CLI, which must not print it, the initial
  password is sealed (AES-256-GCM, key derived from `BETTER_AUTH_SECRET` for
  this purpose only) in `password_handoffs` and can be revealed once in the
  dashboard for 72 hours; revealing removes it in the same step, and a reset or
  a change of password discards it. A reset makes a new password; the old one
  stops working and every session of the account ends. A tester can change
  their own password on their account page (`/change-password`, with the
  current one, under the password policy).
- **Roles and plans stay separate.** Every username account is created with
  role `user`; it can never be made an admin (`setUserRole` refuses, the
  dashboard explains why): admin access needs a Google sign-in. Its plan is the
  ordinary assigned plan, read by the existing entitlements on every request,
  so plan changes apply at once without a new account.
- **Same protections as passwords elsewhere:** 5 sign-ins a minute per network
  address; 10 wrong passwords for one username pause it for 15 minutes,
  whether or not it exists; one answer for an unknown username and a wrong
  password (the library hashes even when the username is unknown); a suspended
  account that gives the right password is told it is suspended (403), and
  gets no session. Sessions are the existing database sessions (secure,
  HTTP-only, same-site cookies over HTTPS).
- **Audited:** creation, resets, sign-outs by an admin, reveals of an initial
  password, removal from the CLI, sign-ins and failed sign-ins (ids, enums and
  counts only; never a password).

## Consequences
- QA and invited testers use real accounts without Google and without email,
  and nobody can create one by themselves.
- A forgotten password needs an admin (there is no reset by email); the
  sign-in page says so.
- An admin knows a password they handed out until the tester changes it.
- The nightly clean-up of never-confirmed sign-ups never touches username
  accounts.
- Turning `AUTH_USERNAME_PASSWORD` off makes the accounts unable to sign in
  but keeps them and their data (`studio-set-username-login <env> off`).

## Alternatives considered
- **Turning email + password back on with sign-up closed:** it needs real
  email for verification and resets, which the task rules out, and it would
  bring back the public sign-up and reset endpoints.
- **Better Auth's admin plugin:** convenient, but its HTTP endpoints carry
  their own role model (`banned`, admin roles) next to this app's, and would
  bypass the two-factor gate, the recent-sign-in rule and the audit.
- **Showing the CLI's initial passwords in the terminal, or in a root-only
  file:** the first puts them in terminal history and session logs; the
  second needs an SSH session to read. A sealed, short-lived, one-time reveal
  in the dashboard works from the owner's phone and leaves nothing behind.
- **Letting an admin type a password:** generated ones are strong by
  construction and never reused from elsewhere.
