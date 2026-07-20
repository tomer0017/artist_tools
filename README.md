# Studio Companion

A browser-based toolkit for painters and other traditional artists. Upload a
reference photo and use five focused tools to plan and execute a piece:

- **Measure** — calibrate against a real-world reference line, then measure
  proportions across the image in centimetres or inches, organised into layers.
- **Value** — reduce a photo to a fixed number of value groups, extract a
  dominant-color palette, and export value studies with paint-mixing hints.
- **Color** — an interactive color wheel with harmonies, oil/acrylic mixing
  recipes, skin-tone mixes, and an eyedropper to pick colors from the image.
- **Grid** — overlay a proportional grid on the image for grid-method drawing
  and export it as a print-ready PNG.
- **Compare** (השוואת ציור) — align a photo of your painting against its
  reference, then inspect proportion, value and color differences (overlay,
  blink, split, difference and grayscale modes) and export a still comparison,
  a difference image, or an animated GIF that reveals the mismatch.

Everything runs client-side; the active project is auto-saved to the browser's
`localStorage`. The Compare workspace keeps its own isolated session.

## Getting started

```sh
npm install      # install dependencies
npm run dev      # start the dev server on http://localhost:8080
npm run build    # production build
npm run test     # run the unit tests (vitest)
npx playwright test   # run the end-to-end Compare Art workflow test (chromium)
```

## Tech stack

- Vite + React 18 + TypeScript
- Tailwind CSS with shadcn/ui (Radix) components
- React Router (HashRouter) for GitHub Pages hosting
- Canvas 2D APIs for all image processing and exports

## Project documentation

See [PROJECT.md](./PROJECT.md) for a full breakdown of the architecture, pages,
components, and the color/value processing logic.
