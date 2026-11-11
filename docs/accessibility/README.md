# Accessibility: what is checked, what was fixed, what is still open

**Last updated:** 2026-11-11. **Status:** automated checks pass on every
scanned page, with one documented exception. **No manual audit has been done
yet.** Studio Companion therefore does **not** claim conformance with WCAG or
the Israeli standard IS 5568. The draft statement at the end of this page
must not be published until the manual audit below is done and reviewed.

## Automated checks (every e2e run)

`e2e/accessibility.spec.ts` runs axe-core 4.14.0 (pinned, through
`@axe-core/playwright` 4.14.0) against the WCAG 2.0 and 2.1 A and AA rules.
WCAG 2.0 AA is the basis of IS 5568.

| Where | Pages | Browsers |
|---|---|---|
| Public pages | `/`, `/he`, `/pricing`, `/he/pricing`, `/sign-in`, `/he/sign-in`, `/sign-up`, `/he/sign-up`, `/forgot-password` | Desktop Chrome |
| Studio (English) | Home, plans, account page, the first screen of each of the five tools | Desktop Chrome |
| Studio (Hebrew, right to left) | Home, account page | Desktop Chrome |
| Admin dashboard | Users, analytics, plans, pricing, coupons, billing, activity | Desktop Chrome |
| Phone | Home, account page, Measure, Compare | Chrome and WebKit with iPhone 13 emulation (simulated, not a real device) |

Each run writes the findings to `test-results/a11y-<browser>-*.json`.
A test fails on any finding except the documented exceptions below.

**Result on 2026-11-11, after the fixes listed below:** no findings on any
scanned page except the known exception.

### Limits of these checks

- Automated tools find only part of accessibility problems (commonly
  estimated at a third). They cannot judge whether alternative text,
  labels or reading order make sense.
- Only each tool's **first screen** is scanned. The states after a photo is
  loaded (canvas, sliders, dialogs, export sheets) are not scanned yet.

## Fixed on 2026-11-11

| Problem (axe rule, WCAG) | Where | Fix |
|---|---|---|
| Secondary text contrast 3.8–4.3:1 (`color-contrast`, 1.4.3) | Every page | `--muted-foreground` raised from 50% to 60% lightness (`#797986` → `#94949e`): at least 4.6:1 on every dark surface. The change is subtle; it was checked against screenshots, and visual parity still passes. |
| Visible text missing from the accessible name (`label-content-name-mismatch`, 2.5.3) | Home tool cards; account button; admin brand link | The cards are named by their own text, and their pictures are decorative. The account button and the brand link use visually hidden text instead of `aria-label`. |
| Zoom disabled (`meta-viewport`, 1.4.4) | Public pages, admin | `maximum-scale` removed. The studio keeps it; see the exception below. |
| Unlabelled input (`label`, 1.3.1 / 4.1.2) | Color tool, HEX field | `aria-label` added. Nothing changes visually. |
| Scrollable area unreachable by keyboard (`scrollable-region-focusable`, 2.1.1) | In-studio plans page | The area is focusable, as a named region with a visible focus ring. |
| Link distinguished by colour only (`link-in-text-block`, 1.4.1) | Admin activity log | Account links are underlined. |

## Known exception

| Rule | Where | Why, and the plan |
|---|---|---|
| `meta-viewport` (1.4.4 Resize text) | The studio (`/app…`) | The studio keeps `maximum-scale=1`, for two reasons. Its canvas tools handle pinch and pan themselves. And iOS would otherwise zoom into small text fields (such as a scale length) and stay zoomed, which breaks the canvas layout. On iOS, Safari still lets people pinch to zoom; on Android, page zoom is blocked. **Plan:** make the tools' text fields 16 px on phones (part of the tools' translation, 3b-2), then remove the limit. |

## Still to do before any conformance claim

1. **Manual keyboard pass.** Check every page and tool state with the
   keyboard alone: focus order, visible focus, no keyboard traps, Escape
   closes dialogs.
2. **Screen-reader pass:**
   - VoiceOver on iPhone (Hebrew and English) and on macOS;
   - NVDA on Windows (Hebrew and English);
   - in every tool, including what is announced for canvas content and for
     results (measurements, colours, grid).
3. **Gestures (WCAG 2.5.1).** Every pinch, drag or multi-point gesture in the
   tools (zoom, pan, Smart Align points, the comparison slider) needs a
   single-pointer or button alternative. Check what exists today.
4. **Colour as the only signal (1.4.1).** Check the tools' colour-coded
   overlays: the comparison's difference view, values, harmonies.
5. **Reflow and text size.** Check 320 px wide (1.4.10) and 200% text size
   (1.4.4) on public and account pages.
6. **Motion.** Confirm the animations (tool introductions, GIF previews)
   respect "reduce motion".
7. **Scan the remaining states.** Run axe on the tools after a photo is
   loaded, with dialogs and export sheets open.
8. **Review.** An accessibility consultant reviews the results, and the
   owner names an accessibility coordinator (needed for the statement).

## Draft accessibility statement

> **DRAFT — NOT FOR PUBLICATION.** It requires the manual audit above and
> review by a qualified accessibility consultant and an Israeli lawyer. The
> legal requirements listed (for example, the statement's contents under the
> Equal Rights for Persons with Disabilities (Service Accessibility
> Adjustments) Regulations, 2013) must be confirmed by counsel. Text in
> [brackets] is for the owner to fill in.

**Accessibility statement — Studio Companion**

Studio Companion aims to be usable by everyone, including people with
disabilities. We work towards WCAG 2.0/2.1 level AA and the Israeli standard
IS 5568. [Conformance level: to be stated only after the manual audit.]

*What we have done:*

- Pages are checked automatically on every release, in English and Hebrew,
  on desktop and on phone-sized screens.
- Text and controls meet the contrast requirements.
- Fields and buttons have accessible names.
- Hebrew pages are laid out right to left.
- Zooming is possible on all pages outside the studio.

*Known limitations:*

- Inside the studio, page zoom is limited (see above).
- The tools work on images on a canvas. What the canvas shows (the artwork,
  measurement lines, grids) is not described to screen readers.
- [Results of the manual audit.]

*Accessibility coordinator:* [name, phone, email]. We will reply within
[period].

*Last reviewed:* [date of the manual audit].
