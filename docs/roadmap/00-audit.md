# Phase 0 — Current-state audit and gap analysis

Inspected on 2026-11-10: the repository at `77b92be` (branch
`migration/nextjs-saas-foundation`) and the staging server (read-only, over SSH).
Nothing below is assumed from documentation alone; each line was checked in the
code or on the server.

## 1. Architecture today

```
iPhone / desktop browser
  └─ studio UI (React 19, client-rendered); the five tools run entirely in the browser,
     work is kept in localStorage (never uploaded)
        │ HTTPS (Let's Encrypt, HTTP/2 + QUIC)
nginx (CloudPanel vhost staging.185-176-255-3.sslip.io)
        │ 127.0.0.1:3000, X-Real-IP set from the connecting address
Next.js 16 standalone server (systemd unit studio-companion-staging, user studio-staging, Node 24.22.2)
  ├─ Better Auth 1.7.18 (/api/auth/*)        ├─ server pages: /app layout, /admin, /pricing, /sign-in
  ├─ /api/me, /api/me/intros, /api/usage     └─ server actions: admin plan/role changes
        │ mongodb://127.0.0.1:27017 (auth on, replica set rs0)
MongoDB 8.0.34 (same VPS, localhost only)
```

Production for real users is still the pre-migration Vite build on GitHub Pages
(`tomer0017.github.io/artist_tools`), untouched by this work.

## 2. What already exists

### Authentication (`src/server/auth.ts`)
- Google sign-in only (OIDC, state + PKCE by Better Auth). An account is its
  Google `sub`; `accounts` has a unique `(providerId, accountId)` index.
- `emailAndPassword: { enabled: false }`; `accountLinking: { enabled: false }`.
- Registration gate `user.validateUserInfo` + a second gate in
  `databaseHooks.user.create.before`: invite list (`AUTH_SIGNUP_ALLOWLIST`) or
  open (`AUTH_SIGNUP_MODE=open`); Google must have verified the address. The gate
  assumes a verified address, so it would refuse every email/password sign-up
  as written.
- Sessions: database sessions, 30 days rolling (renewed daily), 5-minute signed
  cookie cache, cookie prefix `sc`, `__Secure-` over HTTPS, SameSite=Lax.
  Suspended accounts cannot create sessions and are treated as signed out.
- Google tokens are stripped before storage (`withoutTokens`).
- Origin and callback-URL checks are forced on (`disableOriginCheck: false`).
- Client IP from `X-Real-IP` only (nginx sets it from `$remote_addr`; the
  appended `X-Forwarded-For` is ignored).
- Rate limiting: Better Auth's in-memory limiter, 100 requests/60 s by default,
  `/sign-in/social` 10/60 s, `/callback/*` 20/60 s, plus the library's
  built-in rules for sign-in/sign-up (3/10 s) and email-sending endpoints (3/60 s).
- Audit + analytics on registration and every session creation.

**Library capabilities confirmed in `node_modules/better-auth` 1.7.18** (not
yet used): email/password with scrypt hashing (`node:crypto`), mandatory email
verification with generic responses for existing addresses
(`requireEmailVerification` → synthetic user + `onExistingUserSignUp`),
constant-work sign-in failures (hashes even for unknown users), password reset
with single-use expiring tokens and `revokeSessionsOnPasswordReset`,
`verification.storeIdentifier: 'hashed'` (tokens hashed at rest),
`accountLinking.disableImplicitLinking` (link only from a signed-in session via
`linkSocial`; same email required unless `allowDifferentEmails`), server-only
`setPassword`, `delete-user` with hooks, session list/revoke endpoints,
`freshAge` checks, database-backed rate-limit storage.

### Data model (`src/server/db/collections.ts`, `migrate.ts`)
Better Auth: `users`, `accounts`, `sessions`, `verifications`.
App: `plans`, `subscriptions`, `usage`, `audit_events`, `payment_events`,
`analytics_events`. Idempotent migration on every release (indexes, plan sync,
`users.plan` backfill). User fields: `role`, `status` (`active|suspended`),
`plan`, `planUpdatedAt/By`, `lastLoginAt`, `introsSeen`, `marketingConsent`
(+ `At`, `Source`), all `input: false`.

### Roles, plans, entitlements (`src/lib/plans.ts`, `src/server/entitlements.ts`)
- Role (`user|admin`), assigned plan (`free|pro`) and subscription status are
  separate. Admins get every feature on any plan; no plan grants admin.
- Nine stable feature ids; the matrix lives in code and is copied to `plans`
  by the migration (the code wins over the database).
- `computeEntitlements` is pure and reads only server data; monthly usage caps
  are supported by the schema but none are set. `POST /api/usage` authorizes
  and counts plan-gated features before any GIF is encoded.

