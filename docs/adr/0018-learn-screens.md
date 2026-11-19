# 0018 — Learn screens: the studio's Learn view, personal history and class mode

**Status:** Accepted (2026-11-19). Milestone M5 of the Learn plan
(docs/learn/07-phases-qa-approvals.md), approved by the owner "according to
the revised Learn plan". It takes the plan's recommendations for A4 (where
Learn lives), A10 (class mode), A13 (no analytics) and A16 (no accuracy
measurement), and builds A9 (what locked items show) as the catalog setting
it already is. Built on ADR-0017 and ADR-0013.
Dark launch, as before: no published plan includes a Learn module, so only
admins see Learn.

## Context
M4 (ADR-0017) built Learn's server: versioned content, private references,
per-item access in Admin → Plans, one resolver, and the authorized routes.
M5 adds what people use, as planned in docs/learn/04 (S1–S9). The owner's
priorities for it (2026-11-19):

1. A polished, intuitive, phone-first Learn.
2. The Learn home, the course, the challenges, exercise and challenge cards,
   and the history.
3. The 3 exercises and 3 challenges available to admins for real testing.
4. The existing tools and Worksheets used where relevant, without
   duplicating them.
5. Locked content clearly marked, with nothing protected leaked.
6. Hebrew right to left and English left to right throughout.
7. The teacher/class workflow only within M5's approved scope.
8. Learning to draw on paper, not digital painting.
9. Free/Pro permissions and every tool preserved.
10. Navigation, history, entitlements, accessibility and phone layouts tested.

Not in M5: the content editor (M6) and the full curriculum (M7).

## Decision

### 1. Where Learn lives (A4)
- **A studio view** with a screen per address (`src/lib/learn/routes.ts`):
  - `/app/learn` (S1);
  - `/app/learn/curriculum` (S2);
  - `/app/learn/exercises/<id>` (S3);
  - `/app/learn/challenges` (S4);
  - `/app/learn/challenges/<id>` (S5);
  - `/app/learn/history` (S8).

  The tools stay mounted behind it, so opening a tool from a card and coming
  back loses nothing. Learn's code loads only when Learn is opened.
- **Entry points:** a "Learn to draw" section on Home, and a Learn item in the
  desktop top bar. On phones Learn is reached from Home: the bottom bar keeps
  its six items.
- **Shown only when it means something:** the account copy every studio page
  sends (`AccountSummary.learn`, `learnSummaryOf`) says whether Learn appears
  at all (an admin, or a module some published plan offers) and each
  collection's state: open, locked, or absent.
  - Learn's pages send everyone else Home, as an unknown address would.
  - With today's catalog, Free and Pro see no Learn anywhere.

### 2. Where a screen's data comes from
- **From the Learn API only** (`/api/learn/items`, `/api/learn/items/<id>`,
  `/api/learn/completions`), decided per request by the one resolver. Pages
  verify the session and send the account; **they never carry Learn content.**
  - This differs from 06 §5's sketch, in which pages sent the data. The
    studio renders in the browser only, so there was nothing to gain from it.
  - One path for every screen means a page and a refresh can never disagree.
- **Asked again:**
  - on every visit to a screen;
  - when the tab comes back into view;
  - every minute while it is in view;
  - at once when the account's Learn access changes. `learn.key` changes
    with the modules and the rules, and the account copy is refreshed every
    minute and across tabs (ADR-0013).

  So an open card locks within a minute of a plan change (QA criterion 6,
  tested end to end). Its images and exports are refused by the server at
  once.

### 3. The screens (docs/learn/04)
- **S1 · Learn home:**
  - the drawing course, with "Start" or "Continue: <next exercise>" from the
    person's own completions;
  - the challenges: Random, Quick, All;
  - the class mode switch.

  No progress bars, streaks or badges.
- **S2 · Course:** the groups in order, curriculum then color. Each row has
  the exercise's number, title and small picture, how many times it was
  completed, and a lock when locked. Items not yet published are marked
  "Draft · admins only" (only admins see them).
