# 06 — Technical architecture (proposal, for approval)

Inspected on 2026-11-18 at `be6890c` (branch `migration/nextjs-saas-foundation`).
Every "today" statement below was checked in the code; file paths are given
so each can be re-checked.

## 1. What exists and what Learn reuses

| Area | Today | Learn reuses it as |
|---|---|---|
| Studio shell | One client app under `/app` (`src/app/app/layout.tsx`, `src/components/shell/Studio.tsx`); tools stay mounted while the URL moves; every page sends the account fresh (`requireStudioAccount` → `AccountSync`, ADR-0013) | Learn is another studio view (`/app/learn/...`), so tools keep their work behind it |
| Entitlements | `getEntitlements` (src/server/entitlements.ts) from the database only; plans read on every request; `/api/usage` authorizes and counts saves and exports, failing closed | The only plan decision; Learn adds an item-level resolver on top (§4) |
| Admin configuration | Versioned drafts → publish, audited, with diff and restore (src/server/config/versions.ts, ADR-0006); kinds `catalog` and `pricing`; guarded publish `publishIfUnchanged` | New kinds `learn_content` and `learn_access` |
| Sketch engine | Clean Outline and Pencil Study in a Web Worker, DOM-free and deterministic (src/lib/sketch/; `SketchClient.exportImage`) | The worksheet "Outline" page, called as is — not a line of it changes |
| Values (Study & Simplify) | Inside the `ValueTab` component (`processImage`, src/components/value/ValueTab.tsx): equal-width luminance bins at a 900 px working size | Moved unchanged into a pure module with pixel-identical tests, then called by worksheets (§6) |
| Create a Grid | Inside the `GridTab` component (src/components/grid/GridTab.tsx): canvas size in cm/in, 1–16 even columns and rows, Fit/Fill/Center, drag/pinch/wheel; PNG export 2400 px wide | Geometry moved unchanged into a pure module with parity tests, then extended (§7) |
| Saving | One sink for every save, authorized first (src/components/common/SaveMedia.tsx) | Extended to PDFs |
| Photos | Data URLs in this browser's storage (`useProjectStore`); never uploaded | Unchanged: teachers' photos never leave the device |
| i18n | use-intl, English and Hebrew with a key-parity test (src/i18n/) | UI strings the same way; content strings per field (§8) |
| Backups | Release script dumps the database before migrating; nightly dump of every database | Learn data is in MongoDB (including images, §3), so it is covered |

Nothing in Learn needs a server-side image library, a new database, a new
authentication role or a change to the proven image algorithms.

## 2. Content model

Content is one versioned document per publication (kind `learn_content`),
like the plan catalog: admins edit a draft, see a diff, publish; going back
is publishing an earlier version again. About a hundred items of a few
kilobytes each make a document of a few hundred kilobytes, far below
MongoDB's 16 MB limit.

```ts
type Localized = { en: string; he: string };      // both required for published items

interface LearnContent {
  modules: LearnModule[];                          // curriculum units and the colour module
  exercises: LearnExercise[];
  challenges: LearnChallenge[];
}

interface LearnModule {
  id: string;                                      // 'U03', stable
  collection: 'curriculum' | 'color';
  order: number;
  title: Localized;
  summary: Localized;
}

interface LearnExercise {
  id: string;                                      // 'D-OBS-02', stable, never reused
  collection: 'curriculum' | 'color';
  moduleId: string;
  order: number;                                   // display order within the module
  published: boolean;                              // draft items are visible to admins only
  title: Localized;
  objective: Localized;
  materials: Localized;
  instruction: Localized;                          // the short card text
  guide?: Localized;                               // "More help"
  mistake: { mistake: Localized; fix: Localized };
  success: Localized;
  references: AssetRef[];                          // zero or more
  worksheet: { kind: 'none' } | { kind: 'generated' } | { kind: 'static'; assetId: string };
  tools: ToolId[];                                 // shortcuts: 'measure' | 'value' | 'color' | 'grid' | 'compare'
}

interface LearnChallenge {
  id: string;                                      // 'CH-017'
  group: ChallengeGroup;                           // 'everyday' | 'still-life' | 'plants' | ...
  order: number;
  published: boolean;
  title: Localized;
  prompt: Localized;
  level: 'beginner' | 'intermediate' | 'advanced';
  skill: Localized;
  unitId?: string;                                 // the curriculum unit that teaches the skill
  reference: 'life' | 'own_photo' | 'provided' | 'memory';
  references: AssetRef[];
  medium: 'pencil' | 'both';
  quick: boolean;
  tools: ToolId[];
}

interface AssetRef { assetId: string; alt: Localized; credit?: Localized }
```

