# 0001 — Extend the existing stack instead of replacing it

**Status:** Accepted (2026-11-10)

## Context
The app already runs on Next.js 16 (App Router), Better Auth 1.7.18 and
MongoDB 8 on one VPS, with server-only entitlements, an audit log, an
idempotent migration and a health-gated release script. The five painting
tools run entirely in the browser and are protected by visual-parity and
e2e suites. The roadmap adds email/password, admin configuration, i18n and
billing.

## Decision
Keep the stack. Add capabilities as modules beside the existing ones:
`src/server/mail/`, `src/server/security/` (throttles, password policy),
`src/server/config/` (versioned configuration), `src/server/billing/`
(extended), plus routes and pages. Better Auth's built-in features are used
wherever they exist (email/password, verification, reset, linking, session
revocation) rather than re-implemented. The tools' code is not touched except
for text extraction (Phase 3) and analytics hooks (Phase 6).

## Consequences
- One authentication system, one database, one deploy pipeline; existing
  accounts, sessions and the admin keep working through every phase.
- Library upgrades must be tested against our hooks (registration gate,
  token stripping, linking rules) — covered by the auth integration tests.
- A single VPS stays a single point of failure until the product is validated
  (risk R21).

## Alternatives considered
- Hosted identity (Auth0, Clerk, Cognito): faster MFA and email, but a second
  user store to migrate into, per-user fees, and data outside our control.
- Separate API service: more moving parts with no benefit at this size.
