# Measure Tool Onboarding — UX Redesign

A ground-up redesign of the Measure tool's first-run experience. It stops
*explaining the tool* and instead *demonstrates the workflow*, so a painter who
has never used a measuring tool understands what to do within ~5 seconds.

The onboarding answers exactly one question: **"What do I do first?"**

---

## What changed

**Before** — Measure used the generic, multi-screen onboarding: a preview card
("Reference → Measured") followed by a 3-step spotlight tour pointing at the
canvas, the toolbar, and the eyedropper. Plus a separate mobile-only "Set
Measurement Scale" dialog. The user clicked through several informational
screens before touching anything.

**After** — one short, illustration-led, workflow-driven experience shared by
mobile and desktop:

| Step | Trigger | What the painter sees |
|------|---------|-----------------------|
| **1. Intro** | First time on Measure with an image but no scale | A single card: the storyboard illustration, **one** short headline, example chips, **one** button — *"Draw my reference line"*. No paragraph, no second screen, no second button. |
| **2. Do it** | On closing the card | Straight onto the canvas in draw mode. A **pulsing tap target** (`TapCoach`) shows the gesture for the first point — teaching by interaction, not a sentence — backed by one quiet helper line. The coach clears the instant a point is placed (one action at a time). |
| **3. Payoff** | After the real length is entered | A short success card animates a reference line resolving into a real size + ✓ — *"Scale set — 80 cm. Every line you draw now measures the real thing."* Auto-dismisses. |

The generic multi-step tour is **removed** for Measure. Other tools keep it.

### Design-critique pass (reduce text, show don't tell)

The first build was re-audited against "can this be understood without reading /
can one interaction be removed / can an illustration replace text":

- **Cut the modal to the bone** — removed the body paragraph (the storyboard
  already delivers it) and the redundant "Skip for now" (the ✕ / backdrop
  already dismiss). What remains: picture → 6-word headline → example chips →
  one button.
- **Taught the first gesture on-canvas** — added `TapCoach`, a pulsing target
  that answers "what do I do now?" with motion instead of a sentence, so the
  painter feels they are already using the tool. First point only.

---

## The hero illustration (`hero-storyboard.svg`)

The single most important asset. It must communicate the whole workflow **with
the text removed**:

```
  ① tap one end ─────────────── ② tap the other end
                 ┌──────────┐
                 │  80 cm   │   ← enter its real size once
                 └────┬─────┘
        ● ─────────── line ─────────── ●   (across the KNOWN canvas width)
                      │ 33 cm │        ← every OTHER line now reads true
```

Design rules it follows:
- **Shows, never tells.** Numbered tap points, the drawn reference line, the
  size tag, and a *second* auto-measured line (the payoff) are all on-canvas.
- **On-brand.** Reuses the existing framed-painting motif and the app's
  `--primary` (amber) / `--foreground` tokens — no new design system.
- **Weightless & crisp.** Pure inline SVG, no binary assets, sharp at any size.
- **Animated, gently.** In-app it loops as a storyboard (dot → dot → line draws
  → size tag → payoff). The loop is disabled under `prefers-reduced-motion`.

Mockups in this folder (`*.svg`) inline the theme colours so they preview
standalone; the shipped React components use the live theme tokens.

## Copy (deliberately minimal)

- **Heading (only line of prose in the modal):** "First, measure something you know the size of"
- **Known-object chips:** Canvas · Frame · Ruler · Book · Door
- **CTA:** "Draw my reference line" (single button; dismiss via ✕ / backdrop)
- **Tap coach (Step 2):** "Tap to start" (mobile) / "Click to start" (desktop)
- **Canvas helper (Step 2):** "Draw a line over something whose real size you know"
- **Success (Step 3):** "Scale set — {size}. Every line you draw now measures the real thing."

---

## Implementation map

Components live in [`src/components/measure/onboarding/`](../../../src/components/measure/onboarding/):

| File | Role |
|------|------|
| `MeasureWorkflowArt.tsx` | The animated hero storyboard (the design asset, in code). |
| `MeasureIntroModal.tsx` | Step 1 — the single illustrated card + one CTA. |
| `TapCoach.tsx` | Step 2 — pulsing on-canvas target that teaches the first tap/click. |
| `MeasureScaleSuccess.tsx` | Step 3 — the celebratory success card. |
| `MeasureDesktopOnboarding.tsx` | Desktop wiring (mounts on the desktop canvas path only). |
| `MeasureHelpButton.tsx` | Header "?" replay for Measure (it opts out of the generic tour). |
| `useMeasureIntro.ts` | `useMeasureIntro` (once-ever + replay) and `useScaleSuccess` (fires when a scale is first set). |

Wiring:
- **Mobile** — `MeasureMobile.tsx` composes the modal + success and drives its
  local `cal` tool. The canvas already carried the Step-2 helper.
- **Desktop** — `MeasureTab.tsx` renders `<MeasureDesktopOnboarding/>`; the CTA
  switches the canvas into `calibrate` mode; `MeasureCanvas.tsx` shows the helper.
- **Opt-out** — `src/onboarding/onboardingConfig.ts` has **no** `measure` entry.

## Persistence & replay

- Stored once via the shared onboarding storage, key `measure-intro`
  (`resetOnboarding('measure-intro')` to replay from scratch).
- The header **?** button re-opens the intro anytime (via a lightweight window
  event, so it works from outside the Measure subtree). No data loss.

## Accessibility

- Modal is a labelled `role="dialog"`, Escape-dismissible, backdrop-dismissible.
- All motion respects `prefers-reduced-motion` (storyboard + success animations
  collapse to their final frame).
- Illustration carries a full descriptive `aria-label`, so it degrades to text.
