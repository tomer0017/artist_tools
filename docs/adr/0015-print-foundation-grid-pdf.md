# 0015 — Print foundation: A4 PDFs made in the browser

**Status:** Accepted (2026-11-18). Milestone M2 of the Learn plan
(docs/learn/07-phases-qa-approvals.md); decisions A5 and A17.

**Since M3 (2026-11-18):** the "Save PDF (A4)" button is hidden on the
owner's decision (the PNG grid image is what is needed). Everything below
stays in the code, with its tests; `GRID_PDF_BUTTON` (src/lib/print/ui.ts)
brings the button back (ADR-0016 §5).

## Context
Create a Grid needed a printable result: an A4 PDF whose first page is the
reference with its grid and whose second page is the same grid, blank, for
paper. The owner's requirements:

- exact A4, portrait and landscape;
- the same grid, crop, placement and physical size on both pages, square
  cells and partial edge cells included;
- grid lines as crisp vectors;
- a 50 mm calibration bar, and "print at 100% / actual size" instructions;
- a maintained, security-reviewed library, loaded on demand;
- part of the existing save, share and print workflow;
- a new `export.pdf` entitlement, off for Free and Pro until the owner
  publishes it, authorized by the server for every PDF, failing closed.

The studio promises that images never leave the device, and it had no PDF
library.

## Decision

### 1. Made in the browser, with jsPDF 4.2.1
- **Pinned exactly** (`"jspdf": "4.2.1"`), and loaded with a dynamic
  `import()` only after the server has authorized the PDF. The studio's
  first load does not change.
- **Checked on 2026-11-18:**
  - 4.2.1 is the latest release (published 2026-03-17), and the repository
    is maintained (last change 2026-11-14). MIT licence.
  - All 15 published advisories for jsPDF (OSV) are fixed at or before
    4.2.1. The two newest, CVE-2026-31938 (critical: HTML injection through
    the "open in new window" outputs) and CVE-2026-31898 (injection through
    FreeText annotation colours), are fixed in 4.2.1 itself.
  - Its compression library is fflate 0.8.3. GHSA-px8p-9vwx-vf98 affects
    0.8.0 to 0.8.2.
  - `npm audit --omit=dev` is unchanged: the 8 documented findings, none from
    jsPDF or its dependencies (docs/security/dependency-audit.md).
- **Only a small part is used:**
  - Calls: `new jsPDF`, `addImage` (JPEG and PNG from the app's own
    canvases), `line`, `rect`, colour, width and opacity (`GState`),
    `addPage`, `setProperties`, `viewerPreferences`, and
    `output('arraybuffer')`.
  - Never called: `html()`, forms (AcroForm), annotations, `addJS`, the
    new-window outputs, `loadFile`, XMP metadata, BMP or GIF decoding, SVG.
  - So the optional html2canvas, DOMPurify and canvg are never loaded. A
    check in a real browser confirmed which scripts load before and after a
    PDF is made.
- **Alternatives considered:**
  - pdf-lib: no release since 2021-11.
  - @pdfme/pdf-lib: a maintained fork, but larger.
  - pdfkit: written for Node; needs a bundling shim in the browser.
  - A server-side PDF: it would send the user's photo to the server, which
    breaks the promise above and adds server load.

### 2. Words as images (A17)
- **How:** the browser draws the footer's words into a canvas, in the page's
  language and the app's font, and places them as PNG images.
- **Why:** Hebrew then goes through the browser's own text engine, so no
  Hebrew font file is embedded and jsPDF's simplified right-to-left handling
  is never relied on.
- **Mixed Hebrew lines** (Hebrew, numbers and `cm` on one line):
  - The parts are joined with a right-to-left mark (U+200F), so their order
    holds in Chromium and WebKit alike.
  - Isolates were tried first. WebKit's canvas ignores them.
  - The Hebrew strings drawn on the pages have no brackets, because a WebKit
    build drew them unmirrored.
- **Cost:** the words cannot be selected or searched. The PDF's title
  (metadata) is real text.

