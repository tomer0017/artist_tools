# 05 — Admin control and Free/Pro entitlements for Learn (proposal, for approval)

> **As built in M4 (2026-11-19, ADR-0017):**
> - The three module rows and the Learn access section are in Admin → Plans.
> - A catalog without the section opens nothing. Free and Pro stay at None
>   until the owner publishes otherwise.
> - Admin → Learn shows and publishes the content (no editor until M6).
> - "View as" comes with the editor (M6).

**Revised 2026-11-18 after the owner's first review:**

- §2 states what today's Plans editor can and cannot control.
- Learn access moves into Admin → Plans: one document and one publication,
  instead of a separate Learn access screen (§4).
- "First N" counts items, and is frozen into an explicit list when it is
  published. Reordering content never changes anyone's access (§4).

## 1. Status of the earlier staging bug (investigated first)

The bug: on staging, a Free account could open and use Measure & Plan
although the published plan catalog (version 2) removed it from Free.

- **Root cause (2026-11-18):** no code checked the tool features
  (`tool.*`):
  - the tool route verified only the session;
  - the studio mounted every tool;
  - image saves were never checked, and GIF exports failed open;
  - plan pages read the code defaults;
  - plans were cached for a minute per process.
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

## 2. What today's Plans editor controls

Admin → Plans (`src/app/admin/plans/CatalogEditor.tsx`) edits the plan
catalog. The catalog is a versioned document, drafted and then published
(ADR-0006), and read by the server on every request (ADR-0013).

For Free and for Pro separately, it controls:

- the five tools, each on or off;
- four save options, each on or off, with an optional quota per day or per
  calendar month:
  - saving images;
  - GIFs;
  - large GIFs;
  - difference GIFs.

It can also switch any of these off for everyone except admins.

Its rows come from the code's feature list (`FEATURES` in
`src/lib/plans.ts`). A new feature ID therefore appears as a new row without
any change to the editor.

**So the answer is no, not today.** It has no Learn features, no PDF exports
and no item level. With this proposal:

| Can the Plans editor control… | Today | With this proposal |
|---|---|---|
| The whole drawing curriculum, per plan | No: no Learn feature exists | Yes: the `learn.curriculum` row |
| The colour module, per plan | No | Yes: `learn.color` |
| The challenge library, per plan | No | Yes: `learn.challenges` |
| Individual exercises, per plan | No: the editor has no item level | Yes: the Learn access section (§4) |
| Individual challenges, per plan | No | Yes: the Learn access section |
| The Grid PDF, per plan, with a quota | No: no PDF export exists | Yes: `export.pdf` |
| The worksheet PDF, per plan, with a quota | No | Yes: `export.worksheets` |

**Independence.** Each row and each rule is set on its own; changing one
never changes another. There are two deliberate couplings, both shown in the
editor:

- **An item needs its module.** An exercise or challenge opens only if its
  module is on for that plan; a module that is off locks all its items.
- **A worksheet from a Learn reference needs both.** It needs
  `export.worksheets` and access to that item. A teacher's own photo needs
  only the export.

## 3. New catalog features (code)

| Feature ID | Meaning | Quota |
|---|---|---|
| `learn.curriculum` | The drawing curriculum (20 exercises) | None: on or off, like tools |
| `learn.color` | The colour module (7 exercises) | None |
| `learn.challenges` | The challenge library (50) | None |
| `export.pdf` | Print-ready PDF from Create a Grid: the reference with its grid, and a blank grid | Optional, per day or month |
| `export.worksheets` | Prepare Worksheets packages: a multipage PDF from one image | Optional, per day or month |

**Dark launch:**

- The migration adds these features to no plan.
- Until an admin publishes a catalog that includes them, only admins see
  Learn and the PDF exports.
- Turning them on for Free or Pro is a deliberate, reviewable publication.

**Prerequisite:** the rollback-safety fix
([catalog-rollback-safety.md](../security/catalog-rollback-safety.md)) must
be released before any of these feature IDs exist. It is a separate change,
with its own tests and its own approval.

## 4. Learn access: per collection, inside Admin → Plans

A new **Learn access** section is added to the same editor and stored in the
same catalog document. One draft, one diff, one publication and one history
decide everything a plan includes: tools, exports, modules and items.
Restoring a catalog version restores exactly the combination that was
reviewed together.

For each collection (curriculum, colour, challenges) and each plan (Free,
Pro), there is exactly one rule:

| Rule | Meaning |
|---|---|
| **All** | Every published item in the collection, including items published later |
| **None** | No item. The module may still be on, showing every item locked |
| **Selected** | Exactly the listed items, nothing else, until the list is changed and published again |

The editor offers three ways to fill a Selected list:

- **First N:** the first N items in the collection's current order.
- **A whole group:** for example, all 12 core exercises, or every challenge
  in "Plants and flowers".
- **Pick items:** a searchable list showing ID, title, group, level and
  published state.

There is also one global setting: what a **locked item shows in lists** —
the title only, or the title and a small thumbnail.

### What "First N" means, and what reordering does

- **N counts items, never units or groups.**
  - In the curriculum, the items are exercises: Core 1–12, then Next steps
    13–20.
  - In the challenge library, they are challenges.
  - v1 has no units (02).
- **The order is the content order at the moment the admin chooses First
  N.** The editor shows the result before saving, for example
  "First 4 = D-START-01, D-SHAPE-01, D-LINE-04, D-OBS-02".
