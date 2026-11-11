# Studio Companion - Project Documentation

## Project Purpose

Studio Companion is a browser-based toolkit for painters and other traditional
artists. The user uploads a reference photo once and then works through five
focused tools that share that image and a single saved project (Compare Art is
the exception — it manages its own two images and an isolated saved session):

- **Measure** — calibrate the photo against a known real-world length and
  measure proportions across it, organised into user-managed layers (a new
  project starts with one generic "General Lines" layer; the artist can add and
  delete layers for any subject — figures, landscapes, objects, etc.).
- **Value** — reduce the photo to a fixed number of value groups, extract a
  dominant-color palette, and export value studies with paint-mixing hints.
- **Color** — an interactive color wheel with harmonies, paint-mixing recipes,
  skin-tone mixes, and an eyedropper for sampling the image.
- **Grid** — overlay a proportional grid for grid-method drawing and export a
  print-ready PNG.
- **Compare** (Hebrew: השוואת ציור) — align a photo of the current painting
  against its reference and inspect proportion / value / color differences, then
  export a still, a difference image, or an animated GIF. This workspace is
  fully isolated (own provider + `localStorage` key) and is documented in its
  own section, "Compare Art workspace", below.

Everything runs client-side. The active project (image, measurements, layers,
sampled colors, value/grid settings) is auto-saved to `localStorage`, so a
refresh restores the last session. The app is a Next.js (App Router)
application: a public landing page at `/` and the studio under `/app`. Until the
Next.js version goes live, production is still the pre-migration Vite build on
GitHub Pages (`/artist_tools/`, hash routes), deployed from
`develop/post-v0.5.0-ux-improvements`.

## General Architecture

```
.
├── next.config.ts              Next.js config (standalone output, StrictMode off as before)
├── scripts/prepare-standalone.mjs  Copies public/ + static assets into .next/standalone after build
├── scripts/db.ts               Operator CLI: migrate, find-user, grant-admin, revoke-admin
├── scripts/e2e-server.ts       Test server: throwaway MongoDB + signed-in test accounts
├── .env.example                Every environment variable, documented (no secrets)
├── tailwind.config.ts          Tailwind theme (HSL CSS-variable design tokens)
├── playwright.config.ts        @playwright/test config (runs on the production build)
├── e2e/                        End-to-end specs + opt-in visual-parity harness
├── PROJECT.md                  ← this file
└── src/
    ├── app/                    Next.js App Router
    │   ├── layout.tsx          Root layout: <html>, metadata, viewport, index.css
    │   ├── page.tsx            Public landing page (/) + legacy /#/tool forwarding
    │   ├── not-found.tsx       404 page
    │   ├── error.tsx           Server-failure page (access is never granted on error)
    │   ├── sign-in/page.tsx    Google sign-in (public)
    │   ├── admin/page.tsx      Users list for admins (404 for everyone else)
    │   ├── api/auth/[...all]/  Better Auth endpoints (sign-in, callback, sign-out, session)
    │   ├── api/me/             The signed-in user + entitlements (read-only copy)
    │   ├── api/health/         Liveness, and database readiness with ?ready=1
    │   └── app/                The studio (/app, signed-in only)
    │       ├── layout.tsx      Renders the studio once for every /app route
    │       ├── page.tsx        Home marker (renders nothing)
    │       └── [tool]/page.tsx Tool markers; unknown tools redirect to /app
    ├── index.css               Design tokens + utility classes (.btn-tool, .tab-button, surfaces)
    ├── App.css                 Legacy Vite scaffold styles (not imported anywhere)
    ├── components/
    │   ├── shell/              App shell: studio, Home hub, navigation, shared tool chrome
    │   │   ├── Studio.tsx      The whole studio: providers + ProjectProvider + tab Workspace
    │   │   ├── StudioClient.tsx  Renders the studio in the browser only (after mount)
    │   │   ├── LegacyHashRedirect.tsx  Forwards old /#/tool links to /app/tool
    │   │   ├── tools.ts        Tool registry (titles, descriptions, icons, URL slugs)
    │   │   ├── HomeScreen.tsx  Home / Tool Hub (five illustrated tool cards)
    │   │   ├── AppNav.tsx      BottomNav (phones) + TopNav (tablet/desktop)
    │   │   ├── BrandMark.tsx   Logo + wordmark (also used by the landing page)
    │   │   ├── ToolHeader.tsx  ToolHeader, ToolHelpButton, HeaderIconButton, StepIndicator
    │   │   ├── ToolEmptyState.tsx  First screen of an image tool (art + steps + upload)
    │   │   └── ToolArt.tsx     SVG illustrations (portrait in photo/flat/values/sketch, hero eye)
    │   ├── common/ImageUploader.tsx   File picker / drag-drop → data URL
    │   ├── measure/            Measure tool (canvas, toolbar, panel, mobile, tab)
    │   ├── value/ValueTab.tsx  Value study + palette extraction + Sketch mode
    │   ├── color/ColorTab.tsx  Color wheel, recipes, skin tones
    │   ├── grid/GridTab.tsx    Drawing grid overlay + export
    │   └── ui/                 shadcn/ui (Radix) primitives — vendored, mostly unused
    ├── hooks/
    │   ├── useProjectStore.tsx Global project state (Context) + localStorage autosave
    │   ├── use-mobile.tsx      Viewport-width mobile detection (<768px)
    │   ├── use-touch-or-mobile.tsx  Touch-capable OR narrow-viewport detection
    │   └── use-toast.ts        shadcn toast store
    ├── types/project.ts        Shared types, defaults, geometry + real-world-length helpers
    └── test/                   Vitest setup + a placeholder test
```

The studio is intentionally **one persistent workspace**: every `/app` route
shares one layout (`src/app/app/layout.tsx`) that renders the studio, and the
studio swaps tool panels based on the `activeTab` value in the project store.
The route pages render nothing, so changing the URL never remounts a tool. The
studio renders only in the browser (it starts from `localStorage` and its layout
depends on the screen size), while its code is part of the page's first
download.

## Pages

### Landing — route `/` (`src/app/page.tsx`)
- **Purpose:** Public entry point: the studio hero, the five tools with their
  artwork, "Free to start. Pro is coming soon", and links to Plans and Sign in.
  The main button follows the registration setting: "Start free with Google"
  when registration is open, "Open the studio" while invite-only (with a note
  saying so).
- Old hash links (`/#/compare`) are forwarded to `/app/compare` by
  `LegacyHashRedirect` (unknown tools → `/app`), because a hash never reaches
  the server.

### Studio — routes `/app`, `/app/[tool]` and `/app/profile` (`src/components/shell/Studio.tsx`)
- **Purpose:** The Home / Tool Hub and the five tools. Every view has its own
  URL (`/app`, `/app/measure`, `/app/study`, `/app/color`, `/app/grid`,
  `/app/compare`); they share one layout, so switching tools never remounts
  the workspace and the browser / iOS back gesture moves between tools.
  Unknown tools redirect to Home.
