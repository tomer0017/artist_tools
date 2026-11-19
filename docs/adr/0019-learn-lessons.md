# 0019 — Lessons that teach: the lesson template, the optional baseline, challenges linked to lessons

**Status:** Accepted (2026-11-19); its lesson page (§4) and publishing rules
(§2) are revised by [ADR-0020](0020-beginner-lessons.md), after the owner's
review of M6a. Milestone M6a of the Learn plan, designed
in [docs/learn/08-m6-design-review.md](../learn/08-m6-design-review.md) and
approved by the owner with ten refinements (08 §12). It changes ADR-0018's
exercise card into a lesson, and keeps everything else of ADR-0018 and
ADR-0017. Dark launch, as before: no published plan includes a Learn module,
so only admins see Learn. M6b (the content editor) waits for the owner's
review of M6a.

## Context
After M5 the owner found that the Drawing Course and the Challenges felt the
same: both showed a reference and asked to copy it. The cause was structural:
one card for both, the teaching folded behind "More help", and no place in
the content for a demonstration, steps or a self-check.

The owner's refinements that shape M6a:

- D-START-01 is an optional baseline; the first lesson teaches pencil
  control and line exercises.
- The Values and light unit teaches shading simple 3-D forms explicitly.
- The prototype uses accurate diagrams drawn in code and annotated,
  rights-verified references, and never invents demonstrations of real
  drawings.
- The experience stays concise and visual on phones, with no teaching
  hidden in an accordion.
- Challenges stay separate from the course, and every tool stays one tap
  away.
- M5's security checks, history, Free/Pro settings and compatibility are
  kept.

## Decision

### 1. The content: additions only
- **A lesson** is an exercise with `steps`. Its parts (`src/lib/learn/model.ts`):
  - `demo`: 1–6 pictures with a caption each ("See it");
  - `steps`: 3–6 steps, each with an optional picture, tool link or the
    worksheet ("Do it");
  - `checks`: 2–4 questions ("Check it");
  - `mistake.image`: an optional picture for the common mistake;
  - `skill`: the one skill in a few words, for the course list;
  - `minutes`: a typical time, never a timer;
  - `optional`: the baseline drawing (not numbered).
- **Every M5 field stays required** and keeps its meaning: `instruction` is
  the lesson's one-line summary, `guide` its "Why it works", `success` its
  "Done when".
- **Course units are groups** with an optional `level` (beginner,
  intermediate) and `summary` (the unit's goal).
- **A challenge** gains `lessons` (the 1–3 lessons it builds on) and an
  optional `focus` line. `skill` and `skillArea` stay.
- **A tool link** (`ToolLink`) names a tool, says what it is for, and may
  carry a preset: Study & Simplify's values (3, 5, 7, 9, 11 or 13, its own
  steps) with or without Squint, or Create a Grid's columns and rows (1–16).

**Why additions only:** content is read tolerantly (ADR-0014, ADR-0017), so
a release that knows only M5's fields still reads M6 content and shows a
lesson as M5's plainer card. A test parses published M6 content with a frozen
copy of M5's schema (`src/server/learn/lessons.test.ts`), so rolling back to
`ab42467` stays safe. An exercise without `steps` keeps M5's card, so content
can be converted one lesson at a time.

### 2. What is checked before publishing
In `contentIssues` (`src/server/learn/content.ts`):

- **A published lesson has its parts:** a demonstration, 3–6 steps and 2–4
  checks, every text in English and Hebrew.
- **Its parts are short:** a caption 160 characters, a step 220, a check
  140, the skill line 60, "Why it works" 400, a challenge's focus 140. This
  keeps a lesson readable on a phone, with nothing folded away.
- **Structure, for drafts too:**
  - a preset only for its own tool, within that tool's steps;
  - a worksheet step only in a lesson that has a worksheet;
  - a demonstration or checks only with steps;
  - a challenge's lessons must exist and be named once;
  - a `level` only on course units.
- **Every picture** (references, and demonstration, step and mistake
  pictures) is a stored reference image with a complete licence record and
  an intact file, as references were before.
- **The rights record:** own and commissioned work may have no source page
  (`source: null`); every other kind still needs one. Admin → Learn shows
  "Own work, no source page". The rest of the rights record designed in
  08 §6.2 comes with the editor (M6b).

### 3. What learners receive
- **An open item is copied field by field, nested fields included**
  (`fullItem`, `src/server/learn/present.ts`): its two languages per text, a
  step's text, picture, tool and worksheet mark, nothing else. A reviewer's
  note, or any field a newer release adds, never leaves the server, at any
  depth.
- **A list row** adds what lists may show of any item, locked ones included
  (docs/learn/05 §5):
  - for an exercise, its `skill` line, whether it is `optional`, and whether
    it is a `lesson`;
  - for a challenge, the IDs of the `lessons` it builds on.

  Its picture is a lesson's first demonstration frame, or the first
  reference, where previews allow.
- **The asset route serves every picture an item uses** (`itemAssetIds`):
  references, demonstration, step and mistake pictures, and a static
  worksheet. Each goes only to accounts that may open an item using it, as
  before. A locked lesson's 403 carries only its list entry.