Validation (zod, at save and again at publish):

- IDs are unique and match their patterns.
- A published ID can never be deleted, only unpublished. A published item
  can never change its kind.
- Both languages are present for every published item.
- Every referenced asset exists and has complete licence metadata.
- Tool shortcuts name existing tools.
- Static worksheets are PDFs.

**Stable IDs** decouple everything else (access rules, completions,
links, tests) from titles and order.

**Seed content**: the curriculum (02) and challenges (03) are imported as
the first draft from a JSON file in the repository. They are published only
after review, so nothing appears to users until the owner approves the
content.

## 3. Reference images (assets)

- **Storage:** MongoDB GridFS bucket `learn_assets` (part of the MongoDB
  driver already in use). No new service, and the existing dumps and
  restore drill cover it.
- **Identity:** `assetId` is the SHA-256 of the bytes: immutable and
  de-duplicated. Old versions stay available for content rollback; a later
  clean-up can remove assets no version references.
- **Metadata** (required before an item using the asset can be published):

  ```ts
  { contentType: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf',
    width, height, bytes,
    licence: { kind: 'own' | 'commissioned' | 'cc0' | 'public-domain' | 'licensed',
               source: string, author: string, licenceUrl?: string, attribution?: string,
               modelRelease: 'yes' | 'not-needed', notes?: string },
    thumbnailAssetId: string,                    // 320 px WebP, made at upload
    uploadedBy, uploadedAt }
  ```

- **Upload (admin only):** the admin's browser re-encodes the image. This
  strips EXIF data (camera details, location) and limits the long side to
  4,000 px. It also makes the thumbnail. The server checks the file's real
  type from its first bytes, its size (≤ 10 MB), its dimensions and the
  admin's session, then stores it and audits it. There is no server-side
  image processing, so no new server dependency.
- **Serving:** `GET /api/learn/assets/<assetId>`.
  - It authorizes every request: the account must be able to open at least
    one published item that uses the asset, or the asset must be a
    thumbnail that previews allow.
  - It streams from GridFS with an ETag and
    `Cache-Control: private, no-cache`: revalidated each time, so access
    ends at once when it should.
  - Assets are never in `public/`.

## 4. Access resolution (one decision, built on entitlements)

`src/server/learn/access.ts`, pure and unit-tested:

```ts
learnAccess(entitlements, accessConfig, content) => {
  canOpen(itemId): boolean,
  lockReason(itemId): 'module_off' | 'not_in_plan' | 'unpublished' | null,
  visibleItems(collection): ItemSummary[],       // what lists may show, with locks
}
```

It applies the precedence in 05 §2 exactly:

1. admin;
2. published;
3. account active;
4. module feature;
5. the plan's rule.

Every Learn page, API route, asset route and export authorization calls this
one function with the request's fresh entitlements. `/api/usage` gains an
optional `learnItem` field, so a worksheet from a Learn reference is refused
unless that item is open to the account. This is the same fail-closed path
as ADR-0013.

## 5. Routes

