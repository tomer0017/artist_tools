# 06 — Technical architecture (proposal, for approval)

Inspected on 2026-11-18 at `be6890c` (branch `migration/nextjs-saas-foundation`).
Every "today" statement below was checked in the code; file paths are given
so each can be re-checked.

## 1. What exists and what Learn reuses

| Area | Today | Learn reuses it as |
|---|---|---|
| Studio shell | One client app under `/app` (`src/app/app/layout.tsx`, `src/components/shell/Studio.tsx`); tools stay mounted while the URL moves; every page sends the account fresh (`requireStudioAccount` → `AccountSync`, ADR-0013) | Learn is another studio view (`/app/learn/...`), so tools keep their work behind it |
| Entitlements | `getEntitlements` (src/server/entitlements.ts) from the database only; plans read on every request; `/api/usage` authorizes and counts saves and exports, failing closed | The only plan decision; Learn adds an item-level resolver on top (§4) |
| Admin configuration | Versioned drafts → publish, audited, with diff and restore (src/server/config/versions.ts, ADR-0006); kinds `catalog` and `pricing`; guarded publish `publishIfUnchanged` | New kind `learn_content`; Learn access becomes a section of the catalog (05 §4) |
| Sketch engine | Clean Outline and Pencil Study in a Web Worker, DOM-free and deterministic (src/lib/sketch/; `SketchClient.exportImage`) | The worksheet "Outline" page, called as is — not a line of it changes |
| Values (Study & Simplify) | Inside the `ValueTab` component (`processImage`, src/components/value/ValueTab.tsx): equal-width luminance bins at a 900 px working size | Moved unchanged into a pure module with pixel-identical tests, then called by worksheets (§6) |
| Create a Grid | Inside the `GridTab` component (src/components/grid/GridTab.tsx): canvas size in cm/in, 1–16 even columns and rows, Fit/Fill/Center, drag/pinch/wheel; PNG export 2400 px wide | Geometry moved unchanged into a pure module with parity tests, then extended (§7) |
| Saving | One sink for every save, authorized first (src/components/common/SaveMedia.tsx) | Extended to PDFs |
| Photos | Data URLs in this browser's storage (`useProjectStore`); never uploaded | Unchanged: teachers' photos never leave the device |
| Static images | UI art in `public/images` (`public/` is about 356 KB), copied into each release by `scripts/prepare-standalone.mjs` and served to anyone without a check | Not used for Learn references (§3) |
| Repository | Public on GitHub: anyone can read it without signing in (checked 2026-11-18) | Reviewed content and reference images are never committed (§2, §3) |
| i18n | use-intl, English and Hebrew with a key-parity test (src/i18n/) | UI strings the same way; content strings per field (§8) |
| Backups | Release script dumps the database before migrating; nightly dump of every database, kept 14 days on the VPS; off-site copies planned, not built | Content, access and image metadata are in MongoDB, so they are covered; the image files need one new backup step (§3) |

Nothing in Learn needs a server-side image library, a new database, a new
authentication role or a change to the proven image algorithms.

## 2. Content model

Content is one versioned document per publication (kind `learn_content`),
like the plan catalog: admins edit a draft, see a diff, publish; going back
is publishing an earlier version again. 77 items (20 exercises, 7 colour
exercises, 50 challenges) of a few kilobytes each make a document of a few
hundred kilobytes, far below MongoDB's 16 MB limit.

