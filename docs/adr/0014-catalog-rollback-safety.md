# 0014 — Rolling back never resets or widens the published plans

**Status:** Accepted (2026-11-18)

## Context
While planning Learn (docs/learn), an inspection found a latent hazard in the
plan catalog. It was reproduced on a throwaway database with `be6890c`
(docs/security/catalog-rollback-safety.md):

1. A release adds a feature ID, and an admin publishes a catalog that uses it.
2. Staging or production is rolled back to an earlier release.
3. **The earlier release cannot parse that catalog.** Its schema accepts only
   the feature IDs it knows (`z.enum(FEATURES)`).
4. **It falls back to the code's defaults.** `publishedDocument()` returned
   them for any published version that did not parse.
5. **Its migration writes those defaults to `plans`** (`syncPlans` in
   `src/server/db/migrate.ts`). This is silent: no error, no audit entry.

Free would get Measure & Plan, Compare & Correct and GIFs back: the class of
failure ADR-0013 fixed.

Three related gaps:

- **Admin → Plans failed with an error** on such a catalog.
- **Sections were dropped.** A catalog section the earlier release did not
  know (zod strips unknown keys) would have been removed the next time an
  admin published from it.
- **A lost history meant the defaults.** A database whose catalog history was
  lost, with `plans` intact, would have started again from the more generous
  defaults.

## Decision
- **Read tolerantly, apply only what is known.**
  - A stored catalog is read with `StoredCatalogSchema`
    (`src/server/config/catalog.ts`). Feature IDs are any short string, and
    unknown keys are kept at every level: the top level, `plans`, and each
    plan entry.
  - `readCatalog()` returns what this release applies (`catalog`, its known
    features only), the document as stored (`stored`), and what it keeps
    without applying (`unknown`).
  - Nothing unknown is ever granted.
- **Fail closed on what is known but cannot be applied.**
  - A setting on a known feature that this release cannot apply withholds
    that feature from that plan (status `partial`). Such settings include a
    quota with a period it does not know, a malformed quota, a quota with
    extra fields, and a quota on a tool.
  - Read this way, a catalog never grants more than it was published with.
- **Never replace a published version with the defaults.**
  - `publishedDocument()` throws `UnreadableConfigError` for a published
    version that does not parse; the defaults apply only when nothing was
    ever published.
  - The migration reads the published catalog itself. If it is unreadable,
    `plans` is left exactly as it is (the last plans applied), the report
    says `unreadable`, and an error is logged.
- **Never drop what is not understood.**
  - "Start a draft" and "Restore as draft" copy the stored document,
    unknown parts included.
  - The editor's form is validated by the strict `CatalogSchema` (known IDs
    only; an unknown ID is refused). `saveCatalogEdit` merges it into the
    draft with `mergeKnown`, which replaces only the known IDs and keeps
    everything else, in place.
  - A version this release cannot apply in full is never saved, published
    or restored from it (`ConfigSpec.check`). Admin → Plans then shows why
    and turns editing off; discarding a draft and restoring an earlier,
    readable version stay possible.
- **`plans` documents are read fail closed too.** In `planStateOf`
  (`src/server/entitlements.ts`):
  - unknown IDs are ignored;
  - a cap that cannot be read allows no use;
  - a plan without a readable shape includes nothing;
  - each problem is logged once per process.
- **A lost history starts from what is in force.** With no published catalog
  but existing `plans`, version 1 is made from the plans in force
  (`initialCatalog`), not from the defaults.
- **Operator support:**
  - `npm run db -- catalog-status` (read only) shows the published version,
    its fingerprint, how this release reads it, and whether `plans` is in
    step;
  - the migration prints the same summary;
  - `entitlement-test --publish-check` records and restores the stored
    document exactly, and refuses to run on a catalog it cannot apply in
    full.
- **The compatibility rule for every later release:**
  - new feature IDs and new sections may be added freely;
  - a new kind of restriction on a feature that earlier releases know must
    also be written in the fields they read (`features`, `quotas` with
    `day`/`month`, `disabled`). They then enforce it at least as strictly;
  - the catalog's existing fields keep their shape.

## Consequences
- **Rolling back to this release or any later one keeps the published
  plans** for every feature the target release knows. This holds with the
  migration (a re-release) and without it (an instant switch of `current`).
- **This release adds no feature ID and writes nothing new into a catalog.**
  Rolling back from it to `be6890c` or earlier stays safe, as long as no
  release after this one has published a new feature ID or section. From
  then on, never roll back below this release (deploy/README.md, Rolling
  back).
- **An older release ignores a newer kind of restriction** that is written
  only in a new section, so the compatibility rule above is required. It is
  part of the review of every release that changes the catalog.
- **Withholding can show less than was published:** a feature with a setting
  the release cannot apply is unavailable there, rather than unlimited.
- **No data changed and no visible change:** with today's catalog,
  everything is known and applied as before.

## Alternatives considered
- **Refuse to start, or fail the migration, on an unknown catalog.** A
  rollback would then be impossible exactly when it is needed.
- **Keep unknown IDs out of the stored document.** Admins would lose a newer
  release's settings by publishing from an older one.
- **Ignore a setting that cannot be applied** (a quota whose period is
  unknown). That makes the feature unlimited: more than was published.