### Admin (`src/app/admin/`, `src/server/admin.ts`)
- 404 for non-admins; role re-read from the database on every action.
- Users list (search by email, pagination), detail (Google link hint, sessions,
  access, usage, audit trail), plan Free↔Pro and grant/revoke admin behind
  confirmations; self-demotion and last-admin removal refused; every change
  audited. Activity feed.
- Not present: suspend/reactivate UI (the status field and the session gate
  exist), filters beyond email, test-account flag, promotional grants, feature
  or price configuration, coupons, analytics dashboards.

### Billing (`src/server/billing/`)
- Provider contract (`verifyWebhook` over the raw body) and an idempotent
  processor keyed on `(provider, eventId)` that upserts `subscriptions` and
  audits. No HTTP route, no provider, no products, prices, currencies,
  coupons, invoices or reconciliation.

### Analytics (`src/server/analytics.ts`)
- First-party, allow-listed events, ids only, dedupe keys for one-off events.
  Only `registration_completed` and `login_succeeded` are recorded; the
  browser-side events are defined but not wired.

### Account page (`/app/profile`)
- Shows identity, plan, role, subscription status, what is included, resets
  tool introductions, signs out. Not present: editing the name, language,
  currency, marketing consent, device sessions, linking, password, data export,
  account deletion.

### Internationalisation
- None. `<html lang="en">`, English strings inline in components. The only
  Hebrew is in Compare and the save sheet (iOS "Save Image" guidance, added
  before the migration). No `dir`, no locale-aware formatting helpers.

### Security headers (`next.config.ts`)
- `nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: same-origin`,
  `Permissions-Policy` (camera/mic/geo off), HSTS 1 year. No
  Content-Security-Policy. JSON API bodies are parsed without an explicit size
  cap (nginx allows 64 MB).

### Deployment and operations (`deploy/`)
- `release.sh`: builds an exact commit as the site user, runs the migration,
  switches `current` atomically, health-gated with automatic switch-back; keeps
  5 releases (`77b92be 9cb5be4 8012427 ab2a86a 8a73722`). Rollback drill done.
- systemd unit with sandboxing (`ProtectSystem=full`, `NoNewPrivileges`, 1 GB
  memory cap); logs as JSON lines in journald (52 MB used).
- Secrets only in `/etc/studio-companion/staging.env` (`root:studio-staging
  0640`); variables present: `BETTER_AUTH_URL BETTER_AUTH_SECRET MONGODB_URI
  MONGODB_DB GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET AUTH_SIGNUP_ALLOWLIST`.
- **Backups: the nightly dump had never run.** cron refused
  `/etc/cron.d/studio-mongo-backup` because the file was group-writable
  (`INSECURE MODE`, 1,181 refusals since 2026-11-09 23:40). Only the manual
  pre-deploy dumps existed. Fixed during this audit (file backed up to
  `/root/backups/cron-20261110T182031Z`, mode 0644, cron logged `RELOAD`); a
  manual run produced `mongodb-20261110T182031Z.archive.gz`. Still local-only:
  no off-site copy (plan in `deploy/offsite-backups-plan.md`), no restore drill
  of the nightly archives, no alert on failure.
- Monitoring: none (no uptime check, error tracking or alerting).
- CI: none (no `.github/`); every test run so far was local.

### Server (read-only checks)
| Item | Finding |
|---|---|
| OS / kernel | Ubuntu 24.04.5 LTS, 6.8.0-149; unattended-upgrades enabled |
| Disk / memory | 15 of 96 GB used; 8 GB RAM, ~5.8 GB available |
| Firewall (ufw) | deny incoming; allow 22, 80, 443/tcp+udp, 8433–8443 (CloudPanel) |
| SSH | keys only (`passwordauthentication no`, `kbdinteractive no`, root `without-password`), `MaxAuthTries 3`, fail2ban `sshd` jail; `X11Forwarding yes` (unneeded) |
| Bound to all interfaces, blocked only by ufw | FTP :21, SMTP :25 (Postfix), MySQL :3306/:33060, Varnish :6081 — CloudPanel defaults |
| MongoDB | `bindIp 127.0.0.1`, authorization + keyFile, replica set `rs0`, 1 GB cache |
| TLS | Let's Encrypt, valid to 2027-02-07, renewed by CloudPanel |
| Mail | Postfix installed (CloudPanel); no domain, so no SPF/DKIM/DMARC — unusable for real email |