```ts
type Localized = { en: string; he: string };      // both required for published items

interface LearnContent {
  groups: LearnGroup[];                            // 'core', 'next', 'color' and the challenge groups
  exercises: LearnExercise[];
  challenges: LearnChallenge[];
}

interface LearnGroup {
  id: string;                                      // 'core', 'next', 'color', 'plants', ...; stable
  collection: 'curriculum' | 'color' | 'challenges';
  order: number;
  title: Localized;
  summary?: Localized;
}

interface LearnExercise {
  id: string;                                      // 'D-OBS-02', stable, never reused
  collection: 'curriculum' | 'color';
  groupId: string;
  order: number;                                   // display order within the collection
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
  groupId: string;                                 // 'everyday' | 'still-life' | 'plants' | ...
  order: number;
  published: boolean;
  title: Localized;
  prompt: Localized;
  level: 'beginner' | 'intermediate' | 'advanced';
  skill: Localized;
  skillArea: number;                               // 1–10, links to the exercises that teach it (03)
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

**Seed content:**

- The curriculum (02) and challenges (03) are imported as the first draft by
  a CLI command, from a JSON file kept outside the repository.
- The repository is public (§1), so reviewed content is never committed. Its
  home is the database, versioned and backed up with it. The drafts in these
  planning documents are already public.
- Content is published only after review, so nothing appears to users until
  the owner approves it.

## 3. Reference images (assets)

**Reevaluated 2026-11-18.** The first proposal stored the images in MongoDB
(GridFS). This section replaces it.

### What exists today

There is no server-side store for uploaded files, so every option below is
new:

- UI art lives in `public/images`. The build copies it into each release
  (`scripts/prepare-standalone.mjs`), and it is served to anyone without a
  check.
- Photos stay on the device (`useProjectStore`, browser storage) and are
  never uploaded.
- MongoDB holds accounts, configuration, audit records and usage. It holds
  no binary data.
- **Backups:**
  - the release script dumps the database before every migration;
  - a nightly dump of every database is kept for 14 days on the VPS;
  - off-site copies are planned, not built (`deploy/offsite-backups-plan.md`).
- The GitHub repository is public.

### How much

- **Number:** the 20 exercises and the challenges marked Provided need
  roughly 40–60 references.
- **Size:** 3,200 px on the long side is enough for A4 at 300 DPI inside the
  margins. At about 1–1.5 MB each, the library is roughly 40–90 MB, plus
  small thumbnails.

### The options

| Option | Access control | Backups and rollback | Verdict |
|---|---|---|---|
| `public/`, or files in the repository | None: public URLs, and the repository is public. Licensed or commissioned images may not allow public redistribution | Git | **Rejected** |
| MongoDB GridFS (the first proposal) | Through the authorized route | No new backup step. But every dump copies the whole library again: the dump before each release, and each nightly dump kept for 14 days. A future off-site copy would upload it again every night | Possible, not recommended |
| **Files on the server, outside the releases and `public/`; metadata in MongoDB** | Through the authorized route only | One new step: an incremental copy beside the database dumps. Files never change (they are named by their hash), so each is copied once | **Recommended** |
| Object storage (S3-compatible) | Signed URLs, or the route | Managed by the provider | Not now: a paid service and new credentials. Revisit with the off-site backup plan |

### The recommendation in detail

- **Where:** `/var/lib/studio-companion/<environment>/learn-assets/`.
  - One directory per environment, owned by the site's user, mode 0750.
  - Outside every release directory, so a deployment or a rollback never
    touches it.
  - Outside `public/`, and never served by the web server directly.
- **Names:** `<sha256>.<ext>`. The SHA-256 of the bytes is the `assetId`.
  - Files are immutable and de-duplicated: a changed image is a new file.
  - Old files stay, so every earlier content version keeps working.
  - A later clean-up can remove files that no version references.
- **Metadata** (MongoDB collection `learn_assets`), required before an item
  using the asset can be published:

  ```ts
  { _id: assetId,                                 // SHA-256 of the bytes
    contentType: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf',
    width, height, bytes,
    licence: { kind: 'own' | 'commissioned' | 'cc0' | 'public-domain' | 'licensed',
               source: string, author: string, licenceUrl?: string, attribution?: string,
               modelRelease: 'yes' | 'not-needed', notes?: string },
    thumbnailAssetId: string,                     // 320 px WebP, made at upload
    uploadedBy, uploadedAt }
  ```

- **Upload (admin only):**
  - The admin's browser re-encodes the image. This strips EXIF data (camera
    details, location), limits the long side to 3,200 px, and makes the
    thumbnail.
  - The server checks the admin's session, the file's real type from its
    first bytes, its size (at most 10 MB) and its dimensions.
  - It writes a temporary file and renames it into place, so a partial file
    never exists. Then it records the metadata and audits the upload.
  - There is no server-side image processing, so no new server dependency.
- **Serving:** `GET /api/learn/assets/<assetId>`.
  - It authorizes every request: the account must be able to open at least
    one published item that uses the asset, or the asset must be a
    thumbnail that previews allow.
  - The ID must be exactly 64 hexadecimal characters, so no file path is
    ever built from user input.
  - It streams the file with the hash as its `ETag` and
    `Cache-Control: private, no-cache`. Each use is revalidated, so access
    ends at once when it should.
- **Backups:**
  - an incremental copy of the directory, made with the nightly database
    dump (only new files are copied);
  - included in the restore drill (`deploy/restore-drill.sh`);
  - the content validator and the smoke check report any referenced asset
    whose file is missing.
- **Rollback:**
  - a code rollback leaves the files untouched;
  - an earlier content version finds its files, because none is removed;
  - a database restore brings back older content, which refers only to
    files that still exist.
- **Reversible:** content refers to assets only by their hash. Moving the
  files later, to GridFS or object storage, changes no content.

## 4. Access resolution (one decision, built on entitlements)

`src/server/learn/access.ts`, pure and unit-tested:

```ts
learnAccess(entitlements, content) => {
  canOpen(itemId): boolean,
  lockReason(itemId): 'module_off' | 'not_in_plan' | 'unpublished' | null,
  visibleItems(collection): ItemSummary[],       // what lists may show, with locks
}
```

The entitlements carry the plan's Learn rules: All, None, or the frozen
Selected list (05 §4). The rules are copied from the published catalog into
`plans` together with its features, as features are today, so
`getEntitlements` remains the one place that reads plans.

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

> **As built in M3 (ADR-0016):** the owner chose **PNG images** over one PDF.
> Every sheet has Create a Grid's export size and the photo where
> `imageRect` puts it; the grid sheets are Create a Grid's own images; the
> outline is the sketch engine's Clean Outline drawn from its paths
> (`drawPaths`); the values are `src/lib/values` (moved, golden-tested). The
> print layout below (A4 pages, scale bar, footer) is kept for a later PDF.

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
- **Hebrew text inside PDFs** (titles, page names): decided in M2 (A17).
  The browser draws the words as images in the page's language; no font
  is embedded (ADR-0015 §2).
- **Decided in M2** (A5): jsPDF 4.2.1, pinned, loaded only after the server
  authorizes a PDF (ADR-0015 §1).

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

- **Prerequisite, outside this plan: the rollback-safety fix**
  ([catalog-rollback-safety.md](../security/catalog-rollback-safety.md)).
  - **The hazard:** today's code would reset every plan to the code
    defaults if it were rolled back after a catalog with a new feature ID
    was published. Free would get Measure & Plan and Compare & Correct back.
    It was reproduced on a throwaway database on 2026-11-18.
  - **Learn would add new feature IDs and a new catalog section.** The fix
    therefore makes the catalog keep both and ignore them.
  - **It is a separate security fix,** with its own tests and approval, and
    released before any Learn milestone.
- **Additive migrations only:**
  - the kind `learn_content`, seeded empty (no items);
  - the catalog's new features, added to no plan;
  - the catalog's Learn access section: None for Free, All for Pro (which
    opens nothing until a module feature is published);
  - collections `learn_assets` (metadata) and `learn_completions`, with
    their indexes;
  - the asset directory, created by the server installer, not by the
    migration.
- **Backups:**
  - the release script's dump;
  - an explicit dump before the first content import;
  - the asset directory's incremental copy (§3).
- **Rollback, by layer:**
  - code: the previous release (safe once the rollback-safety fix is
    released);
  - content: republish an earlier `learn_content` version;
  - access: republish an earlier catalog version;
  - the whole module: publish a catalog without the Learn features
    (immediate and audited).

## 13. Risks

| Risk | Mitigation |
|---|---|
| Rollback resets the published plans (found above) | The separate rollback-safety fix, released before any new feature ID or catalog section |
| The public repository exposes content or licensed images | Reviewed content and reference images are never committed: content lives in the database, images in the asset directory |
| Image files missing after a restore or a move | Immutable files named by hash, never removed by a release; incremental copies; a missing-file check in the validator and the smoke check |
| Image algorithms drift during extraction | Pure moves with byte-identical golden tests; the sketch engine is not touched |
| Locked content leaks through page data, thumbnails or caches | Server-side resolver everywhere; tests on HTML, page data and asset routes as Free, Pro, admin and signed out |
| PDFs print at the wrong size | True A4 pages in millimetres; a scale bar on every page; "100% / actual size" guidance |
| iPad memory during PDF generation | One working image, page-by-page generation, existing canvas limits, DPI caps |
| Reference licensing | Required licence metadata; sources limited as in §11; model releases |
| Content quality and Hebrew terminology | Expert review gates before publishing (07) |
| Scope creep | Small milestones with their own approval (07) |
