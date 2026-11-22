# 0021 — Challenges V2: a creative playground (a mood, a spin, one idea, an optional timer)

**Status:** Accepted (2026-11-22) for staging, under the founder's brief
"Creative Playground (Challenges V2)"; waiting for the founder's review. The
brief and what was built are in
[docs/learn/11-challenges-v2.md](../learn/11-challenges-v2.md). It changes
only the Challenges screen (S4 of ADR-0018) and adds one optional content
field. The course (ADR-0019, ADR-0020), the tools, plans, catalog, access
and sign-in are unchanged. Learn is still dark-launched: no published plan
includes it, so only admins see it.

## Context
The challenges were a filtered list with Random and Quick buttons. The
founder wants them to work for an artist with no idea of what to draw: open
Challenges, choose a mood or be surprised, spin, get one specific idea, draw,
perhaps with a timer, then mark it as completed, save it or spin again. It
must feel playful but professional, never like an exam or a casino. An easier
choice must never mean less talent.

Constraints of the brief:

- the 29-lesson course, the drawing tools, plans, catalog, entitlements,
  sign-in and production stay as they are;
- the existing challenge IDs and data are kept;
- no new dependency, no gamification engine (no grades, streaks, rankings,
  AI judging);
- new commercial content stays private (the repository is public);
- the timer stays right through a locked phone, a sleeping tab or a closed
  browser, with no backend timer, no notifications and no promise of an
  alarm.

## Decision

### 1. The screen (`ChallengesScreen.tsx`, `Playground.tsx`)
**First the playground:** "Need an idea?", then four moods as radio buttons.

| Mood (English) | Hebrew (the founder's words) | Draws from |
|---|---|---|
| Something light | בא לי משהו קליל | light ideas |
| Let me create | בא לי ליצור | creative ideas |
| Challenge me! | תאתגרו אותי! | challenging ideas |
| Surprise me 🎲 | תפתיעו אותי 🎲 | all of them (the default) |

- **Spin** (להגריל) picks one idea the account may open. It never repeats
  the one on screen (unless it is the only one), and it avoids the last 8
  spins while others remain. If a mood has nothing, a kind line says so.
- **The reel:** a short (1.2 s) turn through up to ten other titles that
  eases out onto the pick. It is decoration, hidden from screen readers,
  which hear "Your idea: <title>". There is no reel for people who ask for
  less motion, or when the mood has one idea. No sounds, coins or lights.
- **The idea:** its category, its effort ("Light", "Creative",
  "Challenging"), the title, the task, the twist ("Twist: …") when it has
  one, the tip, the skill it builds, and a reference thumbnail when it has
  one. Then **Save**, **Open the challenge**, **Mark as completed** (not in
  class mode; last, so its "Marked as completed · Undo" line falls before
  the timer), and the timer.
- **Below, "All challenges":** the list as before, with its filters. "Level"
  is now **Effort**, with the same values relabelled. A **Saved** filter is
  new, and a saved card shows "Saved".
- **Removed:** the Random and Quick buttons above the list (the playground
  replaces them). The Learn home keeps its own Random and Quick, and a
  challenge's page keeps "Another one", as before.

### 2. Effort, never skill (`src/lib/learn/roulette.ts`)
The challenge's existing `level` is read as the effort the person feels like:
beginner is light, intermediate is to create, advanced is a challenge. No new
field, so every existing challenge keeps working, and Admin, the filters and
plans see the same values. The words never rank people: "Light",
"Creative", "Challenging"; "whatever your level" in the lead.

### 3. The content (`src/lib/learn/model.ts`), one addition
- **`twist`:** optional, one line, at most 140 characters, both languages
  when present. It is checked in `contentIssues`, copied by name in
  `fullItem`, and kept out of the list.
- **`focus`,** which existed, is shown as the tip.
- **The categories are challenge groups.** The 8 new ones come after the 4
  existing ones; nothing existing moves.

### 4. The timer (`src/lib/learn/timer.ts`, `ChallengeTimer.tsx`)
**Off until asked for:** "Add a timer (optional)", then 10, 30 or 60
minutes, or a stopwatch, with the founder's line: "Draw whatever you can in
the time you chose. Whatever comes out is part of the fun."

**What is kept** (in this browser, `studio-challenge-timer`):

```ts
{ v: 1, challengeId, target /* ms, or null for the stopwatch */, startedAt, pausedAt /* or null */, paused /* ms paused so far */ }
```

- **What it shows is worked out from the clock** every time:
  elapsed = (pausedAt or now) − startedAt − paused. So a reload, a locked
  phone, a sleeping tab or a browser closed for hours shows the right time
  at once. The page works it out again whenever it is shown or focused. A
  one-second tick only repaints the digits; nothing counts.
- **Pause, Resume, Reset;** coming back to Challenges brings back the idea
  of the running timer. A new spin keeps the session: the timer follows the
  idea on screen (one drawing session). One timer at a time.
- **When the time is up:** "Time's up! Keep going if you like: whatever you
  drew is part of the fun." The clock shows the time drawn, and keeps
  counting. No alarm, sound, vibration, notification, penalty or failure.
- **Nothing is promised that a web page cannot do:** a closed browser rings
  nothing; the person sees the result on coming back.
- **A stored timer that does not read back exactly** (another version, a bad
  ID, a negative or impossible time) is ignored.

### 5. Saved ideas and completion
- **Saved ideas:** IDs in this browser (`studio-challenge-saved`, at most
  200, newest first). They are one store for everything on the page, so a tap
  in the playground updates the list at once; other tabs follow.
  - The mood, the idea on screen and the last spins are kept the same way.
  - No server, no account sync.
  - "Save" is also on a challenge's own page.
- **Mark as completed** is the existing one (ADR-0018): the person's own
  word, once a day, in My history, with Undo, never in class mode, nothing
  judged.

### 6. Privacy (`src/lib/device-data.ts`)
Everything the playground and the timer keep starts with `studio-challenge-`.
"Sign out and clear this device" removes it with the project and the
comparison, so the next person on a shared device does not see it. The
challenge filters stay, as before: a preference, not anyone's work.

### 7. The content itself: private
- **The 60 ideas** (CH-055 … CH-114) in 8 categories are new, original text,
  in English and Hebrew. They are private: `studio-companion-private/challenges-v2`,
  with their provenance and rights (`PROVENANCE.md`). None has a picture.
- **On staging,** they are published as content version 10. An operator
  script reads the live version 9, adds only the categories and ideas,
  proves nothing else changed (course, existing challenges, groups, other
  config, plans, grants, history) and publishes only if version 9 is still
  live (`publishIfUnchanged`).
- **The repository's test fixture** has its own synthetic challenges (one
  with a twist).

