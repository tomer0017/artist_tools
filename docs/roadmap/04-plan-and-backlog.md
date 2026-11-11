# Phase plan and prioritised backlog

Each phase ships as small commits, is deployed to staging only after every
quality gate passes, and is reported with what works and what is pending.
Within a phase, items are in implementation order. "Needs" lists approvals
that block an item; everything else proceeds.

## Quality gates (every phase)

TypeScript (`npm run typecheck`) · lint (0 errors) · unit + integration
(vitest; real MongoDB 8 replica set via mongodb-memory-server) · desktop and
iPhone-WebKit e2e (Playwright, production build) · auth/authorisation tests
for every new route and action · migration tests (first run, re-run, previous
schema) · security regression tests (enumeration, CSRF/origin, privilege) ·
accessibility checks on new screens (roles, names, focus; axe from P5) ·
visual parity of the five tools (36 screenshots) · the five-tool e2e suites.
Then: deploy to staging, verify the exact commit and `/api/health?ready=1`,
smoke-test externally.

---

## Phase 1 — Authentication and account management

| ID | Item | Acceptance criteria |
|---|---|---|
| P1-01 | Mail foundation | `Mailer` interface; transports `disabled` (default) and `outbox` (development/staging only; startup fails if `APP_ENV=production`); templates: verify, reset, existing-account notice, password changed/added, account deleted; per-address send limits; admin-only outbox viewer `/admin/mail` (404 unless outbox is active) |
| P1-02 | Email/password sign-up | Behind `AUTH_EMAIL_PASSWORD=on` (default off; refused without a mail transport); same invite/open gate as Google, applied to the address; verification required before any session; identical response for new, existing and refused addresses; existing-account notice email; `user.registered` audit with `provider: credential` |
| P1-03 | Password policy | 12–128 characters; rejects common passwords, repeated/sequential patterns, and passwords containing the email name or "studio companion"; same checks on sign-up, reset, change and set; clear inline guidance; scrypt hashing by the library |
| P1-04 | Verification | Links expire in 24 h; signed by the server; sign-in with an unverified address re-sends (throttled) and explains; verifying signs the person in; `user.email_verified` audited; unverified accounts older than 24 h purged by the nightly maintenance command |
| P1-05 | Password reset | Generic response for any address; token single-use, 30-minute expiry, hashed at rest; reset revokes every session; notification email; `user.password_reset` audited |
| P1-06 | Rate limits | Persistent per-IP limits on sign-up, sign-in, verification, reset, change-password; per-address failed sign-in throttle (10 per 15 min → generic "try again later"); per-address email limits; JSON bodies capped; `auth.throttled` audited |
| P1-07 | Sessions | Account page lists devices (browser/OS summary, last active, partially masked IP, "this device"); revoke one; sign out of all other devices; session tokens never sent to the browser; audited |
| P1-08 | Profile | Edit display name; preferred language (English/Hebrew) and currency (USD/ILS) saved for Phase 3/4; profile photo: the Google photo or none; marketing email opt-in toggle, default off, each change recorded in `consent_events` |
| P1-09 | Explicit linking | `disableImplicitLinking`; a Google sign-in whose address belongs to a password account is refused with guidance; signed-in password users can connect Google (same verified address only); signed-in Google users can add a password (fresh session); a sign-in method can be removed only if another remains; all audited + notified |
| P1-10 | Data export | One-tap JSON download of the person's data (profile, sign-in methods without ids or secrets, sessions, consents, usage, audit history, introductions); no tokens or hashes; rate-limited; audited |
| P1-11 | Account deletion | Fresh session (≤ 10 min, otherwise re-authenticate) + typed confirmation; refused for the last admin; deletes the user and all personal app data; audit trail keeps the bare id; confirmation email; optional removal of this device's tool work |
| P1-12 | Sign-in UI | `/sign-in` (Google + email), `/sign-up`, `/forgot-password`, `/reset-password`, check-your-email states; mobile-first; error messages that do not reveal account existence; existing Google flow unchanged |
| P1-13 | Ops | Release script dumps the database before migrating; nightly maintenance command (purge unverified accounts, prune rate-limit rows) as a cron job |

**Staging after Phase 1:** `AUTH_EMAIL_PASSWORD=on`, `MAIL_TRANSPORT=outbox`,
still invite-only. Test emails are read in `/admin/mail`.
**Needs (for real email, not for Phase 1 itself):** domain + email provider.

## Phase 2 — Commercial admin dashboard

