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
| 2026-11-18 17:24:48 | `6f2159a` | **Create a Grid improvements, Learn milestone M1** (approved by the owner; includes `f2f7b91`). Rotation left or right 90° or by 180°: only the drawing turns, never the stored photo. Exact A4 portrait and landscape. Square cells of a set size. **Save blank grid** (the same lines on white, for paper), through the same authorized save. Exact zoom and moves beside drag, pinch and wheel. The geometry is shared in `src/lib/grid`. Grids saved before M1 open and save byte for byte as before. No Learn screens, content, migrations or feature IDs. Settings and published plans unchanged | 44 indexes ensured; no data changed (0 plans updated; "Catalog version 6: applied") | yes (release step, 17:24:43, `mongodb-20261118T172443Z`) |
| 2026-11-18 15:52:59 | `224bb65` | **Rolling back never resets or widens the published plans** (ADR-0014; approved by the owner as a separate security fix; includes `9c38661`). An older release keeps the feature IDs and sections a newer one published, and applies none of them. A setting it cannot apply withholds that feature (fail closed). An unreadable catalog leaves `plans` as it is, never the defaults. Admin → Plans says so and turns editing off. New read-only `npm run db -- catalog-status`. No feature ID added. Settings and published plans unchanged | 44 indexes ensured; no data changed (0 plans updated; "Catalog version 6: applied") | yes (release step, 15:52:54, `mongodb-20261118T155254Z`) |
| 2026-11-18 12:49:17 | `be6890c` | The staging checks (`login-test`, `entitlement-test`) try a request again, up to five times, when it could not be made: the server's resolver sometimes takes 5–15 s for staging's own sslip.io name. App unchanged | 44 indexes ensured; no data changed | yes (release step, 12:49:12) |
| 2026-11-18 12:34:24 | `cc98437` | The publication check never overwrites an admin: it records the live version and content first, and publishes the temporary version and the restore only over the version it expects (`publishIfUnchanged`); scripts are type-checked in CI. App unchanged | 44 indexes ensured; no data changed | yes (release step, 12:34:18) |
| 2026-11-18 11:57:07 | `3161d2c` | The operator check `entitlement-test` always removes its temporary accounts and retries requests that could not be made (the server failed for a moment to resolve its own sslip.io name, and one temporary account was left behind: removed with `remove-tester`). App unchanged since `cccced6` | 44 indexes ensured; no data changed | yes (release step, 11:57:01) |
| 2026-11-18 11:33:59 | `cccced6` | **What a plan includes is enforced everywhere** (ADR-0013), after QA found a Free account using Measure & Plan although the published catalog (version 2) removed it from Free: a tool opens only if the plan includes it (locked screen otherwise, English and Hebrew, by every route), every save and export is authorized by the server first and fails closed, plan changes and publications reach open studios, plans pages follow the published catalog. Settings unchanged | 44 indexes ensured; no data changed (0 plans updated: the published version 2 was already in `plans`) | yes (release step, 11:33:54) and again before the publication check (`mongodb-20261118T113628Z`) |
| 2026-11-18 02:14:25 | `887a41e` | Username accounts for invited testers (ADR-0012): a username and a password beside Google, for accounts only admins create (no sign-up, no email); in the admin dashboard, New tester account, Reset password, Reveal initial password (once), Sign out everywhere, search by username. **Settings changed after the release, 02:14:47Z:** `AUTH_USERNAME_PASSWORD=on` with `studio-set-username-login` (previous file in `/root/backups/username-login-20261118T021447Z/`); Google, `AUTH_SIGNUP_MODE=open`, `AUTH_EMAIL_PASSWORD=off` and `MAIL_TRANSPORT=disabled` unchanged. **Data added 02:16Z,** after a second dump: QA accounts `Tomerfree` (Free) and `Tomerpay` (Pro), role user, test accounts, initial passwords sealed for one reveal until 2026-11-21 02:16Z | 44 indexes ensured (new: unique partial `users.username`, TTL `password_handoffs.expiresAt`); no existing data changed | yes (release step, 02:14:19) and again before the accounts were created (`mongodb-20261118T021507Z`) |
| 2026-11-16 22:24:33 | `675d8de` | Color & Mixing: the wheel and all six harmonies on one screen ("Wheel & Harmonies"); a swatch click copies its HEX with feedback; a harmony's dots on the wheel make its colours the base. Study, Measure, Grid, Compare unchanged. Settings unchanged: Google only | 42 indexes ensured; no data changed | yes (release step, 22:24:29) |
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