## Consequences
- **An idea in two taps,** without browsing. The list stays for those who
  browse.
- **Nothing to fail:** no score, streak or deadline; the timer only helps.
- **What one browser keeps** (saved ideas, the timer) is not on the person's
  other devices. That is the price of no new server state. It is cleared
  with this device's work.
- **No change to:** routes, collections, the database, plans, entitlements,
  the asset route, history, class mode, worksheets, tool hand-offs or the
  course.

## Rollback
**Releases before this one read version-10 content:** the schemas keep
unknown fields (`passthrough`), and `fullItem` copies fields by name.

- **The previous release (`9808770`)** shows the 67 challenges in its old
  list, with Random and Quick, and ignores the twist.
- **Content version 9** can be published again (the operator script's
  `rollback`, or Admin's restore). It keeps the 60 ideas, unpublished: a
  published ID is never deleted.
- **Browser data left behind** (saved ideas, a timer) is ignored by older
  releases.

**The floor stays `224bb65`.**

## Alternatives considered
- **A new `effort` field:** rejected. `level` already carries it; a second
  field could disagree with it, and every existing challenge would need it.
- **Saved ideas and the timer on the server:** rejected for V1. They would
  need a collection, routes, limits and export and deletion rules (ADR-0010)
  for little gain. The brief asks to reuse.
- **A server-side or service-worker timer, or notifications:** rejected by
  the brief. A web page cannot ring reliably when the browser is closed.
- **A wheel or slot machine:** rejected. A casino look; a vertical reel of
  titles says the same in 1.2 seconds.
- **A spin library or animation dependency:** rejected. CSS transitions do
  it.
