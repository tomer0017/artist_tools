# Studio Companion - Project Documentation

## Project Purpose

Studio Companion is a browser-based toolkit for painters and other traditional
artists. The user uploads a reference photo once and then works through four
focused tools that share that image and a single saved project:

- **Measure** — calibrate the photo against a known real-world length and
  measure proportions across it, organised into anatomical layers.
- **Value** — reduce the photo to a fixed number of value groups, extract a
  dominant-color palette, and export value studies with paint-mixing hints.
- **Color** — an interactive color wheel with harmonies, paint-mixing recipes,
  skin-tone mixes, and an eyedropper for sampling the image.
- **Grid** — overlay a proportional grid for grid-method drawing and export a
  print-ready PNG.

Everything runs client-side. The active project (image, measurements, layers,
sampled colors, value/grid settings) is auto-saved to `localStorage`, so a
refresh restores the last session. The app is deployed to GitHub Pages under
`/artist_tools/` and uses `HashRouter` so deep links work on static hosting.

## General Architecture

```
.
├── index.html                  App shell + meta tags
├── vite.config.ts              Vite config (base "/artist_tools/", port 8080, @ alias)
├── tailwind.config.ts          Tailwind theme (HSL CSS-variable design tokens)
├── playwright.config.ts        Standard @playwright/test config (no e2e specs yet)
├── PROJECT.md                  ← this file
└── src/
    ├── main.tsx                React root; renders <App />
    ├── App.tsx                 Providers (QueryClient, Tooltip, Toasters) + HashRouter
    ├── index.css               Design tokens + utility classes (.btn-tool, .tab-button, surfaces)
    ├── App.css                 Legacy Vite scaffold styles (not imported anywhere)
    ├── pages/
    │   ├── Index.tsx           The whole app: ProjectProvider + tab Workspace
    │   └── NotFound.tsx        404 catch-all route
    ├── components/
    │   ├── layout/Header.tsx   Top bar + tab switcher
    │   ├── NavLink.tsx         Thin react-router NavLink wrapper (currently unused by pages)
    │   ├── common/ImageUploader.tsx   File picker / drag-drop → data URL
    │   ├── measure/            Measure tool (canvas, toolbar, panel, mobile, tab)
    │   ├── value/ValueTab.tsx  Value study + palette extraction
    │   ├── color/ColorTab.tsx  Color wheel, recipes, skin tones
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

The app is intentionally a **single page** (`/`) that swaps tool panels based on
the `activeTab` value in the project store — not a multi-route SPA. `HashRouter`
exists only to serve that page and a 404 fallback from GitHub Pages.

## Pages

### Workspace — route `/` (`src/pages/Index.tsx`)
- **Purpose:** The entire application. Hosts the four tools behind a single
  tab bar.
- **Features & functionality:**
  - Renders `<Header />` (title + tab switcher) above a `<main>` that shows
    exactly one tool based on `activeTab` (`measure` | `value` | `color` |
    `grid`).
  - Maintains a CSS custom property `--app-height` tracking
    `visualViewport.height`, so iOS Safari/Chrome toolbars and the on-screen
    keyboard don't cause `100vh` layout jumps. The root element uses
    `height: var(--app-height, 100vh)`.
- **Key components used:** `Header`, `MeasureTab`, `ValueTab`, `ColorTab`,
  `GridTab`, all wrapped in `ProjectProvider`.
- **State & data:** Reads `activeTab` from the project store. All tool state
  lives in the store or in each tool's local component state.

### Not Found — route `*` (`src/pages/NotFound.tsx`)
- **Purpose:** Catch-all for unknown routes.
- **Features & functionality:** Logs the attempted path to the console and shows
  a 404 message with a link back to `/`.
- **Key components used:** None beyond router `useLocation`.
- **State & data:** None.

## Core Components

### Layout & shared
- **Header** (`layout/Header.tsx`) — Sticky top bar showing the "Studio
  Companion" title and the four tab buttons (Measure / Value / Color / Grid).
  Reads/sets `activeTab` from the store.
- **NavLink** (`NavLink.tsx`) — `forwardRef` wrapper around react-router's
  `NavLink` adding `activeClassName`/`pendingClassName` compatibility props.
  Present but not used by the current single-page UI.
- **ImageUploader** (`common/ImageUploader.tsx`) — Reusable uploader with a full
  drop-zone variant and a `compact` icon-button variant. Validates the MIME
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
  (toggle visibility, set active) and measurement lines (rename label, delete),
  plus actions: Export PNG (image + drawn lines), Export JSON (full project),
  Clear all lines, New project (both with inline confirm).
- **MeasureMobile** (`measure/MeasureMobile.tsx`) — A purpose-built
  touch-first Measure experience (kept separate so desktop is untouched).
  Adds: a magnifier loupe while dragging endpoints, large hit-targets,
  bottom-sheet panels (layers / selected line / reference / precision / more),
  precision nudge controls, an export-preview modal with Web Share / Save Image
  / Download, and extensive iOS visual-viewport / keyboard handling.

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
  - **Color Wheel** — interactive hue ring + saturation/value square, hex
    input/copy, harmonies (complementary, split-complementary, analogous,
    triadic, warm/cool variants), and "pick from image" eyedropper. Picks up a
    hex handed off from the Measure tab via `sessionStorage`.
  - **Mixing Recipes** — curated paint recipes grouped by family (greens,
    purples, oranges, pinks, browns, neutrals) with ingredient swatches,
    percentages, and notes.
  - **Skin Tones** — light/medium/dark cards with base/shadow/highlight mixes.
  - Plus a "Painter Cheat Sheet" shown under each sub-tab.

### Grid tool
- **GridTab** (`grid/GridTab.tsx`) — Renders a canvas of configurable
  proportions with an overlaid grid. The image can be dragged, pinch/wheel
  scaled, and fit/fill/centered. `GridControls` (a sub-component) sets canvas
  size + unit, quick aspect-ratio presets, grid columns/rows, line
  color/opacity/thickness, and image scale. Exports a high-resolution PNG.

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
  that display real-world lengths; organise lines into 6 default anatomical
  layers (general, eyes, nose, mouth, jaw, hair) with per-layer visibility;
  rename/label lines; select and drag endpoints; undo/redo; pan/zoom;
  shift-constrain to horizontal/vertical; show/hide all measurements; reset
  view; eyedropper color sampling into a session palette; export annotated PNG.
  A dedicated mobile UI adds a magnifier, precision nudging, bottom sheets, and
  share/save/download of the export.
- **Value:** grayscale / color / painter modes; 3/5/7/9 value groups; focus
  modes (all / shadows / lights / squint); contrast & brightness (hue-preserving)
  sliders; dominant-color palette extraction with warm/cool classification and
  paint-mixing hints; value isolation; before/after compare; fullscreen; export
  processed image, palette, or a composed study sheet.
- **Color:** interactive HSV wheel; hex input/copy; 6 color harmonies;
  warm/cool nudging; pick a color from the image; ~24 paint-mixing recipes;
  skin-tone mix cards; painter cheat sheet; hand a chosen color to the wheel
  from a sampled swatch in Measure.
- **Grid:** configurable canvas ratio (cm/in) with presets; adjustable
  columns/rows; line color/opacity/thickness; drag/scale/fit/fill/center the
  image; export a 2400px-wide PNG.

## Color Logic & Processing

This is the heart of the project and lives in two files.

### ColorTab — generative color theory (`components/color/ColorTab.tsx`)
- **HSV ⇄ RGB ⇄ Hex** conversions (`hsvToRgb`, `rgbToHsv`, `hsvToHex`,
  `hexToHsv`) drive the interactive wheel. The hue ring maps pointer angle to
  hue; the inner square maps x/y to saturation/value.
- **Harmonies** are computed by rotating hue: `shiftHue(hex, deg)` produces
  complementary (180°), split-complementary (150°/210°), analogous (±30°), and
  triadic (120°/240°) sets.
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
   palette quantization yields clean color masses instead of speckle.
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
6. **Value groups** (the distribution strip / palette rows) are rebuilt from the
   per-bin averages with percentage coverage, hex, warmth, and paint hint.

`brightnessLabel` (darkest→highlight) and the warmth/family classifiers are
reused across the strip, palette rows, and the exported study sheet so labels
stay consistent.

### Grid & Measure geometry
- **Grid** math (`GridTab`) computes a fit scale so the image fills the chosen
  canvas ratio, then layers offset/scale transforms for drag/pinch/wheel, and
  draws evenly-spaced column/row lines plus a border, mirrored between the live
  preview and the 2400px export.
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
  (`pushUndo` snapshots the lines array before add/delete/clear).
- **Local component state** handles transient UI: drafts and tool modes in the
  Measure components, processing results and view toggles in `ValueTab`, the
  selected color and sub-tab in `ColorTab`, and drag/pinch state in `GridTab`.
- **Cross-tool handoff** uses `sessionStorage` key `use-color-in-tab`: a sampled
  swatch in Measure stashes a hex and switches to the Color tab, which reads and
  clears it on mount.
- **React Query** (`QueryClient`) is provided in `App.tsx` for parity with the
  original scaffold but is not currently used for data fetching (the app has no
  backend).

## Key Dependencies

- **react / react-dom (18)** — UI runtime.
- **vite + @vitejs/plugin-react-swc** — dev server (port 8080) and build.
  `base` is `/artist_tools/` for GitHub Pages.
- **react-router-dom (HashRouter)** — serves the single page + 404 from static
  hosting.
- **tailwindcss + tailwindcss-animate + @tailwindcss/typography** — styling via
  HSL CSS-variable design tokens defined in `index.css`.
- **shadcn/ui + @radix-ui/\*** — accessible UI primitives in `components/ui`
  (the app mainly uses tabs, tooltip, and the Sonner/Toaster notifications).
- **lucide-react** — icon set used throughout the toolbars and controls.
- **@tanstack/react-query** — provider wired up; no active queries yet.
- **sonner / next-themes / class-variance-authority / clsx / tailwind-merge /
  zod / react-hook-form** — standard shadcn supporting libraries.
- **vitest + @testing-library/react + jsdom** — unit testing (`npm run test`).
- **@playwright/test** — installed for future e2e; `playwright.config.ts` is a
  standard self-contained config (no specs committed yet).
- **gh-pages** — `npm run deploy` publishes `dist/` to GitHub Pages.

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
  clipboard copy and the `sessionStorage` color handoff now log on failure.
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
