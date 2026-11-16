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
| 2026-11-16 19:56:33 | `225ba58` | Sketch: Clean Outline and Pencil Study replace the black-and-white trace, drawn in a Web Worker (approved by the owner after a visual review; Color and Values unchanged). Settings unchanged: Google only | 42 indexes ensured; no data changed | yes (release step, 19:56:29) |
| 2026-11-16 11:08:59 | `186d2a4` | Email forms keep what was typed, or filled in by a password manager, before the page finished loading (`186d2a4`; it caused CI run 12's one failure), after docs `d240cb5`. Settings unchanged: Google only | 42 indexes ensured; no data changed | yes (release step, 11:08:55) |
| 2026-11-16 10:46:37 | `b22a510` | Google-only public sign-in: one button, no separate registration, password endpoints switched off (`b22a510`, after docs `23ff423`). **Settings changed after the release, 10:47Z:** `AUTH_SIGNUP_MODE=open`, `AUTH_EMAIL_PASSWORD=off`, `MAIL_TRANSPORT=disabled`; previous file in `/root/backups/google-only-20261116T104716Z/` | 42 indexes ensured; no data changed | yes (release step, 10:46:29) |
| 2026-11-15 13:34:35 | `8ce4860` | Since `6033016`: CI fixes (`b5eaa19` `3e3f5b4` `80bbc06`), docs (`5b60feb` `5907f9f`), and the SMTP transport, the registration guards and the sign-up pause (`8ce4860`). Registration stays invite-only and mail stays in the outbox: no provider yet | 42 indexes ensured; no data changed | yes (release step, 13:34:31) |
| 2026-11-11 14:01:44 | `6033016` | Since `3782e2c`: the dependency fixes (`f3120ba`), admin two-factor verification (`6fb6022`), CI (`056c79f`), error monitoring (`4405a76`), restore drill, off-site backup job and the missing auth indexes (`58fda2f`), the iOS-only zoom limit (`de2851b`), the five tools in Hebrew (`41dc7ae` `f22ac10` `1cec672` `43e51de` `bba5ec1` `c03f8cc` `ce96c15` `6033016`) | 42 indexes ensured, including the new **unique `users.email` and `sessions.token`**; new empty collections `admin_mfa`, `admin_mfa_sessions`, `error_reports`; no data changed | `mongodb-20261111T140139Z` (release step) |
| 2026-11-11 10:27–10:57 (built 10:26:40) | `3782e2c` | Everything since `56b9629`: CSP with nonces and body limits (`2785aa9`), billing core and `/admin/billing` (`9e046a2`), Hebrew studio frame (`56d5f3c`), accessibility fixes (`a58baa9`), retention in nightly maintenance (`c41c978`), docs | New empty billing collections and indexes (additive) | By the release script, which switches only after the dump, migration and health check succeed. Its log was not read: the VPS was unreachable over SSH afterwards. |
| 2026-11-11 01:28 | `56b9629` | Fix: `/he` pages served from real routes (a proxy rewrite returned 500 behind nginx) | none | yes (release step) |
| 2026-11-11 01:20 | `6616888` | Phase 3a: English/Hebrew public pages, sign-in, emails, RTL, `/he` | none | yes (release step) |
| 2026-11-11 00:48 | `40cbe24` | Phase 2b: versioned plans/prices, quotas, coupons, analytics (includes `ff080c8`) | `config_versions` seeded with today's plans (v1) and no prices; plans unchanged; new indexes | yes (release step) |
| 2026-11-11 00:11 | `b2a06ea` | Phase 2a: admin filters, suspension, test accounts, promotional Pro, audit export (includes docs `6382183`) | new indexes only | yes (release step) |
| 2026-11-10 23:36 | `9f16951` | Phase 1: email/password, account management, data export and deletion (includes `3d16ac4`, `e4fc94e`, `c942f21`) | 1 account given language/currency defaults; new indexes. Env: `APP_ENV=staging`, `AUTH_EMAIL_PASSWORD=on`, `MAIL_TRANSPORT=outbox` (previous env file: `/root/backups/phase1-20261110T233138Z/`) | `mongodb-20261110T233626Z` |
| 2026-11-10 16:3x | `77b92be` | Visitor journey, plans pages, tool introductions, Compare iPhone fix | — | `mongodb-20261110T163612Z` (manual) |

Nightly backups: the first scheduled run after the cron fix was verified on
the server on 2026-11-11 (`mongodb-20261111T014001Z`, 02:40 server time,
logged by cron).

Why staging moved from `77b92be` to `56b9629`: these are the five releases
above, all made deliberately during the 2026-11-10/11 session, each after the
full test suite passed. The owner's account (only user, only admin) was
checked in the database after `40cbe24`: role admin, plan Free, active,
Google sign-in unchanged. The releases directory keeps the newest five builds,
so `77b92be` is no longer on disk; going back to it means rebuilding it with
`studio-release staging 77b92be` (its code runs against the newer data, since
every migration was additive).

## Verification of `225ba58` (2026-11-16, ~19:57Z)

- **Before the release:** CI run 15 green on `225ba58`:
  - type check, lint, unit and integration 18:53–18:54Z;
  - end-to-end (Chromium, WebKit iPhone emulation) 18:54–18:58Z.
  Locally the same: 280 unit/integration and 171 e2e tests.
- **The release log** (`studio-release-225ba58`, result success):
  - dependencies 19:54:27, build 19:55:26, dump 19:56:29;
  - migration ("42 indexes ensured", no data changed);
  - healthy 19:56:33.
- **Over HTTPS:**
  - `deploy/smoke.sh` 20/20;
  - health ok on `225ba58`, built 19:55:27Z;
  - the Sketch worker entry (`turbopack-worker-1hrsqshz0gfey.js`, 927 B) and the engine chunk (`1eq8xo7i18hcm.js`, 22.9 KB) served as JavaScript;
  - `/app/study` sends signed-out visitors to sign-in.
- **Not checked here:** Sketch in a signed-in session on staging. Sign-in is Google only, with the owner's account, so this is the owner's iPhone check.
- **Releases kept:** `225ba58 186d2a4 b22a510 8ce4860 6033016` (`3782e2c` pruned). To roll back instantly, point `current` at `186d2a4` and restart.

## Verification of `186d2a4` (2026-11-16, ~11:10Z)

- **The release log:**
  - dependencies 11:06:56, build 11:07:57, dump 11:08:55;
  - migration ("42 indexes ensured", no data changed);
  - healthy 11:08:59.
- **Settings:** still Google only (`AUTH_SIGNUP_MODE=open`, `AUTH_EMAIL_PASSWORD=off`, `MAIL_TRANSPORT=disabled`).
- **Over HTTPS:**
  - `deploy/smoke.sh` 20/20;
  - health ok on `186d2a4`, built 11:07:59Z;
  - the Google sign-in start and Google's acceptance of the client and redirect address, as for `b22a510` below.

## Verification of `b22a510` and Google-only sign-in (2026-11-16, ~10:50Z)

- **Before switching:** staging had 1 user (the owner: admin, Google) and **no password accounts**, no unconfirmed sign-ups and no pending verifications. Turning email and password off locked nobody out.
- **The release log:**
  - dependencies 10:43:54, build 10:45:11, dump 10:46:29;
  - migration 10:46:30 ("42 indexes ensured", no data changed);
  - healthy 10:46:37.
- **The settings,** switched at 10:47Z: `AUTH_SIGNUP_MODE=open`, `AUTH_EMAIL_PASSWORD=off`, `MAIL_TRANSPORT=disabled`. The file kept its owner, mode and other keys. After the restart, health was ok (config and database ok) on `b22a510`.
- **Over HTTPS:**
  - `deploy/smoke.sh` 20/20, including the Google-only checks;
  - `/sign-in` and `/he/sign-in` have one action ("Continue with Google" / "המשך עם Google"), no input fields, and no mention of invitations, account creation or passwords;
  - all 9 password endpoints answer 404.
- **The Google sign-in start:**
  - goes to `accounts.google.com/o/oauth2/v2/auth` with `redirect_uri=https://staging.185-176-255-3.sslip.io/api/auth/callback/google`, `openid email profile`, PKCE S256, a state value and `prompt=select_account`;
  - **Google accepted the client and the redirect address** (302 to its sign-in page, no error).
  - Whether the consent screen is in "Testing" cannot be seen without signing in.
- **The owner account:** admin, active, Free, verified, still the only user, with 4 live sessions (none signed out).
- **Not verified yet:** a first sign-in by a Google account that has never used the app. The owner checks this after confirming the consent screen is *In production*.

## Verification of `8ce4860` (2026-11-15, ~13:37Z)

- **Over HTTPS:**
  - `deploy/smoke.sh` 18/18, and `/api/health` reports `8ce4860`;
  - the new sign-in messages render (`email_not_verified`, and `signups_paused` in English and Hebrew).
- **On the server:**
  - **The release log:** build done 13:34:30, dump 13:34:31, migration 13:34:33 ("42 indexes ensured", no data changed), healthy 13:34:35.
  - **New tools,** installed from the live release:
    - `studio-set-mail`: tested against a throwaway directory with fake values. It kept the other settings, the file mode and a `.previous` copy, and never printed the password. It refused a bad port, a placeholder sender, a password with `$` and a bad host, leaving the file unchanged.
    - `studio-mail-test`: through the outbox ("Kept in the outbox").
  - **Settings unchanged:** invite-only, `AUTH_EMAIL_PASSWORD=on`, `MAIL_TRANSPORT=outbox`.
  - **The owner account:** admin, active, Free, verified, still the only user and admin, with 4 live sessions.
- **Not done yet:** real email delivery, and with it public registration. Both wait for the owner's provider credentials (`docs/ops/email.md`).

## Verification of `6033016` (2026-11-11, ~14:03Z)

- **Over HTTPS:** `deploy/smoke.sh` 18/18. `/api/health` reports `6033016`,
  built 14:00:44Z.
- **On the server:**
  - **The release log:** dependencies 13:59:39, build 14:00:43, dump
    14:01:39, migration 14:01:40, healthy 14:01:44.
  - **The migration:** "42 indexes ensured, 0 configuration kinds published
    with defaults, 0 plans inserted, 0 plans updated, 0 accounts set to Free,
    0 given default language and currency".
  - **Unique indexes now present:** `users_email_unique`,
    `sessions_token_unique`, `provider_identity_unique`.
  - **New collections**, all empty: `admin_mfa`, `admin_mfa_sessions`,
    `error_reports`.
  - **The owner account:** admin, active, Free, `en`, still the only user.
    Its 4 live sessions are kept, so nobody was signed out.
- **The dump the release took** passed `backup-offsite.sh --check-only` and
  a restore drill (RESULT: OK, 4 s). It was taken before the migration, so
  it does not have the new indexes yet; the next nightly dump will.
- **Not verifiable from here:**
  - signing in on the iPhone;
  - turning on two-factor verification;
  - the tools in Hebrew on a real device.

  All three are the owner's checks; see the iPhone checklist in the final
  report.

## Verification of `3782e2c` (2026-11-11)

- **Verified over HTTPS** (`deploy/smoke.sh`, 18/18, from the Mac at
  ~10:58Z):
  - `/api/health` reports `3782e2c`;
  - English and Hebrew public pages answer, `/he` included;
  - signed-out visitors are sent to sign-in from `/app` and `/admin`;
  - exactly one Content-Security-Policy (nginx adds none), with a new nonce
    on every request;
  - oversized bodies get 413.
- **Verified on the server** (SSH, ~12:50Z):
  - **The release log** of `studio-release-3782e2c-b`, which succeeded:
    - install 10:23:58, build 10:26:35;
    - database dump 10:29:10 (`mongodb-20261111T102910Z`);
    - migration 10:29:11: "34 indexes ensured, 0 configuration kinds
      published with defaults, 0 plans inserted, 0 plans updated, 0 accounts
      set to Free, 0 given default language and currency", so no data
      changed;
    - healthy and switched at 10:29:22.
  - **The billing indexes:** `subscriptions_by_updated`, `payments_by_time`,
    `payment_events_by_time`, `billing_customer_unique`, `payment_unique`,
    `payments_by_user`, `checkout_expiry_ttl`, `reconciliation_by_time`.
    The billing collections are empty.
  - **Configuration** unchanged: catalog v1 and pricing v1 published.
  - **The owner account:** admin, active, Free, `en`/USD, Google only, still
    the only user and admin, 4 live sessions. **A Google sign-in at
    12:42:36Z, after the release**, so a returning sign-in works on
    `3782e2c`.
  - Releases kept: `3782e2c 56b9629 6616888 40cbe24 b2a06ea`. `9f16951`
    was pruned (keep 5).

## Awaiting deployment

Nothing: `225ba58` is live, Google only.
