# 0017 — Learn foundations: versioned content, private assets, access in the plan catalog

**Status:** Accepted (2026-11-19). Milestone M4 of the Learn plan
(docs/learn/07-phases-qa-approvals.md); decisions A6, A7, A8 and A19.
Dark launch: no plan includes a Learn module, and Learn has no screens yet
(M5).

## Context
Learn (a drawing curriculum, a colour module and challenges) needs, before
any screen exists:

- content in English and Hebrew that admins draft, publish and restore;
- reference images that are licensed, private and served only to accounts
  allowed them;
- access decided per plan in Admin → Plans, down to individual items;
- no change to the published Free/Pro plans or to anyone's data.

The repository is public, so neither the content nor the images may be
committed. The owner's decisions for M4 (2026-11-19):

1. Three exercises and three challenges, as test content, not the final
   curriculum.
2. Verified CC0/public-domain images only, with the source, author, licence
   and rights recorded for each.
3. Content and images kept out of the repository.
4. The draft, publish, history and restore workflow.
5. The test content may be published on staging; no Free/Pro plan setting
   may be published or changed.
6. Learn access None for Free and Pro.
7. Every Learn content and image request checked on the server.
8. Backup and restore of the images and the content verified.

## Decision

### 1. Content: one versioned document (`learn_content`)
- **Model:** groups, exercises and challenges with stable IDs
  (`D-START-01`, `C-COL-01`, `CH-017`), English and Hebrew text, references
  by asset ID, tool shortcuts (`src/lib/learn/model.ts`). The ID's prefix
  says its collection.
- **Versioned like the plan catalog** (ADR-0006, `src/server/config/versions.ts`):
  a draft, a diff, publish, history and restore, audited. Two hooks were
  added to the versioned configuration for this, used by nothing before:
  checks that need the database, and what a restore starts from.
- **Checked when a draft is saved and again when it is published**
  (`src/server/learn/content.ts`):
  - IDs unique, each in the collection its prefix names; groups exist;
  - every published item complete in both languages;
  - a challenge with a provided reference has one;
  - every asset exists, is of the right kind, has a complete licence, and
    its file is there with exactly its bytes;
  - **a published item is never deleted, only unpublished**, and never
    changes kind. Restoring an earlier version keeps items published since
    then, unpublished, so every ID an access list names stays valid.
- **Read tolerantly** (ADR-0014): fields a newer release adds are kept.
  A published version this release cannot read refuses every Learn request
  (503); it is never replaced by anything.
- **No editor yet (M6).** Drafts come from `npm run db -- learn-import
  <folder>`. Admin → Learn (`/admin/learn`) shows the draft and the live
  version, what publishing changes (warning when an item a plan's list names
  would be unpublished), every item and asset with its licence, and what
  each plan opens. It publishes, discards and restores.

### 2. Assets: files outside the app, named by their hash (A19)
- **Where:** `LEARN_ASSETS_DIR`, on staging
  `/var/lib/studio-companion/staging/learn-assets/`, owned by the site's
  user, mode 0750. It is outside every release, so a deployment or a
  rollback never touches it, and outside `public/`.
  `deploy/install-learn-assets.sh` creates it.
- **Names:** `<sha256>.<ext>`; the SHA-256 of the bytes is the asset ID.
  Files are immutable and de-duplicated, written atomically: a temporary
  file, flushed, then renamed. Metadata, the licence included, is in
  `learn_assets`.
- **Checked by their bytes** (`src/server/learn/assets.ts`):
  - the type from the first bytes: JPEG, PNG, WebP, or PDF for worksheets;
  - the size: 10 MB at most, 256 KB for thumbnails;
  - the dimensions, read from the headers: 3,200 px at most, 400 px for
    thumbnails;
  - **no embedded metadata.** EXIF, XMP, IPTC, comments and text chunks are
    refused, so camera details and locations never reach the server.
  - No image is decoded on the server, so no image library is needed.
- **Licence required:** kind (own, commissioned, CC0, public domain,
  licensed), source page (https), author, title, licence URL (required for
  CC0 and licensed), the rights as the source states them and where they
  were checked, the date checked, and the model release. A thumbnail
  follows its asset.
- **Uploading:** the import command, which uses the same storing code a
  browser upload will use in M6. The images are re-encoded in a browser
  canvas before import, which removes their metadata; the server's checks
  would refuse them otherwise.

### 3. Access: in the plan catalog, decided in one place
- **Three module features** (`learn.curriculum`, `learn.color`,
  `learn.challenges`) in `UNPUBLISHED_FEATURES`: in no plan until an admin
  publishes one. They are on or off, like tools; never a quota.
- **A Learn section in the catalog** (`src/server/config/learn-access.ts`):
  - one rule per plan and collection: **All**, **None**, or **Selected**;
  - what locked items show in lists: the title, or the title and a
    thumbnail.
- **Selected lists:**
  - made with First N, a whole group, or by picking (Admin → Plans);
  - **frozen when published**: the server enforces only the listed IDs, so
    reordering or adding content never changes anyone's access;
  - the editor shows when the content changed since a list was made, and
    offers the new list (a new publication);
  - **publishing checks the IDs:** an unknown ID, an ID from another
    collection, or a newly added unpublished one blocks it. An ID already in
    the live list may stay after its item is unpublished (hidden), so
    publishing the item again restores the same access.
