# 0013 — What a plan includes is enforced on every route and every save

**Status:** Accepted (2026-11-18)

## Context
QA on staging (2026-11-18) found that a Free account could open and use
Measure & Plan, although the published plan catalog (version 2) removed it
from Free. The account page showed the lock, so the data was right; nothing
acted on it. Investigation found:

- **No code checked a tool's feature.** The catalog lets admins turn each
  tool on or off per plan (`tool.measure` … `tool.compare`), and
  entitlements resolved them correctly, but the tool route
  (`src/app/app/[tool]/page.tsx`) checked only the session, and the studio
  (`src/components/shell/Studio.tsx`) mounted every tool. ADR-0006 says "a
  feature needs code that checks it": the tool features never had any.
- **Saving images was never checked** (`export.image`), in any tool; only
  Compare's GIFs asked the server, and when the server could not be reached
  they went ahead anyway (fail open).
- **Two permission sources:** the plan comparison (studio and `/pricing`)
  and several texts ("all five tools are free") came from the code's
  default matrix, not from the published catalog.
- **A per-process cache** kept the plans for a minute; with Next.js an
  admin's server action could clear one module copy while pages and API
  routes answered from another.

## Decision
- **One resolver.** `getEntitlements` (src/server/entitlements.ts) remains the
  only decision, from the database alone: the account's status, role and plan
  in force, and what each plan includes as published (the `plans` documents
  that publishing writes). It is read on every request; there is no cache.
  Admins get every feature, including features switched off for everyone.
- **Every studio page sends the decision.** The layout and every page under
  `/app` (Home, each tool, account, plans) verify the session and read the
  account fresh (src/server/studio-account.ts); the studio replaces its copy
  only with a newer one (`asOf`). So direct addresses, reloads and every
  navigation inside the studio follow the plan as it is now, at no extra
  request. An open studio also asks every minute while in view, again when
  it comes back into view, and tells the account's other tabs
  (BroadcastChannel) as soon as it learns of a change.
- **A tool opens only if the plan includes it** (`useToolAllowed`). Otherwise
  its place shows a locked screen (src/components/shell/ToolLocked.tsx,
  English and Hebrew) explaining why — part of Pro, or not on any plan — with
  a way back Home and to the plans. Home and both navigation bars mark it. A
  tool that locks while open is hidden with its work kept: nothing is
  deleted, and it comes back as it was if access returns. A locked tool's
  introduction, tour and "tool opened" event never happen.
- **Every save and export is authorized by the server first**
  (`POST /api/usage`, `authorizeToolUse`): the tool it comes from must be
  included (checked, never counted) and each exported feature too (counted,
  under any quota). All saves go through one sink
  (src/components/common/SaveMedia.tsx), which requires the tool; GIFs are
  authorized before they are encoded; Measure's project file is authorized
  too. **Only a yes proceeds**: a refusal, a used-up limit or no answer at all
  (offline, server error) saves nothing and says why (fail closed).
- **Pages that describe plans use the published plans:** the plan comparison
  (studio and `/pricing`), the account page (one row per tool whenever plans
  differ by tool) and the "all five tools are free" texts, which change to
  wording that holds for any split. Public pages fall back to that neutral
  wording if the database cannot be read.
- **Tools are on or off.** A quota on a tool had nothing to count, so the
  editor offers none and the catalog drops any it is given; quotas apply to
  saves and exports.

## Consequences
- A feature switched off for a plan is unusable from that plan through any
  route the studio offers, and the server refuses its operations and exports
  even to a client that skips the studio's checks.
- A plan change or a publication reaches an open studio on its next
  navigation, within a minute while it stays open, or at once in a tab whose
  sibling learned of it; a save attempted in between is refused by the server.
- Every save now makes one small request first (no request per pointer move
  or canvas interaction). Saving needs the server to answer.
- Operators can check all of this on a live environment
  (`npm run db -- entitlement-test [--publish-check]`). A publication check
  records the live version and content, and publishes its temporary version
  and the restore only over the version it expects
  (`publishIfUnchanged`): it never overwrites an admin's draft or
  publication, and stops and says so instead.
- **Limit:** the five tools process images on the person's own device, by
  design (images never leave it). The server decides and refuses everything
  it is asked, but cannot stop someone who rewrites the studio's code in
  their own browser from running a tool's on-device code; the tools' code is
  part of the app's public files. Nothing gained that way reaches the server
  or another account. Exports from such a modified studio are not
  authorized and not counted.

## Alternatives considered
- **Locking tools only in the studio from the copy in the first page:** what
  existed for GIF options; it misses plan changes and publications while a
  studio stays open, and does nothing for direct requests.
- **A request on every tool interaction:** precise, but slow and costly for
  a canvas app; checking at navigation, every minute and at every save is
  enough to bound staleness without it.
- **Serving each tool's code only to accounts that include it:** the code is
  in public static files and the work is on the device; it would add
  complexity without a real boundary.
- **Counting tool openings for quotas:** would invent a unit (an opening,
  a session, a day) that the owner has not decided; left out until there is
  a product decision.
