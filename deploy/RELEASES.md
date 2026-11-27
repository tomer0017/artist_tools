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
| 2026-11-27 03:30:31 (production) · catalog v10 03:31 | `a207091` (`52c67a1` + a test fix; on `111daa0`) | **Art on Your Wall** (הציור שלך על הקיר), /app/wall: upload and crop an artwork (free, square, circle, ratios; rotate; real size in cm), classic / floating / frameless frames in seven finishes with a mat and round frames, Wall Studio (colours and textures), Room Studio (five rooms in perspective, four sofas, any colour, to scale), My Room (the person's photo, perspective corners, real-size calibration), gallery lighting and a picture light, projects kept in the browser (IndexedDB), four frames compared, PNG/JPEG at 1600 or 4200 px. New features `tool.wall`, `wall.premium`, `wall.lighting`, `wall.my_room`, `wall.compare`, `export.wall_hires`; a save is authorized with the options it uses. CI run 87 green (318 e2e, incl. e2e/art-wall.spec.ts on Chromium and iPhone WebKit). Then catalog v10 (scripts/publish-wall-catalog.ts one-off, dry run first, cli:owner-request): Free + Art on Your Wall; Pro + the tool and all its options. Checks: smoke all passed; catalog-status in step; entitlement-test all passed against catalog v10 (the tool opens for Free and Pro); paypal-check ok; counts unchanged but config versions 32; 0 error lines | 58 indexes ensured; nothing changed ("Catalog version 9: applied"); then catalog v10 published | yes (`mongodb-20261127T033021Z`) |
| 2026-11-24 17:09:52 (production) · 17:20:05 (staging) | `889415d` | **Sketchy: on phones his sign stays inside the hero**, clear of the gilt Pro banner that follows it for Free accounts (seen on production after `523e141`: its last 25 px covered the banner's heading); a little more compact on narrow screens, with a tip too long for the room scrolling inside the board. CI run 72 green. Checks: smoke 27/27 (production and staging); `entitlement-test` all passed; `paypal-check` ok; counts unchanged; 0 error lines in the app log; production acceptance with fresh temporary testers 6/6 (removed). Staging mirrored from `90be421` | 58 indexes ensured; nothing changed (0 plans updated; "Catalog version 9: applied") | yes (release steps: `mongodb-20261124T170942Z` production, `mongodb-20261124T171954Z` staging) |
| 2026-11-24 16:25:23 (production) | `523e141` (with `288b805`) | **Sketchy, the studio companion** (the founder's brief "Sketchy — The Intelligent Studio Companion"; ADR-0024). The fox artist of the official character sheet as an animated SVG puppet on Home and the Learn home: walks in, waves, introduces himself, suggestions on a sign with real buttons (each checked against the account's real access), a menu (surprise me, drawing tips, the challenge roulette, improve my drawing, choose a tool, a lesson, practice sheets, preparing a class, who you are, hide), an animated roulette of the challenges the account may open, celebrations after saves and completions. New Admin → Companion (settings, animations with previews, per-capability access, 47 tips in English and Hebrew; each save live as a new version of kind `companion`). Account field `users.companion` (hidden, audience). Nothing published: the code's defaults apply (on for everyone, all Free). PayPal, billing, plans and Learn unchanged. CI run 70 green (checks and the full end-to-end suite). Checks: smoke 27/27; `entitlement-test` all passed (97 items, 183 images); `paypal-check` all ok; counts identical before and after (2 users, 3 sessions, 0 subscriptions, 0 payments, 31 config versions, 183 Learn assets); catalog v9 in step; production acceptance with temporary testers (Free, Pro, Hebrew × desktop Chromium and iPhone WebKit) 6/6, testers removed | 58 indexes ensured; nothing changed (0 plans updated; "Catalog version 9: applied") | yes: a verified dump first (`mongodb-20261124T161045Z`, restore drill RESULT OK and LEARN OK with 183/183 asset files, content v19), then the release step (16:25:09) |
| 2026-11-24 04:36:14 (production) · 05:17:32 (staging) | `90be421` | **Learn CMS: every lesson and challenge managed in Admin → Learn, each with its own access** (the founder's brief "Complete Production Learn CMS"; ADR-0023). Add, edit (English and Hebrew), duplicate, archive and restore; pictures uploaded from the browser, replaced, reordered and removed; up/down within a group; preview; each save live at once as a new content version, with item and whole-content history and restore. Each item's Access (Free, Pro, Admin only, Blocked) is the only setting; Admin → Plans only sums Learn up. Production runs it first (the owner's way of working), staging mirrored. **After the release (operator, each dry run checked first, then `--apply`):** content v11, each item's mode written with access unchanged (Free 76, Pro 21); v12, every existing item Free (the founder's request, including the 21 lessons catalog v8 kept for Pro); catalog v9, the old Learn rules to All, so a release before modes shows exactly the same. Production acceptance over HTTPS with temporary testers (removed): content v13–v17 took D-SUBJ-04 through Pro, Free, Admin only, Blocked and back to Free (v17 holds v12's content). Staging: the same three steps, the same content and catalog hashes. Checks: smoke 27/27, `entitlement-test` all passed (97 items, 183 images), `paypal-check` all ok; tools, exports, prices and PayPal unchanged | 58 indexes ensured (1 new, `config_versions_by_item`); item histories backfilled once; 0 plans updated ("Catalog version 8: applied"). Then content v11–v17 and catalog v9 (production), v11–v12 and catalog v9 (staging) | yes: a verified dump first (`mongodb-20261124T034724Z`, restore drill RESULT OK and LEARN OK with 183/183 asset files), then the release steps (`mongodb-20261124T043607Z` production, `mongodb-20261124T051723Z` staging) |
| 2026-11-22 01:08:25 | `c1ee8bc` | **Challenges V2: the creative playground** (the founder's brief of 2026-11-22; dark launch; ADR-0021, docs/learn/11; includes `4cbb200`). The Challenges screen opens on "Need an idea?": four moods (efforts, never skill ratings), a spin with a short reel, one idea with an optional twist and a tip, Save, Mark as completed, and an optional timer (10/30/60 minutes or a stopwatch) worked out from wall-clock timestamps in the browser; a Saved filter in the list; clearing this device removes what the playground keeps. **After the release:** Learn content version 10 (the owner's version 9 plus 8 categories and 60 private ideas, CH-055…CH-114) published by a guarded operator script. No Free/Pro plan setting published or changed | 48 indexes ensured; no plan changed (0 plans updated; "Catalog version 6: applied"). Then content version 10 (no new asset) | yes (release step, 01:08:19, `mongodb-20261122T010819Z`), and before the content (`mongodb-20261122T011240Z`) |
| 2026-11-20 00:45:56 | `9808770` | **The 15-lesson beginner course** (the founder's sprint brief of 2026-11-19, deadline 2026-11-26; dark launch; docs/learn/10; includes `78b7fb2`). Code: the Learn screen scrolls up and down only. Right to left, WebKit with visible scrollbars had counted the scrollbar's width as sideways overflow: 5 px on every Learn screen in Hebrew. Content, afterwards: Learn test content version 4 (lessons 6–15, the units regrouped into the approved stages, the challenges linked to their lessons, CH-053 and CH-054). No Free/Pro plan setting published or changed | none (48 indexes ensured, 0 plans updated) | `mongodb-20261120T004549Z`; before the content `mongodb-20261120T005627Z` |
| 2026-11-19 17:28:22 | `a748e6d` | **Beginner lessons, the M6a revision** (approved by the owner after reviewing M6a; dark launch, ADR-0020, docs/learn/09; includes `a7dcb29`). A lesson is one small skill: the objective, one picture, "Your task" in 1–3 lines, "Make something", "Done when", and one button, "I did it — next lesson" (records the person's own word once a day, never in class mode, with "Marked as done … Undo"; nothing judges the drawing). The rest is behind "Need help?" (the mistake and its picture, why, what you need, tools, more practice, credits); the practice sheet is optional ("any paper works"). Publishing rules: one picture, 1–3 task lines, no self-checks; drafts are no longer numbered. **After the release:** test content version 3 (five micro-lessons with code-drawn pictures and A4 practice sheets, two starter challenges; the three M6a lessons unpublished, kept whole) imported and published. Published plan settings unchanged | 48 indexes ensured; no plan changed (0 plans updated; "Catalog version 6: applied"). Then content version 3 and 25 new asset records (by `learn-import` / `learn-publish`) | yes (release step, 17:28:17, `mongodb-20261119T172817Z`), and before the import (`mongodb-20261119T173351Z`) |
| 2026-11-19 14:52:53 | `54e2a16` | **Lessons that teach, Learn milestone M6a** (approved by the owner with their refinements; dark launch, ADR-0019). An exercise with steps is a lesson: See it (a picture at a time), Do it (steps with the subject, tool links that set the tool and lead back, the worksheet), Check it (never saved), the common mistake, Done when and Next; nothing folded but credits. The course in units with "Up next" and an optional, unnumbered baseline; two doors on the Learn home and Home ("Start: Lesson 1 · …"); challenges with a Skill filter, focus lines and "Builds on"; "Lesson" replaces "Exercise". Content additions only (M5 reads them). **After the release:** test content version 2 (the three lessons rewritten, with diagrams drawn in code and annotated CC0 references; the three challenges linked) imported and published. Published plan settings unchanged | 48 indexes ensured; no plan changed (0 plans updated; "Catalog version 6: applied"). Then content version 2 and 21 new asset records (by `learn-import` / `learn-publish`) | yes (release step, 14:52:47, `mongodb-20261119T145247Z`), and before the import (`mongodb-20261119T145703Z`) |
| 2026-11-19 10:46:48 | `ab42467` | **Learn screens, Learn milestone M5** (approved by the owner; dark launch, ADR-0018). A studio view at `/app/learn/...`: the Learn home (Start/Continue, Random, Quick, class mode), the drawing course, the challenges (filters remembered on the device), exercise and challenge cards (the reference full screen with zoom, More help, tool shortcuts that hand the reference to Measure, Study, Grid and Compare, Prepare worksheets / Use my photo, Mark as completed with Undo, Another one), My history and the locked page; "Learn to draw" on Home and Learn in the desktop top bar for accounts Learn is shown to (admins only today). New history API `/api/learn/completions` (own entries only; in the data download, removed with the account); class mode per tab never touches it. Published plan settings unchanged | 48 indexes ensured (2 new, `learn_completions`); no plan changed (0 plans updated; "Catalog version 6: applied") | yes (release step, 10:46:43, `mongodb-20261119T104643Z`) |
| 2026-11-19 02:37:27 | `324e136` | **Learn foundations, Learn milestone M4** (approved by the owner; dark launch, ADR-0017). Versioned Learn content (`learn_content`: draft, publish, history, restore), private reference images named by their SHA-256 in `LEARN_ASSETS_DIR` and checked by their bytes (no embedded metadata), and per-item access in Admin → Plans (All / None / Selected per plan and collection, frozen when published), decided by one resolver on every request; new Admin → Learn; `/api/learn/items`, `/api/learn/assets` and `learnItem` in `/api/usage`. New feature IDs `learn.curriculum`, `learn.color`, `learn.challenges`, **in no plan**; catalog v6 has no Learn section, so **Free and Pro open nothing**. **Server setup before the release:** `deploy/install-learn-assets.sh staging` (asset directory, `LEARN_ASSETS_DIR` in the env file, nightly asset backup at 02:50). **After the release:** the test content (3 exercises, 3 challenges; 4 CC0 references) imported and published as content version 1. Published plan settings unchanged | 46 indexes ensured (2 new, `learn_assets`); no plan changed (0 plans updated; "Catalog version 6: applied"). Then content version 1 and 8 asset records (by `learn-import` / `learn-publish`) | yes (release step, 02:37:21, `mongodb-20261119T023721Z`), and before the import (`mongodb-20261119T024027Z`) |
| 2026-11-18 21:04:47 | `8576f66` | **Prepare Worksheets, Learn milestone M3** (approved by the owner; includes `ab2f5aa`). From Create a Grid and Study & Simplify: the original, a clean outline, the reference with its grid, an optional blank grid and a values study, saved as **PNG images** that line up (the owner's choice over the planned PDF). Built from the existing tools: Create a Grid's own images, Study's Clean Outline and its Values algorithm (moved to `src/lib/values` unchanged, ADR-0016). New feature ID `export.worksheets` ("Worksheets"), **in no plan: only admins can make worksheets until the owner publishes it**. Create a Grid's "Save PDF (A4)" button is hidden (code and `export.pdf` kept). **Fixed (`ab2f5aa`):** Study & Simplify's study, palette and study sheet saves did nothing under the site's CSP since 2026-11-11. Settings and published plans unchanged | 44 indexes ensured; no data changed (0 plans updated; "Catalog version 6: applied") | yes (release step, 21:04:41, `mongodb-20261118T210441Z`) |
| 2026-11-18 18:47:37 | `d261013` | **Create a Grid's A4 PDF, Learn milestone M2** (approved by the owner). A two-page A4 PDF: the reference with its grid, then the same grid blank, for paper. Both pages have one frame, the same vector lines and a 50 mm bar; true size when the canvas fits, otherwise reduced and stated. jsPDF 4.2.1 is loaded only after the server authorizes a PDF (ADR-0015). New feature ID `export.pdf` ("Grid PDFs (A4)"), **in no plan: only admins can make PDFs until the owner publishes it**. Settings and published plans unchanged | 44 indexes ensured; no data changed (0 plans updated; "Catalog version 6: applied") | yes (release step, 18:47:32, `mongodb-20261118T184732Z`) |
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

## Challenges V2 on staging, `c1ee8bc`, then Learn content version 10 (2026-11-22, 01:05–01:30Z)

The founder's brief "Creative Playground (Challenges V2)" of 2026-11-22
(ADR-0021, docs/learn/11): the Challenges screen opens on a playground (a
mood, a spin, one idea, an optional timer, Save, Mark as completed), and 60
new private ideas in 8 categories are published for admins only. No Free/Pro
plan setting was published or changed; the course and the 7 existing
challenges are unchanged. Production and GitHub Pages are untouched.

- **Before:**
  - CI run 57 (`c1ee8bc`, with `4cbb200`) green: type check, lint, unit
    and integration tests, and the e2e suite. Run 56 (`4cbb200` alone) was
    cancelled by the newer push.
  - Read-only checks on staging (`9808770`):
    - `learn-status`: content version 9 `05bd7c9ba382fd1f` (the owner's,
      2026-11-21 23:07Z), no draft; 183 assets, 183 of 183 files intact;
    - the capture: catalog version 6 `f8a1a43e4cedbed7`, `plans`
      `48f75a1f7925d6c5`, no draft.
- **The release** (01:05:38–01:08:25):
  - the dump `mongodb-20261122T010819Z`;
  - 48 indexes ensured, "0 plans updated", "Catalog version 6: applied";
  - healthy at 01:08:25 (`/api/health`: `c1ee8bc`).
- **After the release, with content version 9 still live:** smoke 27/27,
  `entitlement-test` 24/24 (37 items, 183 images), `login-test` 13/13.
- **The content:**
  - **Upload:** the private folder `challenges-v2`'s two files (the ideas and
    the operator script) went to a 0700 folder of the site user,
    `content-reviews/challenges-v2-20261122`. Both match the local SHA-256s.
  - **`snapshot`:** version 9 and fingerprints of what must not change
    (the release, other configuration, plans, grants, completions).
  - **`check`,** publishing nothing:
    - 68 changes, all additions (8 categories, 60 ideas);
    - the 30 lessons, the 7 challenges and their 4 groups identical;
    - 29 numbered lessons;
    - the document stored exactly as built, no content issue;
    - Free and Pro open 0 items.
  - **`apply`,** after the dump `mongodb-20261122T011240Z`: content version
    10 live at 01:12Z (actor `cli`, content `9585deef076f5df5`), published
    only because version 9 was still live and no draft existed
    (`publishIfUnchanged`). The fingerprints were unchanged afterwards.
  - **`verify`:**
    - version 10 is exactly version 9 plus the additions;
    - an admin's entitlements open all 60 ideas, with title, task, twist,
      tip and skill exactly as written;
    - Free and Pro, from the plans as published: 0 of 97 items open,
      0 thumbnails;
    - signed out, CH-055 and CH-114 answer 401.
  - **`learn-status`:** 183 of 183 files intact (no new asset).
  - **The capture:** identical (the catalog with its history and times, and
    `plans`).
  - **`entitlement-test`:** 24/24 (97 items, 183 images).
  - **Evidence:** in the private folder (0600).
- **In real browsers** (`lab/qa/staging-v2.spec.ts`; temporary Free, Pro and
  Hebrew accounts; removed, 0 left; passwords only in a 0600 file, deleted, as
  were the sign-in states), 5/5:
  - for each of the three accounts:
    - each of the 67 challenges answers 403, and the list is empty;
    - none of the new text reaches the account;
    - no Learn on Home;
    - the Challenges screen and an idea's page lead Home, with no
      playground;
    - recording a new idea is refused;
  - signed out, 401;
  - on an iPhone (WebKit, emulated), the bottom bar keeps its six items.

  A first run timed out after 10 minutes, with no failed expectation: it
  checked every phrase with its own `expect`. The rerun used one per
  response and took 29 s.
- **Smoke** 27/27 again at the end.
- **Not verified on staging:** an admin's view of the playground. No
  temporary admin exists, by design (ADR-0012): the founder checks it.
- **Locally** (emulated browsers, not physical devices):
  - **Unit and integration:** 93/93 targeted tests (Learn, roulette,
    timer, device data, i18n).
  - **Browser tests:** `learn-screens` and `entitlements` 39/39 on the
    fixture, Chromium and iPhone WebKit; `learn-screens` 26/26 again after
    the last change, and CI run 57 ran the whole suite. They cover:
    - the moods and the spin rules;
    - the reel;
    - Save after a reload, and the Saved filter;
    - Mark as completed;
    - the timer after reloads, three hours away, pause and resume, time
      up and the stopwatch;
    - Hebrew, phones, axe;
    - Free with a challenge module.
  - **Screenshots:** of the private ideas on the same build.
- **Rollback:**
  - **The code:** `9808770` reads content version 10. It shows the 67
    challenges in its old list and ignores the twist. It is in releases/
    with `a748e6d`, `54e2a16` and `ab42467`; `324e136` was pruned.
  - **The content:** version 9 can be published again with the operator
    script's `rollback` or Admin's restore. The 60 ideas stay, unpublished.
  - **The floor stays `224bb65`.**

## Lessons 16–29 on staging: Learn content versions 5–7 (2026-11-20, 02:25–03:05Z)

After the founder approved lessons 1–15 and asked for lessons 16–29 in the
same direction (docs/learn/10), each stage was built as its own content
version and published on staging in turn, for admins only. There was no
release: staging still runs `9808770`, and no code changed. No Free/Pro
plan setting was published or changed. Production and GitHub Pages are
untouched.

**Each version** went through the same steps. The private seed was copied to
a 0700 folder on the server, checked file by file against the local
SHA-256s, and deleted after the import. Then, in order:
- a dump;
- `learn-import`;
- `learn-publish`;
- `learn-status`;
- the read-only capture, compared with the one taken before;
- `entitlement-test`.

| Version | Published | Content | Adds | Dump first | Assets |
|---|---|---|---|---|---|
| 5 | 02:26Z | `fdef32cf20ada603` | Lessons 16–19: light on a box, a ball, core and cast shadow, a cylinder | `mongodb-20261120T022532Z` | 60 already stored, 12 new; 124 of 124 files intact |
| 6 | 02:36Z | `c81d6ba3fe1ff9b7` | Lessons 20–24, observation (D-SHAPE-01, M6a's draft, rewritten as lesson 21); CH-002 linked to lessons 20–22 | `mongodb-20261120T023645Z` | 72 already stored, 15 new; 149 of 149 files intact |
| 7 | 02:51Z | `67f0c6a110ce967d` | Lessons 25–29, the first realistic drawing; a sixth unit | `mongodb-20261120T025057Z` | 87 already stored, 15 new; 174 of 174 files intact |

- **Every version, on staging:**
  - the capture identical: the catalog (version 6, its publication time and
    history) and `plans` with their update times;
  - `entitlement-test` 24/24: as Free and as Pro, each item (28, 32, then
    37) is refused as published, with exports from it; 0 items open, 0
    images served.
- **After version 7, in real browsers** (fresh temporary Free, Pro and
  Hebrew accounts; removed, 0 left; passwords only in a 0600 file, deleted,
  as were the sign-in states):
  - the Learn checks 3/3:
    - the 36 published items answer 403, the draft D-START-01 404;
    - each of the 174 asset files answers as it should;
    - no lesson text reaches them, every "Make something" line included;
    - completions are refused (a sample: the completions throttle allows 60
      attempts per 10 minutes per account);
    - signed out, everything answers 401;
    - on an iPhone (WebKit, emulated), the same refusals;
  - smoke 27/27.
- **Locally, the same build and each version** (emulated browsers, not
  physical devices):
  - every lesson in English and Hebrew, in desktop Chromium and iPhone 13
    WebKit: title, place, picture, the enlarged picture, task, "Make
    something", "Done when", where the button leads, the sheet's bytes, the
    help sheet with the focus returned, axe, no sideways overflow, no
    console errors;
  - "I did it — next lesson" from lesson 1 to the last;
  - a returning person;
  - class mode;
  - lesson 26's button opens Create a Grid at 4 × 4 with the lesson's photo
    and the way back;
  - v7: 121/121.
- **The history replayed** (M4, M6a, v3, v4, v5, v6, v7) on a throwaway
  database: no content issue. Each version only adds to the one before.
- **The practice sheets:** the 14 new PDFs read back as one A4 portrait page
  each, no images, every mark at least 18 mm from the edges, and no words
  but the lesson's ID.
- **Not verified on staging:** an admin's view of the lessons, by design (no
  temporary admin, ADR-0012): the founder's check.
- **Rollback:** any earlier content version can be restored (its files are
  all still stored). The code rollback is unchanged.

## The 15-lesson beginner course on staging, `9808770` (2026-11-20, 00:43–01:20Z)

The founder's sprint brief of 2026-11-19, with a deadline of 2026-11-26: lessons 6–15 and one A4 sheet per lesson, admins only, then stop for the
founder's review (docs/learn/10). No Free/Pro plan setting was published
or changed. The Learn test content went from version 3 to version 4, and
nothing was deleted. Production and GitHub Pages are untouched.

- **Before:**
  - CI run 52 (`9808770`, with `78b7fb2`) green: type check, lint, unit
    and integration tests, and the e2e suite.
  - Read-only checks on staging (`a748e6d`):
    - `learn-status`: content version 3 `5323ddeca93edb04`, no draft;
    - the capture: catalog version 6 `f8a1a43e4cedbed7`, `plans`
      `48f75a1f7925d6c5`, no draft.
- **The release** (00:43:04–00:45:56):
  - the dump `mongodb-20261120T004549Z`;
  - 48 indexes ensured, "0 plans updated", "Catalog version 6: applied";
  - healthy at 00:45:56 (`/api/health`: `9808770`).
- **After the release, with content version 3 still live:**
  - smoke 27/27 and `entitlement-test` 24/24;
  - `login-test` 13/13. A run straight after two earlier ones hit the
    limit of five sign-ins a minute; the run a minute later passed whole.
- **The test content** (the private folder `learn-seed-course15`, copied
  to a 0700 folder on the server only for the import, checked file by file
  against the local SHA-256s, then deleted there):
  - the dump `mongodb-20261120T005627Z`;
  - `learn-import`: v3's 30 assets already stored ("exists"), 30 new ones
    stored (20 pictures with their thumbnails, 10 sheets); draft version 4;
  - `learn-publish`: content version 4 live at 00:56Z (actor `cli`,
    content `e8578e4bb8dc059d`):
    - 15 lessons in the units `lines` (1–5), `build` (6–8), `forms`
      (9–13) and `values` (14–15). D-LINE-04, M6a's glass lesson, is
      rewritten as lesson 10 and published; D-START-01 and D-SHAPE-01 stay
      unpublished;
    - the challenges are linked to their lessons; CH-002 is intermediate;
      CH-053 and CH-054 are added;
    - no warning: no plan's list names an item;
  - `learn-status` exit 0: 104 assets (44 pictures, 44 thumbnails, 16
    PDFs), 104 of 104 files with exactly their recorded bytes.
- **After the content:**
  - the capture identical: the catalog (content, publication time,
    history) and `plans` with their update times; no draft;
  - `entitlement-test` 24/24: as Free and as Pro, each of the 24 items is
    refused as published, with exports from them; 0 items open, 0 images
    served;
  - smoke 27/27;
  - **the practice sheets on the server:** each of the 15 PDFs has exactly
    the bytes of the file read back locally: one A4 portrait page each
    (595.28 × 841.89 pt), no images, every mark at least 18 mm from the
    edges, no words but the lesson's ID (and, on D-VAL-01, its fill order
    as digits). Printing on a real printer has not been checked.
- **In real browsers** (temporary Free, Pro and Hebrew accounts; removed,
  0 left; passwords only in a 0600 file, deleted, as were the sign-in
  states):
  - the Learn checks 3/3:
    - Free, Pro and Free in Hebrew get no Learn anywhere;
    - the 22 published items and their completions answer 403; the 2
      unpublished ones answer 404;
    - each of the 104 asset files answers 403 when a published item uses
      it, and 404 otherwise. That includes M6a's files of D-LINE-04, kept
      for the history;
    - no text of the new lessons reaches them;
    - signed out, every Learn request answers 401;
    - on an iPhone (WebKit, emulated), the bottom bar keeps its six items;
  - the M1 checks 8/8, the M3 checks 6/6, the plan-enforcement checks 6/6
    (the publishing test skipped);
  - **Not verified on staging:** an admin's view of the lessons. No
    temporary admin exists, by design (ADR-0012): the founder checks it.
- **Locally, the same build and the same content** (`E2E_LEARN_SEED`;
  emulated browsers, not physical devices), 64/64 checks:
  - every lesson in English and Hebrew, in desktop Chromium and iPhone 13
    WebKit: title, place, picture, the enlarged picture, task, "Make
    something", "Done when", where the button leads, the sheet's bytes, the
    help sheet with the focus returned, axe, no sideways overflow, no
    console errors;
  - "I did it — next lesson" from lesson 1 to 15 and back to the course,
    each lesson recorded once;
  - a returning person finds all 15 done;
  - class mode records nothing.
- **Locally, the tests:**
  - 572 unit and integration tests;
  - e2e 267 passed, 9 skipped, including the new Hebrew phone test on
    Chromium and WebKit;
  - a replay of staging's history (M4, M6a, v3, then v4) on a throwaway
    database: no content issue.
- **Rollback:**
  - `a748e6d` reads content version 4 the same way, without the overflow
    fix. `54e2a16` (M6a) shows the lessons in its denser layout. Both are
    in releases/, with `ab42467` and `324e136`.
  - Content version 3 can be restored if needed; its files are all still
    stored.
  - `8576f66` was pruned (the five newest are kept).
  - Once the founder publishes any Learn feature or rule, never roll back
    below `224bb65` (ADR-0014).

## Beginner lessons (the M6a revision) on staging, `a748e6d` (2026-11-19, 17:25–17:45Z)

Approved by the owner after reviewing M6a, with nine refinements
(docs/learn/09 §6): the revised lesson experience and the first five
micro-lessons only, then stop and show the owner. No Free/Pro plan setting
was published or changed. The Learn test content went from version 2 to
version 3 (admins only), and the M6a lessons were unpublished, not deleted.
Production and GitHub Pages are untouched.

- **Before:**
  - CI runs 49 (`a7dcb29`) and 50 (`a748e6d`) green: type check, lint, 572
    unit and integration tests, and the e2e suite (9 skipped on purpose).
  - Read-only checks on staging (`54e2a16`):
    - `learn-status`: content version 2 `9075f928b2177a66`, no draft;
    - the capture: catalog version 6, `plans` `48f75a1f7925d6c5`, no draft.
- **The release** (17:25:51–17:28:22):
  - the dump `mongodb-20261119T172817Z`;
  - 48 indexes ensured, "0 plans updated", "Catalog version 6: applied";
  - healthy at 17:28:22 (`/api/health`: `a748e6d`).
- **After the release, with content version 2 still live:** smoke 27/27,
  `login-test` 13/13, `entitlement-test` 24/24.
- **The test content** (the private folder `learn-seed-beginner`; copied to
  the server only for the import, then deleted there):
  - the dump `mongodb-20261119T173351Z`;
  - `learn-import`: M6a's 15 assets already stored ("exists"); 10 new
    pictures with their thumbnails and 5 practice-sheet PDFs stored; draft
    version 3;
  - `learn-publish`: content version 3 live at 17:34Z (actor `cli`,
    content `5323ddeca93edb04`):
    - D-HAND-01, D-LINE-01, D-LINE-02, D-FLAT-01 and D-FLAT-02 (Lessons 1–5,
      in the units `lines` and `flat`);
    - CH-051 and CH-052 (starter challenges);
    - D-LINE-04, D-START-01 and D-SHAPE-01 unpublished and moved to the
      later units `forms` and `observe`;
    - CH-002, CH-012 and CH-017 unchanged;
    - no warning: no plan's list names an item;
  - `learn-status` exit 0: 54 assets (24 pictures, 24 thumbnails, 6
    worksheets), 54 of 54 files with exactly their recorded bytes. The 10
    new diagrams and 5 sheets are own work (no source page). Free and Pro
    open nothing.
- **After the content:**
  - the capture identical: the catalog (content, publication time, history)
    and `plans` with their update times; no draft;
  - `entitlement-test` 24/24. As Free and as Pro, each of the 13 items and
    each of the 54 images is refused (published) or not found (only the
    unpublished lessons use it), as published. Exports from items are
    refused; 0 items open, 0 images served;
  - smoke 27/27;
  - **the practice sheets on the server:** each of the 6 PDFs (the 5 new
    and M6a's warm-up page) has exactly the bytes its name records, the same
    files read back locally: one A4 portrait page each (595.28 × 841.89 pt),
    no images, every mark at least 17 mm from the edges, and no words but
    the lesson's ID.
- **In real browsers** (temporary Free, Pro and Hebrew accounts; removed;
  passwords only in a 0600 file, deleted, as were the sign-in states):
  - the Learn checks 3/3: Free, Pro and Free in Hebrew get no Learn
    anywhere. The 10 published items answer 403, the 3 unpublished ones and
    their completions 404. The 27 assets of published items answer 403,
    the 27 used only by unpublished lessons 404. No text of the new lessons
    reaches them;
  - signed out, every Learn request answers 401;
  - on an iPhone (WebKit, emulated), the bottom bar keeps its six items.
  - **Not verified on staging:** an admin's view (the lessons themselves).
    No temporary admin exists, by design (ADR-0012): the owner checks it.
- **Regressions on the same build:**
  - the M1 checks 8/8, the M3 checks 6/6;
  - the plan-enforcement checks 6/6 (the publishing test skipped).
- **Locally, the same build and the same content** (the private seed through
  `E2E_LEARN_SEED`): desktop and iPhone (WebKit), English and Hebrew.
  Checked:
  - every lesson's first screen and whole page;
  - the help sheet;
  - the "Marked as done … Undo" note;
  - the course and the challenges.

  No console errors. The only horizontal overflow is WebKit's 5 px in
  Hebrew, as on every Learn page since M5.
- **Locally, the tests:**
  - 572 unit and integration tests, including the M5 compatibility test (a
    frozen copy of M5's schema reads published content);
  - e2e in Chromium and WebKit iPhone emulation:
    - the lesson page part by part, in English and Hebrew, with axe;
    - the help sheet, its focus returning to its button;
    - the button with Undo, once a day, and in class mode;
    - the phone layout (a full-width picture and button, a sheet within the
      screen);
    - the course with drafts unnumbered;
    - Free and Pro refused a lesson and its pictures.
  - A replay of staging's history (M4's content, M6a's under its own rules,
    then version 3) on a throwaway database.
- **Rollback:**
  - `54e2a16` (M6a) and `ab42467` (M5) are in releases/. Both read content
    version 3: M6a shows the five lessons in its denser layout, M5 as plain
    cards. M6a's rules would refuse to publish version 3 again, so after a
    rollback, restore version 2 (M6a's own) if content must be published.
  - `d261013` was pruned (the five newest are kept); it can be rebuilt with
    `studio-release staging d261013`.
  - Once the owner publishes any Learn feature or rule, never roll back
    below `224bb65` (ADR-0014).

## Lessons that teach (Learn M6a) on staging, `54e2a16` (2026-11-19, 14:42–15:07Z)

Approved by the owner after the M6 design review
(docs/learn/08-m6-design-review.md, `eac9074`), with ten refinements: M6a
only, then stop and show the owner. No Free/Pro plan setting was published
or changed; the Learn test content went from version 1 to version 2
(admins only). Production and GitHub Pages are untouched.

- **Before:**
  - CI runs 44 (`eac9074`, the design documents) and 45 (`54e2a16`) green:
    type check, lint, 569 unit and integration tests, and 265 e2e tests
    (9 skipped on purpose: the hidden PDF button's interface tests).
  - Read-only checks on staging (`ab42467`):
    - `learn-status`: content version 1 `2ee2b7fb9fa13516`, no draft;
    - the capture: catalog version 6, `plans` `48f75a1f7925d6c5`, no draft.
- **The release** (14:50:19–14:52:53):
  - the dump `mongodb-20261119T145247Z`;
  - 48 indexes ensured, "0 plans updated", "Catalog version 6: applied";
  - healthy at 14:52:53 (`/api/health`: `54e2a16`).
- **After the release, with content version 1 still live:** smoke 27/27,
  `login-test` 13/13, `entitlement-test` 24/24.
- **The test content** (the folder is kept outside the repository; copied to
  the server only for the import, then deleted there):
  - the dump `mongodb-20261119T145703Z`;
  - `learn-import`: the 4 CC0 references already stored ("exists"), 10 new
    pictures with their thumbnails and the warm-up PDF stored; draft version 2;
  - `learn-publish`: content version 2 live at 14:57Z (actor `cli`, content
    `9075f928b2177a66`): D-START-01 (the optional baseline), D-LINE-04
    (Lesson 1), D-SHAPE-01 (Lesson 2); CH-002, CH-012 and CH-017 linked to
    them; the group `core` replaced by the units `start` and `shapes`;
  - `learn-status` exit 0: 29 assets (14 pictures, 14 thumbnails, 1
    worksheet), 29 of 29 files with exactly their recorded bytes. The 8
    diagrams and the PDF are own work (no source page); the 2 annotated
    pictures are CC0 derivatives naming their museum source. Free and Pro
    open nothing.
- **After the content:**
  - the capture identical: the catalog (content, publication time, history)
    and `plans` with their update times; no draft;
  - `entitlement-test` 24/24. As Free and as Pro, each of the 6 items and
    each of the 29 images (a lesson's demonstration, step and mistake
    pictures and the PDF included) is refused, and so are exports from items;
    0 items open, 0 images served;
  - smoke 27/27.
- **In real browsers** (temporary Free, Pro and Hebrew accounts; removed;
  passwords only in a 0600 file, deleted, as were the sign-in states): the
  Learn checks 3/3. Free, Pro and Free in Hebrew get no Learn anywhere; each
  of the 29 assets is refused; no text of the new lessons reaches them;
  signed out, every Learn request answers 401; on an iPhone (WebKit,
  emulated) the bottom bar keeps its six items.
  - **Not verified on staging:** an admin's view (the lessons themselves).
    No temporary admin exists, by design (ADR-0012): the owner checks it.
- **Regressions on the same build:**
  - the M1 checks 8/8, the M3 checks 6/6;
  - the plan-enforcement checks 6/6 (the publishing test skipped).
- **Locally:**
  - 569 unit and integration tests, including the M5 compatibility test (a
    frozen copy of M5's schema reads published M6 content);
  - 265 e2e tests (9 skipped), in Chromium and WebKit iPhone emulation:
    - the lesson page part by part, in English and Hebrew, with axe;
    - the baseline never counted as starting the course;
    - a step's tool link setting Study (3 values) and Create a Grid (3 × 3),
      with the way back;
    - the Skill filter and "Builds on";
    - Free and Pro refused a lesson and each of its pictures;
    - a challenge open to Free showing nothing of a course no plan offers it.
  - The same content (the private seed) looked at on the same build: desktop,
    iPad and iPhone, English and Hebrew, with no console errors.
- **Rollback:**
  - `ab42467` (M5) is in releases/. It reads content version 2 (additions
    only) and shows the lessons as M5's plainer cards.
  - Content version 1 can be restored as a draft and published again.
  - `6f2159a` was pruned (the five newest are kept); it can be rebuilt with
    `studio-release staging 6f2159a`.
  - Once the owner publishes any Learn feature or rule, never roll back
    below `224bb65` (ADR-0014).

## Learn screens (Learn M5) on staging, `ab42467` (2026-11-19, 09:21–11:00Z)

Approved by the owner "according to the revised Learn plan", subject to Admin
→ Learn showing the six test items on staging. Before release, the owner
chose to release now and check both together (Admin → Learn and the new
screens are theirs to check, with their admin account). No Free/Pro plan
setting was published or changed, and no content was published: Learn
content stays version 1. Production and GitHub Pages are untouched.

- **Before:**
  - CI run 41 (`ab42467`) green: type check, lint, 552 unit and integration
    tests, and 260 e2e tests (9 skipped on purpose: the hidden PDF button's
    interface tests).
  - Read-only checks on staging (`324e136`):
    - `learn-status`: content version 1 `2ee2b7fb9fa13516`, no draft,
      files 8 of 8;
    - the capture: catalog version 6 `f8a1a43e4cedbed7`, `plans`
      `48f75a1f7925d6c5`, no draft.
  - Admin → Learn locally, with the private seed (the same content) on the
    same release: 36/36 checks, desktop and iPhone WebKit. All six items,
    the four CC0 images with their thumbnails, and "nothing" for Free and
    Pro.
- **The release** (10:44:13–10:46:48):
  - the dump `mongodb-20261119T104643Z`;
  - 48 indexes ensured (2 new, `learn_completions`), "0 plans updated",
    "Catalog version 6: applied";
  - healthy at 10:46:48 (`/api/health`: `ab42467`).
- **After the release:**
  - smoke 27/27 (25 as before, plus `/app/learn` leading signed-out
    visitors to sign-in and the history API answering 401, private);
  - `login-test` 13/13;
  - `entitlement-test` 24/24. As Free and as Pro:
    - the 6 items, the 8 images and exports from items are refused as
      published;
    - "Mark as completed" is accepted for no item (0), and the history holds
      0;
    - `/app/learn` answers 307 → `/app`;
    - signed out, the history answers 401;
    - its temporary accounts are removed.
  - `learn-status` identical to before;
  - the capture identical: the catalog (content, publication time, history)
    and `plans` with their update times; no draft.
- **M5 in real browsers** (temporary Free, Pro and Hebrew accounts; removed;
  passwords only in a 0600 file, deleted, as were the sign-in states):
  3/3 passed.
  - **Free, Pro, Free in Hebrew (Desktop Chrome):**
    - no Learn on Home and no Learn in the top bar;
    - every Learn address (`/app/learn`, the course, the challenges, a card,
      the history) leads to `/app`, with no Learn content in any page;
    - "Mark as completed" is refused (403 `module_off`) for each of the 6
      items, and the history is empty and private;
    - the M4 refusals still hold: lists, items, images, exports, admin
      pages.
  - **Signed out:** the history API answers 401, and a card's address leads
    to sign-in.
  - **WebKit with iPhone 13 emulation:** the same, and the bottom bar keeps
    its six items.
  - **Not verified on staging:** an admin's view, that is Admin → Learn and
    the Learn screens with the six test items. No temporary admin exists, by
    design (ADR-0012); the owner checks both.
- **Regressions on the same build:**
  - the M1 checks 8/8, the M3 checks 6/6;
  - the plan-enforcement checks 6/6 (the publishing test skipped).
- **Locally:**
  - 552 unit and integration tests;
  - 260 e2e tests (9 skipped), in Chromium and WebKit iPhone emulation.
    They cover every Learn screen in English and Hebrew with axe, tool
    shortcuts, worksheets from a card, the history, five students in a row
    in class mode with no history requests, and a plan publication: what
    Free and Pro see, and an open card locking within a minute.
  - An independent security review of the changes found nothing critical,
    high or medium. Its low findings were fixed before the commit:
    - history titles follow the lists' rule;
    - at most 10,000 completions per account;
    - an open item sends its known fields only.
- **Rollback:**
  - `324e136` (M4) is in releases/. `224bb65` was pruned (the five newest
    are kept); it can be rebuilt with `studio-release staging 224bb65`.
  - Rolling back to `324e136` removes the screens and leaves
    `learn_completions` in place, unused (empty on staging).
  - Once the owner publishes any Learn feature or rule (or `export.pdf` /
    `export.worksheets`), never roll back below `224bb65` (ADR-0014).

## Learn foundations (Learn M4) on staging, `324e136` (2026-11-19, 02:34–03:10Z)

Approved by the owner as M4 only (no Learn screens, no content editor, no
production). No Free/Pro plan setting was published or changed. The only
publication is Learn content version 1, the test content, which the owner
allowed on staging; with no Learn module in any plan, it is visible to
admins only. Production and GitHub Pages are untouched.

- **Before:**
  - CI run 39 (`324e136`) green: type check, lint, 522 unit and integration
    tests, and 247 e2e tests (9 skipped on purpose: the hidden PDF button's
    interface tests).
  - Capture: catalog version 6 `f8a1a43e4cedbed7`, `plans`
    `48f75a1f7925d6c5` (both plans updated 2026-11-18 12:53:43Z, no Learn
    field), no draft. Staging ran `8576f66`.
- **Server setup** (02:34:30, `deploy/install-learn-assets.sh staging`):
  - `/var/lib/studio-companion/staging/learn-assets` (studio-staging, 0750);
  - `/var/backups/learn-assets/staging` (root, 0700);
  - `LEARN_ASSETS_DIR` added to the env file (the previous file is kept as
    `/root/backups/staging.env.20261119T023430Z`);
  - `/usr/local/sbin/studio-learn-assets-backup` with
    `/etc/cron.d/studio-learn-assets-backup-staging` (02:50, 0644), and
    `/usr/local/sbin/studio-restore-drill`.
- **The release** (02:35:09–02:37:27):
  - the dump `mongodb-20261119T023721Z`;
  - 46 indexes ensured, "0 plans updated", then "Catalog version 6: applied";
  - healthy at 02:37:27.
- **After the release, before any content:**
  - the capture identical;
  - `catalog-status` ok and both plans in step;
  - `learn-status` empty, with the asset directory found;
  - smoke 25/25 (22 as before, plus three Learn checks: signed out 401,
    private caching);
  - `login-test` 13/13, `entitlement-test` 20/20.
- **The test content** (the folder is kept outside the repository; copied
  to the server only for the import, then deleted there):
  - the dump `mongodb-20261119T024027Z`;
  - `learn-import`: 4 references and 4 thumbnails stored, draft version 1;
  - `learn-publish`: content version 1 live at 02:41Z (actor `cli`, content
    `2ee2b7fb9fa13516`), the same content as the import checked locally;
  - `learn-status` exit 0: D-START-01, D-SHAPE-01, D-LINE-04; CH-002,
    CH-012, CH-017. Files: 8 of 8 with exactly their recorded bytes (0640,
    the site user's). Each licence is CC0 from The Cleveland Museum of Art.
    Free and Pro open nothing.
- **After the content:**
  - the capture identical: the catalog (content, publication time, history)
    and `plans` with their update times;
  - `entitlement-test` 20/20. As Free and as Pro, each of the 6 items is
    refused (403 `module_off`), and so are each of the 8 images and an
    export from an item. Lists are empty, signed-out requests get 401, and
    the dark launch holds (nothing opened, nothing served).
- **Backup and restore of the content and the images:**
  - the dump `mongodb-20261119T024224Z`;
  - `studio-learn-assets-backup staging`: 8 copied, 0 problems. A second
    run copied none and checked all 8 (incremental);
  - the restore drill (`--assets`), in 7 s:
    - all 26 collections restored with the live counts, `learn_assets` 8
      included (RESULT: OK), and the unique indexes back;
    - content version 1 restored (6 items, 4 assets used), and all 8 files
      restored with exactly their bytes (LEARN: OK);
    - no throwaway database left.
- **M4 in real browsers** (temporary Free, Pro and Hebrew accounts; removed;
  passwords only in a 0600 file, deleted): 3/3 passed.
  - **Free, Pro, Free in Hebrew (Desktop Chrome):**
    - the lists are empty;
    - the 6 items answer 403 and 3 unknown ones 404;
    - the 8 images answer 403, and an export from CH-017 is refused;
    - Admin → Learn and Admin → Plans answer 404;
    - the studio's pages carry no Learn text.
  - **Signed out:** 401 everywhere, and Admin → Learn leads to sign-in.
  - **WebKit with iPhone 13 emulation:** the same refusals.
  - **Not verified on staging:** an admin's view (Admin → Learn, the Plans
    editor's Learn section, the items and images). No temporary admin
    exists, by design (ADR-0012); that is the owner's check.
- **Regressions on the same build:**
  - the plan-enforcement checks 6/6 (the publishing test skipped). One
    Hebrew sign-in first met the per-network sign-in limit after many
    sign-ins in a minute, and passed when run again a minute later;
  - the M1 checks 8/8, the M3 checks 6/6.
- **Locally:** 522 unit and integration tests, 247 e2e tests (9 skipped), in
  Chromium and WebKit iPhone emulation, including a publication through
  Admin → Plans that opens exactly one item for Free at once and takes it
  back.
- **Rollback:**
  - `8576f66` is still in releases/. `be6890c` was pruned (the five newest
    are kept).
  - A rollback leaves the Learn content, the images and the env line as they
    are; releases before M4 ignore them and have no Learn routes.
  - Once the owner publishes any Learn feature or rule (or `export.pdf` /
    `export.worksheets`), never roll back below `224bb65` (ADR-0014).

## Prepare Worksheets (Learn M3) on staging, `8576f66` (2026-11-18, 21:02–21:16Z)

Approved by the owner as M3 only (no Learn screens or content). Nothing was
published, so the published plan settings are as they were. Production and
GitHub Pages are untouched.

- **Before:**
  - CI run 37 (`8576f66`) green: type check, lint, 481 unit and integration
    tests, and 239 e2e tests (Chromium, WebKit iPhone emulation). Nine more
    are skipped on purpose: the hidden PDF button's interface tests.
  - Capture: catalog version 6 `f8a1a43e4cedbed7`, `plans`
    `48f75a1f7925d6c5`, no draft. Staging ran `d261013`.
- **The release:**
  - the dump `mongodb-20261118T210441Z`;
  - "0 plans updated", then "Catalog version 6: applied";
  - healthy at 21:04:47.
- **After, on real staging:**
  - The capture is identical, after the release and again after the browser
    checks: catalog (content and publication time), history, and `plans`
    with their update times.
  - `catalog-status` ok, both plans in step.
  - Smoke 22/22, `login-test` 13/13.
  - `entitlement-test` (read only) 11/11. It checks every export feature, so
    the server refused `export.worksheets` and `export.pdf` to Free and Pro.
- **M3 in real browsers** (temporary Free, Pro and Hebrew accounts; removed;
  passwords only in a 0600 file, deleted): 6/6 passed.
  - **As staging is (Free, Pro):**
    - no Worksheets or PDF button in Create a Grid or Study & Simplify;
    - no Worksheets row on the plans page;
    - the server refuses a set (403, `export.worksheets`).
  - **A studio that believes it may:** the account answer was altered in the
    test browser only. The real server checked Study & Simplify (200), then
    refused the set (403). The studio said why, and nothing was made.
  - **Staging's own build making a set:** the server's yes was **simulated
    in the test browser**; the real server would refuse. Desktop Chrome in
    English and Hebrew, and WebKit with iPhone 13 emulation.
    - The four sheets are 2400 × 3360.
    - The grid sheet is identical, byte for byte, to the grid image staging
      saved for real.
    - The original, the outline and the values are where the photo is.
  - **Study & Simplify's saves, for real** (Free has them): the study, the
    palette and the study sheet were saved (the server said 200 each). Before
    `ab2f5aa` they did nothing.
  - **Not verified on staging:** a set made with the server's real yes. That
    needs an admin account (the owner's) or a publication.
- **Regressions on the same build:**
  - The M1 checks: 8/8 passed.
  - The plan-enforcement checks: 6/6 passed. The test that publishes was
    skipped.
- **Locally:**
  - The full suites: 481 unit and 239 e2e tests.
  - **The Values move, in a real browser:** Study's files compared between
    `7b11235` and M3 were all byte-identical: 21 files (5 on-screen
    studies, 5 saved studies, 5 palettes, 5 study sheets, 1 Clean Outline
    PNG).
  - The old build could only be compared with its study saves made to work
    in the test page.
- **Rollback:**
  - `d261013` is still in releases/. It is safe while neither `export.pdf`
    nor `export.worksheets` is published. It would bring back the PDF button
    for admins and the Study save bug.
  - Once the owner publishes either feature, never roll back below `224bb65`
    (ADR-0014).

## Create a Grid's A4 PDF (Learn M2) on staging, `d261013` (2026-11-18, 18:45–18:56Z)

Approved by the owner as M2 only (no Learn screens or content). Nothing was
published, so the published plan settings are as they were. Production and
GitHub Pages are untouched.

- **Before:**
  - CI run 35 (`d261013`) green: type check, lint, unit/integration, and
    230 e2e tests (Chromium, WebKit iPhone emulation).
  - Capture: catalog version 6 `f8a1a43e4cedbed7`, `plans`
    `48f75a1f7925d6c5`, no draft. Staging ran `6f2159a`.
- **The release:**
  - the dump `mongodb-20261118T184732Z`;
  - "0 plans updated", then "Catalog version 6: applied";
  - healthy at 18:47:37.
- **After, on real staging:**
  - The capture is identical, at the start and again after the browser
    checks: catalog (content and publication time), history, and `plans`
    with their update times.
  - `catalog-status` under `d261013`: "ok (everything known and applied)",
    both plans in step, `export.pdf` in neither.
  - Smoke 22/22 (expecting `d261013`), `login-test` 13/13.
  - `entitlement-test` (read only) 11/11. It checks every export feature,
    so the server refused `export.pdf` to Free and to Pro.
- **M2 in real browsers** (temporary Free, Pro and Hebrew accounts; removed;
  passwords only in a 0600 file, deleted): 5/5 passed.
  - **As staging is (Free, Pro):** no PDF button; the plans page does not
    list grid PDFs; the server refuses a grid PDF (403, `export.pdf`).
  - **A studio that believes it may:** the account answer was altered in
    the test browser only. The real server still refused the PDF (403), the
    studio said why, and nothing was made.
  - **Staging's own build making the PDF:** the server's yes was
    **simulated in the test browser**; the real server would refuse.
    Desktop Chrome in English and in Hebrew, and WebKit with iPhone 13
    emulation. Each PDF was read back from the file:
    - exact A4, two pages, printing without scaling asked;
    - one frame (179 × 250.6 mm for 50 × 70 cm) and the same lines on both
      pages, the photo on page 1 only;
    - the bar exactly 50 mm, on the right in Hebrew.
  - **Not verified on staging:** a PDF made with the server's real yes. That
    needs an admin account (temporary testers cannot be admins) or a
    publication, which needs the owner.
- **Regressions on the same build:**
  - The M1 checks: 8/8 passed.
  - The plan-enforcement checks: 6/6 passed. The test that publishes was
    skipped.
- **Locally:**
  - 436 unit/integration and 230 e2e tests at `d261013` (an earlier full
    run, before the last Hebrew and dependency changes, passed 228/228).
  - Every PDF the e2e tests make is read back from the file.
  - The app's PDFs, rendered by PDFKit (the engine of Preview and Safari),
    were looked at page by page.
  - A test PDF opened from a blob URL under the site's CSP renders in
    Chrome's viewer ("Open to print").
  - A check in a real browser: jsPDF (133 KB gzipped) loads only once a PDF
    is authorized; html2canvas, DOMPurify and canvg never load.
- **Rollback:**
  - `6f2159a` is still in releases/. It is safe while `export.pdf` stays
    unpublished: the tolerant reader keeps an unknown ID without applying
    it.
  - Once the owner publishes a catalog with `export.pdf`, never roll back
    below `224bb65` (ADR-0014).

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

Nothing: `c1ee8bc` is live (Challenges V2 and the beginner drawing course, dark-launched; Learn content version 10: lessons 1–29 with optional practice, 67 challenges). Google, plus username sign-in for accounts admins create; the plan catalog's live version is 6, with exactly the owner's version 2 content (versions 3–6 are the two audited publication checks), and no plan includes a Learn module.

## Private Learn content integration (2026-11-22, Israel time)

- **Application release:** `98087705983eba28ac612a2697308fbdbc0c915a`, unchanged.
  This is a content-only deployment; no build, migration or production action.
- **Content v8:** founder-approved graphite eye construction (27), matching eye
  shading (28), realistic apple (29), HE/EN instructions and A4 worksheets.
- **Content v9:** published at `2026-11-21T23:07:32.952Z`. Existing simple apple
  added as optional practice after lesson 19. Existing D-START-01 published as
  an optional, unnumbered Before & After mug activity before lesson 1; lesson 24
  offers the optional redraw with the same reference. No new lesson IDs.
- **Checks passed:** all 29 numbered lessons load through the real admin pipeline;
  approved 27–29 text and asset hashes match, all three PDFs are single-page A4;
  optional baseline does not affect numbering, next lesson or unit counts.
  Free/Pro authorization using actual published plans denies lesson content and
  assets, including thumbnails. Anonymous item/image/PDF requests return 401.
- **Browser check:** existing admin session shows lessons 1–29, the unnumbered
  baseline at the course start, the apple image in lesson 19 and the comparison
  prompt in lesson 24. No completion actions were taken.
- **HTTPS smoke:** 26 checks passed initially; the health expectation used a full
  SHA whereas the endpoint emits `9808770`. The health-only recheck passed.
  The initial targeted access check expected only `hidden`; it was corrected to
  accept existing `locked` or `hidden` states, both denying content and thumbnails.
  The corrected targeted check passed. No application defect or code fix.
- **Preserved:** application release, catalog v6, plans, grants, other configuration
  and completion records verified unchanged. All numbered IDs/order unchanged;
  v9 preserves approved lessons 27–29 exactly. No production writes.
- **Private evidence/rollback:** staging-only DB backup, v8 content snapshot,
  operator source and verification report under private staging content storage
  `content-reviews/learn-integration-20261122`. Existing graphite originals,
  worksheet source and commercial-use/provenance evidence remain under
  `content-reviews/graphite-27-29-20261121`; existing apple/mug rights are retained.
- **Review:** ready for founder hands-on staging review. Real-printer validation
  remains manual; Learn is not open to Free/Pro accounts.