| Route | Kind | Notes |
|---|---|---|
| `/app/learn`, `/app/learn/curriculum`, `/app/learn/challenges`, `/app/learn/history` | Server pages in the studio layout | Each sends the account (AccountSync) and the authorized Learn data for that page; the studio renders the Learn view |
| `/app/learn/exercises/<id>`, `/app/learn/challenges/<id>` | Server pages | Full content only if `canOpen`; otherwise only the locked summary |
| `GET /api/learn/items/<id>` | API | For refreshing an open card; 403 when locked |
| `GET /api/learn/assets/<id>` | API | §3 |
| `POST /api/learn/completions`, `DELETE /api/learn/completions/<id>`, `GET /api/learn/completions` | API | §9; own account only; rate-limited |
| `POST /api/usage` | Existing | Adds `learnItem`; new features `export.pdf`, `export.worksheets` |

The studio's URL ↔ view mapping (`src/components/shell/tools.ts`) learns
the `/app/learn/...` paths. Today a nested path falls back to Home, so this
must be extended and tested.

## 6. Worksheets: one image, several aligned pages, one PDF

Everything is generated on the device: photos never leave it, as the app
promises, and the server only authorizes and counts.

**New pure modules** (unit-tested, no React):

- `src/lib/print/paper.ts`:
  - ISO 216 A4 (210 × 297 mm), portrait or landscape;
  - millimetres to PDF points (72 / 25.4);
  - the printable area within a 12.7 mm safe margin;
  - measuring elements kept away from the top and bottom edges (01 §6).
- `src/lib/print/layout.ts`:
  - the image rectangle on the page from rotation (quarter turns),
    Fit/Fill, zoom and offset;
  - **one placement shared by every page of a package**, which is what keeps
    the outline, the grid and the original exactly aligned.
- `src/lib/grid/geometry.ts`:
  - grid lines in millimetres, from columns × rows or from a square cell
    size, with partial cells at the right and bottom edges;
  - letter and number labels;
  - shared with Create a Grid (§7).
- `src/lib/values/posterize.ts`:
  - the Values algorithm moved out of `ValueTab` without changing it
    (same 900 px working size by default, same bins, same output);
  - `ValueTab` then calls it;
  - golden-image tests prove the output is identical, byte for byte, before
    and after the move.

**Pages:**

| Page | Made by | Notes |
|---|---|---|
| Original | The rotated, cropped working image | Downscaled to at most 300 pixels per inch on paper (200 on constrained devices, per src/lib/sketch/sizing.ts limits) |
| Outline | `SketchClient.exportImage(..., 'outline', DEFAULT_CONTROLS)` | Clean Outline exactly as in Study; Pencil Study as an option. A vector version (the engine already traces paths) can come later |
| Reference with grid | Original + grid lines drawn as **vector lines** in the PDF | Crisp at any printer resolution; labels in the margin |
| Blank grid | Vector lines only | With a canvas set to A4 in Create a Grid, the blank grid is printed at true size: a drawing sheet with the exact grid |
| Values | `posterize` at 3 or 5 levels, grayscale | |

Every page carries a 5 cm scale bar and a one-line footer: the item ID if
any, the page name, and "Print at 100% / actual size".

**PDF library:** the app has none today; one client-only library is needed.

- **Recommendation: jsPDF ≥ 4.2.1** (01 §7):
  - maintained, MIT-licensed and the smallest (about 109 KB gzipped, ES
    build);
  - embeds JPEGs without re-encoding;
  - has a right-to-left text engine for Hebrew labels.
- **Safety:** pinned at or above 4.2.1 because of its early-2026 security
  fixes. Only the core is used (no HTML rendering, so its optional
  dependencies are never loaded). It is covered by the existing dependency
  audit.
- **Alternatives:** pdf-lib has had no release since 2021, and its active
  fork is larger.
- **Loading:** on demand, so it adds nothing to the studio's first load.
- **Viewer hint:** the PDF sets `PrintScaling /None`.
- **Hebrew text inside PDFs** (titles, page names):
  - either an embedded Hebrew-capable font subset,
  - or labels rendered by the app as images;
  - decided with the owner in M2 (A17).
- **Decision needed** (A5).

**Memory and speed on iPad:**

