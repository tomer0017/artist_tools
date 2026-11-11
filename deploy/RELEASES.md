# Staging release log

Every release to `https://staging.185-176-255-3.sslip.io`, newest first, from
the release script's own log (`journalctl -u studio-release-*`; times UTC).
Each release built one exact commit of `migration/nextjs-saas-foundation`,
took a MongoDB dump first (since 9f16951), ran the additive migration, and
switched only after `/api/health?ready=1` answered. History is linear: every
commit below descends from the one before it (no rebases or force-pushes).

From the release after 56b9629 on, `GET /api/health` reports the running
commit (`version.commit`), so it can be checked over HTTPS alone.

| Released (UTC) | Commit | What changed | Data changes (migration) | Dump taken first |
|---|---|---|---|---|
| 2026-11-11 01:28 | `56b9629` | Fix: `/he` pages served from real routes (a proxy rewrite returned 500 behind nginx) | none | yes (release step) |
| 2026-11-11 01:20 | `6616888` | Phase 3a: English/Hebrew public pages, sign-in, emails, RTL, `/he` | none | yes (release step) |
| 2026-11-11 00:48 | `40cbe24` | Phase 2b: versioned plans/prices, quotas, coupons, analytics (includes `ff080c8`) | `config_versions` seeded with today's plans (v1) and no prices; plans unchanged; new indexes | yes (release step) |
| 2026-11-11 00:11 | `b2a06ea` | Phase 2a: admin filters, suspension, test accounts, promotional Pro, audit export (includes docs `6382183`) | new indexes only | yes (release step) |
| 2026-11-10 23:36 | `9f16951` | Phase 1: email/password, account management, data export and deletion (includes `3d16ac4`, `e4fc94e`, `c942f21`) | 1 account given language/currency defaults; new indexes. Env: `APP_ENV=staging`, `AUTH_EMAIL_PASSWORD=on`, `MAIL_TRANSPORT=outbox` (previous env file: `/root/backups/phase1-20261110T233138Z/`) | `mongodb-20261110T233626Z` |
| 2026-11-10 16:3x | `77b92be` | Visitor journey, plans pages, tool introductions, Compare iPhone fix | — | `mongodb-20261110T163612Z` (manual) |

Why staging moved from `77b92be` to `56b9629`: these are the five releases
above, all made deliberately during the 2026-11-10/11 session, each after the
full test suite passed. The owner's account (only user, only admin) was
checked in the database after `40cbe24`: role admin, plan Free, active,
Google sign-in unchanged. The releases directory keeps the newest five builds,
so `77b92be` is no longer on disk; going back to it means rebuilding it with
`studio-release staging 77b92be` (its code runs against the newer data, since
every migration was additive).

## Awaiting deployment

Commits after `56b9629` that are tested locally but not yet on staging (kept
up to date while the VPS is unreachable):

| Commit | What | Data changes | Pushed to GitHub |
|---|---|---|---|
| `2785aa9` | Security: per-request CSP nonce (`'strict-dynamic'`), request body caps (413), `version.commit` in `/api/health`, absolute hreflang | none | not yet (GitHub unreachable from the Mac, 2026-11-11 ~09:00Z) |
| `9e046a2` | Phase 4a: provider-neutral billing core (no provider connected), read-only `/admin/billing`, revenue per currency in `/admin/analytics` | new empty collections `billing_customers`, `payments`, `checkout_sessions`, `reconciliation_runs`; new indexes only | not yet |

Checks for the next staging release, beyond the usual ones:
- The CSP is new. After the switch, open the landing page, `/he`, sign-in
  and (as the owner) a tool, and look for CSP errors in the browser console.
  Also confirm nginx adds no second `Content-Security-Policy` header, because
  two policies would both apply.
- `GET /api/health` must report `version.commit` equal to the released
  commit. This is the first release that reports it.
