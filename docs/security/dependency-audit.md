# Dependency audit

**Audited:** 2026-11-11, with `npm audit`. **Before:** 22 findings (2
critical, 13 high, 7 moderate); 15 in what npm counts as the production tree.
**After:** 8 (2 critical, 4 high, 2 moderate). The remaining 8 need major
upgrades, are documented below, and none of them runs in the production
server. One, zod, does run in production: it is in the server's own code,
with mitigations listed.

## Rules followed

- **Only fixes within the installed major version.** No unnecessary major
  upgrades.
- **Every new or changed package version was published at least 14 days
  earlier.** All were checked one by one, transitive packages included.
  `browserslist` pulled in data packages published the same day, so those
  were pinned to the newest versions at least two weeks old.
- **Fixes are exact versions in `package.json` `overrides`**, so the lock
  file cannot drift.
- **After the change:** 223 unit/integration tests, 137 e2e tests (Desktop
  Chrome and iPhone WebKit, simulated) and 36/36 visual parity all pass.

## Why npm counts test tools as "production"

`npm audit --omit=dev` still lists vitest, vite and tinypool because
better-auth declares vitest as an optional peer for its test helpers. Nothing
at runtime imports them. The standalone server bundle (`.next/standalone`)
contains only the files the server actually loads, so none of them is
deployed.

## Fixed

| Package | Was | Now | Severity | Where it runs |
|---|---|---|---|---|
| brace-expansion | 1.1.12, 2.0.2 | 1.1.21, 2.1.7 | high | Build tools (eslint, glob) |
| browserslist | 4.25.1 | 4.28.7 | high | Build (CSS prefixes); its data packages are pinned: caniuse-lite 1.0.30001819, electron-to-chromium 1.5.467, node-releases 2.0.60 |
| flatted | 3.3.1 | 3.4.2 | high | eslint cache |
| form-data | 4.0.5 | 4.0.6 | high | jsdom (tests) |
| js-yaml | 4.1.0 | 4.3.2 | high | eslint |
| lodash | 4.17.21 | 4.18.0 | high | recharts, which only the unused `ui/chart` component imports; no page loads it |
| minimatch (3.x) | 3.1.2 | 3.1.4 | high | eslint |
| picomatch (2.x) | 2.3.1 | 2.3.2 | high | Build (file watching) |
| rollup | 4.24.0 | 4.59.0 | high | vite (tests) |
| source-map-js | 1.2.1 | 1.2.2 | high | postcss (build) |
| @humanfs/node | 0.16.6 | 0.16.8 | moderate | eslint |
| ajv (6.x) | 6.12.6 | 6.14.0 | moderate | eslint |
| yaml | 2.6.0 | 2.8.3 | moderate | postcss config (build) |
| postcss-selector-parser (6.x) | 6.1.2 | 6.1.5 | moderate | Tailwind (build). 6.1.6 was 3 days old, so not used. |
| @tailwindcss/typography | 0.5.16 | **removed** | moderate (through postcss-selector-parser 6.0.10) | Not used: `tailwind.config` loads only the animation plugin, and no component uses `prose` |

## Not fixed: each needs a major upgrade

| Package | Severity | Where it runs | Can it be exploited here? | Plan |
|---|---|---|---|---|
| **zod 3.25.76** (our direct dependency) | high: memory exhaustion validating oversized constrained collections (fixed in 4.6.6) | **Production server**: input validation in server actions and API routes | **Limited.** Every server action checks the session before validating, so only signed-in, invite-only users reach it. API bodies are capped at 1–16 KB while they stream in. Server action bodies are now capped at **128 KB** (was 1 MB). better-auth uses its own zod 4.6.7, which is not affected. | Migrate to zod 4, a planned major upgrade with its own commit and the full test suite. |
| vitest 3.2.6, @vitest/mocker | critical, moderate: file read and code injection in vitest's mock and browser servers | Tests only, on the Mac and in CI | No. We do not use browser mode or the mocker server, and tests run only our own code. | vitest 4, a major upgrade for development only. |
| tinypool 1.1.1 | critical: prototype-pollution gadgets in worker options | vitest's worker pool, tests only | No. The options come from vitest's own configuration, not from input. | With vitest 4. |
| vite 5.4.19 | high: file serving in vite's development server | Used by vitest; not used to serve the app (Next.js serves it) | No. The vite development server is never started for the app, and tests run headless on localhost. | vite 6 or 7, with vitest 4. |
| esbuild 0.21.5 | moderate: CORS in esbuild's development server | Inside vite 5 | No. The esbuild serve mode is never used. | With vite. |
| glob 10.4.5, minimatch 9.0.5 | high: CLI command injection, ReDoS | Tailwind CSS build, through sucrase | No. They match patterns from our own Tailwind config at build time; the glob CLI is never called. | With Tailwind 4 (a planned design-system upgrade), or when sucrase updates. |

## Also done

- `experimental.serverActions.bodySizeLimit: '128kb'` in `next.config.ts`,
  for the zod finding above. The largest legitimate server action payload is
  an admin's plan or price document, about 10 KB.
- CI runs `npm audit --omit=dev --audit-level=critical` on every push, as a
  report (`.github/workflows/ci.yml`). It does not fail the build for the
  documented findings above; new findings show up there.