- one working image per package, capped by the existing canvas limits
  (`MAX_CANVAS_PIXELS` = 16 MP). WebKit's iOS canvas cap is higher than that
  (01 §7);
- an A4 page at 300 DPI is about 7 MP;
- the outline runs in the existing worker;
- pages are generated one after another, so peak memory stays at about one
  page.

**Saving:** the SaveMedia sheet learns PDFs: Print, Share and Save.

- It shows thumbnails rendered by the app, because the Content Security
  Policy forbids embedding a PDF viewer (`object-src 'none'`,
  `frame-src 'none'`), and that should stay.
- Before anything is generated, `/api/usage` is asked with
  `features: ['export.worksheets']` and, for a Learn reference,
  `learnItem`.
- No answer means no PDF (fail closed).

## 7. Create a Grid improvements, and how they join worksheets

| Need | Today | Proposal |
|---|---|---|
| Rotate 90° left/right, 180° | Not available | A `rotation` setting (0/90/180/270) applied when drawing and exporting; the source image is never modified |
| Fine rotation | Not available | Optional later step (±15° in 0.5° steps), drawn with canvas transforms; never re-encodes the source. Proposed after the rest proves itself |
| True A4 portrait / landscape | Ratios only (1:1, 3:4, 4:5, 2:3, 9:16 at fixed cm sizes) | Two presets: 21 × 29.7 cm and 29.7 × 21 cm, exact |
| Fit and Fill | Fit, Fill, Center exist | Kept; plus an explicit zoom slider and nudge buttons (accessible alternatives to dragging) |
| Repositioning and zoom | Drag, pinch and wheel (0.25×–8×) | Kept |
| Accurate alignment | Lines at rounded pixel positions of the preview size | Lines computed in millimetres by the shared geometry, drawn at device resolution for the preview, as vectors in the PDF |
| Square cells | Columns × rows divide the canvas evenly, so cells are square only by coincidence | A "square cells" mode: choose the cell size; partial cells at the right and bottom edges, the same on the reference and the blank grid |
| Matching blank grid | Not available | A blank-grid page from the same geometry |
| Print-ready PDF | PNG, 2,400 px wide, dark background | A4 PDF: reference with grid, and blank grid, with the scale ("1 square = 3 cm on your canvas; printed at 41%") and a scale bar |

**Compatibility:**

- the new settings are optional fields with defaults equal to today's
  behaviour, so every saved grid opens exactly as before;
- parity tests prove that today's PNG export is unchanged for unchanged
  settings;
- the existing PNG export stays.

**Integration:** Create a Grid gets a **Prepare Worksheets** button. It opens
the composer with the grid's image, rotation, framing and grid already set.
The composer uses the same geometry modules, so both produce identical
grids.

## 8. Localisation

- **UI strings:** in `src/i18n/messages`, English and Hebrew, guarded by the
  existing key-parity test.
- **Content:** `{ en, he }` per field. Publishing requires both, so no card
  ever mixes languages. No silent fallback.
- **Hebrew:** gender-neutral phrasing, as in the app. Reviewed by a
  native-speaking art teacher before the first publication.
- **Layout:** right to left for Hebrew. Sizes, IDs, grid labels and numbers
  stay left to right, as in the tools today.

## 9. Personal history, and the shared tablet

- **Collection `learn_completions`:**
  `{ _id, userId, itemId, completedAt, contentVersion }`.
  - Several per item are allowed.
  - Indexes: `{ userId, completedAt: -1 }` and
    `{ userId, itemId, completedAt: -1 }`.
- **API:**
  - add: only for an item open to the account, rate-limited;
  - remove: own entries only;
  - list: own, paginated.
- **Account data:** in the account's data download. Removed with the
  account (ADR-0010). Retention: while the account exists.
- **Class mode:**
  - It is a setting of this browser (`sessionStorage` plus a timestamp; off
    after 12 idle hours).
  - While it is on, the client never calls the completion API.
  - There is nothing to record about students on the server, because no
    student data exists anywhere: no profiles, names, photos or results.
