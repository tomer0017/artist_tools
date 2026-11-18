# 07 — Phased plan, QA acceptance criteria and approval checkpoints

Ordered for the highest value at the lowest risk first. Each milestone is
small, ships on its own to staging after CI, keeps a rollback path, and
waits for approval before the next one starts. Nothing in this plan has been
implemented or tested yet: no Learn code exists.

## Milestones

### M0 — Rollback safety (no visible change)
- **Why first:** today, rolling back after a catalog with any new feature
  ID is published would reset every plan to the code defaults (06 §12).
- **Scope:** the catalog keeps unknown feature IDs but ignores them, and a
  published version that fails to parse is never replaced by defaults
  (`plans` untouched; the failure is logged and shown to admins).
- **Tests:** unit tests; a migration integration test with a catalog from
  "the future"; the existing suites.
- **Done when:** released to staging and verified with `entitlement-test`.
  The next release may then add feature IDs safely.

### M1 — Create a Grid: rotation, A4, square cells, blank grid
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
- **Scope:**
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
- **Scope:**
  - content and access kinds;
  - the asset store and upload (admin only, licence metadata required);
  - the authorized asset route;
  - the access resolver;
  - `learnItem` in `/api/usage`;
  - the `learn.*` features (in no plan);
  - Admin → Learn → Access;
  - a JSON import of seed content: 3 exercises and 3 challenges with
    licensed references, visible to admins only.
- **Tests:**
  - the resolver's full rule matrix;
  - publish validation;
  - the authorization criteria below, local and on real staging;
  - `entitlement-test` extended for Learn.

### M5 — Learn screens and personal history
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

### M6 — Full admin content editor
- **Scope:**
  - English and Hebrew side by side;
  - ordering;
  - assets with licence metadata;
  - draft, diff, publish and restore;
  - "View as Free / Pro".
- **Tests:** editor e2e, validation, audit entries.

### M7 — Content production, in batches
- **Scope:**
  - the 46 drawing exercises and 50 challenges: text in both languages,
    licensed references, static worksheets;
  - reviewed by an art educator and a native Hebrew speaker;
  - published in batches (Units 0–3, 4–7, 8–10, then challenge groups).
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
8. "First N" and "Selected" open exactly the expected items. Unknown or
   unpublished IDs block publication.
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

| # | Decision | Recommendation | Needed before |
|---|---|---|---|
| A1 | This plan and its order, with M0 first | Approve as is | M0 |
| A2 | The curriculum sequence and exercises (02) | Review; ideally also an art educator | M7 (content), M4 (seed) |
| A3 | The 50 challenges (03) | Review | M7, M4 (seed) |
| A4 | Where Learn lives: Home and desktop navigation; phones through Home | Approve; revisit after measuring | M5 |
| A5 | The PDF library (one new dependency, loaded on demand) | jsPDF ≥ 4.2.1 (maintained, smallest, right-to-left text; 01 §7) | M2 |
| A6 | Content in the database as versioned publications (not in code) | Database | M4 |
| A7 | Reference sourcing: own or commissioned photos, CC0 collections, model releases; any budget | Own or commissioned plus CC0 museum collections; no stock-photo sites without legal review | M4 (seed), M7 |
| A8 | The entitlement model (module features and per-collection rules) and the dark launch | Approve; the launch policy is a separate decision at M9 | M4 |
| A9 | What locked items show in lists | Title and thumbnail | M5 |
| A10 | Class mode: its name and the 12-hour automatic end | Approve | M5 |
| A11 | Grid scope: rotation, A4, square cells, blank grid now; fine rotation later | Approve | M1 |
| A12 | Moving the Values algorithm into a module, unchanged, with golden tests | Approve | M3 |
| A13 | Analytics for Learn: none, or ids-only "opened" events | None at first | M5 |
| A14 | Who reviews the content and the Hebrew | The owner names reviewers | M7 |
| A15 | Real-staging verification with temporary accounts at every milestone | Approve as standing practice | M1 |
| A16 | Should Learn ever measure drawing accuracy (angles, proportions)? | No in v1: feedback can backfire, and the aim is less screen time (01 §2) | M5 |
| A17 | Paper and text in PDFs: A4 only or also Letter; Hebrew text as an embedded font or as images | A4 only at first; decide the Hebrew method in M2 | M2 |
| A18 | How Learn is evaluated before any claim about results (for example volunteers' before-and-after drawings) | Make no outcome claims until such an evaluation exists | M9 |