## Create a Grid improvements (Learn M1) on staging, `6f2159a` (2026-11-18, 17:23–17:40Z)

Approved by the owner as M1 only (no Learn screens, content or migrations).
Nothing was published: the published plan settings stay as they are.
Production and GitHub Pages are untouched.

- **Before:**
  - CI run 33 (`6f2159a`) green.
  - CI run 32 (`f2f7b91`) failed one new e2e test: it read the project from
    storage before the 300 ms auto-save had written it. The test was fixed
    in `6f2159a`; the app was unchanged.
  - Capture: catalog version 6 `f8a1a43e4cedbed7`, `plans`
    `48f75a1f7925d6c5`, no draft.
- **The release:**
  - the dump `mongodb-20261118T172443Z`;
  - "0 plans updated", then "Catalog version 6: applied";
  - healthy at 17:24:48.
- **After, on real staging:**
  - The capture is identical: catalog, history, and `plans` with their
    update times.
  - `catalog-status` ok and in step.
  - Smoke 22/22, `login-test` 13/13, `entitlement-test` (read only) 11/11.
- **M1 in real browsers** (temporary Free, Pro and Hebrew accounts; removed;
  passwords only in a 0600 file, deleted): 8/8 passed.
  - **Free, rotation:** the photo in storage is unchanged; the server is
    asked first (`tool.grid`, `export.image`: 200); the saved PNG
    (2400 × 3360) is turned, read back pixel by pixel.
  - **Free, A4 with 3 cm squares:** the blank grid PNG (2400 × 3394) is
    white with black lines exactly at the 3 cm positions, read back.
  - **Free, zoom and moves:** −/+ 1 %, typed 150 %, moves of 0.1 cm, then
    drag and wheel; axe clean with every control open.
  - **Free, a grid saved before M1:** it opens and saves as before (name,
    size, pixels).
  - **Free, failing closed:** with no answer from the server, no blank grid
    is saved; after "Try again" it is.
  - **Pro:** both saves.
  - **Hebrew:** translated, the canvas left to right, axe clean.
  - **iPhone emulation:** the rotations, square cells and both saves sit
    above the navigation.
- **The earlier plan-enforcement checks** on the same build: 6/6 passed
  (the test that publishes was skipped).
  - A first run hit staging's own limit of 5 sign-ins a minute per network
    ("Too many attempts from this network…"), after `login-test` and
    `entitlement-test`. It passed after a minute.
- **Locally:**
  - 408 unit/integration and 219 e2e tests.
  - **A/B in one Chromium:** `224bb65` and M1 saved five grids saved before
    M1 as byte-identical PNGs.
  - **The preview's canvas calls,** recorded in the browser, match the
    earlier first pass call for call. Before M1, the preview drew the grid
    twice over itself on first load, so lines outside the photo looked
    darker than in the saved image; M1 draws each frame cleanly.

## Rollback safety on staging, `224bb65` (2026-11-18, 15:50–16:01Z)

Approved by the owner as a standalone security fix, with this instruction:
the published plan settings must not change without explicit approval. So
nothing was published on staging: the publication check
(`entitlement-test --publish-check`) and the browser test that publishes were
not run. Production and GitHub Pages are untouched.

- **Before:**
  - CI run 30 (`224bb65`) green: type check, lint, unit/integration and
    end-to-end.
  - Read-only capture of the live database: catalog version 6 live
    (versions 1–5 archived), content `f8a1a43e4cedbed7` (the owner's
    version 2 plans), no draft; `plans` fingerprint `48f75a1f7925d6c5`, both
    updated 12:53:43.807Z.
- **The release:**
  - the dump `mongodb-20261118T155254Z`;
  - the migration printed "0 plans updated", then "Catalog version 6:
    applied";
  - healthy at 15:52:59.