- **Features & functionality:**
  - `useViewRouting` keeps the URL and the store's `activeTab` (`ViewId` =
    `'home' | TabId`, default `'home'`) in sync both ways — nav links change
    the URL; tools can still hand off with `setActiveTab` (Measure → Color).
  - Phones (<768px) get a labelled six-item `BottomNav` (hidden while a text
    field is focused, so it never sits on the keyboard); wider screens get
    `TopNav`. Safe-area insets are applied top and bottom.
  - `KeepAlive` mounts Study, Color and Compare on first visit and keeps them
    alive while hidden, so in-memory work survives tool switches (a Study-only
    image, Compare's full-res images + undo, the colour being explored).
    Measure and Grid mount only while visible (fully persisted; Measure listens
    for keys on `window`).
  - The `<main>` children get `min-width: 0` — without it a tool's flex root
    grows to its image's width and pushes controls off-screen on phones.
  - Maintains a CSS custom property `--app-height` tracking
    `visualViewport.height`, so iOS Safari/Chrome toolbars and the on-screen
    keyboard don't cause `100vh` layout jumps. The root element uses
    `height: var(--app-height, 100vh)`.
  - **Account page** (`/app/profile`, `ProfileScreen.tsx` +
    `src/components/account/`): name (editable) and photo (removable),
    verified email, how the person signs in, plan, role (admins),
    subscription status, member-since date, what the plan includes (the
    Free/Pro matrix below), a disabled "Upgrade: coming soon" for Free
    accounts; **Preferences** (language English/עברית and currency USD/ILS,
    saved for Phases 3–4; "News by email" switch, off by default, every change
    kept in `consent_events`); **How you sign in** (Google connected or
    "Connect Google"; "Add a password" / "Change password"; "Disconnect
    Google" only while a password exists); **Signed-in devices** (browser/OS,
    last active, masked network, sign out one or all others; tokens never
    reach the browser); tool introductions; admin link; **Your data**
    ("Download my data" JSON, "Delete account…" with typed DELETE and an
    option to remove this browser's work); Sign out, and "Shared device? Sign
    out and remove the work stored here". Adding a password and deleting the
    account need a session younger than 10 minutes, otherwise "Confirm it is
    you" (password, or Google again). All changes are server actions
    (`src/app/app/profile/actions.ts`) on the signed-in account only. Reached
    from the avatar at the top right of Home (phones) and of the top bar
    (wider screens). It is a studio view like the tools, so the tools stay
    alive behind it.
  - `AccountProvider` (`account.tsx`) holds the account the server rendered
    the studio with (`getAccountSummary`) and re-reads `/api/me` when the
    studio comes back into view or the account page opens; a 401 sends the
    person to sign in and back.
  - **First-visit tool introductions** (`ToolIntro.tsx`, content in the
    `TOOLS` registry): the first time an account opens a tool, a short card
    gives its name, what it helps with, how it works in three steps and one
    button to start. Dismissing it in any way counts; it is remembered on the
    account (`users.introsSeen`, `POST /api/me/intros`) and on the device, so
    returning artists are never interrupted again. "Show introductions again"
    on the account page resets them (`DELETE /api/me/intros`). The guided
    tours stay behind each tool's Help button and still never open on their
    own.
- **Key components used:** `HomeScreen`, `ProfileScreen`, `TopNav`/`BottomNav`, `MeasureTab`,
  `ValueTab`, `ColorTab`, `GridTab`, `CompareArt` (lazy), all wrapped in
  `ProjectProvider` + `OnboardingProvider`.
- **State & data:** Reads `activeTab` from the project store. All tool state
  lives in the store or in each tool's local component state.

### Sign in / sign up — routes `/sign-in`, `/sign-up`, `/forgot-password`, `/reset-password`, `/email-verified`
- **Purpose:** The way in. `/sign-in`: "Continue with Google" (creates the free
  account on first use) and, where `AUTH_EMAIL_PASSWORD=on`, an email +
  password form with "Forgot password?" and "Create an account". The copy
  follows the registration setting ("Sign in or create your free account" when
  open; an invite-only explanation otherwise) and lists what a free account
  includes. `/sign-up` (name, email, password; ends on "Check your email"
  whatever the address — new, registered or not invited), `/forgot-password`
  (same answer for any address), `/reset-password?token=` (new password; signs
  out every device) and `/email-verified` (where confirmation links and email
  sign-ins land; shows expired-link errors) exist only with email + password
  on (`src/components/auth/`). Fields use 16 px text so iOS does not zoom.
  Signed-in visitors are sent straight on; failed sign-ins come back with a
  plain-language message that never reveals whether an account exists.
  `?callbackURL=` is accepted only for internal `/app` and `/admin` paths
  (`src/lib/redirects.ts`).

### Plans — routes `/pricing` (public) and `/app/plans` (studio view)
- **Purpose:** Free (available now) and Pro (coming soon) side by side, from the
  same matrix the server enforces, plus a comparison table and short answers
  (no prices, nothing to buy). `PlanComparison` is shared; the studio view
  shows the person's current plan and keeps the tools alive behind it, so a
  locked Pro option can link to it without losing work. Linked from the
  landing page, the sign-in page, Home ("Plans" under the tools), the account
  page and every Pro notice.

### Admin — routes `/admin`, `/admin/users/[id]`, `/admin/analytics`, `/admin/plans`, `/admin/pricing`, `/admin/coupons`, `/admin/billing`, `/admin/activity`, `/admin/mail` (`src/app/admin/`)
- **Purpose:** Supporting accounts. `/admin`: search by email plus filters
  (role, assigned plan, status, email verified, sign-in method, test accounts,
  registration dates; shareable URLs), headline counts (accounts, admins, Pro,
  Pro given, suspended, test), every account with how it signs in (Google id's
  last four characters only, password yes/no), registration, last login,
  role, plan in force (and whether it was given), subscription, sign-ins and
  GIFs this month — cards on phones, a table on wider screens — plus recent
  activity. `/admin/users/[id]`: one account (sign-in methods, sessions,
  access in force, usage, its audit trail) and what an admin can change, each
  behind a confirmation: **plan** Free ↔ Pro (testing only, no billing),
  **role** (make / remove admin), **status** (suspend with a reason — signs the
  account out everywhere — or reactivate), **test account** (left out of
  analytics), and **promotional access** (Pro for 7–365 days with a reason;
  ends on its own, can be ended early; `src/server/grants.ts`). Role and
  status changes need the admin to have signed in within 10 minutes,
  otherwise "Confirm it is you" appears in place. `/admin/activity`: the
  latest 200 audit events, filtered by kind, actor, account email and dates,
  with **Export CSV** (up to 5,000 rows; the export itself is audited).
  `/admin/analytics`, `/admin/plans`, `/admin/pricing`, `/admin/coupons`: see
  "Configuration and coupons" and "Analytics" below. `/admin/billing`
  (read-only): MRR/ARR per currency, live, cancelling and ended
  subscriptions, refunds, failed payments and disputes, and the latest
  subscriptions, payments, provider notifications and checks against the
  provider — empty until a payment provider is connected. `/admin/mail` ("Test mail"): only while
  `MAIL_TRANSPORT=outbox` (development/test/staging) — the account emails the
  app kept instead of sending, for 24 hours, with their links; 404 otherwise.
- **Protection:** every page calls `requireAdmin()` (role re-read from the
  database; everyone else gets a 404). Changes are server actions
  (`actions.ts`): Next.js accepts them only from this site's pages, and each
  re-checks `currentAdmin()`, validates its input with zod, and writes an audit
  event. An admin cannot remove their own admin role, and the last active admin
  can never be demoted (`setUserRole`). No tokens, session secrets or full
  Google ids are ever sent to the page. There is no API that lists users.

### Not Found — route `*` (`src/app/not-found.tsx`)
- **Purpose:** Catch-all for unknown routes.
- **Features & functionality:** Logs the attempted path to the console and shows
  a 404 message with a link back to `/`.
- **State & data:** None.

## Environments and deployment

| Environment | Where | Runs |
|---|---|---|
| Production (current) | GitHub Pages `tomer0017.github.io/artist_tools` | Pre-migration Vite build, from `develop/post-v0.5.0-ux-improvements` |
| Preview | `http://185.176.255.3` (VPS, static files in `/var/www/studio-preview`) | Pre-migration build, root paths |
| Staging | `https://staging.185-176-255-3.sslip.io` (VPS) | Next.js app from `migration/nextjs-saas-foundation` |

Staging on the VPS (details and commands in `deploy/README.md`):
- CloudPanel Node.js site (nginx + Let's Encrypt, auto-renewed) → Next.js
  standalone server on `127.0.0.1:3000` under systemd unit
  `studio-companion-staging` (site user `studio-staging`, Node 24 via NVM).
- MongoDB 8.0 on the same VPS, `127.0.0.1:27017` only, access control on,
  single-node replica set `rs0`; app user `studio_staging` with readWrite on
  `studio_companion_staging` only. Nightly dump at 02:40 to
  `/var/backups/mongodb` (14 days, this server only — no off-site copy yet).
- Secrets live only on the server: `/etc/studio-companion/staging.env`
  (root:studio-staging 0640) and `/root/.studio-secrets/` (root 0700).
- Releases: `sudo /usr/local/sbin/studio-release staging <ref>` (a copy of
  `deploy/release.sh`, which dumps the database before migrating); rollback
  drill verified.
- Email + password is on with the mail outbox (`APP_ENV=staging`,
  `AUTH_EMAIL_PASSWORD=on`, `MAIL_TRANSPORT=outbox`): account emails are read
  at `/admin/mail`, nothing is sent. Nightly maintenance at 03:20
  (`/etc/cron.d/studio-maintenance` → `/usr/local/sbin/studio-maintenance`).
- The `sslip.io` hostname is a free wildcard DNS name for the server's IP,
  used until a real domain exists.

## Accounts, data and security (SaaS foundation)

- **Sign-in:** Better Auth (`src/server/auth.ts`). Google: OpenID Connect
  with state and PKCE, scopes `openid email profile`; the Google identity is
  its `sub` (`accounts` unique on providerId + accountId), Google tokens are
  not stored. Email + password (off unless `AUTH_EMAIL_PASSWORD=on`, needs a
  mail transport): address confirmed by email before any session (links last
  24 h), the same response for every sign-up (the owner of an existing
  account is emailed instead), scrypt hashing, policy 12–128 characters
  without common, predictable or personal passwords
  (`src/server/security/password-policy.ts`), reset tokens single-use, 30
  minutes, stored hashed (`verification.storeIdentifier: 'hashed'`), a reset
  signs out every device. **Accounts are never merged because addresses
  match** (`disableImplicitLinking`): a Google sign-in for a password
  account's address is refused with guidance; the signed-in owner can connect
  Google (same verified address) or add a password (fresh session); every
  added method is audited and emailed. Origin/callbackURL checks are forced on
  (Better Auth would skip them under tests).
- **Abuse limits:** per-IP limits in MongoDB (`rateLimits`, from nginx's
  `X-Real-IP`) per auth endpoint; per-address throttles keyed on a hash of the
  address (`auth_throttles`): 10 wrong passwords per 15 minutes pause password
  sign-in for that address, at most 3 emails of a kind per hour and 10 per day
  (`src/server/security/throttle.ts`). The app must stay behind nginx: without
  `X-Real-IP` every client shares one per-IP bucket.
- **Account email** (`src/server/mail/`): one provider-neutral mailer;
  `MAIL_TRANSPORT=disabled` (default) or `outbox` (kept 24 h for admins at
  `/admin/mail`; refused unless `APP_ENV` is development, test or staging). No
  real provider yet (needs a domain and approval). Sent in the background so a
  response never reveals whether an address has an account.
- **Self-service** (`src/server/account-management.ts`): device sessions,
  profile and preferences, marketing consent history, data export
  (`POST /api/me/export`, 5 per hour, no tokens/hashes/provider ids) and
  deletion (removes the user and personal app data; the audit trail keeps the
  bare id; refused for the last admin and while a paid subscription runs).
  Nightly `npm run db -- maintenance` removes password sign-ups never
  confirmed within 24 h and prunes idle rate-limit rows.
- **Sessions:** random tokens in MongoDB, HttpOnly + SameSite=Lax cookies
  (`sc.session_token`, `__Secure-` prefixed over HTTPS), 30 days rolling, a
  5-minute signed cookie cache, TTL cleanup. `getSession()` also confirms the
  session still exists in the database on every request, so a session that
  was ended (another device signed out, suspension, deletion) stops working
  at once. Suspended accounts cannot start sessions and are treated as signed
  out.
- **Three layers of protection:** `src/proxy.ts` redirects requests without a
  session cookie (speed only); `requireUser`/`requireAdmin`
  (`src/server/session.ts`) verify the session on the server in every studio
  layout and page; API routes verify it themselves (`/api/me` → 401).
- **Data model** (`src/server/db/collections.ts`, indexes in `migrate.ts`):
  users/accounts/sessions/verifications (Better Auth), plans, subscriptions,
  usage (per user/feature/month), audit_events, payment_events,
  analytics_events. User references are ObjectIds.
- **Account model:** three separate things. **Role** (`users.role`: `user` |
  `admin`) decides who may administer; **plan** (`users.plan`: `free` | `pro`)
  is what an admin assigned (every new invited account starts on Free);
  **subscription status** (`none` | `trialing` | `active` | `past_due` |
  `canceled` | `expired`, from server-written `subscriptions`) is billing,
  which is not live, so it is `none` for everyone. The plan in force is the
  better of the assigned plan and what an active subscription grants. Role,
  status and plan are Better Auth fields with `input: false`, so no auth
  endpoint can set them (tested: update-user refuses them).
- **Entitlements** (`src/server/entitlements.ts`): one pure function decides
  access, plan, features and limits from the database only (user status, role,
  assigned plan, server-written subscription, plans, usage). **Admins get every
  feature whatever their plan or subscription; no plan ever grants the admin
  role.** Client-supplied plan or payment claims are never inputs (tested).
- **Free / Pro feature matrix** (the published **plan catalog**, versioned and
  edited by admins at `/admin/plans` — `src/server/config/catalog.ts`; version 1
  is the code default from `src/lib/plans.ts`; the migration
  writes it to `plans`):

  | Capability | Free | Pro | Admin |
  |---|---|---|---|
  | All five tools (Measure, Study, Color, Grid, Compare) | ✓ | ✓ | ✓ |
  | Save images (grids, studies, comparisons) | ✓ | ✓ | ✓ |
  | Comparison GIFs: opacity pulse and blink, S and M sizes | ✓ | ✓ | ✓ |
  | Large GIFs (L, up to 800 px) | locked | ✓ | ✓ |
  | Compare + Difference GIF animation | locked | ✓ | ✓ |

  No quotas are set in version 1. Admins can add per-plan quotas (per UTC day or
  calendar month), enforced atomically by `authorizeFeatureUse` (a used-up
  quota answers 429 `limit_reached`; the studio says so), and can switch a
  feature off for everyone but admins. Locked options stay visible with a lock; choosing
  one explains it is part of Pro and that paid plans are coming soon.
- **Registration** (`AUTH_SIGNUP_MODE`, `src/server/env.ts`): `invite` (the
  default; only Google-verified addresses on `AUTH_SIGNUP_ALLOWLIST`) or `open`
  (any Google-verified address). Either way a new account is role `user` on
  Free with marketing consent off; existing accounts always sign in to their
  original account (Google `sub`); registration and every login are audited.
  Staging is invite-only until opening it is approved.
- **Pro notices** (`src/components/common/ProFeature.tsx`, texts in
  `PRO_FEATURE_INFO`): choosing a locked option explains what it does, why it
  is part of Pro, that Pro cannot be bought yet, and links to the plans. The
  server still decides (`/api/usage`).
- **Using a plan-gated feature:** before any GIF is encoded the studio calls
  `POST /api/usage` with the features it needs; the server checks them from
  the database (`authorizeFeatureUse`) and counts the use (these counts are
  the admin's "GIFs this month"). Cross-site requests are refused.
- **Testing Free and Pro:** an admin switches an account's plan on
  `/admin/users/[id]` (or `npm run db -- set-plan <userId> free|pro`); the
  account sees it on its next request.
- **Payments (not active):** `src/server/billing/` is the provider-neutral
  core (docs/billing/02-architecture.md): the provider contract, a webhook
  signature check, an event processor (once per provider event id; never
  older state over newer; payments recorded once; coupon redemptions;
  checkouts completed only for their own account), server-side checkout
  sessions, revenue figures and reconciliation. No provider is connected,
  there is no webhook or checkout route, and nobody can pay; the provider
  choice is the owner's (docs/billing/01-provider-research.md).
- **Admin access** is granted by user id only: by an existing admin on
  `/admin/users/[id]`, or with `npm run db -- grant-admin <userId>` on a
  machine with database access (which refuses accounts that are not active,
  not Google-verified, or not linked to exactly one Google identity) — never
  from configuration or an email address. Every change is audited.
- **Analytics:** first-party, allow-listed events without personal data;
  one-off events are de-duplicated. Recorded: registration, login, one
  `active_day` per account and UTC day (studio load and `/api/me`), one
  `tool_open` per account, tool and day (`POST /api/events`, tool id only).
  `/admin/analytics` (`src/server/analytics-report.ts`) shows new and active
  accounts, tools used, counted features, weekly returning-account cohorts,
  Pro counts and (zero until billing) revenue; test accounts are left out.
  Landing and first-export events are defined but not wired yet. Marketing
  consent is a separate, default-off field.
- **Configuration and coupons** (docs/adr/0006, 0007): `config_versions`
  holds the plan catalog and Pro prices as drafts → published versions (one
  live per kind; earlier versions restorable as a new draft); publishing needs
  a sign-in from the last 10 minutes and is audited. Prices are integer minor
  units per interval and currency and are not shown anywhere until paid plans
  launch. Coupons (`/admin/coupons`, `src/server/coupons.ts`): percent or fixed
  amount, target prices, dates, total and per-person limits; switched off,
  never deleted; validated for checkout by `checkCoupon` (Phase 4).
- **Limits to know:** tools run in the browser. The server decides who may
  use a Pro option and counts it, but the work itself happens on the device,
  so a modified browser could make a Large GIF without asking; only features
  with server-side work could be enforced completely. That is acceptable for
  options without server cost, and is why nothing secret or costly depends on
  the browser's copy of the plan.
  The last project lives in the browser's `localStorage`, so on a shared device
  the next person to sign in on that browser sees it (no per-account local data
  yet).

## Core Components

### Layout & shared
- **Tool registry** (`shell/tools.ts`) — single source of every tool's
  goal-first title ("Measure & Plan", "Study & Simplify", "Color & Mixing",
  "Create a Grid", "Compare & Correct"), nav label, description, chips, icon
  and URL slug. Home, both navs and every tool header read from it.
- **HomeScreen** (`shell/HomeScreen.tsx`) — hero + "What do you want to work
  on?" + five fully-clickable cards, each with an outcome illustration
  (`ToolArt`). One column of wide cards on phone/tablet; 2 + 3 grid on desktop.
- **ToolHeader** (`shell/ToolHeader.tsx`) — every tool's first row: icon,
  title, one-line current task, tool actions, and `ToolHelpButton` (replays
  the Measure/Compare intros or the generic tour). `StepIndicator` is the
  numbered step row (Measure: Set scale → Measure; Compare: Images → Align →
  Compare → Save) with an optional trailing action (e.g. "Change" scale); on
  phones, rows with >2 steps show only the current step's label (others stay
  in the accessibility tree via `sr-only`).
- **ToolEmptyState** (`shell/ToolEmptyState.tsx`) — the no-image screen for
  Measure / Study / Grid: illustration, 3 numbered steps, primary upload.
- **ImageUploader** (`common/ImageUploader.tsx`) — Reusable uploader with a full
  drop-zone variant, a `compact` icon-button variant and a `primary`
  full-width call-to-action button variant (also accepts drops). Validates the MIME
  type, reads the file as a data URL via `FileReader`, and fires
  `onUploadStart` / `onImageLoad` / `onUploadError`. Contains iOS-specific
  workarounds (input must be appended to the DOM for `.click()` to open the
  picker; safety cleanup if the user cancels).

### Measure tool
- **MeasureTab** (`measure/MeasureTab.tsx`) — Orchestrator. When there's no
  image it shows the uploader / loading / error states. On touch-or-mobile it
  delegates entirely to `MeasureMobile`; otherwise it composes
  `MeasureToolbar` + `MeasureCanvas` + `MeasurePanel` and a sampled-colors
  "Palette" strip (each swatch can be "used in the Color tab" via
  `sessionStorage`).
- **MeasureCanvas** (`measure/MeasureCanvas.tsx`) — The desktop interactive
  canvas. Renders the image in a pan/zoom transform with an SVG overlay for
  measurement lines, calibration line, and in-progress drafts. Handles mouse +
  touch input for: calibrating (2 points → real-world size), drawing
  measurements, selecting/dragging endpoints, panning (space / middle / alt /
  zoomed-in), wheel zoom, shift-to-constrain H/V, and the eyedropper (samples
  pixel color from an offscreen canvas with a live hover preview).
- **MeasureToolbar** (`measure/MeasureToolbar.tsx`) — Tool buttons (select,
  calibrate, measure, pan, eyedropper), undo/redo, show/hide measurements,
  reset view, line-color palette, and an uploader. Has a `mobile` layout mode.
- **MeasurePanel** (`measure/MeasurePanel.tsx`) — Side panel listing layers
  (toggle visibility, set active, add via an inline name input, delete via a
  per-row trash button that is hidden when only one layer remains) and
  measurement lines (rename label, delete), plus actions: Export PNG (image +
  drawn lines), Export JSON (full project), Clear all lines, New project (both
  with inline confirm).
- **MeasureMobile** (`measure/MeasureMobile.tsx`) — A purpose-built
  touch-first Measure experience (kept separate so desktop is untouched).
  Adds: a magnifier loupe while dragging endpoints, large hit-targets,
  bottom-sheet panels (layers / selected line / reference / precision / more),
  precision nudge controls, an export-preview modal with Web Share / Save Image
  / Download, and extensive iOS visual-viewport / keyboard handling. The
  **Layers** sheet supports adding (inline input) and deleting layers; the
  **Selected/Lines** sheet hosts a "New line color" swatch picker that reads/
  writes the same `lineColor`/`setLineColor` store state as the desktop toolbar
  (so the active line color is shared across both surfaces).

### Value tool
- **ValueTab** (`value/ValueTab.tsx`) — Self-contained value-study workspace
  (see "Color Logic & Processing"). Processes the image on an offscreen canvas,
  shows the processed result, a value-distribution strip, and three palette
  views (Dominant / Value / Paint Mix). Offers desktop and mobile layouts,
  before/after compare (slider or side-by-side), fullscreen, value isolation,
  and three export formats (processed image, palette strip, full study sheet).
  Can use the Measure image or its own locally-uploaded one.

### Color tool
- **ColorTab** (`color/ColorTab.tsx`) — Three sub-tabs:
  - **Color Wheel** — interactive hue ring + saturation/value square, hex
    input/copy, harmonies (complementary, split-complementary, analogous,
    triadic, warm/cool variants), and "pick from image" eyedropper. Picks up a
    hex handed off from the Measure tab via `sessionStorage`.
  - **Mixing Recipes** — curated paint recipes grouped by family (greens,
    purples, oranges, pinks, browns, neutrals) with ingredient swatches,
    percentages, and notes.
  - **Skin Tones** — light/medium/dark cards with base/shadow/highlight mixes.
  - Plus a "Painter Cheat Sheet" shown under each sub-tab.

### Grid tool
- **GridTab** (`grid/GridTab.tsx`) — Renders a canvas of configurable
  proportions with an overlaid grid. The image can be dragged, pinch/wheel
  scaled, and fit/fill/centered. `GridControls` (a sub-component) sets canvas
  size + unit, quick aspect-ratio presets, grid columns/rows, line
  color/opacity/thickness, and image scale. Exports a high-resolution PNG.

### UI primitives
- **`components/ui/*`** — Standard shadcn/ui wrappers over Radix primitives
  (button, dialog, tabs, tooltip, sonner, etc.). The app actively uses `tabs`,
  `tooltip`, `sonner`/`toaster`; most other primitives are vendored but unused.

## Existing Features

- Upload a reference image via drag-and-drop or file picker (PNG/JPG/WEBP),
  with loading and error states.
- One image and one project shared across all four tools; auto-saved to
  `localStorage` (debounced ~300ms) and restorable on reload.
- Export the whole project to JSON and (implicitly) reload it by keeping it in
  storage. New-project and clear-lines actions with confirmation.
- **Measure:** calibrate to a real-world reference line; draw measurement lines
  that display real-world lengths; organise lines into user-managed layers (a
  new project starts with one "General Lines" layer; add/delete layers, with
  deleted layers' lines reassigned to the general/first layer so no data is
  lost) with per-layer visibility; rename/label lines; pick the active line
  color from a shared palette (desktop toolbar + mobile sheet); select and drag
  endpoints; undo/redo; pan/zoom;
  shift-constrain to horizontal/vertical; show/hide all measurements; reset
  view; eyedropper color sampling into a session palette; export annotated PNG.
  A dedicated mobile UI adds a magnifier, precision nudging, bottom sheets, and
  share/save/download of the export.
- **Value:** grayscale / color / painter modes; 3/5/7/9 value groups; focus
  modes (all / shadows / lights / squint); contrast & brightness (hue-preserving)
  sliders; dominant-color palette extraction with warm/cool classification and
  paint-mixing hints; value isolation; before/after compare; fullscreen; export
  processed image, palette, or a composed study sheet.
- **Color:** interactive HSV wheel; hex input/copy; 6 color harmonies;
  warm/cool nudging; pick a color from the image; ~24 paint-mixing recipes;
  skin-tone mix cards; painter cheat sheet; hand a chosen color to the wheel
  from a sampled swatch in Measure.
- **Grid:** configurable canvas ratio (cm/in) with presets; adjustable
  columns/rows; line color/opacity/thickness; drag/scale/fit/fill/center the
  image; export a 2400px-wide PNG.

## Color Logic & Processing

This is the heart of the project and lives in two files.

### ColorTab — generative color theory (`components/color/ColorTab.tsx`)
- **HSV ⇄ RGB ⇄ Hex** conversions (`hsvToRgb`, `rgbToHsv`, `hsvToHex`,
  `hexToHsv`) drive the interactive wheel. The hue ring maps pointer angle to
  hue; the inner square maps x/y to saturation/value.
- **Harmonies** are computed by rotating hue: `shiftHue(hex, deg)` produces
  complementary (180°), split-complementary (150°/210°), analogous (±30°), and
  triadic (120°/240°) sets.
- **Warm/cool nudging** (`warmer`, `cooler`) eases the hue ~35% toward 40°
  (warm) or 220° (cool) and nudges saturation, mimicking how a painter shifts a
  mixture's temperature.
- **Eyedropper:** the chosen image is drawn to a hidden canvas at natural size;
  a click maps display coordinates to image pixels and reads RGBA via
  `getImageData`, converting to hex.

### ValueTab — image analysis & quantization (`components/value/ValueTab.tsx`)
Processing runs on an offscreen `<canvas>` and is capped at `MAX_PROCESS_DIM`
(900px on the long edge) for mobile performance. The pipeline:

1. **Pre-blur** proportional to mode (squint > painter > color > grayscale) so
   palette quantization yields clean color masses instead of speckle. Sketch
   mode gets **no** pre-blur — the sketch engine runs its own edge-preserving
   denoise and a plain Gaussian would soften exactly the boundaries it needs.
2. **Contrast** via a per-channel LUT around 127.5. **Brightness** is
   *hue-preserving*: it converts each pixel to HSL, moves lightness toward 0 or
   1, preserves hue, and only eases saturation near white — so bright greens stay
   green and skin highlights stay skin-colored. (Applied manually rather than
   via `ctx.filter` because iOS Safari historically ignores filter contrast/
   brightness.)
3. **Luminance binning (pass 1):** every pixel is assigned to one of `levels`
   bins by Rec. 601 luminance (`0.299R + 0.587G + 0.114B`), accumulating average
   color per bin.
4. **Dominant palette extraction:** up to ~40k sampled pixels are bucketed by
   `hueFamily` (red/orange/yellow/green/cyan/blue/purple/magenta/skin/neutral)
   × value band (dark/mid/light). Buckets are averaged, scored by coverage with
   a saturation boost (so vivid hues aren't drowned by neutrals), filtered, and
   capped (5–9 swatches, tied loosely to the chosen `levels`). Each swatch gets
   a human label (`dominantLabel`), a warm/cool classification
   (`classifyWarmth`), and a paint-mixing hint (`paintHint`, e.g. "burnt
   sienna + yellow ochre + titanium white").
5. **Output rendering (pass 2):**
   - *Grayscale mode:* each pixel becomes its bin's midpoint gray.
   - *Color / Painter modes:* each pixel is quantized to the nearest dominant
     palette color using a weighted distance (green-weighted RGB + a strong
     luminance term + a hue-aware penalty that specifically prevents warm/skin
     tones from snapping to magenta neighbours). Painter mode additionally
     softens saturation for a gouache-like look (`hslToRgb`).
   - *Focus modes:* shadows/highlights fade the non-focus bins toward mid-gray;
     "squint" just increases blur. **Isolation** hides all but one selected bin.
   - *Sketch mode:* delegates entirely to the vector trace (`lib/sketch/`,
     below). The grayscale source is cached on `[image, contrast, brightness,
     size]` in a ref, so moving a control re-runs only the trace itself.
     Renders PNG rather than JPEG — JPEG ringing around black lines
     on white paper reads as noise the artist has to filter out. Focus and
     isolation don't apply; the value/dominant palettes are still built,
     because they remain useful reference while drawing.
6. **Value groups** (the distribution strip / palette rows) are rebuilt from the
   per-bin averages with percentage coverage, hex, warmth, and paint hint.

`brightnessLabel` (darkest→highlight) and the warmth/family classifiers are
reused across the strip, palette rows, and the exported study sheet so labels
stay consistent.

### Vector trace (`lib/sketch/`)

Sketch mode is a **deterministic black & white vector trace** — the same kind of
filter as Illustrator's Image Trace or a Photoshop Threshold workflow. Given the
same pixels and the same settings it produces exactly the same paths, every
time.

It makes **no editorial decisions**. It has no notion of faces, hair, subjects,
backgrounds or importance, and it never decides what is worth keeping. How much
black, how much simplification and how much detail survives are the operator's
calls, on the controls. (An earlier version scored contours by "would a painter
draw this?"; it was replaced because the tool should be predictable, not
opinionated.)

```
buildTraceSource(imageData)     -> TraceSource   (grayscale; once per image)
traceImage(source, settings)    -> TraceResult   (per control change)
renderTraceToCanvas(result, canvas)
traceToSvg(result)                               (the same paths, scalable)
```

| File | Role |
| --- | --- |
| `trace.ts` | the filter: settings, presets, and the pipeline below |
| `imageOps.ts` | luminance, box/Gaussian blur, domain-transform smoothing |
| `regions.ts` | sliding-window max, binary morphology, connected components, hole filling, marching-squares boundaries |
| `vector.ts` | RDP simplification, polygon → path (canvas or SVG), SVG document |
| `render.ts` | canvas output |

#### Controls

Two primary controls live permanently under the image; the rest are behind
**More controls**, with a **Reset** back to the recommended default. All values
are 0–100 and resolution-independent, so a saved project reproduces the same
drawing at any processing size — raw pixel counts mean nothing to a painter and
mean something different on every image size.

| Control | What it does |
| --- | --- |
| **Ink** | How much of the image becomes black. |
| **Detail** | Removes tiny shapes and keeps the main forms clean. |
| **Separation** | Makes light and dark areas easier to tell apart (black/white point stretch + S-curve, applied before thresholding). |
| **Invert** | Trace the lights instead of the darks. |
| *Advanced:* Smoothing | How much fine texture reaches the threshold. |
| *Advanced:* Local threshold | 0 = one level for the whole frame; above 0, a local reference radius. Raise it when the lighting is uneven. |
| *Advanced:* Simplify / Corners | Path fitting, and sharp corners → rounded curves. |

Read-outs are words (`Medium`, `Clean`) rather than numbers, because the
painter is judging the picture, not reproducing a level. The raw threshold and
the resolved minimum shape size are shown at the bottom of Advanced for anyone
who does want to reproduce one.

**The mappings are measured, not guessed**, and both were wrong on the first
attempt in instructive ways:

- **Ink → threshold ratio, 0.30–0.62.** Sweeping a portrait: ~0.32 keeps only
  the darkest accents, 0.46 is a clean readable portrait, 0.56 is a bold
  stencil, past 0.65 the face floods. The first mapping spanned 0.44–0.96 and
  put that entire band inside the first tenth of the slider — the other nine
  tenths produced a black mask. Getting the *band* right matters more than the
  curve on top of it.
- **Detail → smallest surviving shape, up to 0.05% of the frame.** The ceiling
  is set by anatomy: an iris covers roughly 0.12% of a frame-filling portrait,
  a nostril 0.02%, and texture speckle sits below 0.01%. The first ceiling of
  0.6% cleared backgrounds beautifully and took both eyes with it.

A consequence worth knowing: **an area threshold cannot separate a clump of
foliage from an iris** — they are the same number of pixels. Texture is
therefore removed by *Smoothing*, before the threshold, where it is still
distinguishable. That is why the default leans on Smoothing (55) more than it
looks like it should.

#### The pipeline

0. **Separation** — an optional black/white point stretch (from the image's own
   2nd/98th percentiles) plus a gentle S-curve, applied after smoothing and
   before thresholding. Deliberately *not* a local-contrast method: CLAHE and
   friends pull skin texture and JPEG blocking back out of the noise floor that
   the smoothing pass just removed.
1. **Smoothing** — a domain-transform recursive filter rather than a Gaussian.
   It flattens texture while leaving real boundaries where they were; a Gaussian
   strong enough to remove the texture also drags every edge with it, and the
   threshold would land somewhere other than on the shapes the operator sees.
2. **Threshold** — global, or against a local reference. The local reference is
   a sliding-window **maximum**, not a mean: a mean is dragged down by the very
   area it measures, so a large dark mass reads as no darker than its own
   interior and comes out hollow.
3. **Noise** — an opening removes black specks, a closing removes white
   pinholes, and a connected-components pass drops anything below the area the
   operator set, in both directions.
4. **Paths** — marching squares over the cleaned mask, RDP-simplified, drawn
   with the corner treatment. Every loop goes into one **even-odd** path: under
   that rule a loop inside a loop *is* a hole, so eyes, gaps and enclosed
   highlights come out right with no outer/inner bookkeeping.

**White holes are cleaned independently of black shapes**, and far more
conservatively. An eye white, the slot between a brow and a lid, the gap
between a moustache and a lip are all small — judging them by size alone closes
the eyes. A pocket is filled only if it is well below the black threshold *and*
the wrong shape: a thin sliver is an artifact, something roughly round and
solidly filled is a feature. The morphological closing is likewise held to half
the opening radius, because closing is the operation that swallows the gap
between a brow and an eye.

Grayscale conversion is cached per image, and the smoothing and local-reference
passes are memoised on their own setting, so dragging Threshold, Noise, Simplify
or Corners re-runs only the cheap half.

Output is PNG on canvas (JPEG ringing along a hard black/white boundary is very
visible) and SVG on export — the SVG is the same polygons as the screen, not a
re-trace of the bitmap.

`trace.test.ts` covers what "deterministic" has to mean: identical output for
identical input, independence from the order controls were changed in, monotone
coverage in Threshold, all-black and all-white at the extremes, Noise removing
only small features, Simplify reducing points, Invert complementing coverage,
the local threshold surviving a lighting ramp a global one cannot, and
out-of-range settings being clamped rather than misbehaving.

### Grid & Measure geometry
- **Grid** math (`GridTab`) computes a fit scale so the image fills the chosen
  canvas ratio, then layers offset/scale transforms for drag/pinch/wheel, and
  draws evenly-spaced column/row lines plus a border, mirrored between the live
  preview and the 2400px export.
- **Measure** uses `distanceBetween`, `angleBetween`, and `midpoint` from
  `types/project.ts`. Real-world length is computed by the shared
  `realWorldLength(line, calibration)` helper: it scales pixel distance by
  `calibration.realWorldSize / pixelLengthOfReferenceLine` and appends the unit.

## State Management

- **Global project state** lives in a single React Context, `ProjectProvider`
  in `hooks/useProjectStore.tsx`, consumed via the `useProject()` hook. It holds
  the image, calibration, measurements, layers + active layer, selection,
  interaction mode, line color, value settings, sampled colors, zoom/pan, grid
  settings, the active tab, and image-loading/error flags — plus all the actions
  that mutate them.
- **Persistence:** a debounced (~300ms) effect serialises a `ProjectData`
  subset to `localStorage` under the key `painter-studio-project`; the provider
  hydrates from it once on mount (`loadFromStorage`). `newProject()` clears both
  state and storage. Zoom/pan, selection, mode, and loading flags are
  intentionally *not* persisted.
- **Undo/redo** is scoped to measurement edits via two `useRef` stacks
  (`pushUndo` snapshots the lines array before add/delete/clear). Layer
  mutations (`addLayer`, `deleteLayer`) are intentionally *not* pushed onto the
  undo stack — `deleteLayer` reassigns its lines to the general/first layer
  directly so undo never restores lines onto a layer that no longer exists.
- **Local component state** handles transient UI: drafts and tool modes in the
  Measure components, processing results and view toggles in `ValueTab`, the
  selected color and sub-tab in `ColorTab`, and drag/pinch state in `GridTab`.
- **Cross-tool handoff** uses `sessionStorage` key `use-color-in-tab`: a sampled
  swatch in Measure stashes a hex and switches to the Color tab, which reads and
  clears it on mount.
- **React Query** (`QueryClient`) is provided in `Studio.tsx` for parity with the
  original scaffold but is not currently used for data fetching (the app has no
  backend).

## Key Dependencies

- **next (16, App Router)** — routing, server, build (`output: 'standalone'`);
  dev and production server on port 8080.
- **react / react-dom (19)** — UI runtime.
- **better-auth** — Google sign-in, sessions, rate limiting (MongoDB adapter).
- **mongodb** (driver 7) — database access; **server-only** marks modules that
  must never reach the browser.
- **mongodb-memory-server / tsx** (dev) — throwaway MongoDB for tests; running
  the TypeScript operator scripts.
- **tailwindcss + tailwindcss-animate + @tailwindcss/typography** — styling via
  HSL CSS-variable design tokens defined in `index.css`.
- **shadcn/ui + @radix-ui/\*** — accessible UI primitives in `components/ui`
  (the app mainly uses tabs, tooltip, and the Sonner/Toaster notifications).
- **lucide-react** — icon set used throughout the toolbars and controls.
- **@tanstack/react-query** — provider wired up; no active queries yet.
- **sonner / next-themes / class-variance-authority / clsx / tailwind-merge /
  zod / react-hook-form** — standard shadcn supporting libraries.
- **vitest + @testing-library/react + jsdom** — unit testing (`npm run test`;
  vite + @vitejs/plugin-react-swc remain only as vitest's transform).
- **@playwright/test** — end-to-end specs in `e2e/` (Chromium + iPhone WebKit),
  run against the production build; `PARITY=vite|next` runs the visual-parity
  harness instead.

All image processing relies on the browser's native **Canvas 2D API**
(`getImageData` / `putImageData` / `drawImage` / `toDataURL` / `toBlob`); there
are no image-processing third-party libraries.

## Error Handling Strategy

The app is 100% client-side and leans heavily on three classes of operation
that can fail at runtime without throwing anywhere a user would notice:
**Canvas 2D operations** (a null context, out-of-memory, or a CORS-tainted
`getImageData`), **image loading** (`new Image()` flows that have an `onload`
but silently never run on failure), and **Web Storage** (`localStorage` /
`sessionStorage` throw in Safari private browsing and when quota is exceeded).
A structured, critical-only error-handling layer was added around exactly these
seams — no business logic was changed, only error boundaries were added around
existing logic.

### Logging convention (use this for all future code)
- **`console.error(...)`** — only for real failures that break a feature
  (canvas init/processing, image-export, eyedropper sampling, storage read/write).
- **`console.warn(...)`** — recoverable/unexpected states only (clipboard
  unavailable, a handed-off color that couldn't be read, an unknown route).
- **No `console.log(...)`** anywhere.
- **Format:** `console.error("[ComponentName] Description of what failed:", error)`
  — every log names the source component/function, says what failed, and
  includes the error object.
- **Never swallow:** every `catch` block either logs or recovers visibly
  (e.g. `MeasureMobile.shareExport` sets a visible `shareState` *and* logs real,
  non-`AbortError` failures).

### What qualifies as a "critical log" here
- Canvas initialization / 2D-context failures.
- Image load failures (`<img onError>` and `new Image().onerror`).
- Color parsing / extraction / quantization failures (Value processing,
  eyedropper sampling in Color & Measure).
- `localStorage` / `sessionStorage` read/write failures.
- Any failure that causes a feature (export, autosave, processing, color
  handoff) to silently stop working.

### Files touched & what was added
- **`hooks/useProjectStore.tsx`** — `loadFromStorage` / `saveToStorage` now log
  instead of swallowing; `newProject()`'s `localStorage.removeItem` wrapped.
- **`components/common/ImageUploader.tsx`** — `FileReader` start + `onerror`
  now log and surface the existing upload-error UI.
- **`components/value/ValueTab.tsx`** — the whole `processImage` canvas pipeline
  wrapped + `img.onerror`; `exportPalette` / `exportStudySheet` wrapped (and the
  study-sheet image promises now reject on error instead of hanging forever).
- **`components/color/ColorTab.tsx`** — eyedropper (`handlePickClick`) wrapped;
  clipboard copy and the `sessionStorage` color handoff now log on failure.
- **`components/measure/MeasureCanvas.tsx`** — `prepareEyedropper` /
  `sampleColorAt` canvas reads wrapped.
- **`components/measure/MeasurePanel.tsx`** — `handleExportPNG` (+ `img.onerror`)
  and `handleExportJSON` wrapped.
- **`components/measure/MeasureMobile.tsx`** — `prepareOffscreen`,
  `drawMagnifier`, `exportPNG` (+ real `img.onerror`), `exportJSON`,
  `triggerDownload`, and `shareExport` hardened.
- **`components/measure/MeasureTab.tsx`** — `sessionStorage` color handoff wrapped.
- **`components/grid/GridTab.tsx`** — `draw`, the natural-size loader, and
  `handleExport` canvas/image paths wrapped + `onerror` handlers.
- **`pages/NotFound.tsx`** — reclassified the 404 log from `error` to `warn`
  and applied the `[NotFound]` convention.

Deliberately **not** wrapped: pure color math (`hsvToRgb`, `rgbToHsl`, …),
geometry helpers in `types/project.ts`, and the viewport hooks — none of these
can throw, so adding try/catch would be noise.

---
## Saving images & GIFs (shared "Save to Photos" flow)

Every image/GIF export in the app goes through ONE shared helper so the save
experience is consistent and iOS-optimised. A browser cannot force a save to the
Photos library or choose which share targets iOS shows, so the flow opens the
best native path and guides the user.

- `src/lib/sketch/` — the Sketch-mode engine (see "Sketch engine" above).
  Pure TypeScript; `analyzeSketch()` needs no DOM, `renderSketchToCanvas()` is
  the only part that touches a canvas. Tests: `src/lib/sketch/pipeline.test.ts`.
- `src/lib/saveMedia.ts` — pure helpers: `mimeForFilename`/`extForMime`,
  `makeShareFile`, `canShareFile` (wraps `navigator.canShare({files:[file]})`),
  `shareFile` (calls `navigator.share({files:[file]})` — **file only**, no
  title/text/url, so iOS surfaces "Save Image"; returns
  `shared`/`cancelled`/`unsupported`/`error`), `downloadBlob`, `canvasToBlob`,
  `dataUrlToBlob`, `isIOS`/`isTouchDevice`.
- `src/components/common/SaveMedia.tsx` — `SaveMediaProvider` (mounted in
  `Studio.tsx`) + `useSaveMedia().save({ blob, filename, mime? })`. Renders one
  preview sheet showing the ACTUAL image/GIF (object URL, revoked on close). On
  touch/iOS the primary action is **Save to Photos** (native share, file only)
  with the guidance "In the next screen, choose Save Image."
  (Hebrew: "במסך הבא יש לבחור שמירת התמונה.") plus a full-screen long-press
  fallback ("Press and hold the image, then choose Save to Photos." /
  "יש ללחוץ לחיצה ארוכה על התמונה ואז לבחור שמירה בתמונות."). On desktop the
  primary is a standard **Save Image / Save GIF** download; **Open Image/GIF**
  and (where supported) **Share** are secondary. Correct MIME + extension are
  preserved (image/png, image/jpeg, image/gif).

All export surfaces call `save(...)` instead of ad-hoc anchor downloads: Compare
Art (`CompareExportSheet`, `useCompareGif`), Grid (`GridTab`), Value (`ValueTab`
— processed image, palette, study sheet), Measure (`MeasurePanel` desktop PNG,
`MeasureMobile` PNG — its bespoke share/preview modal was removed in favour of
the shared sheet). Non-image project JSON export stays a plain download. Color
has no image export. Tests: `src/lib/saveMedia.test.ts` +
`src/components/common/SaveMedia.test.tsx`.

---
## Compare Art workspace

**Purpose.** Replace the painter's manual "combine painting + reference in a
photo editor" process. The painter adds a photo of their current painting
(**Artwork** / הציור שלי) and the original **Reference** (רפרנס), aligns the
reference over the artwork, and inspects where proportions, values and colors
diverge — then exports an animated GIF that reveals the mismatch.

**Touch surface on iPhone.** Smart Align points are placed by press-and-hold
(the magnifier follows the finger, the point lands on release). Safari would
also start its own long-press there — blue text selection, the callout, the
tap highlight — so the canvas region opts out of selection, the callout and
the tap highlight, and touches that start on the canvas are cancelled as
touches with non-passive listeners (`CompareCanvas.tsx`). Pointer Events, which
place points, drag, pinch and pan, still arrive; the rest of the page stays
selectable and scrolls normally. Not a global `user-select: none`.

**Isolation.** Everything lives in `src/features/compare-art/` behind its own
React context (`CompareProvider`/`useCompare`) and its own `localStorage` key
(`compare-art-session`). It shares nothing mutable with `useProjectStore`, so
Measure/Value/Color/Grid are untouched. It is added to navigation additively:
`TabId` gains `'compare'` (`src/types/project.ts`), a tab in `Header.tsx`, and a
lazy-loaded render branch in `Index.tsx` (code-split so gifenc never weighs down
the initial load of the other tools).

**Files.**
- `compareArtTypes.ts` — session shape, defaults, tuning constants (nudge steps,
  sensitivity params, GIF speed/size tables, difference colors).
- `compareArtGeometry.ts` — **pure** transform math. Scene space = a rect with
  the artwork's aspect ratio; the reference `Transform` is stored *normalised*
  (translation in scene-width units, scale as a multiplier on the contain-fit,
  rotation in radians, flipH). This resolution-independence is what makes the
  on-screen preview and the exported GIF pixel-identical. Includes pinch/rotate
  pivot math, 2-point alignment solve, fit/fill/match-bounds, crop.
- `compareArtColor.ts` — **pure** OKLab conversion + painter-friendly delta
  (lightness / chroma / warm-cool).
- `compareArtDifference.ts` — **pure** difference map: quiet where images match,
  colored where they diverge; treats transparent (out-of-bounds) pixels as
  no-data; sensitivity presets Subtle/Balanced/Strong.
- `compareArtCanvas.ts` — the **one canonical scene renderer**
  (`renderSceneToCanvas`) used by the screen, still export, difference export and
  every GIF frame. Also `prepareImage` (EXIF-correct, size-capped decode via
  `createImageBitmap`), `analyzeSceneDifference`, `applyCrop`.
- `compareArtGif.ts` — pure `buildGifFrameSpecs` (opacity-pulse 0→100→0, blink,
  compare-diff) + `generateComparisonGif` (renders each spec through the shared
  renderer, quantises with **gifenc**, yields to the event loop between frames,
  reports progress, supports cancel).
- `compareArtStorage.ts` — load/save; downscales a *persistence-only* copy of
  each image and, on quota overflow, saves settings-only and flags re-selection
  (never corrupts the session). Full-res originals stay in memory for export.
- `compareArtState.tsx` — the store: session state, isolated undo/redo (one
  history step committed per finished gesture / slider / nudge), debounced
  autosave.
- `CompareArt.tsx` (workspace chrome), `CompareCanvas.tsx` (imperative
  RAF-driven canvas + pointer gestures; live transform in a ref, committed once
  per gesture — no React re-render per pointer move), `CompareUploadStep.tsx`,
  `CompareBottomSheet.tsx`, `CompareSheets.tsx`, `CompareExportSheet.tsx`,
  `compareArtImage.ts`.

**Canvas strategy.** Editing chrome (handles, guides, split bar, crop rect) is
painted only onto the on-screen canvas, never through `renderSceneToCanvas`, so
exports are chrome-free. Difference maps are computed at a small analysis
resolution (`ANALYSIS_MAX_DIM`) and debounced; interactive drags render a fast
preview and re-analyse only after the gesture settles.

**Difference method.** Aligned artwork/reference are rendered to two buffers in
identical scene geometry, converted to OKLab, and compared: *value* mode maps
lighter/darker (amber/blue); *color* mode adds warm/cool (red/cyan). A threshold
suppresses camera noise. This reveals mismatches — it does not interpret
artistic intent. Proportion inspection depends on accurate manual alignment, and
color comparison depends on the lighting/white-balance of the artwork photo
(both stated in-app).

**GIF method.** Client-side only, via gifenc (MIT). The default "opacity pulse"
transitions the aligned reference 0%→100%→0% over the fixed artwork; because
frames are opacity-only over one shared transform, the reference geometry cannot
drift between frames. Encoding is chunked with `await`/`setTimeout(0)` yields and
a cancel token, so the UI never freezes.

**Dependencies added.** `gifenc@^1.0.3` (browser ESM, no backend).

**Tests.** `compareArt.test.ts` (geometry, OKLab, difference, GIF specs) and
`compareArtState.test.tsx` (store: load/independent images, default lock, commit
transform, undo/redo, persistence, mode switching) run under vitest.
`e2e/compare-art.spec.ts` drives the real workflow in Chromium — upload → mode
switch → precision nudge → still export → **GIF export** (asserts a valid `GIF`
download) — via `npx playwright test`.

**UI/UX polish (2026-07-20 sprint).**
- **Pre-comparison crop** (`CompareCropScreen.tsx` + `compareArtCrop.ts`): after
  picking an image — and re-editable later from the Align sheet — a full-screen,
  touch-first cropper lets each image be framed independently (pan/pinch the
  image behind a frame; Free mode adds resize handles) with presets Free /
  Square / Circle / 4:3 / 3:4 / 16:9 / Original. It is non-destructive: the
  confirmed crop stores the original + a normalised rect (`session.artworkCrop`
  / `referenceCrop`, `*Original`). The engine needs no changes because it renders
  whatever `session.artwork`/`reference` hold — those now contain the cropped
  bitmap, so overlay/blink/split/difference/grid/GIF all operate on the crop. A
  circular crop's transparent corners are treated as no-data by the difference
  engine automatically.
- **2-point alignment magnifier** (`compareArtMagnifier.ts`): placing an anchor
  point now shows a loupe that follows the finger and commits the point on
  release (not touch-down), so the finger never hides the target. The loupe is a
  faithful copy of the Measure tool's magnifier (identical 120px circle, 50px
  sample window, nearest-neighbour zoom, red crosshair, white ring); Measure's
  file is stable/untouched, so the exact drawing is replicated with the same
  constants.
- **Overlay quick workflow** (`CompareOverlayBar.tsx` + `useCompareGif.ts`): in
  Overlay mode an opacity slider is always visible (no sheet needed) and a
  prominent "Create Opacity GIF" button runs the default opacity-pulse GIF with
  the current alignment/crop/grid immediately, with inline progress
  (Preparing → Rendering → Encoding → Done) and cancel. The Export sheet is
  unchanged and still holds every advanced option.

**Known limitations.** Undo history is in-memory and resets when leaving the tab
(settings/images persist). Persisted images (cropped + originals) are downscaled
(~1400px) to fit the localStorage budget; exports use the full-res in-memory
copies. 2-point alignment is a deterministic manual helper (no computer-vision
auto-align).

---
## Languages (English, Hebrew)

- **How it works** (docs/adr/0009, `src/i18n/`): messages per language in
  `src/i18n/messages/{en,he}.ts` (English is the source; Hebrew must have the
  same keys, enforced by the type and `messages.test.ts`), translated with
  `use-intl` (`getT` in server components, `useTranslations` in client
  components). `<html lang dir>` follows the request: `/he/…` address → the
  signed-in person's language → `sc_locale` cookie → `Accept-Language` →
  English. Hebrew is right to left; email fields stay left to right.
- **Translated (Phase 3a):** landing, plans (`/pricing` and the comparison),
  sign-in, sign-up, forgot/reset password, email-confirmed pages, sign-in
  errors, account emails (by `users.locale`; Hebrew emails are RTL). Public
  pages also live under `/he` (`/he`, `/he/pricing`, `/he/sign-in`…; the
  routes in `src/app/he/` re-export the same pages and the proxy marks the
  request Hebrew) with `hreflang` alternates. A language switch (English | עברית) sits on those
  pages; the account page's Language choice applies too.
- **Translated (Phase 3b-1):** the studio's frame — Home (hero and cards
  mirrored for right to left), both navigation bars, the first-visit tool
  introductions, the in-studio plans page, the account page with all its
  sections, the server messages of its actions (in the account's language)
  and the device list ("Safari ב-iPhone"). Deleting the account accepts the
  confirmation word of either language (DELETE / מחיקה). Changing the
  language on the account page reloads the studio in that language. Tool
  text comes from `tools.<id>` messages (`TOOLS` in `src/components/shell/tools.ts`
  keeps the English for untranslated places).
- **Not yet translated (Phase 3b-2):** each tool's own workspace (controls,
  headers, empty states, Pro notices), its guided tours and the shared save
  sheet. They stay English and left to right inside (`ToolFrame`,
  `lang="en" dir="ltr"`, no box of its own) on Hebrew pages, so no tool
  layout or gesture changes. The admin dashboard stays English (it gives its
  own English messages to shared parts such as "Confirm it is you").

## Accessibility

- **Automated checks** (`e2e/accessibility.spec.ts`, axe-core 4.14.0 pinned):
  WCAG 2.0/2.1 A and AA rules on the public pages (English and Hebrew), the
  studio's frame and each tool's first screen, the Hebrew studio, the admin
  dashboard, and phone-sized screens (Chrome and WebKit, simulated). Any
  finding fails the test, except documented exceptions, which stay in the
  report (`test-results/a11y-*.json`).
- **Known exception:** the studio keeps `maximum-scale=1` (canvas gestures;
  iOS zooming into small fields). Public and admin pages allow zoom
  (`viewport` per layout).
- `--muted-foreground` is 60% lightness (4.6:1 or more on every dark surface).
- **Not done yet:** a manual keyboard and screen-reader audit, gesture
  alternatives, and the tools' states after a photo is loaded. No conformance
  is claimed. Details and the draft statement are in docs/accessibility/README.md.

## Roadmap and architecture decisions

The commercial SaaS roadmap (audit, gap analysis, data model, migration and
rollback rules, risk register, phased backlog with acceptance criteria) lives
in `docs/roadmap/`; architecture decision records in `docs/adr/`. Read both
before changing authentication, configuration, billing, i18n or analytics.

## ⚠️ AGENT INSTRUCTIONS - READ BEFORE EVERY TASK

- Before starting any task, read this file completely.
- After completing any task, update this file if:
  - A new component was added
  - A new page was added or modified
  - Existing logic was changed
  - A new feature was added
  - Architecture changed in any way

This file is the brain of the project. It must always stay up to date.

## Change History
| Date | Change | Files Affected |
|------|--------|----------------|
| 2026-06-15 | Initial documentation created | PROJECT.md |
| 2026-06-15 | Removed all "Lovable" branding/tooling; rebranded to "Studio Companion"; deduplicated real-world-length calc into a shared helper; minor `prefer-const` cleanups | index.html, README.md, package.json, package-lock.json, vite.config.ts, playwright.config.ts, playwright-fixture.ts, src/types/project.ts, src/components/measure/MeasureCanvas.tsx, src/components/measure/MeasurePanel.tsx, src/components/measure/MeasureMobile.tsx, src/components/color/ColorTab.tsx, removed bun.lock & bun.lockb |
| 2026-06-17 | Added structured, critical-only error handling across all logic seams (canvas ops, image loads, localStorage/sessionStorage, color extraction, exports); standardized `[Component] message + error` logging; removed silent catches; no business logic changed. See new "Error Handling Strategy" section. Reduced pre-existing lint errors 4→0. | src/hooks/useProjectStore.tsx, src/components/common/ImageUploader.tsx, src/components/value/ValueTab.tsx, src/components/color/ColorTab.tsx, src/components/measure/MeasureCanvas.tsx, src/components/measure/MeasurePanel.tsx, src/components/measure/MeasureMobile.tsx, src/components/measure/MeasureTab.tsx, src/components/grid/GridTab.tsx, src/pages/NotFound.tsx, PROJECT.md |
| 2026-07-20 | iOS Save-to-Photos flow across the app: one shared helper (`src/lib/saveMedia.ts`) + provider/sheet (`src/components/common/SaveMedia.tsx`, mounted in `App.tsx`). On iOS `navigator.share({files:[file]})` (file only, no title/text/url) after `canShare`; guidance to choose "Save Image" (EN+HE) + full-screen long-press fallback; the sheet previews the ACTUAL image/GIF and revokes object URLs. Desktop keeps standard Save Image/Save GIF download. Routed ALL exports through it (Compare Art `CompareExportSheet`/`useCompareGif`, `GridTab`, `ValueTab`, `MeasurePanel`, `MeasureMobile` — removed its bespoke share/preview modal) and updated labels (Save Image/Save GIF/Save to Photos). No external app hardcoded. Tests: saveMedia.test.ts, SaveMedia.test.tsx; e2e updated for the save sheet. | src/lib/saveMedia.ts (new), src/components/common/SaveMedia.tsx (new), src/App.tsx, src/features/compare-art/CompareExportSheet.tsx, src/features/compare-art/useCompareGif.ts, src/components/grid/GridTab.tsx, src/components/value/ValueTab.tsx, src/components/measure/MeasurePanel.tsx, src/components/measure/MeasureMobile.tsx, src/test/setup.ts, e2e/compare-art.spec.ts, PROJECT.md |
| 2026-07-20 | Compare Art UI/UX polish sprint: (1) **pre-comparison crop** — a touch-first crop screen (pan/pinch, Free-mode resize handles, presets Free/Square/Circle/4:3/3:4/16:9/Original) shown after picking each image and re-editable from the Align sheet; non-destructive (stores original + normalised rect); the whole engine consumes the cropped image with no renderer changes. (2) **2-point alignment magnifier** — a loupe (faithful copy of the Measure magnifier) follows the finger and commits the point on release, not touch-down. (3) **Overlay quick workflow** — an always-visible opacity slider + one-tap "Create Opacity GIF" with inline progress/cancel; Export screen unchanged. New files: CompareCropScreen.tsx, compareArtCrop.ts, compareArtMagnifier.ts, CompareOverlayBar.tsx, useCompareGif.ts. Extended session (artwork/reference Original + Crop) + applyImageCrop store action. Existing tools + Compare rendering/difference/GIF pipeline unchanged. | src/features/compare-art/compareArtTypes.ts, compareArtState.tsx, CompareArt.tsx, CompareUploadStep.tsx, CompareSheets.tsx, CompareCanvas.tsx, compareArtCrop.ts (new), CompareCropScreen.tsx (new), compareArtMagnifier.ts (new), CompareOverlayBar.tsx (new), useCompareGif.ts (new), compareArt.test.ts, compareArtState.test.tsx, e2e/compare-art.spec.ts, PROJECT.md |
| 2026-07-20 | Added the **Compare Art** workspace (5th tool, Hebrew השוואת ציור): isolated `src/features/compare-art/` feature (own `CompareProvider` + `compare-art-session` localStorage key, undo/redo, autosave). Artwork/reference upload, one canonical resolution-independent scene renderer shared by screen + still + GIF, reference move/scale/rotate/flip/opacity with gesture + precision nudges + fit/fill/match/reset + optional 2-point align, layer lock, non-destructive crop, grid overlay, Overlay/Blink/Split/Difference modes + grayscale, OKLab value/color difference with sensitivity + legend, still/difference/GIF export (opacity-pulse/blink/compare-diff) with progress + cancel. Added `gifenc` dependency; code-split the workspace via `React.lazy`. Additive nav wiring only; existing tools unchanged. Added unit tests (`compareArt.test.ts`, `compareArtState.test.tsx`) and an e2e workflow test (`e2e/compare-art.spec.ts`). | src/types/project.ts, src/components/layout/Header.tsx, src/pages/Index.tsx, src/features/compare-art/* (new), e2e/compare-art.spec.ts (new), package.json, package-lock.json, README.md, PROJECT.md |
| 2026-06-17 | Made Measure layers dynamic/user-extensible: a new project now starts with one "General Lines" layer instead of 6 fixed anatomical layers; added `addLayer`/`deleteLayer` store actions (palette-cycling colors, delete reassigns orphaned lines to the general/first layer, last layer protected); add/delete UI in the desktop panel (inline name input) and mobile layers sheet. Existing saved projects load untouched (no migration). Added a mobile "New line color" picker in the Selected/Lines sheet reusing the desktop `lineColor`/`setLineColor` state; extracted the shared `LINE_COLORS`/`LAYER_COLORS` palettes into `types/project.ts`. No changes to calibration, undo/redo, autosave, export, eyedropper, pan/zoom, or other tools. | src/types/project.ts, src/hooks/useProjectStore.tsx, src/components/measure/MeasurePanel.tsx, src/components/measure/MeasureToolbar.tsx, src/components/measure/MeasureMobile.tsx, PROJECT.md |
| 2026-07-25 | **Rebuilt Sketch mode as a painter-first drawing engine** (`src/lib/sketch/`), replacing the inline Sobel + adaptive-threshold edge filter in `ValueTab`. New semantic pipeline: edge-preserving noise reduction (domain transform) → large-shape detection → colour-aware contour extraction (structure tensor) with fragment linking → feature prioritisation against an *ink budget* (not a threshold) → three-level variable line weight → optional pencil shading. Background suppression via clutter / subject / compact-accent maps; "Detailed" adds a separate subject-gated fine pass rather than a lower threshold. The Detail slider now interpolates three tuned anchor param sets (Simple / Balanced / Detailed) instead of moving one threshold. Styles are data (`SKETCH_STYLES`) so new ones need no pipeline changes; UI still exposes only "Artist sketch". UI changes kept minimal: a per-level hint under the slider and an off-by-default "Pencil shading" toggle (`valueSettings.sketchShading`). Sketch output now renders/exports PNG (JPEG ringing was visible noise on line art) and processing is debounced ~60ms so slider drags coalesce. Tests: `src/lib/sketch/pipeline.test.ts`. | src/lib/sketch/* (new), src/components/value/ValueTab.tsx, src/types/project.ts, PROJECT.md |
| 2026-07-25 | **Sketch Detail slider made cumulative.** Split the engine into `buildSketchAnalysis()` (detail-INdependent: denoise, thresholds, contour geometry, stroke widths, weight classes, ranking — all fixed) and `composeSketch()` (pure per-layer budget selection). Simple ⊂ Balanced ⊂ Detailed is now guaranteed by construction, and a stroke is geometrically identical wherever it appears — the slider adds to the drawing instead of regenerating it. Introduced four drawing layers (`structure` / `face` / `secondary` / `fine`) with independent non-decreasing budget curves, so Simple is a usable construction sketch *including* eyes/brows/nose/nostrils/lips, and hair strands + wrinkles are held back for Detailed. Added a face/hands `priority` map (YCbCr skin mask OR'd with accent clustering) to implement the Face → subject → objects priority order; categorical texture rejection (weave/pores/JPEG mush leave the pool entirely); and background contours dropped unless strongly structural, so trees/grass/walls almost disappear at every level. Weight cuts now taken within a layer (across the pool they were degenerate — every silhouette line came out heavy). Style anchors collapsed from 3 param sets to 1 + budget curves. `ValueTab` caches the analysis on `[image, contrast, brightness, size]` so slider drags only re-select. Tests: 12 in `pipeline.test.ts`, including the subset property and budget-curve monotonicity. | src/lib/sketch/{types,styles,pipeline,analysis,index,pipeline.test}.ts, src/components/value/ValueTab.tsx, PROJECT.md |
| 2026-07-25 | **Replaced Sketch mode's line engine with a black-and-white vector trace.** New region pipeline (`regions.ts`, `vector.ts`): edge-preserving smoothing → a *darkness* field measured against a local **maximum** (a local mean hollows out big masses) → coverage-targeted thresholding with an absolute contrast floor (coverage alone blacks in a fifth of a noise frame) → morphological open/close, which kills pores/weave/JPEG mush **by size** so no detail level can readmit them → connected components filtered on area, accent priority and subject-ness → marching-squares boundaries → RDP + quadratic smoothing → one `evenodd` fill. Detail now controls **shape complexity**: mostly via minimum shape size, with only a small coverage rise and a fixed guard band around established masses, because lowering a threshold inflates existing masses until the hair swallows the brows and the face collapses. Cumulativity is now asserted at the pixel level (the test rasterises the loops); every component test uses a peak rather than a mean so a merged mass still passes. Added `sketchToSvg()` + a "Save as SVG (vector)" button — the export is the same polygons as the screen, not a re-trace. New default style `vector` (plus `poster`); the stroke styles (`artist`/`pencil`/`construction`/`ink`) remain and reuse the identical scene analysis. | src/lib/sketch/{regions,vector}.ts (new), src/lib/sketch/{types,styles,pipeline,render,index,pipeline.test}.ts, src/components/value/ValueTab.tsx, PROJECT.md |
| 2026-07-25 | **Replaced Sketch mode with a deterministic vector-trace filter** (`src/lib/sketch/trace.ts`) and deleted the contour/heuristic engine. The previous versions decided for the user what was worth drawing (subject/priority/feature maps, contour scoring, ink budgets); this one decides nothing. Professional control set instead: Threshold (Photoshop semantics), Local threshold radius (0 = global), Smoothing, Noise (min feature area, Illustrator semantics), Simplify (RDP), Corners (sharp ↔ rounded), Invert — plus presets that are just sets of those values. Pipeline: edge-preserving smoothing → global or local-max threshold → morphological open/close + connected-component noise floor → marching squares → RDP → one even-odd path. Grayscale cached per image; smoothing and local reference memoised per setting. SVG export emits the same polygons as the canvas. Removed `pipeline.ts`, `styles.ts`, `analysis.ts`, `types.ts`, `contours.ts` and the stroke renderer (~1600 lines); `sketchDetail`/`sketchShading` kept in `ValueSettings` only so old saved projects still load. Tests: `trace.test.ts` — determinism, order-independence, threshold monotonicity, extremes, noise, invert, uneven lighting, clamping. | src/lib/sketch/{trace,trace.test}.ts (new), src/lib/sketch/{imageOps,regions,vector,render,index}.ts, src/lib/sketch/{pipeline,styles,analysis,types,contours,pipeline.test}.ts (deleted), src/components/value/ValueTab.tsx, src/types/project.ts, PROJECT.md |
| 2026-07-25 | **Vector trace: painter-facing controls and a mobile-usable slider.** (1) Replaced every `input[type=range]` in Value/Sketch with `src/components/common/Slider.tsx` — pointer events + `setPointerCapture` (in a try/catch, so a capture failure can never abort a drag) + `touch-action: pan-y` + a 44px touch target + full ARIA and keyboard support. Verified on **WebKit/iPhone 13**: one continuous drag produced 14 distinct values, page scrollY stayed 0, and a second drag started immediately. (2) Renamed the controls for what the painter sees: Threshold→**Ink**, Noise→**Detail**, plus a new **Separation** (percentile levels stretch + S-curve before thresholding). Both primary mappings are non-linear and were tuned by visual sweep — Ink spans threshold ratio 0.30–0.62, Detail tops out at 0.05% of the frame (an iris is 0.12%). Advanced controls, Invert, Save-SVG and Reset live behind a **More controls** disclosure. (3) White holes are now cleaned independently of black shapes and protected by shape, so eye whites and brow/lid gaps survive maximum Detail. (4) Sketch mode drops the colour palette entirely (strip, tab and pane) and the preview takes the space; **Replace image** is a visible 44×44 button over the preview using the shared uploader, clearing all cached analysis. (5) Preview renders at 1× while a control is under the finger and 2× on release — same composition, no reframing. Regression captured across bearded/female/light-hair/low-contrast/high-contrast/animal/object scenes. | src/components/common/Slider.tsx (new), src/lib/sketch/{trace,trace.test,regions}.ts, src/components/value/ValueTab.tsx, src/types/project.ts, PROJECT.md |
| 2026-11-02 | **UX/IA redesign: Home hub, global navigation, shared tool chrome, step-based tools.** New `src/components/shell/` (tool registry, Home / Tool Hub with SVG outcome illustrations, labelled BottomNav/TopNav, ToolHeader + StepIndicator + ToolHelpButton, ToolEmptyState). Routing: one `/:view?` route with per-tool URLs synced to `activeTab` (now `ViewId`, default `'home'`); `Header.tsx` removed. KeepAlive for Study/Color/Compare. Tutorials no longer auto-open (`AUTO_START_TUTORIALS = false` in onboardingConfig; Help replays everything). **Measure:** step row with always-visible scale + "Change", instruction card and result card ("Draw this distance as X on your artwork") below the canvas instead of floating, explicit pan badge, Save image in header; **TapCoach is now a button that arms selection without placing a point** (mobile + desktop); cancelling a re-scale returns to measuring. **Study:** Color/Values/Sketch picture cards replace the floating switcher; Save is the primary action. **Color:** four sections (Color Wheel / Harmonies / Mixing / Skin Tones) each with a purpose line; selected colour carried across. **Grid:** 3×3 / 4×4 (recommended) / 8×8 presets, Fit/Fill/Center, primary "Save grid image", full settings under Customize. **Compare:** Images → Align → Compare → Save flow; Smart Align (recommended) / Manual; during Smart Align the canvas shows only the image being tapped and the instruction panel has a fixed height (a resizing panel shifted the image under the finger between taps); Artwork / 50-50 / Reference + opacity + grid + more views; Save step = one-tap comparison GIF + still/advanced export. No calculation, image-processing, export or storage-format changes. Tests: rewrote `e2e/onboarding.spec.ts` + `e2e/compare-art.spec.ts` for the new flows; new `e2e/navigation.spec.ts`; Playwright `iphone-webkit` project runs the mobile tests on WebKit. | src/components/shell/* (new), src/pages/Index.tsx, src/App.tsx, src/types/project.ts, src/hooks/useProjectStore.tsx, src/components/layout/Header.tsx (deleted), src/components/common/ImageUploader.tsx, src/components/measure/{MeasureTab,MeasureMobile,MeasureCanvas}.tsx, src/components/measure/onboarding/{TapCoach.tsx,useMeasureIntro.ts}, src/components/value/ValueTab.tsx, src/components/color/ColorTab.tsx, src/components/grid/GridTab.tsx, src/features/compare-art/{CompareArt,CompareCanvas,CompareOverlayBar,CompareUploadStep}.tsx, src/features/compare-art/onboarding/useCompareIntro.ts, src/onboarding/{OnboardingHost.tsx,onboardingConfig.ts,index.ts}, e2e/*, playwright.config.ts, PROJECT.md |
| 2026-11-09 | **Migrated from Vite to Next.js 16 (App Router) + React 19**, behaviour-preserving. Public landing at `/`; the studio under `/app` (`/app/<tool>`), rendered once by a shared layout so tools stay mounted across URLs (KeepAlive preserved); client-only studio rendering with its code in the first download; old `/#/tool` links forwarded; unknown tools → `/app`. Removed react-router-dom, gh-pages and the unused calendar/drawer components (React-18-only deps). Lint errors fixed (0 errors). Tests: 78 unit, 19 e2e (4 new routing specs), 36/36 visual-parity screenshots identical to the pre-migration build. Checkpoint tag `pre-nextjs-migration-2026-11-09`. | src/app/*, src/components/shell/{Studio,StudioClient,BrandMark,LegacyHashRedirect,AppNav,HomeScreen,tools}, next.config.ts, tsconfig.json, eslint.config.js, package.json, playwright.config.ts, e2e/*, scripts/prepare-standalone.mjs, README.md, PROJECT.md |
| 2026-11-10 | **Google sign-in, MongoDB and SaaS foundation (phases C–E), local only.** Better Auth (Google OIDC, PKCE, database sessions, origin checks forced on, no stored Google tokens, identity = Google `sub`); proxy + server-verified sessions on every studio page/API; sign-in page; account line + sign-out under Home; MongoDB data model, idempotent migrations and Free/Pro plans; server-only entitlements; inactive payment-event processor (idempotent, audited); admin users page + CLI role grants; first-party analytics; /api/me, /api/health; security headers. Tests: 120 unit/integration (real MongoDB 8 replica set, full Google OAuth flow with a simulated Google), 36 e2e incl. 17 auth/security, 36/36 visual parity. | src/server/**, src/proxy.ts, src/app/{sign-in,admin,api,error}, src/app/app/*, src/components/{auth,shell/account,shell/Studio*,shell/HomeScreen}, src/lib/{auth-client,redirects}, scripts/{db,e2e-server}.ts, .env.example, e2e/*, playwright.config.ts, next.config.ts, README.md, PROJECT.md |
| 2026-11-10 | **Staging on the VPS.** MongoDB 8.0 (localhost, auth, replica set, nightly local dumps); CloudPanel Node.js site `staging.185-176-255-3.sslip.io` with Let's Encrypt; systemd unit + `deploy/release.sh` (build exact commit, migrate, atomic switch, health-gated auto switch-back; drill verified). Google sign-in optional until its OAuth client exists. Security headers aligned with CloudPanel's nginx + HSTS; health check validates config. | deploy/*, next.config.ts, src/app/api/health, src/server/{env,auth}.ts, src/app/sign-in, src/components/auth, PROJECT.md |
| 2026-11-10 | **Roles, Free/Pro plans, admin dashboard and account page (staging).** Account model: role (`user`/`admin`) separate from an admin-assigned plan (`users.plan`, Free for every new account; Better Auth field with `input: false`) and from subscription status (billing not live). Entitlements: admins get every feature on any plan; effective plan = better of assigned plan and an active subscription; Pro never grants admin. Free/Pro matrix in `src/lib/plans.ts` (Free keeps all five tools and every save; Pro adds Large GIFs and Compare+Difference GIFs), synced to `plans` by the migration (which also moves existing accounts to Free). `POST /api/usage` authorizes and counts plan-gated feature use on the server before any GIF is encoded. Admin dashboard: search by email, phone cards / desktop table, account detail (Google link without the full id, sessions, access, usage, audit trail), plan Free↔Pro and make/remove admin behind confirmations, with server actions that re-check the admin from the database and audit every change; no self-demotion, never the last admin. Account page `/app/profile` (plan, role, subscription, member since, what is included, Upgrade: coming soon, sign out), reached from a new avatar on Home and the top bar. CLI: `list-users` (masked), guarded `grant-admin`, `revoke-admin`, `set-plan`. An expired session now returns to the page it was on after sign-in (the proxy passes the requested path to the studio layout). Tests: 146 unit/integration, 59 e2e (Desktop Chrome + iPhone WebKit; 23 new account/admin/plan specs), 36/36 visual parity with the new avatar hidden. | src/lib/{plans,account,features-client}.ts, src/server/{account,request,admin,entitlements,session,auth}.ts, src/server/db/{collections,migrate}.ts, src/app/admin/**, src/app/api/{me,usage}, src/app/app/{layout.tsx,profile/}, src/proxy.ts, src/lib/redirects.ts, src/components/shell/{account,ProfileScreen,AppNav,HomeScreen,Studio,tools}, src/components/common/ProFeature.tsx, src/features/compare-art/{CompareExportSheet.tsx,useCompareGif.ts}, src/onboarding/OnboardingHost.tsx, src/types/project.ts, scripts/{db,e2e-server}.ts, e2e/{accounts.spec.ts (new),visual-parity.spec.ts}, playwright.config.ts, deploy/README.md, PROJECT.md |
| 2026-11-10 | **Visitor journey: registration, plans, tool introductions, Pro notices; Compare iPhone long-press fix.** Registration is an explicit setting (`AUTH_SIGNUP_MODE` invite|open; invite stays the default and staging stays invite-only); both modes need a Google-verified address, new accounts are always user/Free with marketing off, and registration and logins are audited. Sign-in page explains that Google creates the free account automatically (or that it is invite-only for now). New landing page (five tools with artwork, Plans, Sign in). Plans comparison (`PlanComparison`) on public `/pricing` and studio `/app/plans`: Free available, Pro coming soon, no prices, no payment. First-visit introduction per tool (what it helps with, how it works in three steps, one Start button), remembered per account (`users.introsSeen`, `/api/me/intros`) and resettable from the account page; guided tours unchanged. Pro notices explain what the feature does, why it is Pro and that Pro cannot be bought yet, and link to the plans. Compare: the canvas surface opts out of iOS text selection, callout and tap highlight, and cancels touches that start on it (Pointer Events still place points, drag, pinch and pan); no global change. Same fix prepared, not deployed, for the GitHub Pages app on branch `fix/compare-ios-long-press`. Tests: 150 unit/integration, 71 e2e (Desktop Chrome + iPhone WebKit), 36/36 visual parity. | src/server/{env,auth,account}.ts, src/app/{page.tsx,pricing/,sign-in/page.tsx,api/me/intros/,app/plans/}, src/components/{auth/SignInCard.tsx,plans/PlanComparison.tsx,common/ProFeature.tsx}, src/components/shell/{ToolIntro,PlansScreen,ProfileScreen,account,Studio,tools,HomeScreen}, src/lib/{plans,account}.ts, src/features/compare-art/{CompareCanvas,CompareArt,CompareExportSheet}.tsx, src/onboarding/OnboardingHost.tsx, src/types/project.ts, scripts/{db,e2e-server}.ts, e2e/{journey.spec.ts (new),accounts.spec.ts}, playwright.config.ts, .env.example, deploy/README.md, PROJECT.md |
| 2026-11-10 | **Phase 0 — audit and architecture for the commercial SaaS roadmap.** Current-state audit of code and staging server, gap analysis, proposed data model, migration/rollback strategy, risk register, phased backlog with acceptance criteria (`docs/roadmap/`), 11 ADRs (`docs/adr/`). Found and fixed on the server: the nightly MongoDB backup had never run (cron ignored the group-writable `/etc/cron.d/studio-mongo-backup`); now `0644`, cron reloaded it, a manual run succeeded. | docs/roadmap/*, docs/adr/*, deploy/README.md, PROJECT.md |
| 2026-11-11 | **Phase 1 — authentication and account management.** Email + password through Better Auth behind `AUTH_EMAIL_PASSWORD` (mail transport required): verification before access, identical answers for new/registered/uninvited sign-ups (found and fixed in tests: the library's stand-in response had a different shape), scrypt, 12–128 character policy, single-use hashed reset tokens that sign out every device, explicit-only account linking. Provider-neutral mailer with a staging outbox (`/admin/mail`, refused in production). Per-IP limits in MongoDB plus per-address throttles. Sign-in with email, sign-up, forgot/reset password and email-confirmed pages. Account page: name/photo, language and currency preferences, marketing consent with history, sign-in methods (connect Google, add/change password, disconnect), signed-in devices, data download, account deletion with fresh-session confirmation, shared-device sign-out. Nightly maintenance command; releases back up the database before migrating. Tests: 186 unit/integration, 80 e2e (Desktop Chrome + iPhone WebKit, incl. the full password journey), 36/36 visual parity. Deployed to staging (9f16951) with `APP_ENV=staging`, `AUTH_EMAIL_PASSWORD=on`, `MAIL_TRANSPORT=outbox`, still invite-only; nightly maintenance cron installed. | src/server/{auth,env,account,account-management,background,maintenance}.ts, src/server/{mail,security}/*, src/server/db/{collections,migrate}.ts, src/app/{sign-up,forgot-password,reset-password,email-verified}/, src/app/admin/{mail/,AdminShell.tsx,format.ts}, src/app/app/profile/actions.ts, src/app/api/me/export/, src/app/page.tsx, src/components/auth/*, src/components/account/*, src/components/shell/{ProfileScreen,account}.tsx, src/lib/{locale,user-agent,device-data,account}.ts, scripts/{db,e2e-server}.ts, deploy/{release.sh,maintenance.sh,README.md}, e2e/{password.spec.ts (new),accounts.spec.ts}, playwright.config.ts, .env.example, docs/roadmap/*, PROJECT.md |
| 2026-11-11 | **Phase 2a — admin user management.** Filters on `/admin` (role, plan, status, verified, sign-in method, test, dates) and new counts; suspend (reason enum; ends every session) / reactivate; test-account flag; time-limited promotional Pro (`access_grants`, best of assigned plan / subscription / grant in entitlements; shown on the person's account page); role and status changes require a sign-in within 10 minutes (in-place "Confirm it is you"); activity log filters and audited CSV export. `getSession()` now confirms the session in the database on every request, so ended sessions stop at once (found by the suspension e2e test: the 5-minute cookie cache kept a suspended person signed in). Account deletion also removes grants. Tests: 194 unit/integration, 86 e2e, 36/36 visual parity. | src/server/{admin,grants,entitlements,session,account,account-management}.ts, src/server/db/{collections,migrate}.ts, src/app/admin/{page.tsx,actions.ts,AdminControls.tsx,format.ts,users/[id]/page.tsx,activity/{page.tsx,query.ts,export/route.ts}}, src/components/{account/{parts,ProfileSections}.tsx,shell/ProfileScreen.tsx}, src/lib/account.ts, scripts/e2e-server.ts, e2e/admin.spec.ts (new), playwright.config.ts, PROJECT.md |
| 2026-11-11 | **Phase 2b — commercial configuration and analytics.** Versioned admin configuration (`config_versions`: draft → review → publish, one live per kind, restore earlier versions; publishing needs a recent sign-in; audited). Plan catalog at `/admin/plans`: features per plan, quotas per UTC day or month, features switched off for everyone but admins; version 1 = today's matrix, synced to `plans`, never reverted by deploys. Atomic quota enforcement (no overshoot under concurrency; 429 `limit_reached`; remaining uses on the account page). Pro prices at `/admin/pricing` in integer minor units per interval/currency (not shown publicly). Coupons at `/admin/coupons` with checkout validation for Phase 4. `/admin/analytics`: new/active accounts, tools used, counted features, weekly retention, Pro counts, revenue (zero until billing); `active_day` and `tool_open` events (`POST /api/events`, ids only). Fixed: analytics events ignored the time passed in; fire-and-forget requests now read their replies (an unread response kept the request open, which stalled the parity harness). Tests: 203 unit/integration, 92 e2e (Desktop Chrome + iPhone WebKit), 36/36 visual parity. | src/server/config/*, src/server/{coupons,analytics,analytics-report,entitlements,usage,account}.ts, src/server/db/{collections,migrate}.ts, src/app/admin/{analytics,plans,pricing,coupons}/, src/app/admin/{ConfigControls.tsx,config-actions.ts,AdminShell.tsx,format.ts}, src/app/api/{events/,usage/,me/}, src/app/app/layout.tsx, src/components/shell/{ToolOpenTracker,Studio,ProfileScreen}.tsx, src/lib/{money,features-client,account}.ts, src/features/compare-art/{CompareExportSheet.tsx,useCompareGif.ts}, e2e/admin.spec.ts, PROJECT.md, docs/roadmap/* |
| 2026-11-11 | **Phase 3a — English and Hebrew for the public pages.** `use-intl` 4.14.9 (pinned; fresh transitive packages pinned with overrides); typed English/Hebrew messages with a completeness test (same keys, valid ICU, same placeholders); request language from `/he` address → account → cookie → Accept-Language; `<html lang dir>`; Hebrew RTL with logical spacing, mirrored arrows and hero; `/he` public pages with hreflang; language switch; new accounts take the sign-up page's language (and ILS for Hebrew); account emails in English or Hebrew (RTL). Studio and admin stay English/LTR inside until 3b. Fixed while testing: a server action posted to a `/he` page re-set the Hebrew cookie, and the browser kept the old language cookie after the switch (the switch now writes it last, client-side); the admin editors lost their "saved" message on refresh. Tests: 210 unit/integration, 100 e2e, 36/36 visual parity. | src/i18n/*, src/app/{layout.tsx,page.tsx,pricing/,sign-in/,sign-up/,forgot-password/,reset-password/,email-verified/,locale-actions.ts,app/layout.tsx,admin/AdminShell.tsx,admin/plans/page.tsx,admin/pricing/page.tsx}, src/proxy.ts, src/components/{auth/*,plans/PlanComparison.tsx,common/LanguageSwitch.tsx,account/ProfileSections.tsx}, src/lib/plans.ts, src/server/{auth.ts,mail/templates.ts,account-management.ts}, src/app/app/profile/actions.ts, e2e/i18n.spec.ts (new), scripts/e2e-server.ts, playwright.config.ts, package.json, docs/adr/0009, docs/roadmap/README.md, PROJECT.md |
| 2026-11-11 | **Security quick wins (commit 2785aa9).** Per-request CSP nonce with `'strict-dynamic'` set in `src/proxy.ts` (no violations across the five tools, account and admin); request bodies capped while streaming (16 KB app JSON, 32 KB auth; 413); `GET /api/health` reports `version.commit` and build time; absolute hreflang/social URLs; `deploy/RELEASES.md` (every staging release since 77b92be and the list awaiting deployment). Tests: 210 unit/integration, 104 e2e, 36/36 visual parity. | src/proxy.ts, src/server/request.ts, src/app/api/{auth,events,usage,me/intros,health}/, src/app/layout.tsx, next.config.ts, e2e/{security (new),auth,i18n}.spec.ts, deploy/RELEASES.md |
| 2026-11-11 | **Phase 4a — provider-neutral billing core (no provider connected).** Provider research for an Israel-based merchant (`docs/billing/01-provider-research.md`, no provider chosen) and architecture (`docs/billing/02-architecture.md`); ADR-0008 amended: no simulated provider in the app — the core is tested with verified events built in tests, the full lifecycle later in the chosen provider's sandbox. Event processor: once per provider event id, never older state over newer (decided by the database in the same write; creation races retried), payments/refunds/chargebacks recorded once, provider customer linked, coupon redeemed once at creation, checkout completed only for its own account. Server-side checkout sessions (published active price, verified active account without a live subscription, eligible coupon; one hour). Revenue figures per currency (MRR/ARR, live, cancelling, ended and churn, refunds, failed payments, disputes) feed `/admin/analytics` and the new read-only `/admin/billing`. Reconciliation corrects our copy from the provider's, audits each fix and lists subscriptions the provider does not know. New empty collections and indexes only. Tests: 222 unit/integration (12 new billing), 105 e2e, 36/36 visual parity. | src/server/billing/{provider,signature,process,checkout,metrics,reconcile,overview}.ts, src/server/billing/billing.test.ts (new), src/server/db/{collections,migrate}.ts, src/server/analytics-report.ts, src/app/admin/{billing/ (new),figures.tsx (new),analytics/page.tsx,AdminShell.tsx,format.ts}, e2e/{admin,accounts,security}.spec.ts, src/server/commerce-config.test.ts, docs/billing/*, docs/adr/0008, docs/roadmap/*, PROJECT.md |
| 2026-11-11 | **Phase 3b-1 — the studio's frame in Hebrew.** Home (hero and cards mirrored), both navigation bars (right to left on phones), first-visit tool introductions, the in-studio plans page, the whole account page and the messages of its server actions follow the account's language; device names are worded per language; deleting accepts DELETE or מחיקה; changing the language reloads the studio in it. Each tool's workspace, its guided tours and the save sheet stay English and left to right inside (`ToolFrame`, no box of its own); the admin dashboard keeps English messages. `TOOLS` now takes its English from the messages (one source). Found by visual parity and fixed before commit: wrapping the tools dropped `min-width: 0` from the Grid tool's root on phones (the rule now looks through the frame). Message check now ignores words inside plural branches. Tests: 222 unit/integration, 109 e2e (new Hebrew studio tests on Desktop Chrome and iPhone WebKit, with dedicated Hebrew accounts), 36/36 visual parity. | src/components/shell/{tools.ts,ToolFrame.tsx (new),Studio.tsx,HomeScreen.tsx,AppNav.tsx,ToolIntro.tsx,PlansScreen.tsx,ProfileScreen.tsx,account.tsx}, src/components/account/{ProfileSections,parts}.tsx, src/components/common/SaveMedia.tsx, src/onboarding/OnboardingOverlay.tsx, src/app/app/{layout.tsx,profile/actions.ts}, src/app/admin/AdminShell.tsx, src/i18n/{messages/en.ts,messages/he.ts,messages.test.ts}, src/lib/user-agent.ts, src/server/account-management.ts, scripts/e2e-server.ts, e2e/{i18n,password}.spec.ts, docs/adr/0009, PROJECT.md |
| 2026-11-11 | **Accessibility: automated WCAG checks and fixes.** New `e2e/accessibility.spec.ts`: axe-core 4.14.0 (pinned, more than two weeks old), WCAG 2.0/2.1 A and AA, on public pages (EN/HE), the studio (EN/HE, each tool's first screen), admin and phones. Fixed what it found: secondary-text contrast (`--muted-foreground` 50% → 60% lightness, checked by screenshot; parity unaffected); accessible names that did not contain the visible text (Home cards now named by their text with decorative pictures; account button and admin brand link use hidden text); zoom allowed outside the studio; HEX field label in the Color tool; the in-studio plans page can be scrolled from the keyboard; underlined admin account links. One documented exception: the studio's zoom limit. No manual audit yet, no conformance claimed (docs/accessibility/README.md, with a draft statement not for publication). Tests: 222 unit/integration, 137 e2e, 36/36 visual parity. | e2e/accessibility.spec.ts (new), playwright.config.ts, package.json, package-lock.json, src/index.css, src/app/layout.tsx, src/app/app/layout.tsx, src/app/admin/{AdminShell,EventList}.tsx, src/components/shell/{HomeScreen,account,PlansScreen}.tsx, src/components/color/ColorTab.tsx, e2e/{i18n,navigation,routing}.spec.ts, docs/accessibility/README.md (new), PROJECT.md |
| 2026-11-11 | **Privacy and legal drafts; retention enforced.** `docs/privacy/data-inventory.md`: every piece of personal data (browser, server, backups), purpose, retention and its mechanism, proposed lawful basis, recipients, rights as implemented. `docs/legal/`: drafts of the terms of service, privacy policy, cookies, artwork and content, subscriptions and refunds, support and contact — each marked as a draft for a qualified Israeli lawyer (and accountant), not published, with the owner's open decisions listed. Nightly maintenance now deletes analytics events older than 13 months and audit events older than 24 months (the proposed periods; calendar months clamped to shorter months). Tests: 223 unit/integration. | src/server/maintenance.ts, scripts/db.ts, src/server/account-management.test.ts, docs/privacy/data-inventory.md (new), docs/legal/* (new), PROJECT.md |