### 3. Size on paper
- **Printable area:** A4 less 12.7 mm margins on every side and a 21 mm band
  for the words and the bar.
- **Scale:**
  - The canvas prints at true size when it fits that area.
  - Otherwise it is reduced to fit, never enlarged. The page says "true size",
    or the percentage of the real canvas, and how big a square is on paper.
- **Orientation:** the one that prints the canvas larger (portrait on a tie).
  The canvas is centred above the band.

### 4. One geometry for both pages
- **Grid lines:** PDF vectors placed from the same fractions as the
  on-screen grid (`gridFractions`, `src/lib/grid/geometry.ts`). One function
  draws them on both pages: the user's colour and opacity on page 1, black
  on page 2. The border is drawn a little stronger, as on screen.
- **The photo:** drawn at 300 dpi of its printed size by the function that
  places it in the saved grid image (`imageRect`), so rotation, fit, fill,
  zoom and offsets match exactly. It is embedded as JPEG (quality 0.92) and
  fills the canvas area on page 1 only.
- **The page itself:**
  - Exactly 595.28 × 841.89 pt, swapped in landscape.
  - It asks viewers to print without scaling (`PrintScaling /None`).
  - Every page has a 50 mm bar with end marks. Right to left, the bar and
    the words sit on the right.
- **Code:** `src/lib/print` (paper constants, layout and the PDF builder,
  free of browser code, then its browser half).

### 5. Entitlement and authorization
- **The feature:** `export.pdf` ("Grid PDFs (A4)") is a new feature ID in
  `UNPUBLISHED_FEATURES`. The code's default plans leave it out of Free and
  Pro, so only admins have it until the owner publishes it for a plan in
  Admin → Plans. M2 changes no published plan.
- **Server first, every time:** each PDF asks `POST /api/usage` with
  `tool.grid` and `export.pdf` before anything is made. A refusal shows
  why; no answer or a server error makes nothing (fail closed). The PDF
  library is not even loaded then.
- **Who sees the button:** an account that has the feature; and an account
  whose plan lacks it while another plan offers it, as "Locked". Otherwise
  no one sees it.

### 6. In the save sheet
- **PDFs get their own sheet:**
  - a picture of both pages (a PNG preview: the site's CSP has
    `object-src 'none'` and `frame-src 'none'`, so no embedded PDF viewer);
  - the instruction to print at 100% and measure the bar;
  - "Save PDF" on computers;
  - "Share or print" on phones and tablets (the system share sheet has
    Print and Save to Files);
  - "Open to print", which opens the browser's own PDF viewer in a new tab.
    Checked in Chromium under the site's CSP: the viewer renders the PDF.

### 7. The rollback floor (ADR-0014)
- `export.pdf` is the first feature ID added since that floor.
- While no published catalog uses it, rolling back to `6f2159a` or `224bb65`
  is safe: the tolerant reader keeps an unknown ID without applying it.
- Once the owner publishes a catalog with it, never roll back below
  `224bb65`.

## Consequences
- **New code in the browser:** jsPDF and its dependencies, loaded only when a
  PDF is made.
- **Exact pins:**
  - `@babel/runtime` 7.29.13 and `dompurify` 3.4.17 are set in `overrides`,
    under the 14-day rule (docs/security/dependency-audit.md).
  - DOMPurify is never loaded.
- **Tests:**
  - The PDF is read back from the file, in unit tests and in real browsers
    (`src/test/pdfInspect.ts`). They check: exact A4, both pages sharing one
    frame and the same lines, the bar exactly 50 mm, and the photo placed as
    in the saved image.
  - Refusals, failures and a published plan change are covered end to end.
- **Not provable by automation:** whether a given printer prints at 100%.
  Measuring the bar on paper is the owner's check.

## Alternatives considered
- **An embedded Hebrew font subset:** selectable text, but a font file in the
  bundle, and jsPDF's right-to-left support for mixed lines.
- **Rasterizing the whole page:** simpler, but the grid lines would not be
  crisp vectors, and the files would be large.
- **Fitting every canvas to the page:** loses true size for canvases that fit
  A4, which is the point of printing a grid.