- **Analytics:** none by default. Optionally, ids-only events for opening an
  item (no content, no images, no text) can be added later. **Decision
  needed.**

## 10. Security and privacy

- **One authorization path for Learn:** the access resolver, per request,
  on pages, item API, assets and exports.
- **Locked content stays on the server:** never serialized into pages,
  page data, thumbnails (beyond allowed previews) or caches. Tests assert
  its absence.
- **Images:** teachers' and learners' photos never leave the device. Learn's
  own references are served only to accounts allowed to open them.
- **Admin:** content and access edits require an admin. Publishing requires
  a recent sign-in, as for the catalog. Everything is audited. Uploads are
  type-checked by their bytes and size-limited.
- **API limits:** rate limits on completions and assets. JSON bodies capped
  (as everywhere).
- **Browser policy:** the Content Security Policy is unchanged. Images come
  from the app's own origin, `blob:` or `data:`.

## 11. Copyright and licensing

Sources, safest first (details and current licence terms in 01):

1. **Own or commissioned photographs and drawings**, with a written licence
   that allows commercial use in the app and printing by users, and model
   releases for identifiable people.
2. **CC0 / public-domain open-access collections** (museum and
   natural-history programmes listed in 01). Each item's own rights
   statement is checked and recorded.
3. **Stock-photo sites:** avoided for the library unless a legal review
   says otherwise. Their licences restrict compiling images into a similar
   service.

Every asset carries the licence metadata in §3; credits show under "More
help". A reference can be withdrawn at once by publishing content without
it, after which its asset route stops serving it. Photos of identifiable
people need a model release whatever the photo's licence.

## 12. Migration, backups and rollback

- **Before anything else: make rollback safe** (milestone M0 in 07).
  - **The hazard:** today, the catalog schema accepts only the feature IDs
    the code knows (`z.enum(FEATURES)`, src/server/config/catalog.ts), and
    `publishedDocument()` falls back to the code's defaults when the
    published document does not parse (src/server/config/versions.ts). The
    migration then rewrites `plans` from that result
    (src/server/db/migrate.ts).
  - **Why it matters:** once a catalog containing a Learn feature ID is
    published, rolling back to today's release would silently reset every
    plan to the code defaults. Free would get Measure & Plan and Compare &
    Correct back.
  - **M0 changes, shipped and released before any new feature ID exists:**
    - unknown feature IDs are kept but ignored;
    - a published version that fails to parse is never replaced by
      defaults. `plans` stays untouched and the failure is logged and shown
      to admins.
- **Additive migrations only:**
  - kinds `learn_content` and `learn_access`, seeded empty (no items) and
    "None for Free, All for Pro";
  - collection `learn_completions` and its indexes;
  - the GridFS bucket's indexes;
  - new catalog features, added to no plan.
- **Backups:** the release script's dump, plus an explicit dump before the
  first content import.
- **Rollback, by layer:**
  - code: the previous release (tolerant after M0);
  - content: republish an earlier `learn_content` version;
  - access: republish an earlier `learn_access` version;
  - the whole module: publish a catalog without the Learn features
    (immediate and audited).

## 13. Risks

| Risk | Mitigation |
|---|---|
| Rollback resets the published plans (found above) | M0 first, released before any new feature ID |
| Image algorithms drift during extraction | Pure moves with byte-identical golden tests; the sketch engine is not touched |
| Locked content leaks through page data, thumbnails or caches | Server-side resolver everywhere; tests on HTML, page data and asset routes as Free, Pro, admin and signed out |
| PDFs print at the wrong size | True A4 pages in millimetres; a scale bar on every page; "100% / actual size" guidance |
| iPad memory during PDF generation | One working image, page-by-page generation, existing canvas limits, DPI caps |
| Reference licensing | Required licence metadata; sources limited as in §11; model releases |
| Content quality and Hebrew terminology | Expert review gates before publishing (07) |
| Scope creep | Small milestones with their own approval (07) |
