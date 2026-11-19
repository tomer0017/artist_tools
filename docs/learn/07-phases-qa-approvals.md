# 07 — Phased plan, QA acceptance criteria and approval checkpoints

Ordered for the highest value at the lowest risk first. Each milestone is
small, ships on its own to staging after CI, keeps a rollback path, and
waits for approval before the next one starts. Nothing in this plan has been
implemented or tested yet: no Learn code exists.

**Revised 2026-11-18 after the owner's first review:**

- The former M0 is now a separate security fix, outside this plan.
- M4 uses the new storage for images and the new place for access rules.
- M7 produces 20 exercises, the core first.
- Decisions A1, A2, A6 and A8 changed, and A19 is new.

## Prerequisite (not part of this plan): the rollback-safety fix

- **What:** today, rolling back after a catalog with any new feature ID is
  published would reset every plan to the code defaults. This was reproduced
  on 2026-11-18.
- **Where:** [catalog-rollback-safety.md](../security/catalog-rollback-safety.md)
  has the defect, the reproduction, the fix, its tests and its rollout.
- **Approval:** its own. It is implemented, tested, released to staging and
  reported on its own.
- **Status:** approved, then released to staging on 2026-11-18 (`224bb65`,
  ADR-0014).
- **Order:** no milestone below that adds a feature ID or a catalog section
  (M2 onwards) starts before it is released.

## Milestones

### M1 — Create a Grid: rotation, A4, square cells, blank grid
- **Status:** approved; on staging since 2026-11-18 (`6f2159a`).
- **Scope:**
  - move the grid geometry into `src/lib/grid` unchanged (parity tests);
  - rotate 90° left/right and 180°;
  - exact A4 portrait and landscape presets;
  - a square-cell mode;
  - a zoom slider and nudge buttons;
  - a blank-grid image save (authorized like every image save).
- **Not yet:** PDF, fine rotation.
- **Tests:**
  - geometry unit tests;
  - today's PNG export unchanged for unchanged settings;
  - grids saved in the old format open exactly as before;
  - e2e in English and Hebrew, desktop and iPhone emulation;
  - axe.
- **Value:** immediately useful to painters and teachers, with no new data.

### M2 — Print foundation and the Grid PDF
- **Status:** approved by the owner on 2026-11-18 (`d261013`, ADR-0015).
  Afterwards the owner found the PNG grid image is what is needed: the "Save
  PDF (A4)" button is hidden since M3, and the PDF code and `export.pdf` are
  kept (ADR-0016 §5).
- **Scope:**
  - the chosen PDF library, loaded on demand;
  - `src/lib/print` (A4 geometry, margins, scale bar);
  - from Create a Grid, an A4 PDF: reference with grid, and blank grid;
  - the `export.pdf` feature, dark-launched (admins only until the owner
    publishes it);
  - PDFs in the save sheet.
- **Tests:**
  - parse the generated PDF in tests: page count, exact A4 size, equal
    image rectangle on both pages, scale bar of exactly 50 mm;
  - refused without `export.pdf`;
  - fail closed;
  - **owner check:** print at 100% and measure the scale bar.

### M3 — Prepare Worksheets from any image (before any curriculum exists)
- **Status:** approved 2026-11-18 and implemented (ADR-0016); on staging
  since 2026-11-18 (`8576f66`, deploy/RELEASES.md), with `export.worksheets`
  in no plan (admins only). **Approved by the owner on 2026-11-19**, after
  making the four sheets on staging with their admin account. Still open:
  the owner's checks on a real iPhone and iPad (the share sheet with several
  images, memory and time).
- **Changed by the owner (2026-11-18):** the sheets are saved as **PNG
  images**, not one multipage PDF. Each is the size of Create a Grid's
  saved image with the photo in the same place, so they line up. Canvas,
  grid and framing come from Create a Grid; Study & Simplify's Clean Outline
  and Values algorithm make the outline and values sheets. No scale bar or
  footer on the sheets.
- **Scope as planned:**
  - move the Values algorithm into `src/lib/values` unchanged (golden
    tests);
  - the worksheet composer with five pages (original, outline, reference
    with grid, blank grid, values) and one multipage PDF;
  - `export.worksheets`, dark-launched;
  - **Prepare Worksheets** buttons in Create a Grid and Study & Simplify;
  - page and grid choices remembered on the device; the image never stored.
