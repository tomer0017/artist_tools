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

## Validation

Typecheck ✅ · ESLint (no new issues — baseline 3 pre-existing errors unchanged)
✅ · 60 unit tests ✅ · production build ✅ · Playwright e2e 5/5 (incl. the full
Compare workflow driving the promoted Smart Align) ✅ · scripted end-to-end
verification of Grid (init/independence/labels/empty-state, desktop + mobile),
the Compare intro (auto-show, both animations, ribbon, replay), and picker
cancel (controls re-enable, repeated cycles) — 20/20 ✅.
