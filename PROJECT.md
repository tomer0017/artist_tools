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
    │   ├── color/              Color & Mixing: ColorTab (wheel & harmonies, recipes, skin tones),
    │   │                       ColorWheel, HarmonyCards, colorMath + harmonies (the colour rules), useCopyHex
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

### Sketchy, the studio companion — on Home and the Learn home (`src/components/companion/`, ADR-0024)
- **Purpose:** the studio's mascot and guide: the fox artist of the official
  character sheet, animated, who helps people discover and combine the
  tools, practise, and find something to draw.
- **The character:** one layered SVG puppet (`rig.tsx`, every joint its own
  group and pivot; faces, props and effects; no text in the picture) driven
  by a pose engine (`engine.ts`: blends between clips, adds blinking,
  breathing, tail and ear life, writes only transforms, ~30 fps when calm,
  stops off screen or in a hidden tab, still frames with reduced motion)
  and 14 clips (`clips.ts`: idle, walk, run, jump, sit, rest, wave, laugh,
  think, curious, celebrate, holdSign, point, draw). `Sketchy.tsx` is the
  React wrapper (handle: play, look, anchor).
- **Where:** `CompanionStage` (lazy) in Home's hero and the Learn home's
  header; `Stage.tsx` measures the page (`geometry.ts`) and lets him stand
  only beside the text (`[data-sketchy-avoid]`), below the phone brand row
  (`[data-sketchy-top]`), smaller when the room is small, mirrored in
  Hebrew. His sign goes beside him without covering him, the navigation or
  the tool cards (below his feet when there is no room). Away from his
  stages: only a 3-second, tap-through celebration after a save or a
  completion (`CompanionHost` → `Celebration.tsx`).
