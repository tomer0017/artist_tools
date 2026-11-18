# 0016 — Prepare Worksheets: aligned PNG sheets from one photo

**Status:** Accepted (2026-11-18). Milestone M3 of the Learn plan
(docs/learn/07-phases-qa-approvals.md); decision A12.

## Context
M3 lets an art teacher or student turn their own reference photo into
practice sheets:

1. the original;
2. a clean outline;
3. the reference with its grid;
4. an optional blank grid;
5. a values study.

The plan made them one multipage A4 PDF, on the M2 print foundation
(ADR-0015). After M2 the owner found that the PNG grid image is what is
needed. On 2026-11-18 they asked for:

- the "Save PDF (A4)" button hidden, its code and entitlement kept;
- worksheets saved as PNG images;
- the existing tools and algorithms reused rather than duplicated;
- a simple, mobile-friendly interface in Hebrew and English;
- no change to the published Free/Pro permissions.

## Decision

### 1. Sheets are PNG images, all the size of Create a Grid's saved image
- **Same size and crop:** every sheet is Create a Grid's export size
  (2400 px wide, at the canvas's proportions), with the photo in exactly the
  place that image gives it (`imageRect`). So the sheets line up: a student
  can lay any two over each other.
- **Original:** the photo where it goes, on white paper.
- **Outline:** Study & Simplify's Clean Outline, as Study draws it:
  - traced by the sketch engine at Study's working size, in a worker of its
    own that is shut down afterwards;
  - with the Clean Outline settings set in Study;
  - drawn from its vector paths (the same `drawPaths` as Study's own PNG
    save) at about its size on the sheet, then placed like the photo.
- **Reference with grid, and blank grid:** Create a Grid's own saved images,
  unchanged (`drawExport`). The reference sheet is the same file as "Save
  grid image", byte for byte.
- **Values:** Study & Simplify's Values algorithm in gray, 3 or 5 values, at
  Study's neutral contrast and brightness. It works at about the photo's
  size on the sheet (never above the photo's own pixels, within the
  device's limit), and is drawn without smoothing, so only the study's grays
  reach the sheet. White paper around it.

### 2. Nothing is drawn twice (decision A12)
- **The Values algorithm moved out of `ValueTab`** into
  `src/lib/values/posterize.ts`, cut and pasted, not rewritten. The only
  change: it returns its results instead of setting React state.
- **Golden unit test:** the code as it was (`d261013`) runs beside the moved
  module on noise, gradients and colour patches. Every mode, 2 to 9 values,
  every focus, three contrast and brightness pairs and isolation must give
  the same pixels and palettes: 1,920 combinations. A one-character change
  to the module fails it.
- **In a real browser:** Study's saved files were compared before and after
  the move. The study, palette and study sheet in five settings, the
  on-screen study, and the Clean Outline PNG: 21 files, byte for byte
  identical.
- **The grid sheets** are Create a Grid's functions. The outline is the
  sketch engine (its path drawing moved into `drawPaths`, used by Study's
  save and by worksheets).

### 3. Where it lives
- **Create a Grid:** a "Prepare worksheets" button beside the image saves.
  On phones it reads "Worksheets", with the full name for screen readers.
  The set uses this grid's canvas, grid and framing.
- **Study & Simplify:** in the header on computers, and in the Adjust sheet
  on phones. The set uses Create a Grid's canvas and grid; a photo that is
  not Create a Grid's is fitted to the canvas, and the sheet says so.
- **One sheet, three steps:** choose sheets, make, save.
  - Choose: the blank grid is off at first; Values offers 3 or 5.
  - Make: the sheets are made one after another, with progress; the memory
    in use stays about one sheet.
  - Save, on computers: "Save all", or one sheet at a time.
  - Save, on phones and tablets: one share sheet for all of them (Save
    Images, Save to Files, Print), and the files can be saved too.
- **Remembered on this device:** the choices only. The photo is never
  stored by worksheets.
- **"Save all" downloads go 400 ms apart.** WebKit (Safari) keeps only the
  last of several downloads started at once; this was measured in Chromium
  and WebKit.

### 4. Entitlement and authorization
- **The feature:** `export.worksheets` ("Worksheets") is a new feature ID in
  `UNPUBLISHED_FEATURES`. The code's default plans leave it out of Free and
  Pro, so only admins have it until the owner publishes it for a plan in
  Admin → Plans. M3 changes no published plan.
- **The button** shows only where it can be had, or as "Locked" where
  another plan offers it.
- **A set asks the server first**, before anything is made:
  - if the chosen sheets are the other tool's work, that tool alone
    (`tool.grid` or `tool.study`, checked, nothing counted);
  - then the tool it was opened from, with `export.worksheets` and
    `export.image`. Both are counted, because the sheets are saved images:
    a plan without Saved images gets no worksheets.
- **Fails closed:** a refusal says why, and no answer or a server error
  makes nothing.

### 5. The PDF button is hidden, everything behind it kept
- **One switch** hides "Save PDF (A4)": `GRID_PDF_BUTTON` in
  `src/lib/print/ui.ts`.
- **Kept:** the PDF code, `export.pdf` and their tests. The unit tests run
  the PDF button's code with the switch on. The PDF interface e2e tests
  follow the switch. The plan-change test for `export.pdf` now runs against
  the server.

### 6. Found on the way: Study's saves under the CSP
- **The bug:** Study & Simplify turned its study, palette and study sheet
  (data: URLs) into files with `fetch()`. The site's Content-Security-Policy
  (`connect-src 'self'`, since 2026-11-11) refuses that, so those saves
  silently did nothing.
- **The fix:** `dataUrlToBlob` now decodes in the page; the CSP stays as
  strict.
- **Tests:** an e2e test saves all three.

## Consequences
- **New code:** `src/lib/worksheets` (sheets, making), `src/lib/values`
  (moved) and `src/components/worksheets/PrepareWorksheets.tsx`. No new
  dependency.
- **Two unpublished feature IDs** now exist: `export.pdf` and
  `export.worksheets`. The rollback floor (ADR-0014) applies from the first
  published catalog that includes either.
- **PNG sheets are large.** A photo sheet is about 5–15 MB, like the grid
  image the owner approved.
- **Not on the sheets:** no scale bar or words. Exact physical size is the
  grid image's job, as before.
- **Not verified on real devices:** iPad memory and time (plan M3 test), and
  the iOS share sheet with several images. These are the owner's checks.

## Alternatives considered
- **One multipage A4 PDF, as planned:** rejected by the owner for now. The
  M2 code stays, behind the hidden switch.
- **A ZIP of the images:** one download, but an extra step to open, and no
  Photos on phones.
- **New drawing code for worksheets:** duplication, and sheets that would
  drift from what the tools show.