- **After, on real staging:**
  - The capture is identical: catalog document, version history, and
    `plans` byte for byte, update times included.
  - `catalog-status`: "ok (everything known and applied)", both plans
    "in step".
  - Smoke 22/22.
  - `login-test` 13/13.
  - `entitlement-test` (read only) 11/11: Free and Pro over HTTPS, every
    tool and export (GIFs included) exactly as version 6 publishes them, and
    a plan switch on the same session.
- **Real browsers** (temporary username accounts, removed afterwards;
  passwords only in a 0600 file, deleted): 6/6 passed. Covered:
  - Free cannot use Measure & Plan or Compare & Correct by any route, and
    the server refuses them;
  - Free's other tools work, saving included;
  - Pro's Measure & Plan and Compare & Correct work, GIF exports included;
  - saving fails closed;
  - Hebrew, and iPhone emulation.

  The test that publishes was skipped, as above. No `qa_tmp_`, `enttest_`
  or `logintest_` account is left.
- **Rollback, on real staging data:**
  - **Setup:**
    - the release's dump was restored into a throwaway database;
    - a throwaway MongoDB user held `readWrite` on that database only, so no
      command could reach the live one;
    - the releases' own `npm run db` ran against it.
  - **The new release's migration** on the data as restored changed nothing.
  - **A simulated newer release** published version 7 with `learn.curriculum`,
    `export.pdf`, `learn.color` and three unknown sections, and synced
    `plans` with them. Rolling back to `224bb65` (its migration):
    - kept every published permission: `plans` fingerprint
      `48f75a1f7925d6c5` again;
    - kept version 7 as it was.
  - **`be6890c`'s migration on the same data** reproduced the hazard: Free
    had Measure & Plan, Compare & Correct and GIFs. `224bb65` again: none of
    them.
  - **An unreadable version 8:** `plans` stayed byte for byte, with the
    warning.
  - The database and the user were dropped.
- **The rollback procedure itself** (deploy/README.md):
  - Instant switch to `be6890c` at 15:59:26: health `be6890c`, smoke 22/22,
    `be6890c`'s own `entitlement-test` passed, data identical.
  - Back to `224bb65` at 16:00:30: health `224bb65`, smoke 22/22,
    `catalog-status` ok and in step.
  - The final capture is identical to the one before the release.
- **Locally:**
  - 384 unit/integration and 210 e2e tests.
  - Admin → Plans in a real browser on the local e2e server, with three
    catalogs written as another release would: a newer one, one with a
    setting it cannot apply, and an unreadable one. It found two problems,
    fixed in `224bb65`:
    - a readable version restored over an unreadable one could not be
      published;
    - the notice's colour contrast.
  - axe passes on all three.

## Real-browser verification on staging, `be6890c` (2026-11-18, 12:49–12:57Z)