- **Tests:**
  - the Values and sketch outputs are byte-identical to before;
  - PDF structure tests;
  - the five-students flow with own photos;
  - iPad memory and time on the owner's device.
- **Value:** the whole teacher workflow with the teacher's own photos,
  before any Learn content.

### M4 — Learn foundations (server), dark launch
- **Status:** approved by the owner on 2026-11-19 and implemented
  (ADR-0017), with their decisions:
  - the 3 exercises and 3 challenges are test content;
  - only verified CC0/public-domain images, with the rights recorded;
  - the test content may be published on staging, but no Free/Pro plan
    setting changes;
  - Learn access None for Free and Pro;
  - backup and restore verified.

  Release and verification: deploy/RELEASES.md. M5 waits for the owner's
  approval.
- **As built:**
  - The browser upload form is part of the content editor (M6). Until then
    assets are stored by `npm run db -- learn-import`, through the same
    checks.
  - A catalog without a Learn section opens nothing, so the published
    catalog was not migrated (plans stay as they were).
  - Thumbnails of locked items follow the previews setting.
  - A module no plan offers is not listed at all.
- **Scope:**
  - the content kind;
  - the Learn access section of the catalog, edited in Admin → Plans;
  - the asset directory and its backup, and admin-only upload with licence
    metadata required (06 §3);
  - the authorized asset route;
  - the access resolver;
  - `learnItem` in `/api/usage`;
  - the `learn.*` features (in no plan);
  - an import of seed content from a file outside the repository: 3
    exercises and 3 challenges with licensed references, visible to admins
    only.
- **Tests:**
  - the resolver's full rule matrix;
  - publish validation, including frozen First N lists;
  - the authorization criteria below, local and on real staging;
  - `entitlement-test` extended for Learn;
  - the restore drill with the asset directory.

### M5 — Learn screens and personal history
- **Status:** approved by the owner on 2026-11-19 "according to the revised
  Learn plan" (once Admin → Learn shows the six test items on staging), and
  implemented (ADR-0018). Release and verification: deploy/RELEASES.md. M6
  waits for the owner's approval.
- **As built:**
  - Learn is a studio view at `/app/learn/...`.
    - Its data comes from the Learn API only; pages never carry content.
    - It is shown only to accounts with a module offered (today: admins).
  - Tool shortcuts hand the reference to Measure & Plan, Study & Simplify,
    Create a Grid and Compare & Correct. Saves from it name the item, and a
    photo of the person's own is replaced only after asking.
  - Prepare Worksheets is the M3 sheet, fitted to Create a Grid's canvas,
    from cards with a reference and from "Use my photo".
  - Class mode is per tab: it never touches the history, and adds "Next
    student".
- **Scope:**
  - screens S1–S9 (04);
  - the Home entry and the desktop navigation item;
  - tool shortcuts that hand over the reference;
  - Prepare Worksheets from exercises and challenges;
  - Mark as completed and history;
  - class mode and locked states, in English and Hebrew, on desktop,
    tablet and phone.
- **Tests:**
  - e2e flows, including five students in class mode;
  - completions in the data download and removed with the account;
  - axe;
  - owner checks on iPad and iPhone.

### M6 — Lessons that teach, and the content editor
- **Status:** redesigned after M5 in [08-m6-design-review.md](08-m6-design-review.md)
  and approved by the owner on 2026-11-19 (decisions B1–B13, with the
  refinements in 08 §12). Two steps, each approved on its own.

#### M6a — the lesson format and the learner screens
- **Status:** approved 2026-11-19 and implemented (ADR-0019), with the three
  test lessons and three challenges rewritten in the template (private
  seed). Release and verification: deploy/RELEASES.md. M6b waits for the
  owner's review.
- **Scope:**
  - the lesson template and the schema additions (08 §3), read by M5 as
    well;
  - the lesson page, with the teaching visible on the page;
  - course units, "Up next", and D-START-01 as an optional baseline;
  - challenges linked to the lessons they build on, and a Skill filter;
  - tool links with presets, and "Back to the lesson";
  - the three test lessons rewritten in the template, with accurate
    diagrams drawn in code and annotated CC0 references. No invented
    demonstrations of real drawings.