- **Behaviour:** walks in, waves; introduces himself the first time; greets
  once a day; celebrates saves (SaveMedia's sheet closing) and completions
  (Learn's Mark as completed / "I did it") and offers what is next; after a
  quiet while may hold up a suggestion; wanders between free spots, sits,
  sketches, thinks, rests after a long quiet (wakes when the pointer comes
  near); his eyes follow the pointer on desktops. Never moves while his menu,
  a sign or the roulette is open; never offers anything while the person is
  using the page.
- **Menu** (`Menu.tsx`, a click or Enter on him): Surprise me, a drawing tip
  (another), Choose a challenge (the roulette), Help me improve my drawing
  (needs → tools, and short plans of tools), Help me choose a tool, Recommend
  a lesson (the course's Start/Continue), Create practice sheets (Create a
  Grid opens "Prepare worksheets" when it has a photo), Help me prepare an
  art class (class roulette, class mode for the tab), tell him who you are,
  Hide Sketchy. Entries appear only when they can work for the account.
- **Roulette** (`Roulette.tsx`): a wheel of the challenges the account may
  open (the Learn API, so edits in Admin → Learn show at once), moods,
  category, quick only; Challenges V2's spin rules; Open the challenge; in
  class mode "Prepare practice sheets" (the challenge page opens its
  worksheets with `?sheets=1`).
- **Knowledge and suggestions:** `src/lib/companion/registry.ts` (the tools'
  features, needs, plans of tools, `canRun`), `brain.ts` (what fits, the pace,
  freshness, weights; `SuggestionProvider` for a future AI provider),
  `model.ts` (animations, screens, audiences, triggers, the fixed action
  types, capabilities), `defaults.ts` (settings and 47 tips in English and
  Hebrew).
- **Data:** `GET /api/companion` (this account's settings, capability states
  and visible tips; asked again only when `account.companion.key` changes),
  `POST /api/me/companion` (hide/show, audience: on `users.companion`; in the
  data download). Device memory: `studio-companion*` keys (cleared with the
  device's work).

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

### Admin — routes `/admin`, `/admin/users/[id]`, `/admin/analytics`, `/admin/plans`, `/admin/learn`, `/admin/companion`, `/admin/pricing`, `/admin/coupons`, `/admin/billing`, `/admin/activity`, `/admin/security`, `/admin/verify`, `/admin/mail` (`src/app/admin/`)
- **Admin → Companion** (`/admin/companion`, ADR-0024): Sketchy on or off,
  his size and pace (quiet, balanced, chatty or custom numbers: first
  suggestion after, minutes between two, per day, snooze after "Not now"),
  walking, idle life, celebrations, rest, speed; each animation on or off
  with a preview of every one (dark or light, phone or desktop, English or
  Hebrew); each capability's access (Free, Pro, Admin only, Blocked); every
  tip (English and Hebrew, screens, audience, moment, "right after this
  tool", his move, its button from the fixed action list, access, weight):
  add, edit, copy (starts Admin only), archive, restore, reorder, preview;
  history with restore. Every save is live at once as a new version of the
  `companion` configuration (`src/server/companion/{config,editor,live}.ts`).
- **Purpose:** Supporting accounts. `/admin`: search by email plus filters
  (role, Pro with no end date, Pro for a time, status, email verified, sign-in
  method, test accounts, registration dates; shareable URLs), headline counts
  (accounts, admins, Pro with no end date, Pro for a time, suspended, test),
  every account with how it signs in (Google id's last four characters only,
  password yes/no), registration, last login, role, **access** in force and
  where it comes from (paid, given until a date, no end date, admin),
  **billing** status (kept separate), sign-ins and GIFs this month — cards on
  phones, a table on wider screens — plus recent activity.
  `/admin/users/[id]`: one account (sign-in methods, sessions, usage, its
  audit trail), **Access** (what is in force and every reason for it),
  **Billing** (read-only: the latest subscription and the last 10 payments, as
  the provider's verified events wrote them) and what an admin can change,
  each behind a confirmation: **Manage access** without payment — Pro for 7,
  30 or 90 days (a grant that ends on its own, `src/server/grants.ts`;
  extended from its current end, never past a year from today; ended early),
  Pro with no end date (the assigned plan, `users.plan`), or **Free** (every
  manual Pro ends at once) — **role** (make / remove admin),
  **status** (suspend with a reason — signs the account out everywhere — or
  reactivate) and **test account** (left out of analytics). Manual Pro never
  changes billing, and a paid subscription keeps working on its own. Nobody
  can change their own access (the server refuses). Older grants of 14 or
  365 days keep working. Role and status changes need the admin to have
  signed in within 10 minutes, otherwise "Confirm it is you" appears in
  place. **The owner** (`users.owner`, one admin, set only with `npm run db
  -- set-owner <userId>`): only the owner changes admin roles, and the
  owner's account shows no controls to other admins (every action refuses
  them too); while no owner is set, admins work as before. The list shows
  **last active** (the latest sign-in or session renewal). `/admin/security`
  also lists **trusted devices** (docs/security/admin-2fa.md). `/admin/activity`: the
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
  can never be demoted (`setUserRole`); only the owner changes roles once an
  owner is set. No tokens, session secrets or full
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
- **Username accounts for invited testers** (ADR-0012; off unless
  `AUTH_USERNAME_PASSWORD=on`; staging has it on since 2026-11-18): a username
  and a password, no Google and no email, created only by an admin
  (`/admin/users/new`) or the operator CLI (`npm run db -- create-tester`),
  never by sign-up. Creation and password changes go through Better Auth
  endpoints marked `SERVER_ONLY` (never routed over HTTP;
  `src/server/password-accounts.ts`), so the library's own hashing (scrypt)
  and hooks run; Better Auth's admin plugin is not installed. Usernames: 3–30
  `[A-Za-z0-9_.]`, stored lower case (`users.username`, unique), shown as given
  (`displayUsername`); nobody can set or change one through the API, and the
  username lookup endpoint is off. Their `email` is a placeholder under
  `users.studio-companion.invalid` (never written to, never a way in, never a
  Google address; `src/lib/username.ts`). Passwords are generated (16 of 56
  characters, ~93 bits) and shown once to the admin who asked; the CLI never
  prints one: it is sealed in `password_handoffs` for one reveal in the
  dashboard within 72 h. A reset makes a new password and ends every session;
  testers can change theirs on the account page. Username accounts are always
  role `user` and can never be made admins. Sign-in: 5 per minute per IP, 10
  wrong passwords per username pause it for 15 minutes, one answer for an
  unknown username and a wrong password, 403 `ACCOUNT_SUSPENDED` only after the
  right password of a suspended account.
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
  is the code default from `src/lib/plans.ts`; publishing writes it to `plans`,
  which entitlements read on every request, uncached). The table is version 1;
  **staging publishes version 2 since 2026-11-18** (Free: Study & Simplify,
  Color & Mixing, Create a Grid and saving images; Pro: everything):

  | Capability | Free | Pro | Admin |
  |---|---|---|---|
  | All five tools (Measure, Study, Color, Grid, Compare) | ✓ | ✓ | ✓ |
  | Save images (grids, studies, comparisons) | ✓ | ✓ | ✓ |
  | Comparison GIFs: opacity pulse and blink, S and M sizes | ✓ | ✓ | ✓ |
  | Large GIFs (L, up to 800 px) | locked | ✓ | ✓ |
  | Compare + Difference GIF animation | locked | ✓ | ✓ |

  No quotas are set in version 1. Admins can add per-plan quotas on saves and
  exports (per UTC day or calendar month), enforced atomically by
  `authorizeFeatureUse` (a used-up quota answers 429 `limit_reached`; the
  studio says so), and can switch a feature off for everyone but admins. A tool
  is on or off per plan (no quota). Locked options stay visible with a lock;
  choosing one explains it is part of Pro and that paid plans are coming soon.
- **Enforcement (ADR-0013):** every studio page (layout, Home, each tool,
  account, plans) verifies the session and sends the account as the database
  has it now (src/server/studio-account.ts → `AccountSync`); the studio opens a
  tool only if its plan includes it and otherwise shows a locked screen
  (`ToolLocked`, English and Hebrew; Home and both navigation bars mark it). An
  open studio re-reads the account every minute while in view, on coming back
  into view, and from its other tabs (BroadcastChannel). Every save and export
  asks the server first (`POST /api/usage` with the tool and what is exported,
  `authorizeToolUse`) and only a yes saves: a refusal, a used-up limit or no
  answer saves nothing (fail closed). The plan comparison, the account page and
  the "all five tools are free" texts follow the published plans. The tools
  run on the device: someone who rewrites the studio's code in their own
  browser can run it, but the server refuses and does not count their saves.
- **Rollback safety (ADR-0014):**
  - **Reading.** The stored catalog is read tolerantly (`readCatalog`,
    `src/server/config/catalog.ts`). Feature IDs and sections a newer release
    added are kept exactly and never applied. A setting on a known feature
    that this release cannot apply withholds that feature (fail closed).
  - **No defaults over a published version.** An unreadable published
    catalog is never replaced by the code's defaults: the migration leaves
    `plans` as it is, and `publishedDocument` throws. A lost catalog history
    starts from the plans in force.
  - **Editing.** Drafts, restores and the operator tool keep the stored
    document. The editor's form changes only known features (`mergeKnown`).
    A version this release cannot apply in full is not edited or published
    from it: Admin → Plans says why, and discarding and restoring stay
    possible.
  - **`plans`** documents are read fail closed too (`planStateOf`).
  - **Operators:** after a rollback, run `npm run db -- catalog-status`
    (deploy/README.md). Never roll back below this release once a later one
    has published a new feature ID or section.
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
- **Using a plan-gated feature:** before every save, and before any GIF is
  encoded, the studio calls `POST /api/usage` with the tool and the features
  it needs; the server checks them from the database (`authorizeToolUse`) and
  counts the use (these counts are the admin's usage figures). Cross-site
  requests are refused.
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
  - **Wheel & Harmonies** (one screen since 2026-11-17; before, Color Wheel
    and Harmonies were two tabs) — the wheel (`ColorWheel.tsx`: hue ring +
    saturation/brightness square, also sliders for the keyboard), HEX
    input/copy and the "pick from image" eyedropper, beside (from 768 px) or
    above (phones) all six harmonies as cards (`HarmonyCards.tsx`:
    complementary, split-complementary, analogous, triadic, warm and cool
    versions), two per row. Every change of the selected colour updates every
    card at once: the harmonies are derived from it (`harmoniesOf`), never
    stored. A card shows its colours as dots on the wheel's ring, at their
    hues (one card at a time; press again to hide); a dot makes that colour
    the base (what clicking a harmony swatch used to do). A swatch copies its
    HEX (`useCopyHex`: Clipboard API, or the copy command on plain http), shows
    "Copied" on itself and a status line reads it out. Picks up a hex handed
    off from the Measure tab via `sessionStorage`. While sampling a photo on
    wide screens, the photo spans the full width below the wheel and cards.
  - **Mixing Recipes** — curated paint recipes grouped by family (greens,
    purples, oranges, pinks, browns, neutrals) with ingredient swatches,
    percentages, and notes.
  - **Skin Tones** — light/medium/dark cards with base/shadow/highlight mixes.
  - Plus a "Painter Cheat Sheet" shown under each sub-tab.

### Grid tool
- **GridTab** (`grid/GridTab.tsx`) — a canvas of configurable proportions
  with a grid laid over the image.
  - **Moving the image:** drag, pinch or wheel to zoom; Fit, Fill or Center;
    turned left or right 90° or by 180°. Only the drawing turns; the stored
    photo never changes.
  - **Grid:** presets 3×3, 4×4 and 8×8, or **square cells** of a set size in
    the canvas unit (squares on paper, a partial cell at the right and bottom
    edges).
  - **`GridControls`** sets:
    - the canvas size and unit, and quick ratios, including exact **A4**
      portrait and landscape (21 × 29.7 cm);
    - columns × rows, or the cell size;
    - the lines' colour, opacity and thickness;
    - exact zoom: −/+ 1 %, a slider from 25 % to 800 %, or typed;
    - moves by 0.1 of the unit.
  - **Saves** (since M1): the grid image (2400 px wide PNG), and a **blank
    grid** (the same lines in black on white, without the photo, for paper).
    Both go through the authorized save (`tool.grid` and `export.image`,
    failing closed).
  - **Settings** live in the saved project; a grid saved before M1 gets the
    new settings' defaults (`normalizeGridSettings`) and opens unchanged.

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
- **Color:** interactive HSV wheel (pointer, touch and keyboard); hex
  input/copy; all 6 color harmonies on the same screen as the wheel, shown on
  the wheel on request; copy any swatch's HEX with feedback; warm/cool nudging; pick a color from the image; ~24 paint-mixing recipes;
  skin-tone mix cards; painter cheat sheet; hand a chosen color to the wheel
  from a sampled swatch in Measure.
- **Grid:** configurable canvas ratio (cm/in) with presets; adjustable
  columns/rows; line color/opacity/thickness; drag/scale/fit/fill/center the
  image; export a 2400px-wide PNG.

## Color Logic & Processing

This is the heart of the project and lives in two places.

### Color & Mixing — generative color theory (`components/color/colorMath.ts`, `harmonies.ts`)
- **HSV ⇄ RGB ⇄ Hex** conversions (`hsvToRgb`, `rgbToHsv`, `hsvToHex`,
  `hexToHsv`) drive the interactive wheel. The hue ring maps pointer angle to
  hue; the inner square maps x/y to saturation/value.
- **Harmonies** are computed by rotating hue: `shiftHue(hex, deg)` produces
  complementary (180°), split-complementary (150°/210°), analogous (±30°), and
  triadic (120°/240°) sets. `harmoniesOf(hex)` lists all six harmonies in their
  display order; `colorMath.test.ts` checks it against a frozen copy of the
  original code over 18,616 colours.
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
   mode gets **no** pre-blur (in Sketch this pass only builds the palettes).
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
   - *Sketch mode:* the drawing comes from the sketch engine in a Web Worker
     (`lib/sketch/`, below; `useSketchDrawing`). This pass still runs, without
     pre-blur, to build the value and dominant palettes, which the palette and
     study-sheet exports use; it no longer touches the image shown.
6. **Value groups** (the distribution strip / palette rows) are rebuilt from the
   per-bin averages with percentage coverage, hex, warmth, and paint hint.

`brightnessLabel` (darkest→highlight) and the warmth/family classifiers are
reused across the strip, palette rows, and the exported study sheet so labels
stay consistent.

### Sketch engine (`lib/sketch/`)

Sketch mode has two styles, chosen under the image:

- **Clean Outline:** thin dark contours on white (never black fills), plus
  lighter lines for soft shadow boundaries. Saves as PNG or as a true vector
  SVG.
- **Pencil Study:** graphite tones with soft transitions (the darkest is 30–38 %
  grey, never a black mass), a fine directional grain, and the same contours
  in grey on top.

Both were chosen in a visual review against the retired black-and-white trace
(lab/sketch, untracked; approved 2026-11-16). At the default controls the app
reproduces the approved review images byte for byte (0 of 1,572,291 pixels
differ, both styles).

Everything is deterministic, DOM-free TypeScript on Float32 planes. Spatial
settings are multiples of u = sqrt(w·h)/1000, so a drawing looks the same at
any working size.

```
lightness (CIE L*, percentile-stretched) → logarithmic shadow lift
  → domain-transform edge-preserving smoothing (Gastal & Oliveira)
  → structure-tensor edge directions
  → flow-based DoG (Kang 2007, separable form of Kyprianidis 2008)   ← shared by both styles
  → soft threshold → hysteresis + small-stroke removal               ← Detail
  → line weight: narrow toward the centre / round soft brush        ← Line thickness
Clean Outline: + soft-boundary ridges (coarse Canny with absolute lightness steps), suppressed near contours
Pencil Study:  graphite tone (edge-preserving, large dark areas lifted) + grain scaled by darkness and form ← Shading
```

| File | Role |
| --- | --- |
| `pipeline.ts` | `SketchPipeline`: the engine for one picture, staged and cached |
| `planes.ts` | `PlanePool` (buffer reuse and memory accounting) and the image primitives |
| `lines.ts` | tangent field, flow DoG, soft ridges, hysteresis, cleanup, line weight |
| `styles.ts` | the approved parameters, and how the three controls map onto them |
| `vector.ts` | marching squares with interpolation → RDP → even-odd SVG paths |
| `sizing.ts` | working and export sizes, and their limits |
| `protocol.ts`, `worker-core.ts`, `sketch.worker.ts` | the Web Worker |
| `client.ts` | the page's side: one render in flight, only the newest waits |
| `browser.ts` | reading photo pixels (in halving steps), PNG encoding, vector → PNG |
| `settings.ts` | saved-project settings, including the retired trace's |

**Off the main thread.** `useSketchDrawing` (components/value) reads the photo
once at the working size and transfers it to the worker. Each control change
asks only for a render; the worker answers from cached stages and encodes the
PNG itself (OffscreenCanvas, or the page does it on older browsers). Slider
changes are coalesced (`SketchClient`): nothing queues up. Leaving Sketch shuts
the worker down after 20 s, which returns all its memory.

**Caching.** Per picture: the DoG response (both styles), the soft ridges
(Outline), the graphite curve, form and grain (Pencil, built when first asked
for). Per Detail: which lines. Per Line thickness: their width. Per Shading:
only the final compose. Measured on the review portrait (1269 × 1239, Node on
an M-series Mac): first Clean Outline ≈ 1.3 s, first Pencil Study after it
≈ 0.7 s, a Detail or Line thickness change ≈ 0.15–0.2 s, a Shading change
≈ 45 ms.

**Memory.** Every full-size buffer comes from a `PlanePool`, so the footprint
is a fixed number of planes: about 68 bytes per pixel at the peak and 48 held
with both styles cached (pipeline.test.ts checks ≤ 72 and ≤ 52). Phones and
tablets use the compact mode (only the active style's caches are held: ≤ 24–36
bytes per pixel) and keep at most two spare planes.

| Limit | Desktop | Phone / tablet |
| --- | --- | --- |
| On-screen drawing (both styles) | 1.6 MP, 1600 px | 1.6 MP, 1600 px |
| Saved Clean Outline PNG (drawn from the vector paths) | longest side 3200 px | 2400 px |
| Saved Pencil Study PNG (recomputed in a short-lived worker; the on-screen caches are freed first and on-screen renders wait until it is done) | 4.2 MP | 2.5 MP |
| SVG (Clean Outline) | the on-screen paths, opening at the photo's size | same |

Never above the photo's own size (except the outline, whose paths scale
cleanly), never above 16 MP for a canvas (iOS).

**Controls** (0–100, 50 = the approved look, Reset per style, word read-outs):

| Control | Styles | What it does |
| --- | --- | --- |
| Line thickness | both | Below 50, each contour keeps only the part of its cross-section above a share of its own peak response, so it narrows toward its centre without vanishing. Above 50, a round, soft-edged brush up to 2u px. Soft lines scale with it. |
| Detail | both | Above 50, fainter edges join in (threshold × 0.5 at 100) and smaller strokes survive. Below 50, the threshold stays and weaker strokes are dropped whole (a stroke must reach up to 3.5× the default response at its strongest point), so the main contours stay at full weight instead of fading. |
| Shading | Pencil Study | Below 50, the whole tone lightens to a wash (darkest 0.25). Above 50, the darkest graphite only goes from 38 % to 30 % grey and the mid-tones deepen, so it never becomes a black mass. |

**Overlay.** The drawing's lines in red over a lightened grey copy of the photo,
for checking them against it. On desktop it is a fourth Compare option (Sketch
only); on the phone, a view next to Original and Study.

**Known limits.**
- Lines sit about 2 px inside the dark side of an edge, like a pen line drawn
  along a shadow.
- A very noisy dark area (a high-ISO shadow) can show small specks: the shadow
  lift that finds an ear in shadow lifts the noise too. Lowering Detail to
  about 30 removes them and keeps the contours (tested).
- Dense hair becomes many short strokes.
- A busy background gives many lines.

**Saved projects.** `valueSettings.sketchStyle`, `sketchOutline` and
`sketchPencil` hold the new state. The retired trace's `sketchTrace` (and the
older `sketchDetail` / `sketchShading`) are still accepted and kept untouched;
such a project opens in Sketch as Clean Outline at the defaults.

### Grid & Measure geometry
- **Grid geometry.** `src/lib/grid/geometry.ts` holds the geometry; it is
  pure, and since M1 it is shared by the preview, the saved image and the
  blank grid.
  - It computes a fit scale for the image, as turned, then the offset and
    scale for drag, pinch and wheel.
  - It places the lines: columns × rows evenly, or square cells from the
    top-left corner.
- **Grid drawing.** `src/lib/grid/draw.ts` draws them, with the canvas calls
  Create a Grid has always made: the background, the clipped image, the lines,
  then a stronger border.
- **Proof that nothing changed:** `draw.test.ts` replays the code from before
  M1 and requires exactly the same canvas calls for 90 grids saved before.
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
  selected color, sub-tab and the harmony shown on the wheel in `ColorTab`, and
  drag/pinch state in `GridTab`.
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
  clipboard copy (`useCopyHex.ts`, which also shows "Not copied") and the
  `sessionStorage` color handoff now log on failure.
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
  Pure TypeScript run in a Web Worker; `browser.ts` is the only part that
  touches the DOM. Tests: `src/lib/sketch/{pipeline,client,sizing,settings}.test.ts`
  and `e2e/sketch.spec.ts`.
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
- **Translated (Phase 3b-2):** the five tools and what they share: tool
  header, image upload, save sheet, Pro notice, guided tours (their words in
  `toolsCommon.tours.<id>`), illustrations. Messages per tool in
  `src/i18n/messages/tools/`. Right to left in Hebrew, while canvases, image
  layers, sliders, colour codes and number readouts stay left to right. The
  small Hebrew hints that English pages already showed (Compare's upload
  step, the save sheet) now appear on English pages only.
- **Not translated, on purpose:** text drawn on canvases or into exported
  images and study sheets; pigment names, colour codes, units, file names;
  user data (layer and line names; the default layer "General Lines" is
  stored in projects); the admin dashboard. Hebrew labels typed by a person
  and drawn on the Measure overlay or export keep the drawing code's
  left-to-right order (unchanged). **Needs a native speaker's review**
  before launch (the wording questions are listed in each tool's message
  file history).

## Accessibility

- **Automated checks** (`e2e/accessibility.spec.ts`, axe-core 4.14.0 pinned):
  WCAG 2.0/2.1 A and AA rules on the public pages (English and Hebrew), the
  studio's frame and each tool's first screen, the Hebrew studio, the admin
  dashboard, and phone-sized screens (Chrome and WebKit, simulated). Any
  finding fails the test, except documented exceptions, which stay in the
  report (`test-results/a11y-*.json`).
- **Known exception, narrowed:** only on iPhone and iPad does the studio add
  `maximum-scale=1` (Safari would zoom into small fields and stay zoomed;
  it ignores the limit for pinch-zoom). Page zoom is free everywhere else,
  Android included (the canvases handle their own pinch).
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
| 2026-11-11 | **Launch readiness documents and release smoke test.** `docs/security/threat-model.md` (assets, boundaries, threats with what addresses each, gaps), `docs/security/incident-response.md`, `docs/launch/checklist.md` (every gate Done/Partial/Open/Owner with evidence; not production-ready; npm audit assessed: mostly build tools, zod/lodash reachable but mitigated), `deploy/smoke.sh` (read-only HTTPS checks of a release: commit, pages EN/HE, redirects, one CSP with fresh nonces, 413), verified 18/18 on the local production build. | docs/security/*, docs/launch/checklist.md, deploy/{smoke.sh,README.md,RELEASES.md}, PROJECT.md |
| 2026-11-11 | **Admin two-factor verification.** A step-up check on admin access itself (Better Auth's two-factor plugin covers password sign-ins only, and admins sign in with Google): TOTP (RFC 6238, own implementation, tested against the RFC vectors; each code works once), the secret encrypted at rest (AES-256-GCM, HKDF key), ten single-use recovery codes (hashed), a 5-wrong-codes lockout for 15 minutes, a 12-hour verified session. `/admin/security` (set up with a QR code, a setup key or an `otpauth:` link; new recovery codes; turn off) and `/admin/verify`. Admin pages redirect, and admin actions and routes refuse, until verified. Voluntary; `ADMIN_MFA_REQUIRED=on` makes it required (off until the owner approves). Reset from the server: `npm run db -- reset-admin-mfa <userId>`. Fixed while building: server actions read the session without renewing cookies, so action replies no longer re-render the whole page (that re-render sometimes left an action's promise unresolved). Tests: 231 unit/integration, 142 e2e (the two-factor journey also passed 5 times in a row). | src/server/{admin-mfa,session,env,account-management}.ts, src/server/security/{totp,secret-box}.ts, src/server/db/{collections,migrate}.ts, src/app/admin/{security/,verify/ (new),AdminShell.tsx,format.ts}, scripts/{db,e2e-server}.ts, e2e/{admin-mfa (new),accessibility}.spec.ts, src/server/{admin-mfa,env}.test.ts, package.json (uqr 0.1.3), docs/security/*, docs/launch/checklist.md |
| 2026-11-11 | **First-party error monitoring and an uptime check.** Browser errors (`ErrorReporter` in the root layout: message, stack, path, release; 5 per page, extensions skipped) go to `POST /api/client-errors` (this site only, 10 KB, 30 per IP per 10 minutes through the hashed throttle); server errors through `src/instrumentation.ts` (`onRequestError`, route pattern only). Grouped by fingerprint in `error_reports` (count, first/last seen, up to 10 paths/releases/browsers), with emails, query strings and token-like strings removed and no account, IP or full user agent stored; a group not seen for 30 days expires. Admin page `/admin/errors`. `.github/workflows/uptime.yml` checks `/api/health?ready=1` every 30 minutes once it is on the default branch (owner's decision; docs/ops/monitoring.md). Tests: unit (redaction, paths, grouping, caps, TTL) and e2e (a real browser error reaches the admin without its email or token; 403/413/400). | src/server/error-reports.ts, src/app/api/client-errors/route.ts, src/instrumentation.ts, src/components/common/ErrorReporter.tsx, src/app/layout.tsx, src/app/admin/{errors/,AdminShell.tsx}, src/server/db/{collections,migrate}.ts, e2e/{monitoring (new),accessibility,accounts}.spec.ts, docs/ops/monitoring.md, PROJECT.md |
| 2026-11-11 | **Backups verified by a real restore; missing auth indexes added.** `deploy/backup-offsite.sh` (checks the newest dump is recent, complete and readable by mongorestore; writes a manifest with size, SHA-256 and live document counts; when `/etc/studio-companion/offsite.conf` exists, encrypts with `age` to the owner's public key, uploads with `rclone --immutable` and checks the upload; healthchecks.io pings) and `deploy/restore-drill.sh` (restores one database into a throwaway one, compares counts with the manifest or the live database, checks unique indexes, drops it; the admin password never on the command line). Run on staging: restored in 4 s, counts OK. The drill found that Better Auth's MongoDB adapter creates no indexes: `users.email` unique, `sessions.token` unique and the userId/identifier lookups are now in the migration. Off-site copies wait for the owner's B2 bucket, age key and healthchecks.io check (docs/ops/backups.md, exact steps). vitest test timeout 20 s (integration tests migrate throwaway databases in parallel). Admin pages added to the regular-user 404 test. | deploy/{backup-offsite.sh,restore-drill.sh,cron/studio-offsite-backup} (new), src/server/db/migrate.ts, vitest.config.ts, e2e/accounts.spec.ts, docs/ops/backups.md, docs/launch/checklist.md, PROJECT.md |
| 2026-11-11 | **Studio zoom limit narrowed to iOS.** The studio no longer sends `maximum-scale=1`; on iPhone and iPad only, `useIosNoInputZoom` (StudioClient) adds it after load, where Safari ignores it for pinch-zoom but stops zooming into small fields. Android and desktop can zoom the page; every tool canvas already handles its own pinch (`touch-action: none`). The accessibility spec's documented exception now applies to WebKit iPhone emulation only, and a test checks both cases. | src/components/shell/StudioClient.tsx, src/app/app/layout.tsx, e2e/accessibility.spec.ts, docs/accessibility/README.md, PROJECT.md |
| 2026-11-11 | **Phase 3b-2 — the five tools in Hebrew.** Measure (138 messages), Study (139), Color (103) and Grid (36), Compare (263), translated in parallel by four agents in isolated worktrees from one brief (English verbatim, gender-neutral Hebrew, canvases and coordinate-based controls kept left to right, nothing drawn or exported changed), each checked by its agent against the original components' English output in jsdom, then merged; plus the shared parts (header, upload, save sheet, Pro notice — `PRO_FEATURE_INFO` moved into the messages —, tours restructured into structure + messages, illustrations). `ToolFrame` removed. New e2e: the five tools in Hebrew (photo loaded, Hebrew controls, canvases left to right) and on a Hebrew phone without sideways scrolling; visual review of the Hebrew phone screenshots. English unchanged: visual parity 36/36. | src/components/{measure,value,color,grid}/*, src/features/compare-art/*, src/components/common/{ImageUploader,SaveMedia,ProFeature}.tsx, src/components/shell/{Studio,ToolHeader,ToolArt}.tsx, src/onboarding/*, src/i18n/messages/tools/*, src/lib/plans.ts, src/app/app/layout.tsx, e2e/i18n.spec.ts, docs/adr/0009, PROJECT.md |
| 2026-11-16 | **Sketch: Clean Outline and Pencil Study replace the black-and-white trace.** Chosen in a visual review (lab/sketch, untracked; Outline A flow lines + Pencil A graphite, approved by the owner). New engine in `src/lib/sketch/` (flow-based DoG on an edge-preserving, shadow-lifted lightness plane; soft-boundary ridges; graphite tone and grain), byte-identical to the approved review images at the default controls. Runs in a Web Worker with staged caches (a control change recomputes only what depends on it; slider changes coalesced), a `PlanePool` memory budget checked in tests, compact mode on phones, and limits: on screen ≤ 1.6 MP; saved outline PNG drawn from the vector paths (≤ 3200 px, 2400 on phones); saved pencil recomputed in a short-lived worker (≤ 4.2 MP, 2.5 on phones); SVG for Clean Outline only, real paths and no raster. Controls: Line thickness, Detail, Shading (Pencil), Reset per style, English and Hebrew. Red outline overlay as a Compare option (desktop) and a view (phone). The old trace's code and strings removed; its saved settings still load and stay untouched. Color and Values verified unchanged: 75 of 75 captured states identical to the previous release (5 photos × 15 control states). An independent code review found one real bug before release (a late result for a style switched away from could replace the drawing on screen), fixed with the reviewer's other points (export holds on-screen renders, worker queue survives a failed request, no old-photo frame, no URL after unmount). Tests: 36 new unit tests (determinism and golden hashes, geometry, no solid black, controls, caching, memory, overlay, SVG vs raster, sizes, settings migration, worker client, and the hook: stale results, photo change, unmount mid-encode, export hold; each hook fix checked to fail without it); 11 new e2e (Chromium, WebKit iPhone emulation: worker, controls, Reset, overlay, PNG/SVG saves at full size, legacy project, Hebrew, axe). Totals: 280 unit/integration, 171 e2e. | src/lib/sketch/* (rewritten), src/components/value/{ValueTab.tsx,useSketchDrawing.ts}, src/types/project.ts, src/i18n/messages/tools/study.ts, e2e/{sketch.spec.ts (new),fixtures/photo.ts}, playwright.config.ts, PROJECT.md |
| 2026-11-18 | **Username accounts for invited testers (QA), managed from the admin dashboard** (ADR-0012). A second sign-in beside Google, a username and a password, for accounts that only an admin creates (`/admin/users/new`) or the operator CLI (`npm run db -- create-tester`); no sign-up, no email, no SMTP; switched on per environment (`AUTH_USERNAME_PASSWORD=on`, `studio-set-username-login`). Better Auth's username plugin signs in; creation and resets go through Better Auth endpoints marked SERVER_ONLY (never routed over HTTP) with its own scrypt hashing; the username lookup endpoint is off and nobody can set a username through the API. Their address is a placeholder under `.invalid`, so they never meet a Google account. Passwords are generated (~93 bits) and shown once; the CLI seals the initial password for one reveal in the dashboard (72 h). Admin: search by username, New tester account, Reset password (ends every session), Reveal initial password, Sign out everywhere, activity entries; username accounts are always role User and never admins; plans use the existing entitlements. Sign-in limits: 5/min per IP, 10 wrong passwords per username per 15 min, one answer for unknown usernames and wrong passwords, 403 only after the right password of a suspended account. Also fixed: the personal-password check now runs on password changes; the red Suspend / Remove admin buttons pass contrast. Tests: 33 new unit/integration, 16 new e2e (staging-like server: Google + usernames; desktop Chrome, WebKit iPhone). Totals: 336 unit/integration, 200 e2e. | src/server/{auth.ts,password-accounts.ts (new),admin.ts,account.ts,account-management.ts,maintenance.ts,env.ts,db/{collections,migrate}.ts,security/secret-box.ts}, src/lib/{username.ts (new),auth-client.ts,account.ts}, src/app/admin/{actions.ts,AdminControls.tsx,page.tsx,format.ts,users/[id]/page.tsx,users/new/* (new),activity/*}, src/components/{auth/*,account/*,shell/*}, src/app/{sign-in/page.tsx,app/layout.tsx,api/me/route.ts}, src/i18n/messages/{en,he}.ts, scripts/{db,e2e-server}.ts, e2e/{username-accounts.spec.ts (new),google-only,accounts}.spec.ts, playwright.config.ts, deploy/{install-username-login.sh (new),smoke.sh,README.md}, docs/{adr/0012 (new),privacy/data-inventory.md} |
| 2026-11-18 | **What a plan includes is enforced everywhere** (ADR-0013). Found in QA on staging: a Free account could use Measure & Plan although the published catalog (version 2) removed it from Free. Root cause: nothing checked the tool features (`tool.*`): the tool route only checked the session and the studio mounted every tool; saving images (`export.image`) was never checked; GIF exports went ahead when the server could not be asked; the plan comparison and the "all five tools are free" texts came from the code defaults; plans were cached for a minute per process (per bundle layer). Now: entitlements read the published plans on every request; every studio page sends the account fresh (`requireStudioAccount` → `AccountSync`, newer copies only); a tool opens only if the plan includes it, otherwise a locked screen (English/Hebrew, back to Home, compare plans) and lock marks on Home and both navigation bars; an open studio re-checks every minute while in view, on returning to it and from its other tabs; every save and export, and Measure's project file, is authorized by `POST /api/usage` with the tool (checked) and what is exported (counted), failing closed; GIFs authorized before encoding; the account page lists tools one by one when they differ, with real Pro badges; the plan comparison, `/pricing`, landing and sign-in texts follow the published plans (neutral wording if the database cannot be read); the admin user page shows "Can use"; tools take no quotas. Operator CLI: `entitlement-test [--publish-check [--hold N]]` (clean-up fix `3161d2c`) and `temp-testers create|remove`; `login-test` compares with the published Free plan. On staging since 11:34Z (`cccced6`, then `3161d2c`, `cc98437`, `be6890c`): entitlement-test and its publication checks passed over HTTPS (versions 3–6; the live version 6 has the owner's version 2 content), and 7/7 real-browser tests with temporary accounts passed (Free/Pro, routes, fail-closed saves, GIFs, Hebrew, iPhone emulation, a real publication followed by open tabs). The publication check records the live configuration and never publishes over an admin's change (`publishIfUnchanged`); scripts are type-checked in CI. Tests: 19 new unit/integration (real publish path, refusals, fail-closed saves), 10 new e2e on a third staging-like server with staging's catalog (Free/Pro/admin, direct URLs, reloads, plan switch, publish while open, two tabs, revoked sessions, exports, Hebrew, iPhone). Totals: 355 unit/integration, 210 e2e. | src/server/{entitlements.ts,studio-account.ts (new),account.ts,config/catalog.ts,plan-enforcement.test.ts (new)}, src/lib/{plans,account,features-client}.ts, src/app/app/{layout.tsx,page.tsx,[tool]/page.tsx,profile/page.tsx,plans/page.tsx}, src/app/api/{usage,me}/route.ts, src/app/{page.tsx,pricing/page.tsx,sign-in/page.tsx,sign-up/page.tsx,admin/plans/CatalogEditor.tsx,admin/users/[id]/page.tsx}, src/components/shell/{account,Studio,StudioClient,ToolLocked (new),HomeScreen,AppNav,ProfileScreen,PlansScreen,ToolIntro,ToolOpenTracker}.tsx, src/components/{common/SaveMedia.tsx,plans/PlanComparison.tsx,auth/{SignInCard,SignUpCard}.tsx,measure/{MeasurePanel,MeasureMobile}.tsx,grid/GridTab.tsx,value/ValueTab.tsx}, src/features/compare-art/{CompareExportSheet.tsx,useCompareGif.ts}, src/onboarding/OnboardingHost.tsx, src/i18n/messages/{en,he,tools/common,tools/compare}.ts, scripts/{db,e2e-server}.ts, e2e/entitlements.spec.ts (new), playwright.config.ts, deploy/README.md, docs/{adr/0013 (new),privacy/data-inventory.md} |
| 2026-11-18 | **Rolling back never resets or widens the published plans** (ADR-0014; approved by the owner as a standalone security fix). Found while planning Learn and reproduced with `be6890c`: a release that cannot parse a newer release's catalog (an unknown feature ID) fell back to the code defaults, and its migration wrote them to `plans` (Free would regain Measure & Plan, Compare & Correct and GIFs). Now the stored catalog is read tolerantly (`StoredCatalogSchema`, `readCatalog`): unknown feature IDs and sections are kept and never applied, and a known setting that cannot be applied withholds its feature. An unreadable published catalog is never replaced by defaults (`publishedDocument` throws `UnreadableConfigError`; the migration leaves `plans` as it is and reports it). A lost catalog history starts from the plans in force. Drafts, restores and the operator tool keep the stored document; the editor's form is merged (`mergeKnown`, strict validation kept). Admin → Plans explains a catalog it cannot fully apply and turns editing off (`CatalogReadNotice`, `DraftBar blocked`); a readable earlier version can replace an unreadable one. `plans` documents are read fail closed (`planStateOf`). Operator CLI: read-only `catalog-status`; the migration prints how it read the catalog; `entitlement-test --publish-check` restores the stored document exactly. On staging since 15:52Z (`224bb65`, after `9c38661`), no data changed. Verified on real staging: data identical before and after, catalog-status ok, smoke, login-test, read-only entitlement-test, 6/6 browser tests with temporary accounts (no publication: published plans must not change without approval); the rollback scenario on a throwaway copy of staging's data (the hazard with `be6890c`, none with `224bb65`, an unreadable catalog left alone); an instant rollback to `be6890c` and back. Tests: 28 new (21 server, 7 admin UI); totals 384 unit/integration, 210 e2e. | src/server/{config/catalog.ts,config/versions.ts,db/migrate.ts,entitlements.ts,catalog-rollback.test.ts (new),db/database.test.ts}, src/app/admin/{config-actions.ts,ConfigControls.tsx,plans/page.tsx,plans/CatalogReadNotice.tsx (new),plans/CatalogReadNotice.test.tsx (new)}, scripts/db.ts, deploy/{README.md,RELEASES.md}, docs/{adr/0014 (new),adr/README.md,security/catalog-rollback-safety.md}, PROJECT.md |
| 2026-11-18 | **Create a Grid improvements (Learn plan, milestone M1; approved by the owner).** Rotate the image left or right 90° or by 180° (only the drawing turns, never the stored photo); exact A4 portrait and landscape (21 × 29.7 cm); **square cells** of a set size (a fourth preset, typed or by steps, a partial cell at the right and bottom edges); **Save blank grid** (the same lines in black on white, without the photo, for paper), through the same authorized save as the grid image (`tool.grid` + `export.image`, failing closed); exact zoom (−/+ 1 %, 25–800 %, typed) and moves by 0.1 of the unit, beside drag, pinch and wheel. The geometry and drawing moved into `src/lib/grid` (`geometry.ts`, `draw.ts`), shared by the preview, the saved image and the blank grid; grids saved before M1 get the new settings' defaults (`normalizeGridSettings`) and nothing else changes. The Customize panel's controls now have names for screen readers (axe found them missing). Proof: `draw.test.ts` replays the code of 224bb65 and requires the same canvas calls, bit for bit, for 90 grids saved before; locally, 224bb65 and M1 saved five such grids as byte-identical PNGs, and the preview's canvas calls match the earlier first pass (the earlier preview drew the grid twice over itself on first load; now every redraw starts clean). On staging since 17:24Z (`6f2159a`, after `f2f7b91`), no data changed, published plans unchanged; 8/8 real-browser M1 checks with temporary accounts (rotation and the blank grid read back from the saved PNGs, Hebrew, axe, iPhone emulation) and the earlier plan-enforcement checks. Tests: 24 new unit, 9 new e2e (Chromium + WebKit iPhone), the blank grid refused when a plan loses saving images; totals 408 unit/integration, 219 e2e. | src/lib/grid/{geometry,draw}.ts (new, with tests), src/components/grid/{GridTab.tsx,GridTab.test.tsx (new)}, src/types/project.ts, src/hooks/useProjectStore.tsx, src/i18n/messages/tools/grid.ts, e2e/{grid.spec.ts (new),entitlements.spec.ts}, playwright.config.ts, deploy/RELEASES.md, docs/learn/*, PROJECT.md |
| 2026-11-18 | **Create a Grid's A4 PDF (Learn plan, milestone M2; approved by the owner).** A two-page A4 PDF from Create a Grid: the reference with its grid, then the same grid blank, for paper. Both pages share one frame, the same grid lines as PDF vectors (square cells and partial edge cells included) and a 50 mm calibration bar with end marks; the canvas prints at true size when it fits inside 12.7 mm margins and a 21 mm band for the words, otherwise reduced (never enlarged), and the page says which, with a square's size on paper; the orientation that prints larger is chosen; the PDF asks viewers to print without scaling. The photo is placed by the same function as the saved grid image (`imageRect`) at 300 dpi, as JPEG. Words are drawn by the browser as images in English or Hebrew (right to left: parts joined with a right-to-left mark, which WebKit's canvas honours where it ignores isolates; no brackets in the Hebrew on the pages). **jsPDF 4.2.1**, pinned and security-reviewed, loads only after the server authorizes a PDF (133 KB gzipped; its html2canvas, DOMPurify and canvg never load); `@babel/runtime` 7.29.13 and `dompurify` 3.4.17 pinned under the 14-day rule. New feature ID **`export.pdf`** ("Grid PDFs (A4)") in no plan until the owner publishes it (admins have it); every PDF is authorized by the server first (`tool.grid` + `export.pdf`) and fails closed; the button shows only where it can be had, or as Locked where another plan has it; the plans page lists PDFs only once a plan offers them. The save sheet has a PDF variant: a picture of both pages, Save PDF on computers, Share or print on phones and tablets, Open to print. ADR-0015 (decisions A5 and A17). On staging since 18:47Z (`d261013`), no data changed, published plans unchanged, no publication; 5/5 real-browser PDF checks with temporary accounts (the server's refusal for real; the PDF made by staging's build with the server's yes simulated in the test browser) and the M1 (8/8) and plan-enforcement (6/6) checks again. Tests: 28 new unit (the PDFs read back from the files by `src/test/pdfInspect.ts`), 11 new e2e (Chromium + WebKit iPhone: exact A4, one frame and the same lines on both pages, the bar exactly 50 mm, the photo placed as in the saved PNG when turned, zoomed, moved and filled, Hebrew, failing closed, a plan published for Pro and withdrawn); totals 436 unit/integration, 230 e2e. | src/lib/print/{paper,gridPdf,gridPdfBrowser}.ts (new, with tests), src/test/pdfInspect.ts (new), src/lib/{plans,saveMedia}.ts, src/lib/grid/geometry.ts, src/components/{grid/GridTab.tsx,common/SaveMedia.tsx,shell/ProfileScreen.tsx} (+ tests), src/i18n/messages/{en,he}.ts, src/i18n/messages/tools/{common,grid}.ts, src/server/{plan-enforcement,catalog-rollback}.test.ts, src/server/db/database.test.ts, e2e/{grid,entitlements}.spec.ts, package.json, docs/adr/0015-print-foundation-grid-pdf.md (new), docs/security/{dependency-audit,catalog-rollback-safety}.md, docs/learn/*, deploy/{README,RELEASES}.md, PROJECT.md |
| 2026-11-18 | **Prepare Worksheets (Learn plan, milestone M3; approved by the owner), and Study's saves fixed.** Before M3, as the owner asked: Create a Grid's "Save PDF (A4)" button is hidden (`GRID_PDF_BUTTON`, src/lib/print/ui.ts); the PDF code, `export.pdf` and their tests stay. **Prepare Worksheets**, from Create a Grid (beside the image saves; "Worksheets" on phones) and Study & Simplify (header; the Adjust sheet on phones): the original, a clean outline, the reference with its grid, an optional blank grid and a values study (3 or 5 values), saved as **PNG images** (the owner's choice over the planned PDF), every sheet the size of Create a Grid's saved image with the photo where that image has it, so they line up. Nothing is drawn twice: the grid sheets are Create a Grid's images (the reference sheet equals "Save grid image" byte for byte); the outline is Study's Clean Outline from the sketch engine's paths (`drawPaths`, shared with Study's PNG save); the values are Study's Values algorithm, moved out of `ValueTab` unchanged into `src/lib/values/posterize.ts` (A12: a golden test runs the old code beside it over 1,920 combinations; Study's saved files were byte-identical before and after, 21 files). New feature `export.worksheets` ("Worksheets") in no plan until the owner publishes it (admins only); a set asks the server first (the other tool its sheets use, checked, then the tool it came from with Worksheets and Saved images) and fails closed. Choices remembered on the device, the photo never; phones share all sheets in one share sheet; "Save all" downloads 400 ms apart (WebKit keeps only the last of downloads started together). **Fixed:** Study & Simplify's study, palette and study sheet saves had done nothing since the CSP of 2026-11-11 (`fetch()` of a data: URL is a refused connection): `dataUrlToBlob` decodes in the page. ADR-0016. On staging since 21:04Z (`8576f66`, after `ab2f5aa`), no data changed, published plans unchanged, no publication; 6/6 real-browser M3 checks with temporary accounts (refusals for real, Study's saves for real, a set from staging's build with the server's yes simulated in the test browser), M1 8/8 and plan enforcement 6/6 again. Tests: 45 new unit/integration, 18 new e2e (Chromium + WebKit iPhone); totals 481 unit/integration, 239 e2e (9 PDF interface tests skipped by the switch). | src/lib/values/posterize.ts (moved, with golden test), src/lib/worksheets/{sheets,browser}.ts (new, with tests), src/components/worksheets/PrepareWorksheets.tsx (new, with tests), src/lib/print/ui.ts (new), src/components/{grid/GridTab.tsx,value/ValueTab.tsx,common/SaveMedia.tsx,shell/ProfileScreen.tsx}, src/lib/{plans,saveMedia}.ts, src/lib/sketch/browser.ts, src/i18n/messages/{en,he}.ts, src/i18n/messages/tools/worksheets.ts (new), src/server/*.test.ts, e2e/{worksheets,study}.spec.ts (new), e2e/{grid,entitlements}.spec.ts, playwright.config.ts, docs/adr/0016 (new), docs/adr/0015, docs/learn/*, docs/security/catalog-rollback-safety.md, deploy/{README,RELEASES}.md, PROJECT.md |
| 2026-11-19 | **Learn screens (Learn plan, milestone M5; approved by the owner), dark-launched** (ADR-0018). A studio view at `/app/learn/...`, shown only to accounts some published plan offers a Learn module to (today: admins), reached from Home ("Learn to draw") and the desktop top bar (phones: Home). **Screens:** the Learn home (Start/Continue from one's own completions, Random, Quick, class mode); the drawing course; the challenges (level, subject, pencil or color, quick only, remembered on the device); exercise and challenge cards with the reference full screen and zoom, the short task, More help, tool shortcuts, Prepare worksheets or Use my photo, Mark as completed with Undo, Another one; My history; the locked page ("Part of Pro", "Locked"). Every screen reads only the Learn API (decided per request); pages never carry content. **Tools:** a shortcut hands the reference to Measure & Plan, Study & Simplify, Create a Grid or Compare & Correct (asking before replacing a photo); saves from it name the item in `/api/usage`, so they are refused once it is no longer open. **History:** `learn_completions` via `/api/learn/completions` (own entries only, an open item only, at most 10,000; in the data download, removed with the account). **Class mode:** per browser tab, off after 12 idle hours; no history requested or written; worksheets gain "Next student". English and Hebrew, desktop, tablet and phone, axe WCAG 2.1 AA. On staging since 2026-11-19 10:46Z (`ab42467`), verified with temporary Free/Pro/Hebrew accounts (deploy/RELEASES.md); no plan or content published. |
| 2026-11-19 | **Lessons that teach (Learn plan, milestone M6a; approved by the owner after the M6 design review), dark-launched** (ADR-0019; docs/learn/08). The owner found the course and the challenges alike (a picture, "copy it"). An exercise with steps is now a lesson: what you'll learn, See it (one picture at a time), Do it (numbered steps with the subject, tool links that open Study & Simplify or Create a Grid set as the step needs, with "Back to Lesson n", and the worksheet), Check it (ticked for oneself, never saved), the common mistake with its picture, Done when, Next; nothing folded but credits. The course is in units with their level, goal and "x of y done", "Up next", and D-START-01 as an optional, unnumbered baseline (Lesson 1 is pencil control). Two doors on the Learn home and Home ("Start: Lesson 1 · …"), class mode at the bottom; challenges with a Skill filter (the course's units), focus lines and "Builds on"; "Lesson" (שיעור) replaces "Exercise". Content additions only, read by M5 too (rollback-safe, tested). Test content version 2: the three lessons rewritten with diagrams drawn in code and annotated CC0 references (private seed), the three challenges linked. On staging since 2026-11-19 14:52Z (`54e2a16`), verified with temporary Free/Pro/Hebrew accounts (deploy/RELEASES.md); no plan published. |
| 2026-11-19 | **Beginner lessons (the M6a revision; approved by the owner after reviewing M6a), dark-launched** (ADR-0020; docs/learn/09). The owner found M6a "pedagogically too advanced and visually too dense" for a 15-year-old who has never held a pencil. The course becomes six stages from absolute zero (pencil and lines, flat shapes, simple 3-D forms, value and light, observation, realistic drawing; colour and art history later), in micro-lessons of one small skill. The lesson page: the objective, one picture, "Your task" in 1–3 lines, "Make something" (a small creative use of the skill), "Done when", and one button, "I did it — next lesson", which records the person's own word once a day (never in class mode) with "Marked as done … Undo" and never implies the drawing was assessed; the rest is behind "Need help?" (the mistake and its picture, why, what you need, tools, more practice, credits). An optional A4 practice sheet per lesson; every task works on any paper. Publishing: one picture, 1–3 task lines, no self-checks; drafts are no longer numbered. Test content version 3 (private seed): D-HAND-01, D-LINE-01, D-LINE-02, D-FLAT-01, D-FLAT-02 with code-drawn pictures and wordless sheets, starter challenges CH-051 and CH-052; the three M6a lessons unpublished, nothing deleted. On staging since 2026-11-19 17:28Z (`a748e6d`), verified with temporary Free/Pro/Hebrew accounts (deploy/RELEASES.md); no plan published. |
| 2026-11-19 | **The 15-lesson beginner course (the founder's sprint brief, deadline 2026-11-26), dark-launched** (docs/learn/10). Lessons 6–15 of the approved curriculum, as private test content version 4. Stage 2, drawing with shapes: D-BUILD-01…03. Stage 3, simple 3-D forms: D-FORM-01; D-LINE-04, which is M6a's glass lesson rewritten for the same skill; D-FORM-02; D-FORM-03; D-SHAPE-03. Stage 4, values: D-VAL-01 and D-VAL-02. Each has a code-drawn picture, a picture of its common mistake and a wordless A4 practice sheet. The units are regrouped into the approved stages: lessons 1–5 are stage 1, and lesson 1 is retitled "Light, medium and dark lines", which it already taught. The challenges are linked to the lessons they build on, CH-002 moves to intermediate, and two starter challenges are new (CH-053, CH-054). Nothing is deleted. Lessons 16–29 are specified in the private curriculum specification. One code change: the Learn screen scrolls up and down only. Right to left, WebKit with visible scrollbars had counted the scrollbar's width as sideways overflow (5 px on every Learn screen in Hebrew); a Hebrew phone test covers it. No schema, route, dependency, catalog or plan change. Release and verification: deploy/RELEASES.md. | `src/components/learn/LearnView.tsx`, `e2e/learn-screens.spec.ts`, `docs/learn/10-beginner-course.md`, `docs/learn/{00-review,02-curriculum,03-challenges,07-phases-qa-approvals,README}.md`, `deploy/RELEASES.md`, `PROJECT.md` |
| 2026-11-20 | **Lessons 16–29 of the beginner course (approved by the founder after reviewing lessons 1–15), dark-launched** (docs/learn/10). Built in three batches, each its own private test content version, checked locally and published on staging for admins only. v5: light and shadow (light on a box first, then a ball, core and cast shadow, a cylinder). v6: drawing from observation (an outline, big shapes and negative space with M6a's D-SHAPE-01 rewritten, comparing, measuring with the pencil, a cup and a still life). v7: the first realistic drawing (proportions in a CC0 photo, the grid method opening Create a Grid at 4 × 4, building and shading an eye, a finished drawing). Each lesson has a code-drawn picture, a picture of its common mistake and a wordless A4 sheet. No code change; catalog and plans unchanged; Free and Pro refused everything. | `docs/learn/10-beginner-course.md`, `docs/learn/{02-curriculum,03-challenges,07-phases-qa-approvals,README}.md`, `deploy/RELEASES.md`, `PROJECT.md` |
| 2026-11-23 | **Admin Panel Phase 1, local only (not committed or deployed), on top of the uncommitted Manual Pro work.** **Sign-in renewal fixed after a diagnosis:** a server-rendered page renewed the session in the database but could not write the cookie (Better Auth's Next.js plugin skips it silently), so the browser's 30-day cookie never moved; pages now never renew, and a small client call (`SessionKeepAlive`, studio and admin) renews through Better Auth's own `/api/auth/get-session`, which writes both. **Trusted admin devices** (2FA): after a code, a random token in a `__Host-` HttpOnly cookie (hash stored) lets that device's new sessions skip the code, for the same account only, until 30 days unused or 90 days after its last code; listed and forgotten in Admin → Security; ends with 2FA off, the server reset, the admin role, or "Shared device? Sign out…". **The owner** (`users.owner`, server command line only): only the owner changes roles; other admins cannot change the owner's account. **Profile** for admins: full access instead of a Free plan, its lists and upgrade offers; 2FA status and trusted devices. **Manage access**: one control with Free (end manual Pro) next to Pro 7/30/90/no end date; the list shows last active. The landing page offers "Open the studio" to someone signed in. Also fixed: the server command line's `set-plan` no longer fails the scripts type check (found now; from the Manual Pro work). | src/server/{session,admin-mfa,admin-device-cookie (new),admin,account}.ts, src/server/db/{collections,migrate}.ts, src/components/shell/{SessionKeepAlive (new),ProfileScreen,account}.tsx, src/app/app/{layout.tsx,profile/actions.ts}, src/app/page.tsx, src/app/admin/{AdminShell,AdminControls,page,actions,format}.tsx/ts, src/app/admin/users/[id]/page.tsx, src/app/admin/security/{page,actions,MfaSettings,TrustedDevices (new),TrustCheckbox (new),trust (new)}, src/app/admin/verify/VerifyForm.tsx, src/lib/account.ts, src/i18n/messages/{en,he}.ts, scripts/{db,e2e-server}.ts, tests (admin-mfa, admin-users, saas; e2e admin-mfa, admin, accounts, auth, entitlements, username-accounts), docs/security/admin-2fa.md, docs/privacy/data-inventory.md, docs/roadmap/01-data-model.md |
| 2026-11-22 | **Challenges V2: the creative playground (the founder's brief), dark-launched** (ADR-0021; docs/learn/11). The Challenges screen opens on "Need an idea?": four moods (Something light / Let me create / Challenge me! / Surprise me 🎲; in Hebrew the founder's words), which are efforts, never skill ratings; the challenge's existing `level` is read as that effort and relabelled Light / Creative / Challenging. Spin picks one open idea, never the one on screen and not the last 8 spins while others remain, after a 1.2 s reel of titles (none with reduced motion; hidden from screen readers, which hear the result). The idea shows its category, effort, task, an optional twist (a new optional content field, at most 140 characters, both languages), its tip (`focus`) and skill, then Save, Mark as completed (the existing one), Open, and an optional timer: 10/30/60 minutes or a stopwatch, kept as wall-clock timestamps in this browser and worked out from the clock whenever the page is seen (right after a reload, a locked phone or hours away), with pause, resume, reset and a kind "Time's up" that lets drawing go on; no notifications, sounds or server timer. Saved ideas (one store for the page, other tabs follow), the mood, the idea on screen and recent spins stay in this browser, and "Sign out and clear this device" removes them. The list below gains a Saved filter; the Random and Quick buttons above it are replaced by the playground. Content: 60 original ideas in 8 categories (CH-055…CH-114, private, with provenance), published on staging as content version 10 on top of the owner's version 9 by a guarded operator script; the course, the 7 existing challenges, plans, catalog and access unchanged. No dependency, route, collection or plan change. Release and verification: deploy/RELEASES.md. | `src/components/learn/{Playground.tsx (new),ChallengeTimer.tsx (new),filters.ts (new),ChallengesScreen.tsx,ItemScreen.tsx,ItemParts.tsx,data.ts}`, `src/lib/learn/{roulette.ts (new),timer.ts (new),model.ts}`, `src/lib/learn/{roulette,timer}.test.ts (new)`, `src/lib/device-data.ts`, `src/lib/device-data.test.ts (new)`, `src/server/learn/{content,present}.ts`, `src/server/learn/completions.test.ts`, `src/test/learn-fixture.ts`, `src/i18n/messages/learn.ts`, `scripts/e2e-server.ts`, `e2e/{learn-screens,entitlements}.spec.ts`, `docs/adr/0021-challenges-creative-playground.md (new)`, `docs/learn/11-challenges-v2.md (new)`, `docs/learn/{03-challenges,README}.md`, `docs/adr/README.md`, `deploy/RELEASES.md`, `PROJECT.md` |
| 2026-11-19 | **Learn foundations (Learn plan, milestone M4; approved by the owner), dark-launched.** Learn's server side, before any Learn screen. **Content:** a versioned kind `learn_content` (groups, exercises, challenges, English and Hebrew) with draft, publish, history and restore like the plan catalog; checked at save and publish (IDs, both languages, groups, assets with complete licences and their files); a published item is never deleted, and restoring keeps later items, unpublished. **Assets:** files outside the app and `public/` (`LEARN_ASSETS_DIR`), named by SHA-256, written atomically, never changed; checked by their bytes (type, size, dimensions, no embedded metadata); licence required (https links only). **Access:** three module features in no plan, and a Learn section in Admin → Plans (All / None / Selected per plan and collection, made with First N, a group or picking, frozen when published; what locked items show; effective access; the items each plan gains and loses), read like the rest of the catalog (ADR-0014; a catalog without it opens nothing, so nothing was migrated). One resolver decides every request. **Routes:** `/api/learn/items`, `/api/learn/items/<id>`, `/api/learn/assets/<sha256>` (re-authorized every time), `learnItem` in `/api/usage`; a per-account limit. **Admin → Learn**: versions, changes (warns before unpublishing a listed item), items, assets with licences, what each plan opens. **Operators:** `learn-import`, `learn-status`, `learn-publish`, `learn-discard`; `entitlement-test` covers Learn; the asset directory, its nightly incremental backup and the restore drill with `--assets` (`deploy/install-learn-assets.sh`, `backup-learn-assets.sh`). The owner's decisions: 3 exercises and 3 challenges as test content; verified CC0/public-domain images only, rights recorded (4 CC0 references from The Cleveland Museum of Art, kept outside the repository with SOURCES.md); content publishable on staging, no plan setting changed; Learn None for Free and Pro; backup and restore verified; Worksheets on its own from Home recorded for later (A20). ADR-0017. On staging since 02:37Z (`324e136`): content version 1 published (admins only), catalog and plans identical before and after (update times included); smoke 25/25, `login-test` 13/13, `entitlement-test` 20/20 before and after the content; the backup and restore drill restored the database and all 8 files exactly; real browsers 3/3 for M4, and M1 8/8, M3 6/6, plan enforcement 6/6 again. Tests: 41 new unit/integration, 8 new e2e; totals 522 unit/integration, 247 e2e (9 skipped). | src/lib/learn/{model,access}.ts (new), src/server/learn/{content,assets,import,live,present,request}.ts (new), src/server/config/{learn-access,catalog,versions}.ts, src/server/{entitlements,env}.ts, src/server/db/{collections,migrate}.ts, src/server/security/throttle.ts, src/app/api/learn/** (new), src/app/api/usage/route.ts, src/app/admin/learn/page.tsx (new), src/app/admin/plans/{LearnAccessEditor (new),CatalogEditor,page}.tsx, src/app/admin/{AdminShell,ConfigControls}.tsx, src/app/admin/config-actions.ts, src/lib/plans.ts, src/components/{common/SaveMedia,shell/ProfileScreen}.tsx, src/i18n/messages/{en,he}.ts, src/test/{png,learn-fixture}.ts (new), tests, scripts/{db,e2e-server,learn-commands}.ts, e2e/{learn (new),entitlements}.spec.ts, deploy/{install-learn-assets,backup-learn-assets (new),restore-drill,smoke}.sh, docs/adr/0017 (new), docs/learn/*, docs/ops/backups.md, docs/security/catalog-rollback-safety.md, deploy/{README,RELEASES}.md, PROJECT.md |
| 2026-11-17 | **Color & Mixing: the wheel and the harmonies on one screen.** The Color Wheel and Harmonies tabs are joined into one, "Wheel & Harmonies" (tabs: Wheel & Harmonies, Mixing, Skin Tones). The wheel, its saturation/brightness square and the HEX field sit beside all six harmony cards on tablets and desktops (all in view at 1280×720) and above them on phones (two cards per row, nothing wider than a 320 px screen). Every change of the colour (ring, square, keyboard, HEX, eyedropper, a Mixing or Skin Tones swatch, the hand-off from Measure) updates every card at once; the harmonies are derived, never stored. A card shows its colours as dots on the wheel at their hues, with a small ring on each card showing the same; tapping a dot makes that colour the base, which is what clicking a harmony swatch used to do. A click on a swatch now copies its HEX (before, it changed the base and nothing copied; only the Copy HEX button did, silently), with "Copied" on the swatch and a status line for screen readers; the Copy HEX button shows a check. The wheel's ring and square are now also keyboard sliders. Colour arithmetic moved unchanged to `colorMath.ts` and `harmonies.ts`. The tour's harmony step points at the cards. The "Selected color / Change" strip and the "See harmonies" button are gone with the Harmonies tab. Visual parity with the pre-migration app no longer covers Color. Tests: 23 new unit tests (results identical to a frozen copy of the original code over 18,616 colours; reactive updates; keyboard; dots; copying, its fallback and failure; Hebrew; Mixing, Skin Tones, Measure hand-off, eyedropper), 13 new e2e runs (Chromium desktop and phone, WebKit iPhone: layout, dragging, dots at their hues, clipboard, Hebrew, 320 px, axe). Totals: 303 unit/integration, 184 e2e. | src/components/color/{ColorTab.tsx,ColorWheel.tsx (new),HarmonyCards.tsx (new),colorMath.ts (new),harmonies.ts (new),useCopyHex.ts (new)}, src/i18n/messages/tools/{color,common}.ts, src/onboarding/onboardingConfig.ts, e2e/{color.spec.ts (new),i18n.spec.ts,visual-parity.spec.ts}, playwright.config.ts, PROJECT.md |
| 2026-11-24 | **Learn CMS in Admin → Learn, with each item's own access (the founder's brief "Complete Production Learn CMS"; Admin Panel decisions 1 and 4 of 2026-11-23).** **Access:** every lesson and challenge has one mode, the only setting that decides who opens it: Free (every signed-in account), Pro (Pro accounts: paid, given or assigned; listed locked to others, with the upgrade), Admin only (admins, for checking), Blocked (nobody in the studio, admins included; Admin → Learn previews it); archived items are in the studio for nobody. The same rule set answers lists, direct links, the item API, pictures, completions and exports. Admin → Plans only sums Learn up (its Learn modules and rules are no longer settings; kept in the stored catalog for older releases, and deciding only items without a mode, exactly as before). **Editing:** Admin → Learn's tables (search by ID or either title, filters by group, access and status, an inline Access selector with Undo, up/down within a group, Edit, Preview, Duplicate, Archive/Restore) and an editor (every lesson and challenge field in English and Hebrew; pictures uploaded from the browser — re-saved, metadata stripped, checked again by the server — replaced, reordered, removed; practice-sheet PDFs; tool buttons and presets; a phone-size layout). Every save is live at once as a new version (guarded publication; a change to another item merges, a change to the same item since it opened is refused with the typed text kept); new items take the next unused ID and start Admin only; Free and Pro need both languages. **History:** each version records the items it changed (backfilled by the migration); an item's earlier copy, or the whole content as an earlier version, can be restored (IDs added since stay, archived). **Rollback:** the old `published` flag is kept true only for Free items, so a release before this never opens more. **Operators:** `learn-access status | write-modes | set <mode> --all|<IDs> | align-catalog` (dry run first, then `--apply`), `learn-export`, `counts`. Also fixed on the way: the Admin → Learn page no longer scrolls sideways on a phone; Safari now opens the picture picker; admin history dates no longer mismatch between server and Safari (also in Plans and Pricing). ADR-0023. | src/lib/learn/{model,access,placement (new)}.ts, src/server/learn/{content,editor (new),live,present,assets}.ts, src/server/{entitlements,account,request}.ts, src/server/config/{catalog,versions}.ts, src/server/db/{collections,migrate}.ts, src/app/admin/learn/{page,LearnManager (new),ItemEditor (new),LearnVersions (new),fields (new),form (new),images (new),types (new),actions (new)}.tsx/ts, src/app/admin/{when (new),ConfigControls,config-actions}.ts(x), src/app/admin/plans/{CatalogEditor,page}.tsx (LearnAccessEditor removed), src/app/api/admin/learn/assets/route.ts (new), src/app/api/learn/items/**, src/components/learn/{ItemScreen,LearnHome,LearnOnHome,ChallengesScreen,CurriculumScreen,data}.ts(x), src/i18n/messages/learn.ts, scripts/{db,learn-commands}.ts, tests (access, placement, editor, learn, lessons, completions, database; e2e learn, learn-screens, entitlements, learn-admin (new)), playwright.config.ts, docs/adr/0023 (new), docs/adr/README.md, deploy/README.md, PROJECT.md |
| 2026-11-24 | **Sketchy, the studio companion (the founder's brief "Sketchy — The Intelligent Studio Companion"; ADR-0024).** The fox artist of the official character sheet as a layered SVG puppet with a pose engine and 14 animations (walk, run, jump, sit, rest, wave, laugh, think, curious, celebrate, hold a sign, point, draw, plus blinking, breathing, tail and ears), living on Home's hero and the Learn home's header beside the text, never over the navigation, the tool cards or work; celebrations in the corner after saves and completions elsewhere. A menu (surprise me, drawing tips, challenge roulette, improve my drawing, choose a tool, recommend a lesson, practice sheets, preparing a class, who you are, hide), an animated roulette of the challenges the account may open, contextual suggestions with real buttons (a fixed list of safe actions, each checked against the account's real access), a pace an admin sets (quiet time, cooldown, daily cap, snooze). New Admin → Companion: on/off, size, pace, animations with previews, per-capability access (Free, Pro, Admin only, Blocked; all Free), tips in English and Hebrew; every save live as a new version with history and restore. The person can hide him (account page brings him back) and say whether they come as an artist, a student or a teacher. Reduced motion, keyboard, RTL. | src/components/companion/* (new), src/lib/companion/* (new), src/server/companion/* (new), src/app/admin/companion/* (new), src/app/api/companion/route.ts (new), src/app/api/me/companion/route.ts (new), src/components/account/CompanionCard.tsx (new), src/i18n/messages/companion.ts (new), src/i18n/messages/{en,he}.ts, src/lib/{account,device-data}.ts, src/server/{account,account-management}.ts, src/server/db/collections.ts, src/components/shell/{HomeScreen,Studio,ProfileScreen,account}.tsx, src/components/learn/{LearnHome,ItemScreen,ItemParts,LessonCard,parts}.tsx, src/components/grid/GridTab.tsx, src/components/common/SaveMedia.tsx, src/app/admin/AdminShell.tsx, src/index.css, scripts/e2e-server.ts, playwright.config.ts, tests (brain, registry, geometry, clips, engine, companion database; e2e companion, companion-admin), docs/adr/0024 (new), docs/adr/README.md, PROJECT.md |