| ID | Item | Acceptance criteria |
|---|---|---|
| P2-01 | Admin re-authentication | Sensitive actions (role, suspend, publish config, coupons, grants) require a session created in the last 10 minutes, otherwise a re-sign-in prompt |
| P2-02 | User filters | Role, plan, status, verified, sign-in method, test account, created range; combined with email search; paginated |
| P2-03 | Suspend / reactivate | Confirmation with a reason enum; suspension revokes sessions immediately; cannot suspend yourself or the last admin; audited; the person sees a clear message |
| P2-04 | Test accounts | Flag on the account; excluded from analytics and revenue metrics |
| P2-05 | Promotional access | Grant Pro (or any plan) for a period with a reason; revoke; entitlements include active grants; shown on the account page and in admin; audited |
| P2-06 | Feature catalog and plan matrix | Versioned `catalog` configuration: features (status), plans (features, quotas per day/month); draft → validate → publish with diff preview; rollback by republishing; v1 equals today's matrix (Free keeps all five tools) |
| P2-07 | Quotas | Enforced by `authorizeFeatureUse` (atomic check-and-count); reset periods day/month (UTC); shown to the user as "N left" |
| P2-08 | Products and prices | Versioned `pricing` configuration: products per plan, monthly/annual prices per currency in minor units, trial days; no price is public until published and billing is enabled |
| P2-09 | Coupons | Percent/fixed, eligible prices, dates, global and per-user limits, status; redemptions listed; audited |
| P2-10 | Analytics | Registrations and verified activations; DAU/WAU/MAU; usage by tool/feature; returning users (week-over-week cohorts); Free→Pro conversion, churn, MRR/ARR (zero until billing); refunds/failed payments placeholders; test accounts excluded; phone-friendly |
| P2-11 | Audit explorer | Filter by type, actor, account, date; export CSV for admins |

## Phase 3 — Internationalisation (English + Hebrew)

| ID | Item | Acceptance criteria |
|---|---|---|
| P3-01 | Library | Maintained i18n library verified against the installed Next.js 16 (ADR-0009); dictionaries per locale in the repo |
| P3-02 | Locale resolution | Signed-in: `users.locale`; visitors: cookie, then `Accept-Language`; public pages also reachable under `/he/…` for SEO; language selector everywhere |
| P3-03 | RTL | `dir` on `<html>`; layout uses logical properties; icons that imply direction mirror; canvas surfaces and their gestures stay LTR; no tool behaviour changes |
| P3-04 | Formatting | Dates, numbers, currency through `Intl` with the locale; currency amounts from minor units |
| P3-05 | Translation | Landing, sign-in/up, pricing, profile, admin (optional), tools' UI text, support, emails; Hebrew reviewed by a native speaker (owner) |
| P3-06 | Checks | Test: every key exists in every locale, no unused keys, ICU syntax valid; e2e + parity in both locales |
| P3-07 | SEO | Localised titles/descriptions, `hreflang` alternates, `lang` attribute |

## Phase 4 — Billing infrastructure

| ID | Item | Acceptance criteria |
|---|---|---|
| P4-01 | Provider research | Written comparison of Israeli PSPs and merchants of record with sources and dates: eligibility for an Israel-based business, currencies, subscriptions, tax handling, invoices, refunds, payouts, fees, integration effort; recommendation for owner decision |
| P4-02 | Billing core | Provider adapter interface (checkout, portal, webhook verify, fetch subscription); state machine (trialing, active, past_due, canceled, expired, refunded); entitlement sync from server-written state only |
| P4-03 | Provider sandbox *(replaces the planned mock provider, 2026-11-11)* | Once the owner chooses a provider and opens its sandbox: full flow on staging through the provider's own test checkout — renewals, failures, cancellations, refunds, chargebacks; no real money. Until then the core is tested with verified events built in the tests |
| P4-04 | Webhooks | Raw-body signature verification, idempotent by event id, out-of-order safe (by provider timestamps/versions), audited |
| P4-05 | Coupons at checkout | Server-side validation and redemption |
| P4-06 | Reconciliation | Scheduled comparison of provider vs database; fixes drift; report in admin |
| P4-07 | Customer portal | Manage/cancel/update payment method via the provider's portal; cancellation reachable from the account page |
| P4-08 | Invoices/receipts | Through the provider or an Israeli invoicing service as research decides |

**Needs:** provider decision and merchant account; legal terms; prices.

## Phase 5 — Security, privacy, accessibility, operations

Threat model (auth, billing, admin, uploads, data) · OWASP ASVS L2 checklist
with evidence · CSP (nonce-based) · CI with typecheck/lint/tests, dependency and
secret scanning · dependency upgrades (zod 4, recharts) · upload limits if any
server upload is added · security event review in admin · incident response
plan · encrypted off-site backups + monthly restore drills (**needs** storage
account) · uptime monitoring + error tracking (**needs** accounts, or
self-hosted alternatives) · data inventory, processing purposes, retention and
deletion policy, processor list, transfer assessment · consent and policy
version tracking · accessibility audit (axe in e2e + manual VoiceOver/keyboard
pass), fixes, accessibility statement from verified results · legal drafts:
terms, privacy, cookies (if needed), accessibility statement, subscription and
refund terms, contact/support, artwork ownership and uploads — each marked
"draft, requires legal review".

## Phase 6 — Retention and growth foundations

Wire browser analytics events (tool opened, first use, first export) without
artwork or file names · feedback form (stored, visible to admins) · support
page and contact flow · onboarding/returning-user instrumentation · feature
adoption and retention views · experiment flags (assignment + exposure
events) · architecture note for saved projects (owner-only storage, quotas,
export) — implemented only with approval.

---

## Decisions and approvals needed from the owner

| Decision | Blocks |
|---|---|
| Register a domain | real email, production OAuth, billing onboarding, SEO |
| Choose a transactional email provider | email verification/reset outside staging |
| Approve opening public registration | public sign-up (both Google and email) |
| Final Free/Pro features, prices, trial length | publishing pricing (P2/P4) |
| Billing provider after the P4 research | real payments |
| Off-site backup storage + monitoring accounts | P5 operations |
| Server-wide hardening (CloudPanel port, unused services, X11) | R20 |
| Legal review of drafts | launch |