- **S3/S5 · Cards:**
  - **Reference:** large, opening full screen with pinch, scroll and keyboard
    zoom.
  - **The task:** the short instruction or prompt, then what is needed or
    practised.
  - **Actions:**
    - Prepare worksheets;
    - Print worksheet (a static sheet);
    - Use my photo (a challenge drawn from one's own photo);
    - Mark as completed;
    - Another one (challenges).
  - **Tool shortcuts.**
  - **More help, folded:** why, how, the common mistake and its fix, when
    it is done, and the picture credits.
  - **Layout:**
    - on a tablet in landscape and on desktop, the reference on one side and
      the text on the other;
    - on phones, one column, with the reference small enough that the
      actions show without scrolling past it.
- **S4 · Challenges:**
  - filters in one row (level, subject, pencil or color, quick only),
    remembered on this device;
  - Random and Quick;
  - every challenge as a card.
- **S8 · My history:** completions newest first, removed with one tap; a
  plain count only here.
- **S9 · A locked item:**
  - **In lists:** its title and a lock. A thumbnail shows only where the
    catalog's previews setting allows (A9, Admin → Plans); without a Learn
    section it is titles only.
  - **At its own address:** the locked page, saying "Part of Pro", "Locked"
    or "not on any plan", with Back to Learn and Compare plans.
  - **What the server sends:** its 403 now carries what a list shows of the
    item (title and place), and only when lists show it. The instructions,
    guide and references are never sent.

### 4. Tools and Worksheets, not duplicated
- **A tool shortcut fetches the reference from the authorized route.** A
  reference that is no longer open is refused there too. The picture stays
  on this device, marked with its item:
  - **Measure & Plan, Create a Grid:** the project store's picture, with
    `imageLearnItem` / `gridImageLearnItem`, saved with it. Any other picture
    clears the mark.
  - **Study & Simplify:** its own photo for the visit, so the shared photo is
    untouched.
  - **Compare & Correct:** its reference, with `referenceLearnItem` in its
    session. It takes the picture through a hand-off channel
    (`src/hooks/useLearnHandoff.ts`), so it still shares nothing with the
    project store.
  - **Before replacing a photo of the person's own, it asks.**
- **Every save and export made from a marked picture names the item** in
  `/api/usage` (`learnItem`, M4). The server refuses it once the item is no
  longer open, and the studio says why. Other requests are sent exactly as
  before (`fromLearn`).
- **Prepare Worksheets** is the M3 sheet, unchanged in what it makes. From a
  card it is fitted to Create a Grid's canvas, as from Study, and authorized
  with the card's item. It is offered:
  - for exercises with a generated worksheet;
  - for challenges with a provided reference;
  - from "Use my photo", whose picture names no item and never leaves the
    device.

  It is locked or hidden exactly as in the tools, since `export.worksheets`
  is still in no plan.
- **A static worksheet** ("Print worksheet", for exercises whose sheet is a
  PDF in the content) is part of the item, like its reference: the asset
  route serves it to accounts that may open the item, with nothing counted.
  Whether it should also need `export.worksheets` and count against its
  quotas is the owner's choice, once static sheets exist (M7); no content
  has one yet.

### 5. Completions and history
- **Collection `learn_completions`:** `{ userId, itemId, completedAt,
  contentVersion }`, with two indexes (newest first, and per item). Several
  per item are allowed.
- **API** (`src/app/api/learn/completions`):
  - **record:** only an item open to the account at that moment, so locked
    answers 403 and unknown or unpublished answers 404. At most 10,000 per
    account (409): years of daily practice, and a cap on what every visit
    counts;
  - **list:** one's own, 50 a page, with counts per item, and titles only
    where lists would name the item;
  - **remove:** one's own only; another person's entry is 404, like a
    missing one;
  - **safeguards:** same-origin writes, a 1 KB body, and 60 changes per 10
    minutes per account on top of the Learn limit.
- **In the studio:** once a day (the button then reads "Completed today"),
  with Undo for 8 seconds.
- **The person's data:** in the account's data download, and removed with the
  account (`removeUserData`, ADR-0010).

### 6. Class mode (A10)
- **A setting of this browser tab,** not an account or a role, kept in
  `sessionStorage`. It ends with the tab, when switched off, or after 12
  hours without use.
- **While it is on:**
  - Mark as completed and the history are hidden;
  - the studio never requests anything about the history, not even reading
    it (asserted on the network in e2e);
  - the challenges shown are remembered only in this tab, so Random and
    "Another one" do not repeat them.
- **Prepare Worksheets** adds **Next student:** back to the challenges with
  the same sheet choices, the picture cleared.
- **Tested:** five students in a row.
- **No student data exists anywhere.**

### 7. Random and Quick
Pure rules (`src/lib/learn/pick.ts`):
- they pick only challenges the server says are open, so never a locked one;
- they match the filters;
- they skip the 5 most recently completed and those just shown, relaxing
  that rather than finding nothing;
- "Another one" is never the challenge on screen while another exists.

### 8. Also
- **Plan comparison:** Learn rows (Drawing course, Color course, Drawing
  challenges) appear once a published plan offers a module, like the
  exports.
- **Admin → Learn:** each live item links to its card in the studio, for the
  owner's testing.
- **No analytics (A13)** and **no measurement of drawings (A16).**

## Security and privacy
- **No Learn content in any page or page data**, for anyone (asserted). Lists
  and the locked page get only titles and places, as before.
- **The history is the person's own:**
  - written only for an open item;
  - read and removed by its owner only;
  - titles only for the items in it.
- **The mark on a handed-over picture lives in this browser,** so a person
  can remove it. It keeps honest saves honest; it does not stop copying, as
  nothing shown on a screen can. The protection is the server: it sends a
  reference only while the item is open.
  - The server uses the mark only to refuse, never to allow.
  - A handed-over reference stays in its tool on this device until it is
    replaced, like any photo there. Signing out with "clear this device"
    removes it.
- **An open item sends its known fields only** (`fullItem`): content is read
  tolerantly, so anything else an item carries (a reviewer's note) never
  leaves the server.
- **Unchanged:** the Content Security Policy, the auth flow and the Learn
  routes' caching. New routes follow the same rules: 401 signed out, 503
  fail closed when content cannot be read.

## Consequences
- **Rolling back to `324e136` (M4):**
  - the code returns, with no Learn screens;
  - `learn_completions` stays, unused, and is removed with accounts again
    once M5 is back;
  - the catalog and plans are untouched, and the rollback floor is still
    `224bb65`.
- **Every Learn screen asks the API.** Lists are a few kilobytes, thumbnails
  are cached and revalidated, and well within 600 requests per 10 minutes.
- **Not built yet:**
  - the content editor and "View as" (M6);
  - Worksheets on their own from Home (A20);
  - the S6 frame editor and multipage PDF of the original design (the
    owner's M3 choice of aligned PNG sheets stands);
  - a fixture with a static worksheet PDF (the button is built and served by
    the M4 route).

## Alternatives considered
- **Pages that send each screen's data** (06 §5's sketch): one round trip
  less on a cold load, but two paths to keep in agreement, for a studio that
  renders only in the browser.
- **A seventh bottom-bar item on phones:** rejected in A4. It makes every
  label harder to tap; Home leads to Learn.
- **Fingerprinting a handed-over picture instead of marking it:** it fails
  where a tool keeps a re-encoded copy (Compare & Correct's saved session).
  An explicit mark set and cleared by the tools is exact.
