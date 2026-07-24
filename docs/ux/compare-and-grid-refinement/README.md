# Compare Art & Grid — Workflow-First Refinement

This sprint made two existing tools (Compare Art, Grid) obvious for a first-time
painter, and fixed a picker bug that could strand the user. No new features —
the goal was that every screen answers *"what do I do next?"* without reading.
Same philosophy as the redesigned Measure onboarding.

---

## Part 1 — Grid opens ready, with its own document

**Before:** Grid opened to an empty grid. The only way to add an image was to
dig into the Grid Controls panel. The user faced a grid with no image and no
obvious action.

**After:**
- **Never opens empty when a reference exists.** Grid gets its own working image,
  seeded once from the main reference (`initGridImageFromReference` in the
  project store). If a reference already exists, the grid shows it immediately.
- **Independent document.** After that one-time seed the two are fully decoupled:
  replacing the Grid image never touches the main reference, and changing the
  main reference later never overwrites the Grid image. State lives in the store
  (`gridImage`, `gridImageInitialized`) so it survives tab switches and reloads.
- **Image action is a primary, always-visible control** — not buried in a panel.
  Its label adapts: **Upload Image** ↔ **Replace Image** (desktop bottom bar +
  mobile top bar). A centered dropzone appears only when no reference exists at
  all, so the first action is unmistakable.

## Part 2 — Compare Art teaches the workflow, not the features

**Before:** Compare used the generic multi-card tour and felt like disconnected
tools. It wasn't clear why two images are needed, which one moves, what Smart
Align does, or why the GIF export exists.

**After** — a dedicated, visual first-run onboarding (`src/features/compare-art/onboarding/`),
in the same spirit as Measure’s:
- **One card, two animated workflows, minimal text:**
  - **A — Overlay & fade:** the painting sits over the reference; its opacity
    fades so differences show through; the two blink (that’s *why* GIF export
    exists — mistakes pop).
  - **B — Smart Align:** tap two matching points on each image and they snap into
    alignment automatically.
  - A quiet ribbon shows the one continuous flow: **Load → Align → Compare →
    Grid (optional) → Export GIF.** One CTA: *Start comparing*.
  - Animations are pure inline SVG on theme tokens, looped, and disabled under
    `prefers-reduced-motion`.
- **Smart Align is now a primary action** — a prominent button in the on-canvas
  alignment status card, discoverable the instant the workspace opens (it also
  remains inside the Align sheet). Grid stays a natural bottom-bar step.
- Compare **opts out** of the generic tour (no entry in `onboardingConfig.ts`);
  the header **?** replays the new intro via `CompareHelpButton`.

## Part 3 — Cancelling the image picker no longer strands the user

**Bug:** `openImagePicker` (Compare) only resolved on the file input’s `change`
event. Desktop browsers fire **no** `change` on cancel, so the promise hung
forever → the caller’s `busy` flag stuck → its upload buttons stayed disabled
with no way to recover.

**Fix:** the picker now always settles exactly once, from whichever signal comes
first — `change` (a file, or none), the native `cancel` event, or window `focus`
returning with no file (fallback for browsers without `cancel`). It also tears
the hidden input down cleanly, so repeated open/cancel cycles behave. The same
robust pattern was applied to the shared `ImageUploader`.

---

## Implementation map

| Area | Files |
|------|-------|
| Grid independent image | `src/hooks/useProjectStore.tsx` (`gridImage`, `gridImageInitialized`, `setGridImage`, `initGridImageFromReference`), `src/types/project.ts`, `src/components/grid/GridTab.tsx` |
| Compare onboarding | `src/features/compare-art/onboarding/` (`CompareWorkflowArt`, `CompareIntroModal`, `CompareHelpButton`, `useCompareIntro`), `CompareArt.tsx`, `onboardingConfig.ts` (opt-out), `Header.tsx` |
| Smart Align promotion | `src/features/compare-art/CompareArt.tsx` (`startSmartAlign` + status-card CTA) |
| Picker cancel fix | `src/features/compare-art/compareArtImage.ts`, `src/components/common/ImageUploader.tsx` |

---

## Polish sprint (follow-up) — Compare feels like one workflow

A second pass turned Compare Art from "a set of features" into one continuous,
painter-oriented workflow.

### Onboarding rebuilt as a story (not a feature list)
`src/features/compare-art/onboarding/CompareOnboardingArt.tsx` +
`CompareIntroModal.tsx`:
- A **Load → Align → Compare → Grid → Export GIF** ribbon shows the whole
  journey at a glance.
- The same journey is then told **two ways** as numbered comic-strips:
  **A — Overlay & fade** (load → drag → fade → mistakes appear → GIF) and
  **B — Smart Align** (tap eye on painting → same eye on reference → repeat →
  *snaps into place* → GIF). Each strip reads without its captions.
- A **"Why export a GIF?"** panel *actually blinks* between a painting and a
  reference so the value is felt, not explained.
- All inline SVG, theme-aware, reduced-motion-safe. One CTA: *Start comparing*.

### Persistent alignment toolbar (Part 2 of the brief)
`CompareArt.tsx` now shows a dedicated right-side **alignment toolbar** the whole
time both images are loaded: **Smart Align · Manual · Lock & Zoom**. This
replaced three problems at once:
- Smart Align used to live in a status card that **disappeared** after use — it
  is now always one tap away (run → adjust manually → run again).
- Lock & Zoom used to **float over** the Smart Align control — now they're
  separate rows in one toolbar; nothing overlaps.
- Manual and Smart alignment **coexist** as equal, always-visible tools (the
  Manual sheet is now purely the manual toolkit; the bottom bar dropped its
  redundant "Align" item). The toolbar hides only during the brief Smart Align
  tap sequence, which has its own prompt.

### Extensible crop presets + painter formats (Part 3 of the brief)
Crop presets are now a **data-driven registry** (`CROP_PRESETS` in
`compareArtCrop.ts`) — id, label, aspect (`number | 'original' | null`), optional
`shape`. Added **A5 / A4 / A3** (portrait ISO ratio) that behave exactly like the
existing ratio presets. Adding future formats (A2/A1, square/round canvas,
50×70/60×90/70×100 cm) is a one-line entry — no logic changes.

## Validation

Typecheck ✅ · ESLint (no new issues — baseline 3 pre-existing errors unchanged)
✅ · 60 unit tests ✅ · production build ✅ · Playwright e2e 5/5 (incl. the full
Compare workflow driving the promoted Smart Align) ✅ · scripted end-to-end
verification of Grid (init/independence/labels/empty-state, desktop + mobile),
the Compare intro (auto-show, both animations, ribbon, replay), and picker
cancel (controls re-enable, repeated cycles) — 20/20 ✅.
