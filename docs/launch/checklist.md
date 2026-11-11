# Launch checklist (commercial production)

**Status on 2026-11-11: not ready for production.** Engineering cannot close
several gates alone: they need the owner's decisions, accounts or legal
sign-off. Each gate is marked:

- **Done**: built and verified, with the evidence named.
- **Partial**: started, with what is missing named.
- **Open**: not started.
- **Owner**: needs a decision, an account or a sign-off from the owner.

"Local" means verified in the local test suite only, not yet on staging.

## Product and accounts

| Gate | Status | Evidence or what is missing |
|---|---|---|
| Google sign-in, email and password, verification, reset, account linking only explicit | Done (staging) | e2e `password`, `auth`, `accounts` specs; staging since 9f16951 |
| Account page: profile, preferences, devices, data download, deletion | Done (staging) | e2e `accounts`, `password` |
| Email change, profile photo upload, 2FA | Open | 2FA for admins is a security priority |
| Public registration open | **Owner** | Invite-only until approved |
| Real email delivery (domain, provider, SPF/DKIM/DMARC) | **Owner** | Staging keeps mail in the outbox |
| Production domain | **Owner** | Staging uses `*.sslip.io` |

## Languages

| Gate | Status | Evidence or what is missing |
|---|---|---|
| Public pages, sign-in, emails in English and Hebrew | Done (staging) | e2e `i18n` |
| Studio frame and account page in Hebrew | Done (local, 56d5f3c) | e2e `i18n` (Hebrew studio, iPhone WebKit) |
| The five tools translated (3b-2) | Open | Tools stay English and left to right inside |
| Native-speaker review of the Hebrew | **Owner** | |

## Billing

| Gate | Status | Evidence or what is missing |
|---|---|---|
| Provider research for an Israeli merchant | Done | `docs/billing/01-provider-research.md` |
| Provider-neutral core: events, checkout sessions, metrics, reconciliation | Done (local, 9e046a2) | `src/server/billing/billing.test.ts` |
| Provider chosen, account opened, sandbox | **Owner** | |
| Adapter, webhook route, checkout, portal, return page | Open | After the provider choice |
| Prices, trial, refund policy, VAT and invoices | **Owner** (+ accountant) | |
| End-to-end test in the provider's sandbox | Open | |
| Production billing switched on | **Owner** | |

## Security

| Gate | Status | Evidence or what is missing |
|---|---|---|
| CSP with a nonce, body-size limits, version in health | Done (local, 2785aa9) | e2e `security` |
| Rate limits, anti-enumeration, admin protections, audit log | Done (staging) | Unit and e2e tests |
| Threat model | Done (draft) | `docs/security/threat-model.md` |
| Incident response plan | Partial | `docs/security/incident-response.md`: contacts and notification rules to fill in |
| Dependency audit clean | Open | 15 production-tree findings (see below) |
| CI: type-check, lint, tests and audit on every push | Open | |
| OWASP ASVS L2 review with evidence | Open | |
| External penetration test | **Owner** (budget) | Recommended before billing |

**The dependency findings (`npm audit --omit=dev`, 2026-11-11):**

- **Build and test tools.** vitest and tinypool (2 critical); vite, rollup,
  glob, minimatch, picomatch, brace-expansion and source-map-js (high);
  esbuild, postcss-selector-parser and yaml (moderate). None of these run in
  the server process.
- **At runtime.** zod (high: memory exhaustion on oversized input — request
  bodies are capped at 16–32 KB, which limits it) and lodash (high: in
  functions we never call with user input).
- **Plan.**
  - Patch updates within the current ranges, at least two weeks old.
  - Major upgrades: zod 4 (schemas to migrate) and vitest 4.
  - Each upgrade gets its own commit, with the full test suite.

## Privacy and legal

| Gate | Status | Evidence or what is missing |
|---|---|---|
| Data inventory | Done | `docs/privacy/data-inventory.md` |
| Retention enforced (analytics 13 months, audit 24 months) | Done (local, c41c978) | Unit test; periods to be confirmed by counsel |
| Drafts: terms, privacy policy, cookies, artwork, subscriptions, support | Done (drafts) | `docs/legal/`, not published |
| Lawyer review; owner details filled in; Hebrew versions | **Owner** | `docs/legal/README.md` lists the decisions |
| Policies published, with acceptance recorded per version | Open | After review |
| Database registration and privacy contacts, if required | **Owner** (counsel) | |

## Accessibility

| Gate | Status | Evidence or what is missing |
|---|---|---|
| Automated WCAG 2.0/2.1 A/AA checks on every page type | Done (local, a58baa9) | e2e `accessibility`; one documented exception |
| The studio's zoom limit lifted (tools' fields 16 px on phones) | Open | |
| Manual keyboard and screen-reader audit (Hebrew and English) | Open | `docs/accessibility/README.md` |
| Accessibility statement published, with a coordinator | **Owner** | Draft in `docs/accessibility/README.md` |

## Operations

| Gate | Status | Evidence or what is missing |
|---|---|---|
| Nightly database backup on the server | Done | First scheduled run verified: `mongodb-20261111T014001Z` |
| Off-site encrypted backups | **Owner** (storage account) | `deploy/offsite-backups-plan.md` |
| Restore drill (restore a dump into a scratch database and check it) | Open | |
| Uptime monitoring and alerting | **Owner** (service) or self-hosted | |
| Error reporting from browsers and the server | Open | |
| Separate production environment and database | Open | Staging only so far |
| Release process: dump, migrate, switch, health, verified commit | Done | `deploy/release.sh`, `deploy/RELEASES.md` |
| GitHub Pages production unchanged until cutover | Done | Not touched |
| Production cutover | **Owner** | |