- **Tests:**
  - e2e in English and Hebrew, desktop and iPhone, with axe;
  - entitlements for every new picture field;
  - M6 content read with M5's schema;
  - real staging, with Free and Pro unchanged.
- **Then stop:** the owner sees the lessons before M6b.

#### M6b — the content editor
- **Status:** waits for the owner's review of M6a.
- **Scope:**
  - English and Hebrew side by side, with a live phone preview;
  - ordering;
  - images with the rights record (08 §6.2);
  - draft, diff, publish and restore, behind the publish checklist (08 §6.3);
  - review marks;
  - "View as Free / Pro".
- **Tests:** editor e2e, validation, the rights checklist, audit entries.

### M7 — Content production, in batches
- **Scope:**
  - the 20 lessons (19 numbered and the optional baseline) in the lesson
    template, and the 50 challenges linked to them: text in both languages,
    licensed references, diagrams, photographed demonstrations of real
    drawings, and static worksheets;
  - reviewed by an art educator and a native Hebrew speaker;
  - published in batches, in the units of 08 §2.3:
    1. units 1–2;
    2. unit 3;
    3. unit 4;
    4. units 5–6, after the beginner units have been used;
    5. the challenge groups, as their lessons arrive.
- **Tests:** content validation; printed samples of every static
  worksheet.

### M8 — Colour module
The 7 colour exercises with their tool shortcuts; reviewed like M7.

### M9 — Launch readiness
- **Scope:**
  - accessibility audit and iPad performance;
  - the full real-staging verification with temporary accounts;
  - ADR and documentation.
- **Then the owner decides** the access policy and publishes it: which items
  Free opens, and whether the PDF exports are Free or Pro, with what quotas.

## QA acceptance criteria

### Every milestone
- Unit, integration and e2e tests pass locally and in CI. A test is
  reported as passing only if it ran.
- Clean Outline and Pencil Study produce identical output (existing tests
  plus golden images). Tools outside a milestone's scope behave exactly as
  before (the full e2e suite).
- English and Hebrew: message parity, right-to-left layout, axe WCAG 2.1 AA,
  on desktop and iPhone emulation.
- A dump before every deploy, staging only, and smoke, `login-test` and
  `entitlement-test` after it. Production and GitHub Pages are untouched.

### Learn authorization (M4 onwards)
Checked as Free, Pro, admin and signed out, locally and on real staging:

1. A direct URL to a locked exercise or challenge shows the locked page. Its
   HTML and page data contain no instruction, guide or reference URL
   (asserted, not eyeballed).
2. `GET /api/learn/items/<locked>` answers 403. The locked item's assets
   answer 403, including a URL that worked before access ended.
3. Lists show locked items only as the preview setting allows.
4. Random and Quick never return a locked item.
5. A worksheet PDF from a locked item is refused by `/api/usage` before
   anything is generated. With `/api/usage` unreachable, nothing is
   generated.
6. A plan change made in the admin while a card is open:
   - the card locks on the next navigation or within a minute;
   - its assets and exports are refused at once.
7. Publishing a new access rule while a card is open behaves the same.
8. A Selected list (made by First N, a whole group, or picking) opens
   exactly the listed items:
   - reordering or adding content changes no account's access;
   - the diff shows the gains and losses;
   - unknown or unpublished IDs block publication.
9. A module feature turned off locks every item of the module, whatever the
   rules say.
10. Admins see everything, including drafts. "View as" never changes the
    admin's own access.
11. Suspended or signed-out accounts go to sign-in.
12. In class mode, no completion request is ever sent (asserted on the
    network).

### PDFs (M2 onwards)
- Pages are exactly A4: 595.28 × 841.89 pt (swapped in landscape), parsed
  from the file.
- Every page of a package has the same image rectangle (within 0.01 mm).
- Content keeps at least 12.7 mm from every edge. The scale bar measures
  50 mm in the file, and 50 mm ± 0.5 mm on paper printed at 100% (owner's
  check, from a desktop and from the iPad).
- The file asks viewers to preselect no scaling (`PrintScaling /None`).
- Grid lines sit at the computed positions. Square cells are equal in both
  directions.
