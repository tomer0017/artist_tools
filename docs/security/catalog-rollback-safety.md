# Rolling back must never reset the published plans

**State: implemented and on staging** since 2026-11-18 15:52Z (`224bb65`,
[ADR-0014](../adr/0014-catalog-rollback-safety.md)). Approved by the owner on
2026-11-18 as a separate change. Verified on real staging (deploy/RELEASES.md),
including the rollback scenario on a throwaway copy of staging's data. Not in
production: production does not run this app yet. Found 2026-11-18 while
planning Learn. Severity: **high, latent.**

- **Latent:** it cannot happen with today's data.
- **High:** once triggered, it silently undoes the owner's published Free/Pro
  plans, the same kind of entitlement failure as the Measure & Plan bug fixed
  in ADR-0013.
- **Independent of Learn:** it applies to *any* future feature ID or catalog
  section. It must be fixed, tested and released before any release adds
  one.

## The defect

Three pieces of code combine:

1. **The catalog schema only accepts the feature IDs it knows.**
   `const Feature = z.enum(FEATURES)` in `src/server/config/catalog.ts`
   rejects any unknown ID.
2. **An unreadable published version falls back to the code defaults.**
   `publishedDocument()` in `src/server/config/versions.ts` returns
   `spec.defaults()` when the published document does not parse.
3. **Every release's migration rewrites `plans` from that result.**
   `syncPlans(db, await publishedDocument(db, catalogSpec))` in
   `src/server/db/migrate.ts`.

**Trigger:**

1. A release adds a feature ID (for example Learn's `learn.curriculum`).
2. An admin publishes a catalog that uses it.
3. Staging or production is rolled back to any earlier release.

The earlier release cannot parse the published catalog. Its migration
replaces every plan with the code defaults, silently, with no error and no
audit entry. Free would again include Measure & Plan, Compare & Correct and
GIFs.

The same fallback also breaks Admin → Plans in the rolled-back release: the
page calls `CatalogSchema.parse` and fails with an error.

## Reproduced (2026-11-18, throwaway database, today's code `be6890c`)

1. Published the owner's staging catalog: `plans.free` = Study, Color, Grid,
   saving images.
2. Simulated a newer release that published a catalog with
   `learn.curriculum`. Today's schema cannot parse it.
3. Ran today's migration, as a rollback does. `plans.free` became the code
   defaults: Measure, Study, Color, Grid, Compare, saving images, GIFs.
   `getEntitlements` for a Free account then included Measure & Plan,
   Compare & Correct and GIFs.

## Proposed fix

- **Tolerate unknown feature IDs and unknown sections.**
  - The catalog schema keeps what it does not recognise in the stored
    document and ignores it for entitlements. That covers feature IDs, and
    whole sections such as the per-plan Learn access rules proposed in
    `docs/learn/05-admin-and-entitlements.md` §4.
  - Today the schema would reject unknown IDs and silently strip unknown
    fields (zod's default).
  - An older release then reads a newer catalog correctly for every feature
    it knows, and Admin → Plans still opens.
  - Publishing from an older release carries what it does not understand
    forward unchanged; it never drops it.
- **Never replace a published version with defaults.** The defaults apply
  only when nothing was ever published (a fresh database, as today). If a
  published version exists but cannot be read for any reason:
  - the migration leaves `plans` exactly as they are and logs an error;
  - Admin → Plans shows a warning;
  - entitlements keep using the stored `plans`, which are the last ones
    published.
- **Make the order explicit.** This fix ships, and is released to staging,
  in its own release before any release that adds a feature ID. Every later
  release can then be rolled back to it safely.

No data change and no visible change for anyone.

## Tests (required before approval to release)

- **Unit:**
  - a catalog with unknown feature IDs parses and keeps them;
  - a catalog with an unknown section parses, keeps it, and publishes it
    back unchanged;
  - entitlements ignore them;
  - quotas and switched-off lists with unknown IDs behave the same way;
  - a published document that does not parse is never replaced by defaults.
- **Migration integration:** the reproduction above as an automated test.
  "Rolling back" with a newer catalog must leave `plans` unchanged.
- **Admin:** Admin → Plans opens and shows a catalog containing unknown IDs,
  with a warning, and does not offer to publish them away.
- **Regression:** the full suites (unit, integration, e2e), and the real
  staging `entitlement-test` after release.

## Rollout and rollback

- Released alone to staging, after CI and a database dump. Verified with
  `entitlement-test`. Production and GitHub Pages are untouched.
- Rolling back this fix itself is harmless while no new feature ID exists,
  because it changes no data.
- **The first new feature IDs** are `export.pdf` (M2, ADR-0015) and
  `export.worksheets` (M3, ADR-0016). Both ship unpublished, in no plan. The
  floor applies from the first published catalog that uses either: from then
  on, never roll back below `224bb65`.
- **M4 (ADR-0017)** adds three more (`learn.curriculum`, `learn.color`,
  `learn.challenges`) and the first new catalog section, `learn`. A
  catalog without it opens nothing, so it is not migrated in. Releases from
  `224bb65` to M3 keep the section and the IDs without applying them, and
  have no Learn routes: rolling back to one closes Learn. The same floor
  applies from the first published catalog that uses any of them.

## Decision

Approved on 2026-11-18 as a separate change: implemented, tested, released to
staging and reported before any Learn milestone. What was built is in
[ADR-0014](../adr/0014-catalog-rollback-safety.md). It also covers:

- settings this release knows but cannot apply (fail closed);
- malformed `plans` documents;
- a lost catalog history;
- a read-only `catalog-status` command for rollbacks.

The tests are in `src/server/catalog-rollback.test.ts`.
