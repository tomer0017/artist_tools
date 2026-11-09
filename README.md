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

Image processing runs entirely in the browser; the active project is
auto-saved to the browser's `localStorage`, and images never leave the device.
Signing in (Google) and account data (plans, usage) go through the server and
MongoDB.

## Getting started

1. Copy `.env.example` to `.env.local` and fill it in: a MongoDB connection
   string (Atlas), a Google OAuth client for `http://localhost:8080` (redirect URI
   `http://localhost:8080/api/auth/callback/google`) and a random secret. The
   file is git-ignored — never commit it.
2. Create the database indexes and plans once: `npm run db -- migrate`.

```sh
npm install           # install dependencies
npm run dev           # dev server on http://localhost:8080 (the studio is at /app)
npm run build         # production build (self-contained server in .next/standalone)
npm start             # run the production build on http://localhost:8080
npm run typecheck     # TypeScript
npm run lint          # ESLint
npm run test          # unit tests (vitest)
npx playwright test   # end-to-end tests on the production build (Chromium + iPhone WebKit)
npm run db -- migrate                 # indexes + plans (idempotent; run on every deploy)
npm run db -- find-user <email>       # a user's id (after their first sign-in)
npm run db -- grant-admin <userId>    # admin access, granted only from the server (audited)
```

Unit tests that touch the database start a throwaway MongoDB automatically;
the end-to-end tests start their own server, database and signed-in test
accounts (`scripts/e2e-server.ts`). Neither needs `.env.local`.

The public landing page is `/`; the studio lives under `/app` (`/app/measure`,
`/app/study`, `/app/color`, `/app/grid`, `/app/compare`). Old `/#/tool` links
are forwarded to the new URLs.

## Tech stack

- Next.js 16 (App Router) + React 19 + TypeScript
- Better Auth (Google sign-in, database sessions) + MongoDB
- Tailwind CSS with shadcn/ui (Radix) components
- Canvas 2D APIs for all image processing and exports (in the browser)

## Project documentation

See [PROJECT.md](./PROJECT.md) for a full breakdown of the architecture, pages,
components, and the color/value processing logic.