- Rotating, framing or cropping never changes the stored source image
  (hash before and after).

### Teacher workflow (M3 and M5)
- Five students in a row on one tablet:
  - no image uploaded twice;
  - every package's pages align;
  - "Next student" clears the image;
  - with class mode on, no history is written.
- Tap counts within the targets in 04, measured in a moderated session
  (a goal, not a gate).

## Approval checkpoints (decisions for the owner)

The M6 decisions B1–B13 are in [08 §11](08-m6-design-review.md), approved on
2026-11-19 with the refinements in 08 §12.

| # | Decision | Recommendation | Needed before |
|---|---|---|---|
| A1 | This plan and its order (M1 to M9), after the separate rollback-safety fix | Approve | M1 |
| A2 | The curriculum: 12 core exercises and 8 next steps; 18 merged and 8 deferred (02) | Approve the scope. Produce the core first; the next steps after the core has been used. Ideally reviewed by an art educator | M4 (seed), M7 |
| A3 | The 50 challenges (03) | Review | M7, M4 (seed) |
| A4 | Where Learn lives: Home and desktop navigation; phones through Home | **Built in M5 as recommended** (ADR-0018): Home and the desktop top bar; phones through Home; revisit after measuring | M5 |
| A5 | The PDF library (one new dependency, loaded on demand) | **Decided in M2:** jsPDF 4.2.1, pinned, loaded only after the server authorizes a PDF; security review in ADR-0015 and docs/security/dependency-audit.md | M2 |
| A6 | Content in the database as versioned publications, never committed to the repository (it is public) | Database; seed imported from a file kept outside the repository | M4 |
| A7 | Reference sourcing: own or commissioned photos, CC0 collections, model releases; any budget | Own or commissioned plus CC0 museum collections; no stock-photo sites without legal review | M4 (seed), M7 |
| A8 | The entitlement model, all in Admin → Plans: module and export features, plus one rule per collection and plan (All, None, Selected); First N frozen at publication; the dark launch | Approve; the launch policy is a separate decision at M9 | M4 |
| A9 | What locked items show in lists | **Built in M5 as the catalog setting** (Admin → Plans: titles, or titles and thumbnails); titles only until a Learn section says otherwise. The owner's choice for launch | M5 |
| A10 | Class mode: its name and the 12-hour automatic end | **Built in M5 as recommended** (ADR-0018): "Class mode", per browser tab, off after 12 hours without use | M5 |
| A11 | Grid scope: rotation, A4, square cells, blank grid now; fine rotation later | Approve | M1 |
| A12 | Moving the Values algorithm into a module, unchanged, with golden tests | **Done in M3:** `src/lib/values/posterize.ts`; 1,920 golden combinations and 21 saved files byte-identical before and after (ADR-0016 §2) | M3 |
| A13 | Analytics for Learn: none, or ids-only "opened" events | **None** (M5, ADR-0018) | M5 |
| A14 | Who reviews the content and the Hebrew | The owner names reviewers | M7 |
| A15 | Real-staging verification with temporary accounts at every milestone | Approve as standing practice | M1 |
| A16 | Should Learn ever measure drawing accuracy (angles, proportions)? | **No in v1** (M5 measures nothing): feedback can backfire, and the aim is less screen time (01 §2) | M5 |
| A17 | Paper and text in PDFs: A4 only or also Letter; Hebrew text as an embedded font or as images | **Decided in M2:** A4 only; words drawn by the browser as images, in the page's language (ADR-0015 §2) | M2 |
| A18 | How Learn is evaluated before any claim about results (for example volunteers' before-and-after drawings) | Make no outcome claims until such an evaluation exists | M9 |
| A19 | Where reference images live (06 §3) | **Decided and built in M4:** files on the server outside the releases and `public/`, named by hash; metadata in MongoDB; served only by the authorized route; copied incrementally with the nightly backup (ADR-0017) | M4 |
| A20 | Worksheets on their own: reachable from Home as a feature in its own right, while staying in Create a Grid and Study & Simplify | **The owner's decision (2026-11-19), for later:** recorded, not built in M4 or M5. M5 brings Worksheets to Learn's cards and "Use my photo"; the Home entry waits for the owner's go-ahead | M5 or later |