- **A catalog without the section opens nothing.** That covers every
  catalog before M4. Nothing is migrated, and the published catalog stays
  as it is.
- **Into `plans`:** publishing copies each plan's rules into `plans.learn`,
  which entitlements read. They stay the only reader of plans. A plan whose
  Learn access says nothing gets no field at all, so plans stay exactly as
  earlier releases wrote them until Learn is published.
- **Read like the rest of the catalog (ADR-0014):**
  - a rule with settings this release does not know is withheld (None);
  - unknown collections and settings are kept and not applied;
  - unreadable previews mean titles only.
- **The diff** lists rule changes and the items each plan gains and loses.
- **One resolver** (`src/lib/learn/access.ts`), pure, used by every route
  and by the editor's "effective access". Its precedence:
  1. an account that is not active gets nothing;
  2. an admin opens everything, unpublished items included;
  3. unpublished or unknown items are hidden from everyone else;
  4. a module missing from the plan locks every item of it;
  5. then the rule. A module no plan offers is not even listed.

### 4. Routes: authorized on every request
| Route | Answers |
|---|---|
| `GET /api/learn/items?collection=` | A collection as this account's lists may show it: open items, and locked ones (ID, title, place, lock reason; a thumbnail only where previews allow). Never any item's content. |
| `GET /api/learn/items/<id>` | The whole item if the account may open it; 403 with the reason (`module_off`, `not_in_plan`) if locked; 404 if unknown or unpublished. |
| `GET /api/learn/assets/<sha256>` | The file, for an admin or an account that may open a published item using it (a thumbnail also while locked items show thumbnails); 403 when locked, even for a URL that worked before; 404 otherwise. `Cache-Control: private, no-cache`, `ETag` = the hash (304 after re-authorizing), `nosniff`, same-origin. The ID must be 64 hex characters: no path is built from the request. |
| `POST /api/usage` | New optional `learnItem`: an export from a Learn item's reference needs that item open, checked before anything is counted. |

- **Common to all:** 401 when signed out or suspended; for everyone but
  admins, a limit of 600 Learn requests per 10 minutes per account.
- **Failure:** unreadable content or no asset directory gives 503, fail
  closed.

### 5. Backups and restore
- **Content and asset metadata:** in MongoDB, in the nightly dump and the
  dump before every release.
- **Files:** `studio-learn-assets-backup <env>` copies new files to
  `/var/backups/learn-assets/<env>` at 02:50 (root only). It is
  incremental, since files never change; nothing is overwritten or deleted,
  and the whole copy is re-checked against its names every night.
- **The restore drill** (`deploy/restore-drill.sh --assets <dir>`):
  - restores the database dump into a throwaway database and the asset
    copy into a throwaway directory;
  - checks that every recorded asset is there with exactly its bytes, and
    that every asset the restored published content uses is recorded.

### 6. Seed content (test content, not the curriculum)
- **Items:** D-START-01, D-SHAPE-01, D-LINE-04; CH-002, CH-012, CH-017. The
  text is written from the drafts in docs/learn/02 and 03, in both
  languages.
- **Images:** four references, all CC0 from The Cleveland Museum of Art's
  Open Access collection. The rights were checked per object in the
  museum's API and its policy, and are recorded with each asset. CH-002 and
  CH-012 are drawn from life and need none.
- **Where the files are:** outside the repository, in
  `studio-companion-private/learn-seed-m4/` next to the project (with
  `SOURCES.md`). From there they were imported on staging.

## Consequences
- **Rolling back:**
  - a catalog that uses the new features or section must never be read by
    a release below `224bb65`;
  - releases from `224bb65` keep and ignore them, and have no Learn routes,
    so Learn is closed (ADR-0014, docs/security/catalog-rollback-safety.md);
  - content and files are left untouched by any code rollback.
- **Admins see Learn's raw state** (Admin → Learn, the API); nobody else
  sees anything until a module is published for a plan.
- **No user-facing Learn rows** yet in the plan comparison (`FEATURE_MATRIX`):
  they come with the screens (M5). The feature names exist in both
  languages for refusals.
- **Every Learn request reads the published content** (a few hundred KB at
  most): simple and always fresh, at a small cost per request.
- **Not built yet:**
  - completions and history (M5);
  - the browser upload form and the content editor (M6);
  - "View as" (M6);
  - Random and Quick (M5).

## Alternatives considered
- **GridFS or the repository for images:** rejected in A19 (every dump
  copies the library again; the repository is public).
- **A live First N**, recomputed on every request: a reorder would then
  change access without any publication of the plans. That is the failure
  class of ADR-0013.
- **A separate Learn access screen and document:** two publications would
  then decide what a plan includes, and restoring one without the other
  could combine settings nobody reviewed together.
- **Server-side image processing** (an image library re-encoding uploads):
  a new native dependency. The browser already re-encodes, and the server
  checks the result.
