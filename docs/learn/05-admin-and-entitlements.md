# 05 — Admin control and Free/Pro entitlements for Learn (proposal, for approval)

## 1. Status of the earlier staging bug (investigated first)

The bug: on staging, a Free account could open and use Measure & Plan
although the published plan catalog (version 2) removed it from Free.

- **Root cause (2026-11-18):** no code checked the tool features
  (`tool.*`): the tool route verified only the session, the studio mounted
  every tool, image saves were never checked, GIF exports failed open, plan
  pages read the code defaults, and plans were cached for a minute per
  process.
- **Fix:** ADR-0013, commit `cccced6`, live on staging since 2026-11-18
  (now `be6890c`).
  - Every studio page sends the account fresh from the database.
  - A tool opens only if the published plan includes it.
  - Every save and export is authorized by the server first and fails
    closed.
  - Plans are read on every request, and open tabs follow changes.
- **Verified on real staging (2026-11-18, temporary accounts, real
  browsers):** 7/7 browser tests and 32/32 server checks. They covered:
  - direct URLs, reloads and navigation;
  - refused exports and fail-closed saves;
  - a real publication followed by tabs left open (revoked and granted
    while open);
  - Hebrew, and iPhone emulation.

  Locally: 356 unit/integration and 210 end-to-end tests.
- **Not verified:** the owner's own accounts (Tomerfree, Tomerpay), the admin
  dashboard with the owner's session on staging, a real iPhone.
- **Conclusion:** Learn reuses this mechanism; it adds no second
  authorization system.
  - `getEntitlements` stays the only decision about plans.
  - Learn adds one function on top of it: which items of a collection the
    account may open.
  - It uses the same page pattern (server pages that send fresh data,
    locked screens) and the same export authorization (`/api/usage`,
    fail closed).

## 2. Two levels of control, one decision

| Level | What it controls | Where the admin sets it | Already exists? |
|---|---|---|---|
| **Feature** | Whole modules (drawing curriculum, colour module, challenges) and the two print exports | Admin → Plans (the existing catalog editor) | The mechanism yes; the new feature IDs no |
| **Item** | Which exercises and challenges inside a module each plan opens | Admin → Learn → Access (new, same draft/publish model) | No |

Both are versioned drafts that apply only when published (ADR-0006), audited
with version numbers, and read by the server on every request.

### New catalog features (code)

| Feature ID | Meaning |
|---|---|
| `learn.curriculum` | The drawing curriculum (Units 0–10) |
| `learn.color` | The colour module |
| `learn.challenges` | The challenge library |
| `export.pdf` | Print-ready PDF from Create a Grid (image with grid, blank grid) |
| `export.worksheets` | Prepare Worksheets packages (multipage PDF from one image) |

Quotas (per day or month) are available on the two exports, exactly as on
image and GIF saves today. Modules take no quotas (on or off, like tools).

**Dark launch:** the migration adds these features to no plan. Until an admin
publishes a catalog version that includes them, only admins see Learn and
the PDF exports. Turning them on for Free or Pro is a deliberate,
reviewable publication.

### The Learn access configuration (new versioned kind `learn_access`)

For each collection (curriculum, colour, challenges) and each plan (Free,
Pro), exactly one rule:

| Rule | Meaning |
|---|---|
| **All** | Every published item in the collection |
| **None** | No item (the module may still be on, showing everything locked) |
| **First N** | The first N published items in the collection's order (A — the numeric control) |
| **Selected** | Exactly the listed item IDs (B — explicit per-item control) |

Plus one global setting: what a **locked item shows in lists** — the title
only, or the title and a small thumbnail.

Suggested first values (only a suggestion; the admin decides):

- Free: First 3 of the curriculum; Selected CH-002, CH-012 and CH-017 for
  challenges; None for colour.
- Pro: All, everywhere.

### Precedence (complete, no overlaps)

1. **Administrator** → everything, including items not yet published (shown
   as drafts to admins only).
