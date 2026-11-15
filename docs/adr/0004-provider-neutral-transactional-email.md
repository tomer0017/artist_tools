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

## Update (2026-11-15): the SMTP adapter

The owner asked to open registration on staging, but only once real email works.

**The `smtp` transport** works with any provider's submission server; the provider is still the owner's choice (`docs/ops/email.md`). It uses nodemailer 10.3.1, pinned, with no dependencies.
- TLS is mandatory: implicit on 465, STARTTLS required on any other port.
- nodemailer may not read files or fetch URLs.
- Messages carry `Auto-Submitted: auto-generated`.
- A failure is logged with the SMTP command and reply codes only, never the provider's text, which can quote the recipient.

**Credentials** reach the env file through `studio-set-mail`, typed on the server or piped over SSH, never as arguments. `studio-mail-test` checks the connection and sign-in, then sends one test message.

**The outbox is now also refused with open registration** (outside development and tests). Once strangers can sign up, their links must be emailed to them, not kept where admins can read them.

**A global cap on new accounts** (50 an hour, 300 a day) pauses sign-ups for everyone alike. It protects the provider's quota and the sender's reputation from mass sign-ups.