### 4. The screens
- **A lesson** (`src/components/learn/LessonCard.tsx`), in this order:
  1. the objective, time and materials;
  2. **See it**, a carousel (`DemoCarousel.tsx`): one picture at a time,
     with buttons, dots and a counter. Swiping works on phones, and the
     full-screen button sits in its header, never over a picture: pictures
     do not mirror for right to left, so a corner may hold content;
  3. **Do it**, the numbered steps, with the subject as step 1's picture,
     tool links inside the steps, and the worksheet in its step;
  4. **Check it**, checkboxes ticked for oneself, never saved and never sent;
  5. **the common mistake**, with its picture;
  6. **Done when**, then Mark as completed and "Next: Lesson n" (the main
     button once the lesson is done today, or in class mode);
  7. **Practise it** (the challenges that build on the lesson), **Tools
     that help** (quick access to every tool the lesson names), **Why it
     works** (a short visible note), and Previous / All lessons.

  Only the picture credits fold. On a tablet in landscape and on desktop,
  See it stays in view beside the steps.
- **The course** (`CurriculumScreen.tsx`):
  - units with their level, goal and a quiet "1 of 2 done" (numbered
    lessons only);
  - lessons numbered in order, the baseline marked "Optional";
  - each row with its skill line;
  - "Up next" on the first numbered lesson not done. Color, a module of its
    own, is numbered on its own and has no "Up next".
- **The Learn home and Home:**
  - two doors. The course leads straight to "Start: Lesson 1 · …" or
    "Continue: Lesson n · …", with "Unit 2 of 6 · …" and, until the course
    has started, "Optional first: the baseline". The challenges have Random,
    Quick and Browse.
  - one line for people who already draw;
  - Class mode at the bottom, "For teaching a class".
  - Home asks for the course list and, outside class mode, the person's
    completions. Class mode is read from the tab there too, so in class mode
    nothing about the history is asked for anywhere.
- **Challenges:**
  - a Skill filter, whose values are the course's units (a challenge's skill
    is the unit of the lessons it builds on);
  - "From life", "From your photo" or "From memory" instead of an empty
    picture;
  - on the card, the focus line and "Builds on: Lesson n · …" (a lock when
    locked, nothing when the course is not offered).
- **"Lesson" replaces "Exercise"** in the interface (Hebrew: שיעור).
- **The rules** for numbering, "Start", "Up next", "Next", the units and
  the Skill filter are pure and tested once (`src/lib/learn/course.ts`,
  `src/lib/learn/pick.ts`). Nothing is a prerequisite.

### 5. Tool links, presets and the way back
- **A step's tool link opens the tool with the lesson's subject**, through
  ADR-0018's hand-off (the authorized route, the replace question, the item's
  mark on saves).
- **Its preset is applied as if the person had chosen it:**
  - Study & Simplify switches to Values with that number of values (and
    Squint when asked);
  - Create a Grid switches to columns × rows.

  Nothing else in the tool changes, and a tool the plan does not include
  opens on its locked page with nothing set.
- **"Back to Lesson n · …"** (`ReturnBar.tsx`, `src/hooks/useLearnReturn.ts`):
  - a slim bar above any tool opened from a lesson or a challenge;
  - it lives in memory and ends on leaving the tools, on taking it, on its
    "×", or on a reload;
  - it is the only addition to the tools.

### 6. The test content (private, never committed)
The owner's three test lessons and three challenges are rewritten in the
template (`studio-companion-private/learn-seed-m6a`, with the tools that
regenerate it):

- **D-START-01:** the optional baseline;
- **D-LINE-04:** Lesson 1, pencil control and line exercises, with a static
  A4 warm-up page;
- **D-SHAPE-01:** Lesson 2;
- **CH-002, CH-012 and CH-017:** linked to the lessons they build on.

**Pictures** (refinement 4):

- eight diagrams drawn in code from geometry: ellipses at computed
  roundness below eye level, a cube projected in perspective, a cone's sides
  as true tangents;
- two annotated CC0 pictures: the still life in three values by Study &
  Simplify's own Values algorithm (bundled unchanged), and the mug cropped,
  with three numbered markers;
- no image generator, and no invented demonstration of a real drawing.

Each has a rights record: own work, or a CC0 derivative naming its source.

## Security and privacy
- **Unchanged:** no Learn content in any page or page data; one resolver;
  pictures and worksheets served only to accounts that may open an item using
  them; the Content Security Policy.
- **Checked by tests:**
  - a locked lesson sends nothing of its steps, demonstration or checks, and
    its pictures are refused;
  - a list row of a locked lesson has only its title, skill line and place;
  - nested unknown fields never leave the server;
  - in the dark launch, Free and Pro get a bare 403 for a lesson and every
    one of its pictures;
  - a challenge open to Free shows nothing of a course no plan offers it.
- **The self-check is never stored or sent.** Presets change only the
  person's own tool settings on this device.

## Consequences
- **Rolling back to `ab42467` (M5):**
  - M5 reads M6 content and shows lessons as plain cards;
  - the Skill filter, links and presets disappear;
  - the floor stays `224bb65`.
  - An own-work asset with no source page would fail M5's licence check only
    if content were published under M5; serving is unaffected.
- **Producing a lesson is the real cost** (08 §4, §9): diagrams, step
  pictures and captions in two languages. The template's limits keep each
  lesson small.
- **Not built yet:**
  - the editor, the full rights record, review marks and "View as" (M6b);
  - photographed demonstrations of real drawings (with real artwork, M7);
  - the other 17 lessons and the remaining challenges (M7).

## Alternatives considered
- **A separate lesson type with its own collection:** it would change IDs,
  access rules and history. An exercise with steps keeps all three.
- **The demonstration stacked instead of a carousel:** simpler, but four
  pictures would push the steps several screens down on a phone.
- **Showing the reference first, as in M5:** it keeps the "copy this"
  reading the owner found. A lesson leads with its demonstration; the subject
  is step 1.
- **Saving the self-check:** it would add a record per question, and a
  score in all but name. It stays the learner's own.