Approved by the owner: real browsers against staging with temporary username
accounts (`npm run db -- temp-testers create`: Free, Pro and Free in Hebrew;
passwords only in a 0600 file on the operator's machine, never printed),
removed afterwards. Run from `lab/qa/staging-qa.spec.ts` (Desktop Chrome;
WebKit with iPhone 13 emulation); no traces, videos or automatic screenshots.

- **Before:** CI runs 24 (`cc98437`) and 25 (`be6890c`) green; smoke 22/22; `login-test` 13/13; dump `mongodb-20261118T125151Z`; snapshot of the accounts and the catalog (live version 4 = the owner's version 2 content, no draft).
- **Real staging, 7/7 browser tests passed:**
  - Free: Measure & Plan and Compare & Correct locked through the navigation, the address bar and a reload (the tool's controls and file inputs are not in the page); the server refuses the tools and their exports (403); account and plans pages show the same; admin pages 404.
  - Free: Study & Simplify (the Sketch drawing is drawn and saved as PNG), Color & Mixing and Create a Grid work, saving included.
  - Pro: Measure & Plan (photo, saved image, project file download) and Compare & Correct (a Large Compare+Diff GIF made and saved) work.
  - Saving fails closed: with the usage request failing (connection refused) or answering 503, nothing is saved and the message says so; "Try again" saves once the server answers.
  - Hebrew: the locked screen in Hebrew, right to left.
  - iPhone emulation: the locked screen fits (no sideways scroll), the bottom bar marks locked tools, Hebrew too, and Pro opens Measure & Plan.
  - **Published entitlements changed for real** (`entitlement-test --publish-check`, 32/32 on the server): recorded version 4 (content `f8a1a43e4cedbed7`); published temporary version 5 over version 4 only (Create a Grid off for everyone; Free gains Measure & Plan, Compare & Correct and GIFs, loses saving images), live 12:52:56–12:53:43Z. In the browsers, without touching them: Free's and Pro's open Grid tabs locked 42–43 s after it, Free's locked Measure tab opened; saving an image from it was refused (nothing saved) while Pro still saved; Free could make a plain GIF but not the Large or Compare+Diff ones. Then version 4's content again as **version 6** (identical content, identical `plans` documents). Free's stale Compare tab: its GIF was refused by the server and the tool locked at once; Grid opened again in both tabs 56 s later, their photos still there.
- **After:** the temporary accounts and their sessions removed (the sessions the browsers held answer 401); no temporary account left; no password in any log or result (725 files scanned); accounts unchanged (same fingerprints for the owner's admin account, the other Google account, `Tomerfree`, `Tomerpay`); `plans` documents identical; MongoDB on 127.0.0.1 only; no errors in the app's log.
- **Not checked here:** the owner's own accounts (`Tomerfree`, `Tomerpay`: their passwords are the owner's), the admin dashboard with an admin session (only the owner's Google account is an admin; username accounts can never be), a real Google sign-in and a real iPhone. The admin dashboard is covered by the e2e tests (210/210 locally).

## Verification of `cccced6` and `3161d2c` (2026-11-18, 11:34–12:00Z)

- **Before the releases:** CI run 21 green on `cccced6` and run 22 on `3161d2c`. Locally: 355 unit/integration and 210 e2e tests, including 10 on a third staging-like server with staging's published catalog (Free/Pro/admin, direct URLs, reloads, plan switches, a publication while a tool is open, two tabs, revoked sessions, exports, Hebrew, WebKit iPhone emulation).
- **The release logs** (`studio-release-cccced6`, `studio-release-3161d2c`, result success): dump, then "44 indexes ensured" with no data changed, healthy at 11:33:59 and 11:57:07.
- **Over HTTPS:** `deploy/smoke.sh` 22/22 after each release.
- **On the server, end to end over HTTPS with temporary accounts** (removed afterwards):
  - `npm run db -- entitlement-test` (11:35Z): Free gets exactly the published Free plan (Study & Simplify, Color & Mixing, Create a Grid, saving images); Measure & Plan and Compare & Correct are refused (403 naming the tool), and so are their exports; GIFs are refused to Free; Pro gets all nine features; Free → Pro on the same session opens Measure & Plan at once, and back to Free refuses it again. All checks passed.
  - `npm run db -- login-test`: 13/13 (its Free check now compares with the published Free plan).
  - `npm run db -- entitlement-test --publish-check` (11:58Z, after the dump `mongodb-20261118T113628Z`): published a temporary **version 3** (Create a Grid off for everyone, Measure & Plan added to Free): both accounts lost Create a Grid and Free gained Measure & Plan on their existing sessions, every tool and export as published; then published version 2's content again as **version 4**: both back exactly as before. 30/30. Version 4 is live and identical to version 2 (`plans` too).
  - A first `--publish-check` attempt (11:38Z, `cccced6`) stopped before publishing anything: the server could not resolve its own name for a moment. It left one temporary account (`enttest_free_6873d4`), removed at once with `remove-tester`; `3161d2c` fixes that.
- **Unchanged:** before/after snapshots (roles, plans, status, sign-in methods, live sessions, SHA-256 fingerprints of each user's documents) are identical for the owner's admin account, the other Google account, `Tomerfree` and `Tomerpay`. MongoDB listens on 127.0.0.1 only; the app's log since the release has no errors.
- **Not checked here:** a real browser on staging (the temporary-account browser check was blocked by the session's permission policy before any account was made: it needs the owner's go-ahead), the owner's own accounts (`Tomerfree`, `Tomerpay`: their passwords are the owner's; nothing was reset) and a real iPhone. The same build and catalog are covered by the e2e tests on the staging-like server.
- **Open tabs from before the release** run the old studio code until they reload or navigate.

## Verification of `887a41e` (2026-11-18, ~02:20Z)

- **Before the release:** CI run 19 green on `887a41e` (completed by 02:11Z). Locally the same: 336 unit/integration and 200 e2e tests (the e2e ones include a staging-like server: Google plus usernames, desktop Chrome and WebKit iPhone emulation).
- **The release log** (`studio-release-887a41e`, result success):
  - dependencies 02:12:09, build 02:13:21, dump 02:14:19;
  - migration ("44 indexes ensured", no data changed: 0 accounts set to Free, 0 given defaults);
  - healthy 02:14:25.
- **Settings:** `studio-set-username-login staging on` at 02:14:47Z (the whole previous file kept in `/root/backups/username-login-20261118T021447Z/` and as `staging.env.previous`); the app restarted healthy.
- **The QA accounts** (created 02:16Z with `npm run db -- create-tester`, after the dump `mongodb-20261118T021507Z`):
  - `Tomerfree` (`6afd0a74f56282f5c4b07173`): role user, plan Free, active, test account, one sign-in method (password, scrypt hash), no email (placeholder);
  - `Tomerpay` (`6afd0a7787c67f3cc212b206`): the same with plan Pro;
  - their initial passwords were never printed: each is sealed in `password_handoffs` for one reveal in the dashboard until 2026-11-21 02:16Z;
  - running `create-tester` again (`TOMERFREE pro`) changed nothing.
- **Existing accounts unchanged:** a read-only snapshot before and after (role, plan, status, sign-in methods, live sessions and a SHA-256 fingerprint of each user's documents) is identical for the owner's admin account (4 sessions kept) and for the other Google account.
- **On the server, end to end over HTTPS** (`npm run db -- login-test`, a temporary account, removed afterwards): sign-in by username; Secure, HttpOnly, SameSite=Lax cookie; user role, Free, all five tools, no Pro features; `/admin` and the admin export 404; a plan change to Pro and back applies on the next request; a wrong password gets the one generic answer; a reset signs out at once, the old password stops working and the new one works; a suspension ends the session and refuses sign-in (403). 13/13. Its audit entries remain under a bare id (ADR-0010).
- **Over HTTPS:** `deploy/smoke.sh` 22/22 (now also: the username form on `/sign-in` and `/he/sign-in`, the username endpoint answering, no username lookup, no password sign-up); the server-only account endpoints 404 over HTTP.
- **Also checked:** MongoDB still listens on 127.0.0.1 only; the app's log since the release has no errors (two "Invalid password" warnings from the deliberate wrong-password checks, with no username or password in them).
- **Not checked here:** the dashboard flows with the owner's Google admin session (revealing the initial passwords, plan switches, resets) and a real iPhone. They are covered by the e2e tests on the staging-like server and are the owner's check here.
- **Releases kept:** `887a41e 675d8de 225ba58 186d2a4 b22a510` (`8ce4860` pruned). Rollback: `sudo studio-set-username-login staging off` turns username sign-in off (accounts kept); to go back to the previous code, point `current` at `675d8de` and restart (it ignores the new fields).

## Verification of `675d8de` (2026-11-16, ~22:25Z)

- **Before the release:** CI run 17 green on `675d8de` (completed by 22:22Z). Locally the same: 303 unit/integration and 184 e2e tests.
- **The release log** (`studio-release-675d8de`, result success):
  - dependencies 22:22:36, build 22:23:33, dump 22:24:29;
  - migration ("42 indexes ensured", no data changed);
  - healthy 22:24:33.
- **Over HTTPS:**
  - `deploy/smoke.sh` 20/20;
  - health ok on `675d8de`, built 22:23:34Z;
  - the studio chunk with the new Color code (`3yy-dj-opilwk.js`, 389 KB) served as JavaScript;
  - `/app/color` sends signed-out visitors to sign-in.
- **Not checked here:** Color & Mixing in a signed-in session on staging. Sign-in is Google only, with the owner's account, so this is the owner's iPhone check.
- **Releases kept:** `675d8de 225ba58 186d2a4 b22a510 8ce4860` (`6033016` pruned). To roll back instantly, point `current` at `225ba58` and restart.

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

Nothing: `be6890c` is live (plan enforcement, ADR-0013, since `cccced6`): Google, plus username sign-in for accounts admins create; the plan catalog's live version is 6, with exactly the owner's version 2 content (versions 3–6 are the two audited publication checks).