- **The list is frozen when the catalog is published.**
  - The published catalog stores the explicit list of IDs, with a note of
    how it was made ("First 4, content version 7").
  - The server enforces only the list.
- **Reordering content never changes anyone's access by itself.**
  - Suppose D-OBS-02 moves to position 9, or a new exercise is inserted at
    position 2. Free's list stays exactly as published.
  - The editor then shows "The order changed since this list was made",
    what First 4 would give now, and the gains and losses.
  - Applying the new order is a new, reviewed publication.
- **New items are never added to a Selected list automatically.** Only All
  includes them.
- **An unpublished item is hidden from everyone,** like any unpublished
  item. Its ID stays in the list, so republishing it restores the same
  access. Publishing content that unpublishes an item named in a live list
  warns first.
- **Why not a "live" First N, recomputed from the current order on every
  request?**
  - A content edit, such as a reorder, would then silently change what Free
    can open, without any publication of the plans.
  - That is the class of failure fixed in ADR-0013: what accounts can open
    must be exactly what an admin published.

### Suggested first values (only a suggestion; the admin decides)

- **Free:**
  - curriculum: First 4, frozen as D-START-01, D-SHAPE-01, D-LINE-04 and
    D-OBS-02;
  - challenges: Selected CH-002, CH-012 and CH-017;
  - colour: None.
- **Pro:** All, everywhere.

### Precedence (complete, no overlaps)

1. **Administrator** → everything, including items not yet published (shown
   as drafts to admins only).
2. **Item not published** → nobody else sees it.
3. **Account not active** (signed out, suspended) → nothing, as today.
4. **Module feature missing from the plan in force** → every item of that
   module is locked for that account.
5. **The plan's rule for the collection** → All, None or Selected decides
   each item. There is one rule per collection and plan, so two settings can
   never disagree.
6. **Exports:**
   - a worksheet package needs `export.worksheets`;
   - if its image comes from a Learn item, that item must also be open to
     the account;
   - a teacher's own photo needs only the feature.

The plan in force is the existing one: the best of the assigned plan, an
active subscription and a live grant. A Pro grant therefore opens Pro items.

### Validation when publishing

- Every listed ID must exist in the published content, or the catalog cannot
  be published.
- First N:
  - N must be at least 1.
  - An N larger than the number of published items gives every current item,
    with a warning that items published later are not included (All does
    that).
- The diff lists, per plan, the items gained and lost (for example, "Free:
  gains CH-017; loses D-OBS-02"). It appears beside the feature changes the
  diff lists today.
- Publishing content that unpublishes an item named in a live list warns
  before it publishes.

## 5. Visibility is not authorization

| What | Locked account receives | Open account receives |
|---|---|---|
| Lists (curriculum, challenges) | ID, titles, level, skill, lock reason; thumbnail only if previews allow | Everything for the card |
| Exercise or challenge page | The locked screen; no instructions, guide or reference | The full card |
| `GET /api/learn/items/<id>` | 403, naming the missing feature or rule | The item's content |
| `GET /api/learn/assets/<id>` (full-size reference) | 403 | The image (`Cache-Control: private, no-cache`, re-authorized on every request) |
| Thumbnails | Only when previews allow; small size only | Small size |
| Worksheet PDF | Refused by `/api/usage` before anything is made (fail closed) | Authorized and counted |

- **No public copies of protected content:**
  - reference images are never in `public/`, so there is no static URL to
    guess or share;
  - they are never in the repository either, which is public (06 §3).
- **Server pages build lists only from what the account may see.** Tests
  check that locked content is absent from the HTML and from the page data
  sent to the browser, not only hidden.
- **Every request is authorized when it arrives.** A locked item's protected
  assets cannot be reached by a direct request, an old link or a stale tab.

## 6. Stale sessions, plan changes and open tabs

Learn uses the ADR-0013 mechanisms unchanged:

- Learn pages are server pages, so every navigation re-checks.
- The studio's account copy refreshes:
  - every minute while the tab is in view;
  - when the tab comes back into view;
  - when another tab of the same account sees a change.
- An open exercise whose access ends switches to the locked view on its next
  refresh. The server refuses its protected image and any export even before
  that.
- Suspension, sign-out everywhere and session expiry work as today: the next
  request leads to sign-in.

## 7. Admin screens

- **Admin → Plans** (the existing editor, extended):
  - five new feature rows: the three modules and the two PDF exports, with
    Free/Pro switches and quotas on the exports;
  - the Learn access section (§4);
  - an "Effective access" panel per plan, for example "Free will open:
    D-START-01, D-SHAPE-01, D-LINE-04, D-OBS-02; CH-002, CH-012, CH-017";
  - draft, diff, publish, history and restore, as today.
- **Admin → Learn → Content** (new):
  - exercises and challenges, with English and Hebrew fields side by side
    and required-field checks in both languages;
  - the order within each collection;
  - references: upload and preview, with licence metadata required before
    publishing (06 §3, §11);
  - draft, publish, history and restore, with a full-content diff.
- **View as:** an admin can preview a Learn page as Free or as Pro, for QA.
  It changes nothing about the admin's own access.
- **Audit:** everything is audited by type and version number:
  - content saved and published;
  - catalog published;
  - assets added and removed.

## 8. Pricing stays the owner's decision

Nothing here sets a price, a plan or a default access policy for launch.
Those are the approval checkpoints in 07. Billing and public sign-up stay
exactly as they are.