### Dependencies (`npm audit`, 2026-11-10)
22 advisories (2 critical, 13 high, 7 moderate). Most are build/test tooling
(vitest, vite, rollup, esbuild, glob, minimatch, picomatch). Relevant at
runtime: `zod` 3.25 (memory exhaustion validating oversized constrained
collections; fixed in 4.x) and `lodash` via `recharts` (prototype pollution in
`_.template`/`_.unset`). Mitigation and upgrades are in Phase 5 (body-size caps
for JSON routes come first).

## 3. The five tools and their persistence

All five run entirely in the browser; no artwork reaches the server.

| Tool | State | Persistence |
|---|---|---|
| Measure & Plan | image, calibration, lines, layers, colours | `localStorage['painter-studio-project']` (debounced ~300 ms, shared project) |
| Study & Simplify | value/sketch settings on the shared project | same project key; sketch caches in memory |
| Color & Mixing | selected colour, sections | component state; Measure → Color hand-off via `sessionStorage['use-color-in-tab']` |
| Create a Grid | grid settings on the shared project | same project key |
| Compare & Correct | images (downscaled to 1400 px), alignment, crop, modes, GIF settings | `localStorage['compare-art-session']`; quota overflow falls back to settings-only |

Also kept per browser: onboarding progress (`onboardingStorage`), tool
introductions mirror (`studio-intro-seen:<userId>:<tool>`). The studio layout
keeps tools mounted across URLs (KeepAlive). Work is per browser, not per
account, and sign-out does not clear it: on a shared device the next person
sees the last project (documented, not yet addressed).

## 4. Gap analysis

| Requirement (mission) | Today | Gap | Phase |
|---|---|---|---|
| Google OAuth | ✓ | keep | — |
| Email/password + verified email | disabled; no mail capability | mail transport, sign-up/sign-in/verify UI, gate for unverified sign-ups | 1 |
| Password reset, strong policy, hashing | library supports | configure; policy checks; notifications | 1 |
| Rate limits on register/login/verify/reset | IP limits in memory | per-path rules, persistent storage, per-address throttles | 1 |
| Anti-enumeration | Google-only, n/a | generic responses (library) + existing-account notice | 1 |
| Session management + logout | sign-out only | device list, revoke one/all others | 1 |
| Account deletion + data export | none | both, with re-authentication and audit | 1 |
| Profile: name, language, currency, image, marketing opt-in | read-only page; consent field exists | editable profile + consent history | 1 |
| Explicit, verified account linking | linking disabled | `disableImplicitLinking`, link Google / add password from a fresh session | 1 |
| Audited account/security events | registration, login, admin | password, verification, linking, sessions, profile, export, deletion, throttling | 1 |
| Admin: suspend/reactivate, test accounts, promo Pro, filters | partial (no UI) | build | 2 |
| Feature catalog, plan matrix, quotas, draft/publish | matrix in code | versioned configuration in DB with code defaults | 2 |
| Products, prices (minor units, currencies), coupons | none | catalog + coupons + redemptions | 2 |
| Analytics dashboards | raw events only | aggregates: registrations, activation, DAU/WAU/MAU, usage, retention, conversion, churn | 2 (+6 wiring) |
| English + Hebrew, RTL, locale formatting, hreflang | none | i18n library, dictionaries, RTL layout, canvases kept LTR | 3 |
| Billing provider research (Israel) | none | verified comparison | 4 |
| Provider-neutral billing, webhooks, reconciliation | contract + processor | catalog link, state machine, mock provider, routes, reconciliation, portal | 4 |
| Threat model, ASVS review, CSP, scanning, admin re-auth | headers only | all | 5 |
| Encrypted off-site backups, restore drills, monitoring | local only (now running) | needs storage + monitoring accounts | 5 |
| Privacy inventory, retention, consent versions | consent field only | documents + version tracking | 5 |
| Accessibility audit (IS 5568 / WCAG 2.2 AA) | partial (labels, focus on new UI) | automated + manual audit, fixes, statement | 5 |
| Legal draft pages | none | drafts marked for legal review | 5 |
| Retention/growth instrumentation | events defined | wire events, feedback, support | 6 |

## 5. External blockers (need the owner)

1. **A real domain.** Needed for deliverable email (SPF/DKIM/DMARC), a
   production Google OAuth consent screen, billing-provider onboarding (they
   review the live site, pricing and terms) and SEO/hreflang. `sslip.io`
   cannot carry mail authentication records.
2. **A transactional email provider** (account + DNS records on that domain).
   Until then, staging uses a database outbox that only admins can read
   (ADR-0004).
3. **Billing provider** decision and merchant account (after Phase 4 research).
4. **Off-site backup storage and uptime monitoring** accounts (Phase 5).
5. **Business decisions:** final Free/Pro features, prices, trial length.
6. **Legal review** of the draft pages.