2. **Item not published** → nobody else sees it.
3. **Account not active** (signed out, suspended) → nothing (as today).
4. **Module feature missing from the plan in force** → every item of that
   module is locked for that account.
5. **The plan's rule for the collection** → decides each item: All, None,
   First N or Selected. There is one rule per collection and plan, so two
   settings can never disagree.
6. **Exports** → a worksheet package needs `export.worksheets`. If its image
   comes from a Learn item, that item must also be open to the account. A
   teacher's own photo needs only the feature.

The plan in force is the existing one: the best of the assigned plan, an
active subscription and a live grant. A Pro grant therefore opens Pro items.

"First N" and "Selected" do not combine; the admin chooses one per
collection and plan. The editor offers "Select the first N" as a shortcut
that turns First N into an explicit list, which the admin can then adjust.

### Validation when publishing

- Every selected ID must exist and be published, or the draft cannot be
  published.
- N must be at least 1. More than the number of published items is allowed
  with a warning ("Free gets everything").
- The diff lists, per plan, the items gained and lost. For example: "Free:
  gains CH-017; loses D-OBS-02".
- Publishing content that removes an item which a "Selected" rule names
  warns before it publishes.

## 3. Visibility is not authorization

| What | Locked account receives | Open account receives |
|---|---|---|
| Lists (curriculum, challenges) | ID, titles, level, skill, lock reason; thumbnail only if previews allow | Everything for the card |
| Exercise or challenge page | The locked screen; no instructions, guide or reference | The full card |
| `GET /api/learn/items/<id>` | 403, naming the missing feature or rule | The item's content |
| `GET /api/learn/assets/<id>` (full-size reference) | 403 | The image (`Cache-Control: private, no-cache`, re-authorized on every request) |
| Thumbnails | Only when previews allow; small size only | Small size |
| Worksheet PDF | Refused by `/api/usage` before anything is made (fail closed) | Authorized and counted |

- Reference assets are **never** in `public/`: there is no static URL to
  guess or share.
- Server pages build lists only from what the account may see; tests check
  that locked content is absent from the HTML and the page data sent to the
  browser, not only hidden.
- A locked item's protected assets cannot be reached by direct request, an
  old link or a stale tab: every request is authorized at the moment it
  arrives.

## 4. Stale sessions, plan changes and open tabs

Learn uses the ADR-0013 mechanisms unchanged:

- Learn pages are server pages, so every navigation re-checks.
- The studio's account copy refreshes every minute while in view, when the
  tab comes back into view, and from the account's other tabs.
- An open exercise whose access ends switches to the locked view on its next
  refresh. Its protected image and any export are refused by the server
  even before that.
- Suspension, sign-out everywhere and session expiry work as today: the next
  request leads to sign-in.

## 5. Admin screens

- **Admin → Plans** (existing): five new rows: the three Learn modules and
  the two PDF exports, with Free/Pro switches; quotas on the exports.
- **Admin → Learn → Access** (new):
  - per collection, a Free/Pro rule picker (All, None, First N with a number,
    Selected with a searchable item picker showing ID, title, unit or group,
    level, and published state);
  - the preview setting;
  - an "Effective access" panel per plan ("Free will see: D-START-01,
    D-LINE-01, D-LINE-02");
  - draft, diff, publish, history and restore, as on the catalog.
- **Admin → Learn → Content** (new):
  - exercises and challenges with English and Hebrew fields side by side,
    with required-field checks in both languages;
  - order within the collection;
  - references: upload, preview, and licence metadata required before
    publishing (see 06 §11);
  - draft, publish, history and restore, with a full-content diff.
- **View as**: an admin can preview a Learn page as Free or as Pro, for QA.
  It changes nothing about the admin's own access.
- Everything is audited by type and version number: content saved and
  published, access published, assets added and removed.

## 6. Pricing stays the owner's decision

Nothing here sets a price, a plan or a default access policy for launch:
those are the approval checkpoints in 07. Billing and public sign-up stay
exactly as they are.
