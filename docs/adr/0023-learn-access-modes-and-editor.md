# 0023 — Learn: each item's own access (Free, Pro, Admin only, Blocked), edited in place in Admin → Learn

**Status:** Accepted (2026-11-24), under the founder's brief "Complete
Production Learn CMS". It carries out decisions 1 and 4 the founder approved
for the Admin Panel on 2026-11-23 (four per-item access modes as the single
source of truth; content versioning kept, Save live at once with history and
restore). It replaces how ADR-0017 decided access (the plan catalog's Learn
section); ADR-0017's content versioning, assets and resolver-per-request
stay.

## Context
Who opened which lesson or challenge was decided in two places: a Learn
module per plan in Admin → Plans, and per plan and collection a rule (All,
None or a frozen Selected list). Content came only from the server's import
command, as drafts published in Admin → Learn. The founder wants to manage
the whole curriculum and every challenge from Admin → Learn's tables, without
code, terminal commands or Admin → Plans: add, edit, copy, archive, pictures,
order, and each item's access, live at once, with history and rollback, on
production, which is the working environment until launch. All 97 existing
items must be Free after the change; the founder picks Pro items afterwards.

## Decision

### 1. One setting per item
Every exercise and challenge carries `access`: `free` (every signed-in
account), `pro` (accounts on Pro: paid, given for a time, or assigned; listed
as locked to everyone else), `admin` (admins only, for checking) or `blocked`
(nobody in the studio, admins included; still edited and previewed in Admin →
Learn). An item may also be `archived` (deleted, recoverable): in the studio
for nobody. The resolver (`src/lib/learn/access.ts`) decides from this alone,
on every request, for lists, items, pictures, completions and exports:

| Mode | Signed out | Free | Pro | Admin |
|---|---|---|---|---|
| Free | sign-in | opens | opens | opens |
| Pro | sign-in | listed, locked (403; picture 403) | opens | opens |
| Admin only | sign-in | not found (404) | not found | opens |
| Blocked / archived | sign-in | not found | not found | not found; `?preview=1` from Admin → Learn shows it, marked |

Locked Pro items show their title and thumbnail (the upgrade's teaser).
Learn appears in the studio for an account once it can see one item.

### 2. Plans no longer decide
Admin → Plans shows Learn as a read-only summary (items per mode) linking to
Admin → Learn; the Learn modules are not rows of its feature grid any more.
The catalog's Learn section and modules are kept, unchanged, in the stored
catalog (older releases read them). They decide only an item that has no
mode of its own (content written before this ADR): such an item gets exactly
the access the old rules gave it (`accessModeOf`): unpublished → Admin only;
opened by Free's rules → Free; by Pro's only → Pro; by none → Admin only.
An explicit mode is never overridden.

### 3. Saving is publishing
Each change in Admin → Learn (`src/server/learn/editor.ts`) reads the live
content, applies the one change, checks the whole document as any
publication, and publishes it as a new version through `publishIfUnchanged`
(the compare-and-swap the operator tools use). If another version went live
meanwhile, the change is applied again to it (a save to another item merges);
if this very item changed since its editor opened (its fingerprint differs),
nothing is written and the typed text stays in the form. While an imported
draft waits, nothing is saved from the tables. Free and Pro items need every
text in English and Hebrew and a lesson's rules (one picture, 1–3 task
lines, short parts); Admin only and Blocked items may be unfinished. Every
save is audited (`admin.learn_item_changed`, plus the config events).

New items take the next ID no version ever held (CH-115 after CH-114; a
lesson takes its unit's code, D-VAL-03), and start Admin only. A copy goes
right after its original, Admin only. Up/down moves within a group swap two
numbers, or give the moved item a free number between its neighbours; only
when none is free is the collection numbered afresh, 10 apart. A published
ID is never removed: archive is how an item goes.

### 4. History and restore
A version records the item IDs it changed (`config_versions.items`, indexed;
the migration fills older versions once), so an item's history is a query.
Restoring an item's earlier copy brings back its texts and pictures; its
group, place, access and archive state stay. Restoring a whole version makes
everything as it was then, after showing what it changes; items added since
stay, archived, and a version written before modes keeps each item's
current mode.

### 5. Pictures from the admin's browser
The editor re-saves each picture on a canvas (at most 3,200 px; a 400 px
thumbnail) and strips any metadata block the encoder writes, then uploads it
to `POST /api/admin/learn/assets` (admins with their second factor, same
origin, 10 MB), where it is checked by its bytes and stored by its SHA-256 as
before (ADR-0017), with its rights (own work by default). Files are never
replaced: replacing a picture stores a new one, so every version keeps its
own. Practice-sheet PDFs upload the same way.

### 6. Rolling back stays safe
Next to each mode the old `published` flag is kept true only for a Free item
that is not archived (`publishedFlagFor`). A release before this ADR reads
the flags and the catalog's rules: Free items as before, every other item to
admins only, so going back never opens anything more widely. With the
catalog's Learn rules at All for both plans (`learn-access align-catalog`),
it shows Free items exactly as this release does. New fields (`access`,
`archived`, `items`) are additions an older release ignores.

### 7. The switch-over (operator, guarded, dry run first)
`npm run db -- learn-access status | write-modes | set <mode> --all |
align-catalog`, each with `--apply` only after a dry run that prints and
checks what changes (access unchanged for Free, Pro and admins; an older
release never opening more). On production: write each item's mode (access
unchanged), then every item Free (the founder's request), then the catalog's
Learn rules to All.

## Consequences
- One place to manage content and access; a change reaches learners on their
  next request, and open studio screens refresh within a minute (the
  account's Learn key includes the content version).
- Every save stores a full content version (about 0.3 MB today). Hundreds of
  saves are tens of megabytes; pruning old versions can come later.
- After a rollback to a release before this ADR, Pro items are admins-only
  until rolled forward (never more open); Admin → Learn there is the old
  read-only page.
- e2e: `e2e/learn-admin.spec.ts` drives the editor on the plan-enforcement
  server after its own specs (playwright.config.ts).

## Alternatives considered
- **Keep per-plan rules and add per-item overrides:** two settings for one
  question, the confusion the founder asked to end.
- **Access outside the content (its own collection):** a parallel system next
  to versioned content, with its own history and rollback; the brief asked to
  reuse the versioned infrastructure.
- **Drafts with an explicit Publish:** the founder asked for Save to be live;
  safety comes from history, restore, fingerprints and Admin only for new
  items instead.
