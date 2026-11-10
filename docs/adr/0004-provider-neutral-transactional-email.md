# 0004 — Provider-neutral transactional email with a staging outbox

**Status:** Accepted (2026-11-10)

## Context
Verification, reset and security notices need email. There is no domain yet,
so SPF/DKIM/DMARC are impossible and the VPS's Postfix would land in spam.
Choosing a provider is an external account and needs the owner. Marketing
email is out of scope and needs separate consent.

## Decision
- One `Mailer` interface (`send(message)`) with transports selected by
  `MAIL_TRANSPORT`: `disabled` (default; email features stay off), `outbox`
  (stores the message in `mail_outbox` for 24 hours), and later a real
  provider adapter (SMTP or HTTP API) once approved.
- `outbox` is refused when `APP_ENV=production`. On staging, admins read test
  messages at `/admin/mail` (404 otherwise), so the whole flow can be tested
  from an iPhone without sending anything.
- Templates are code (text + HTML), keyed by locale from Phase 3.
- Per-address send limits protect people from email bombing; the limits never
  reveal whether an account exists.
- No tracking pixels or link rewriting.

## Consequences
- Email/password can be built, tested and demonstrated now; going live is a
  configuration change plus DNS records.
- Outbox messages contain live links: only admins can read them, they expire
  after 24 hours, and the transport is impossible in production.

## Alternatives considered
- Local Postfix: no authentication records without a domain; poor delivery.
- Picking a provider now: an external account and possibly cost, which the
  owner must approve.
