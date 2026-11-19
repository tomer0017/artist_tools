# 08 — M6 design review: a course that teaches, challenges that practise

**Status: approved by the owner on 2026-11-19,** decisions B1–B5 and B7–B13,
with ten refinements. They are recorded in §12 and applied throughout this
document. B6 is settled for M6a by refinement 4. **M6a** (the lesson format
and the learner screens) is approved; **M6b** (the editor) waits until the
owner has seen M6a.

The review answers the owner's finding on M5, before any M6 code:

> The Drawing Course and Challenges currently feel too similar. Both mostly
> present a reference image and ask the learner to copy it.

M5 stays as it is on staging (`ab42467`). Free and Pro still open no Learn
content, and production is untouched.

## Contents

0. Summary
1. Why the two feel the same
2. Curriculum audit and the proposed progression
3. The lesson template, and the challenge brief
4. Visuals: which lessons need diagrams or step-by-step pictures
5. UX: minimal changes
6. The M6 content editor
7. What stays unchanged
8. Audit of the four CC0 reference images
9. Risks
10. Milestones
11. Decisions
12. The owner's refinements (2026-11-19)

---

## 0. Summary

- **The course becomes lessons, and challenges stay briefs.**
  - **A lesson** teaches one skill through seven parts:
    1. objective;
    2. "See it", a visual demonstration;
    3. "Do it", 3–6 guided steps on paper;
    4. "Check it", 2–4 self-check questions;
    5. the common mistake;
    6. tools placed in the step where they help;
    7. "Done when", then the next lesson.
  - **The reference photo moves** from the top of the page into step 1, as
    "your subject".
  - **A challenge** stays one screen: a subject, a prompt, its level,
    medium and skill, and links to the lessons that teach that skill. It has
    no steps and no demonstration, and it works without the course.
- **The 20 lesson IDs stay.** They are regrouped into six units that
  follow the owner's order: pencil control, shapes, seeing, proportion,
  values, then subjects.
  - **D-START-01 becomes an optional baseline drawing,** not numbered. The
    course starts with Lesson 1, pencil control and line exercises
    (D-LINE-04).
  - Units 1–4 (11 numbered lessons and the baseline) are the beginner path;
    units 5–6 (8 lessons) are intermediate.
  - Four real moves: lines before shapes; the grid method into the beginner
    path; the portrait out of it; and the complete drawing to the end of
    the composition unit.
  - **The Values and light unit explicitly teaches shading simple 3-D
    forms:** the light source, core shadow, cast shadow and gradual value
    transitions.
- **Visuals do the teaching:**
  - 14 lessons need a diagram (11 of them essentially);
  - 17 need a step-by-step sequence (5 essentially);
  - 15 can use annotated photos made with the studio's own tools;
  - the optional baseline only marks where to look on its photo: no
    teaching before it, by design.
  - **No words inside images:** captions carry the words in each language.
- **The editor (M6) supports exactly these two templates.** Fields are in
  English and Hebrew side by side, with a live phone preview.
  - Every image needs a rights record before publication, and nothing
    without confirmed commercial use can be published.
  - It uses the existing draft → diff → publish → restore flow.
- **Milestones:** **M6a**, the lesson format and screens, shown on staging
  with the three test lessons, then **M6b**, the editor.
  - **M6a's pictures** are accurate diagrams drawn in code and annotated
    versions of the rights-verified CC0 references. No demonstration of a
    real drawing is invented: photographed demonstrations wait for real
    artwork.
- **The four CC0 images are verified.**
  - The museum's API, its object pages, the files' own embedded metadata
    and its policy all say CC0.
  - The underlying works date from the 1700s and 1800s, and our files are
    the museum's pictures, uncropped.
  - Commercial use: yes for all four. Nothing is unverified that affects the
    rights; the minor flags are in §8.

## 1. Why the two feel the same

The M5 screens follow the plan (04, S3 and S5), which drew both cards from
one template:

- **The same page:** a title, a large picture, one sentence, "Mark as
  completed", and tool chips.
- **The teaching is hidden.** In an exercise it sits behind "More help", as
  a paragraph of guide text, so the visible task is "draw this".
- **Nothing shows how.** The content model has no place for a
  demonstration, a sequence of steps or a self-check. An exercise is a task
  description (objective, instruction, guide, mistake, success), not a
  lesson.
- **The test pictures are things to copy.** All four are museum photographs
  of objects and paintings. In a lesson they read as "copy this", exactly as
  in a challenge.

The fix is in the content structure first and the screens second. The
course does not need more exercises; each one needs a different shape.

## 2. Curriculum audit and the proposed progression

### 2.1 What the current 20 get right

- **They train what the research links to accuracy** (01 §1): looking,
  measuring, checking, values, and big shapes before detail.
- **Their IDs are stable,** their order and titles are separate from the
  IDs, and nothing is timed, mandatory or gamified.
- **Every one already has** an objective, a common mistake and fix, and a
  success criterion: the raw material of a lesson.

### 2.2 What needs to change

1. **The order does not follow a beginner progression.**
   - Lines (D-LINE-04) come after shapes.
   - The portrait (D-HEAD-04) is core exercise 12, before any lesson on the
     figure, the eye or the head.
   - The grid method (D-COPY-01), the most beginner-friendly exercise and the
     one best supported by the studio (Create a Grid, Worksheets), is a
     "next step" at 13.
2. **"Core" and "Next steps" say nothing about what is learned.** Units
   named after skills do, and they double as the skill filter for
   challenges (§3.4).
3. **Some exercises bundle several skills:**
   - D-SHAPE-01: big shapes, and simple forms;
   - D-VAL-01: a value scale, three values, and hatching;
   - D-LIGHT-01: five light families on three objects;
   - D-PERSP-01: eye level, plus one- and two-point perspective;
   - D-FIG-01: gesture, and proportions.

   The template's steps carry one skill through a sequence, so no split is
   needed now. If the educator wants two lessons for perspective or the
   figure, the reserved IDs D-PERSP-02 and D-FIG-02 can be restored with
   their original meaning (§2.4).
4. **They are written as tasks, not lessons.** That is the owner's finding.
   §3 fixes it with one template.
5. **Pencil control is deliberately short** (01: hand control rarely limits
   accuracy). It stays short but comes first, and it adds the most
   practical beginner habit: light lines first, dark lines last.

### 2.3 The progression (approved)

The display number comes from the position; the optional baseline has no
number. No ID changes.

| # | Was | ID | Title (draft; changes in *italics*) | The one skill | Practise with |
|---|---|---|---|---|---|
| | | | **Beginner** | | |
| | | | **Unit 1 · Start: pencil control** (התחלה: שליטה בעיפרון) | | |
| Optional | 1 | D-START-01 | A first drawing from life *(optional baseline)* | Look more than you draw; keep the drawing to compare later | — (a one-off, redone after lesson 11) |
| 1 | 3 | D-LINE-04 | *Pencil control: lines and ellipses* | Confident light lines and ellipses, dark lines last | CH-002, CH-005, CH-012, CH-014 |
| | | | **Unit 2 · Seeing shapes** (לראות צורות) | | |
| 2 | 2 | D-SHAPE-01 | Big shapes and simple forms | Simplify: one big shape, then simple forms | CH-006, CH-012, CH-015, CH-016, CH-017, CH-022, CH-023, CH-048 |
| 3 | 4 | D-OBS-02 | Negative space | Draw the empty shapes | CH-004, CH-013 |
| | | | **Unit 3 · Measuring and proportion** (מדידה ופרופורציות) | | |
| 4 | 13 | D-COPY-01 | The grid method | Transfer square by square: the scaffold | CH-017, CH-019, CH-021 |
| 5 | 5 | D-OBS-03 | Angles and alignments | Check directions with the pencil | CH-026 |
| 6 | 6 | D-OBS-04 | Relative measurement | Compare sizes against one unit | CH-001, CH-026 |
| 7 | 7 | D-OBS-06 | Block-in: from the big shape to the small | Straight lines, big to small, curves last | CH-001, CH-010 |
| 8 | 8 | D-COPY-02 | A measured copy, checked and corrected | Find and fix the largest error, without a grid | CH-001, CH-017 |
| | | | **Unit 4 · Values and light** (ערכים ואור) | | |
| 9 | 9 | D-VAL-01 | *Values: an even scale and gradual transitions* | An even value scale and smooth, gradual transitions; then three values | CH-030, CH-031, CH-042, CH-043 |
| 10 | 10 | D-LIGHT-01 | *Shading simple forms in light* | Ball, box, cylinder and cone under one light source: light side, core shadow, reflected light, cast shadow, and gradual transitions on round forms | CH-003, CH-007, CH-008, CH-018 |
| 11 | 11 | D-OBS-07 | A still life from life, start to finish | Put it together; then redo the baseline and compare | CH-007, CH-009, CH-010 |
| | | | **Intermediate** | | |
| | | | **Unit 5 · Space and composition** (מרחב וקומפוזיציה) | | |
| 12 | 14 | D-PERSP-01 | Eye level and perspective from observation | Eye level and converging lines as a check | CH-011, CH-027, CH-028, CH-029 |
| 13 | 19 | D-SUBJ-02 | Landscape: big shapes and depth | Depth through planes and values | CH-015, CH-031, CH-032, CH-033 |
| 14 | 20 | D-SUBJ-04 | A complete drawing | Plan in thumbnails, finish one drawing | CH-049, CH-050 |
| | | | **Unit 6 · People** (דמות ודיוקן) | | |
| 15 | 15 | D-FIG-01 | Gesture and figure proportions | Gesture first, then head lengths | CH-020, CH-024, CH-025, CH-044–CH-047 |
| 16 | 16 | D-FIG-04 | Hands | The hand's structure | CH-039, CH-040, CH-041 |
| 17 | 17 | D-COPY-03 | Constructing and shading an eye | A feature as a form | CH-037, CH-038 |
| 18 | 12 | D-HEAD-04 | A portrait from a photo | A measured portrait, checked against averages | CH-034, CH-035, CH-037 |
| 19 | 18 | D-HEAD-02 | The head turning | The head as a form turning in space | CH-036, CH-038 |

**Why these moves:**

- **The baseline is optional** (the owner's refinement 2).
  - It is offered before Lesson 1 and again after the still life (lesson
    11), when redrawing it shows progress without a grade. Compare &
    Correct can lay the two drawings over each other.
  - It is not numbered, and it is skipped by "Start", "Continue", "Next
    lesson" and the unit counts.
  - Its ID, history and entitlements are unchanged: it is the same
    published item, marked `optional`.
- **Pencil control comes first,** in the owner's order. Light construction
  lines are needed by every later lesson.
- **The grid as a scaffold, then faded:**
  - lesson 4 gives an early, accurate copy with external help;
  - lessons 5–7 teach doing the same by eye (angles, measurement,
    block-in);
  - lesson 8 copies without a grid and checks the result in Compare &
    Correct.

  This follows the research's caution that transfer aids bypass freehand
  proportion skill (01 §4): the scaffold is taught, then taken away. If the
  educator prefers, the grid can come after block-in instead; nothing else
  changes.
- **Values and light teach shading simple 3-D forms explicitly** (the
  owner's refinement 3):
  - lesson 9: an even value scale, and smooth, gradual transitions;
  - lesson 10: the ball, box, cylinder and cone under one light source,
    with the light side, core shadow, reflected light and cast shadow, and
    gradual transitions on the round forms against the flat planes of the
    box;
  - lesson 11 applies both to a still life from life.
- **Faces after the fundamentals:** a measured portrait needs proportion,
  values, the eye and the head's structure first. It is still one tap away
  for anyone who wants it, since nothing is locked by prerequisites.
- **Perspective opens the intermediate part,** and the complete drawing
  (thumbnails to a finished drawing) closes the composition unit.
- **Every numbered lesson has challenges to practise with,** and each of the
  50 challenges in 03 builds on one to three lessons (the last column). These
  links are a first draft, for the educator to review in M7.

### 2.4 IDs and history

- **No ID is added, removed or reused.**
  - The 20 lesson IDs stay.
  - The 26 merged or deferred IDs stay reserved (02).
  - An ID can only come back with its original meaning, and only if the
    educator asks.
- **Order and units are content, not code.** The new progression is a new
  content version made of groups and an order. Version 1 stays in the
  history, and restoring it works as today (published IDs are kept,
  unpublished).
- **Completions stay valid.** They are recorded by ID, and each lesson keeps
  its skill, so "D-SHAPE-01 completed" still means the same thing.
- **Access lists are unaffected.** They are frozen lists of IDs, so
  reordering changes nobody's access (05 §4). Free and Pro are None today
  anyway. Admin → Plans shows a drift note if a list was made by "First N".
- **The groups.** The current group `core` is retired (it stays in version
  1). The six units are new groups: `start`, `shapes`, `measuring`,
  `values`, `space`, `people`.
- **In the interface, "Exercise" becomes "Lesson" (שיעור).** IDs never
  appear, so nothing else changes.

## 3. The lesson template, and the challenge brief

### 3.1 The lesson: seven parts, always in this order

| Part | What the learner sees | Limits | Required to publish | Field |
|---|---|---|---|---|
| 1. Objective | "You'll learn to …", one sentence, with materials and a typical time ("about 20 min") | 140 characters | Yes (time optional) | `objective`, `materials` (as today), `minutes` (new) |
| 2. See it | The visual demonstration: a diagram, an annotated photo, or a step-by-step sequence; swipe through it, tap to zoom; a caption under each frame | 1–6 frames, captions of 140 characters | At least 1 frame | `demo[]` (new) |
| 3. Do it | Numbered steps to do on paper. Step 1 names the subject ("a real chair, or this photo"); a step may carry a small picture, one tool link, or Prepare Worksheets | 3–6 steps of 200 characters | Yes | `steps[]` (new); `instruction` stays as the one-line summary used in lists |
| 4. Check it | 2–4 yes/no questions about the drawing ("Do the gaps have the sizes you see?"); tickable, never saved, no score | 120 characters each | Yes | `checks[]` (new) |
| 5. Common mistake | Mistake → fix, optionally with a before/after picture | 140 characters each | Yes (picture optional) | `mistake` (as today), `mistake.image` (new) |
| 6. Tools | Not a separate list: each tool link sits in the step where it helps (§5.5) | One per step | No | `steps[].tool` (new), `tools`, `worksheet` (as today) |
| 7. Done | "Done when …" (a description of the drawing, never a score), Mark as completed, Next lesson, "Practise it: N challenges" | 140 characters | Yes | `success` (as today); practice links come from the challenges |

**Also on the page:**

- **Why it works** (`guide`, as today): a short note, visible, at most two
  sentences. Nothing a learner needs is hidden in an accordion (the owner's
  refinement 6). Only the picture credits fold.
- **The skill line** (`skill`, new, 60 characters): the lesson's one skill
  in a few words, shown under its title in the course list.
- **Optional lessons** (`optional`, new): not numbered, and skipped by
  "Start", "Continue", "Next lesson" and the unit counts. The baseline
  drawing is the only one.
- **Tools that help:** the item's tools as a row of chips, for quick access
  beside the links inside the steps.

**One skill per lesson** is held by the template rather than by rules: one
objective, one demonstration, one sequence of steps. A lesson that needs a
second objective is a second lesson.

### 3.2 The schema, additions only

```ts
// Every field M5 reads stays as it is and stays required, so content written
// for M6 is still read by the M5 release, which shows it as today's card.

interface LearnGroup {                   // a course unit, or a challenge subject
  // … as today: id, collection, order, title, summary?
  level?: 'beginner' | 'intermediate';   // course units only
}

interface DemoFrame {                    // one picture of "See it"
  image: AssetRef;                       // alt text in both languages, as today
  caption: Localized;                    // every word lives here, never in the picture
}

interface ToolLink {
  tool: ToolId;                          // 'measure' | 'value' | 'grid' | 'compare' | 'color'
  preset?: { levels: 3 | 5 | 7 | 9 | 11 | 13; squint?: boolean }  // Study & Simplify: its own value steps
         | { columns: number; rows: number };  // Create a Grid, 1–16 each
  label: Localized;                      // what it is for: "See the three values"
}

interface LessonStep {
  text: Localized;
  image?: AssetRef;                      // e.g. the subject in step 1
  tool?: ToolLink;
  worksheet?: true;                      // Prepare Worksheets belongs to this step
}

type Reviewed = { by: string; at: string };   // admin only, never sent to learners

interface LearnExercise {
  // … every M5 field, unchanged …
  optional?: boolean;                    // the baseline: not numbered, not in "Continue"
  skill?: Localized;                     // the one skill, for the course list
  minutes?: number;                      // 5–120; a typical time, never a timer
  demo?: DemoFrame[];                    // 1–6
  steps?: LessonStep[];                  // 3–6; their presence selects the lesson layout
  checks?: Localized[];                  // 2–4
  // mistake gains an optional `image`
  review?: { pedagogy?: Reviewed; hebrew?: Reviewed };
}

interface LearnChallenge {
  // … every M5 field, unchanged (skillArea stays filled, for M5) …
  lessons?: string[];                    // 1–3 lesson IDs this challenge builds on
  focus?: Localized;                     // one line: what to pay attention to
  review?: { pedagogy?: Reviewed; hebrew?: Reviewed };
}
```

**Rules that keep M5 and rollback safe:**

- **Additions only.** No M5 field is removed, renamed or retyped; the
  editor keeps them filled. A release that reads only M5's fields (M5
  itself, after a rollback) still parses M6 content (it is read tolerantly,
  ADR-0014/0017) and shows a complete, plainer card. A test reads M6 content
  with M5's schema.
- **The layout follows the content.** Lessons with `steps` use the lesson
  layout. Items not converted yet keep today's card, so the course can be
  converted one lesson at a time.
- **The server sends a lesson's fields only to accounts that can open it.**
  `fullItem` adds the new fields to its whitelist (never `review`). Every
  picture in `demo`, `steps` and `mistake` is covered by the same asset
  authorization as references. The locked 403 still carries only the list
  entry (title and place).

### 3.3 Lesson or challenge: the difference, held by the templates

| | Lesson (course) | Challenge |
|---|---|---|
| Purpose | Learn one skill | Practise on your own |
| Starts with | The objective and a demonstration | The subject |
| The reference photo | "Your subject" inside step 1, often only a fallback for the real object | The hero of the page (or "From life: …") |
| Guidance | Steps, self-check, common mistake, why it works | One prompt and an optional focus line |
| Order | Numbered, in units, "Next lesson" | Any order: filters, Random, Quick, Another one |
| Organised by | Units (skills), beginner → intermediate | Subject, level, medium, skill (course unit), quick |
| Links | "Practise it: N challenges" | "Builds on: Lesson 3 · Negative space" |
| Who | Beginners, and teachers planning a class | Everyone; experienced artists can skip the course entirely |

The editor offers each template only its own fields: a challenge cannot grow
steps, so the two cannot drift together again.

### 3.4 The challenge brief: two small additions

- **`lessons`: the 1–3 lessons a challenge builds on.**
  - **On the card:** "Builds on: Lesson 3 · Negative space". It shows the
    title exactly as lists show it: a lock when locked, nothing when the
    course is not offered to the account.
  - **On the lesson:** "Practise it: 2 challenges".
  - **The Skill filter is the course units** ("Measuring and proportion"):
    a challenge's skill is the unit of the lessons it builds on, so there is
    no second vocabulary to maintain.
  - **`skill` (the chip text) and `skillArea` stay** for compatibility; the
    editor fills `skillArea` from the first linked lesson.
- **`focus`: one optional line,** e.g. "The empty shapes inside the handles
  first". It is a direction, not a lesson.

Subject (the group), level, medium, quick, reference kind and tools are
unchanged.

## 4. Visuals: which lessons need diagrams or step-by-step pictures

**Four kinds of picture, one rule:**

- **Diagram:** a simple drawing of a concept (a value scale, light on a
  ball, sighting with the pencil). Label-free: numbers ①②③ and arrows, with
  the words in the caption.
- **Step sequence:** 3–5 photos of a real pencil drawing at its stages,
  taken from above in daylight. It is the most convincing demonstration of
  paper-first drawing, and the cheapest to make: draw once, photograph as
  you go.
- **Annotated photo:** a subject photo with guide lines, values or a grid,
  **made with the studio's own tools**:
  - Measure & Plan for lines and measurements;
  - Study & Simplify for values;
  - Create a Grid for grids;
  - Compare & Correct for overlays.

  Each one is also a preview of the tool linked in the steps.
- **Subject photo:** what to draw when the real object is not at hand.
  Mostly the owner's own photos of household objects, or CC0 museum images.

**The rule:** no words inside any picture. One picture then serves both
languages, nothing needs mirroring for right to left, and the captions carry
the words, reviewed like any text.

| # | Lesson | Diagram | Step sequence | Annotated photo (made with) | Subject photo |
|---|---|---|---|---|---|
| Optional | D-START-01 baseline drawing | — | — | Where to look: outline, opening, handle (markers on the CC0 mug) | A plain mug, side view, one light. **No teaching before the baseline, by design** |
| 1 | D-LINE-04 pencil control | **Essential:** ghosting a line between dots; an ellipse in its box; rim and base ellipses against eye level | Helpful: a glass in 3 stages, light lines first, dark lines last | The glass with its two ellipses traced (Measure) | A plain glass or jar |
| 2 | D-SHAPE-01 big shapes | **Essential:** box, cylinder, sphere and cone with their ellipses | Helpful: a bottle as silhouette → forms on one axis → outline | Still life → 2-value silhouettes (Study) | Household objects, or the CC0 still life |
| 3 | D-OBS-02 negative space | — | Helpful: the gaps of a chair, one by one | The chair with its gaps filled (Study, 2 values) | A chair or a plant |
| 4 | D-COPY-01 grid | Helpful: one square, where edges enter and leave | **Essential:** grid → square by square → grid erased → refined | Reference with grid and blank grid (Create a Grid, Worksheets) | A CC0 reference |
| 5 | D-OBS-03 angles | **Essential:** sighting at arm's length, one eye closed, pencil in the picture plane; carrying the angle to the paper | — | Plumb and level lines on a photo (Measure) | A chair, a window or a box |
| 6 | D-OBS-04 measurement | **Essential:** thumb on the pencil, elbow locked | — | A bottle measured in units (Measure) | A bottle |
| 7 | D-OBS-06 block-in | — | **Essential:** 4–8 straight lines → smaller shapes → curves | The envelope over the reference (Measure) | A shoe, a bird, or a cast (CC0 sculpture photos suit it) |
| 8 | D-COPY-02 checked copy | — | **Essential:** copy → overlay → largest error marked → corrected | Copy over reference (Compare) | A simple CC0 drawing or print |
| 9 | D-VAL-01 values | **Essential:** a 5-step scale, a smooth gradient strip (gradual transitions), and the 3-value version | Helpful: squint → three value shapes → fill | Reference → 3 values (Study) | Own or CC0 |
| 10 | D-LIGHT-01 shading simple forms | **Essential:** ball, box, cylinder and cone under one light source, numbered: the light source, light side, core shadow, reflected light, cast shadow; gradual transitions on the round forms, flat planes on the box | Helpful: shading a ball in 3 stages (light and shadow split → core and cast shadow → gradual transitions) | The setup in 3 values (Study) | The setup with one lamp (own photo) |
| 11 | D-OBS-07 still life | — | **Essential:** extremes marked → block-in → shadow shapes → values → finish | — | A 2–3 object setup (own photo) |
| 12 | D-PERSP-01 perspective | **Essential:** eye level; boxes in one- and two-point perspective above and below it; ellipses against eye level | Helpful: a room corner in 3 stages | Converging lines on a room or street photo (Measure) | Own photo, no people |
| 13 | D-SUBJ-02 landscape | Helpful: four planes, four values | Helpful: planes → values → foreground detail | Landscape → 4 values (Study) | CC0 landscape or own |
| 14 | D-SUBJ-04 complete drawing | — | **Essential:** 3 thumbnails → chosen → block-in → value pass → finish | — | Own or CC0 |
| 15 | D-FIG-01 figure | **Essential:** the figure in head lengths (about 7.5; landmarks) | Helpful: line of action → gesture → figure | A standing figure measured in heads (Measure) | CC0 sculpture (no model release needed) |
| 16 | D-FIG-04 hands | **Essential:** palm as a box, finger segments, the knuckle arc | Helpful: box → blocks → outline | — | The learner's own hand |
| 17 | D-COPY-03 eye | **Essential:** the eyeball as a sphere, lids wrapping, iris under the upper lid | Helpful: sphere → lids → iris → 3 values | Eye → 3 values (Study) | A CC0 painting or sculpture detail, or a released photo |
| 18 | D-HEAD-04 portrait | Helpful: the average proportion map | Helpful: block-in → measured features → values | Block-in and eye line measured (Measure) | A CC0 portrait, or a released photo |
| 19 | D-HEAD-02 turning head | **Essential:** ball and jaw; the centre line at front, three-quarter and profile | Helpful: the construction in each view | — | CC0 busts, or own photos of a plaster head |

**In M6a** (the owner's refinement 4):

- **The three test lessons get real, accurate pictures:**
  - diagrams drawn in code (geometry, never freehand imitation);
  - annotated versions of the rights-verified CC0 references, made with the
    studio's own algorithms.
- **No demonstration of a real drawing is invented.** Where the table says
  "step sequence", M6a shows the stages as diagrams, and each is labelled as
  a diagram. Photographed demonstrations of real pencil drawings wait for
  real artwork, from the owner or an educator, and do not block M6a.

**What this means for production (M7):**

- diagrams for 14 lessons (11 essential), some with 2–4 frames;
- step sequences for 17 lessons (5 essential), each 3–5 photos;
- about 16 annotated photos (quick to make with the tools);
- about 20 subject photos (mostly own photos of household objects).

The first batch (units 1–2: the baseline and three lessons) needs diagrams
for 2 lessons (about 5 frames), a few step sequences and 4 subject photos.
Who makes them was decision B6; for M6a, see above.

## 5. UX: minimal changes

The aim stays as it was: pick a task in a few taps, put the screen down,
draw on paper.

### 5.1 The entry points (Learn home and Home)

**Today**, the Learn home starts with the Class mode switch, above the
course.

**Proposed:**

- **Drawing course:** "Step-by-step lessons, from your first line to a
  finished drawing."
  - The main button is "Start: Lesson 1 · Pencil control", or "Continue:
    Lesson 4 · The grid method".
  - A smaller link offers the optional baseline drawing before Lesson 1.
  - One orientation line: "Unit 3 of 6 · Measuring and proportion".
- **Challenges:** "Subjects to draw on your own: by level, subject or
  skill." The buttons are Random, Quick and Browse.
- **For experienced artists,** one line: "Already draw? Open any lesson, or
  go straight to the challenges."
- **For teachers:** Class mode moves to a row at the bottom. It is for a
  minority of visits and should not be the first thing a beginner meets.
- **Home's "Learn to draw" section** shows the same two doors with the same
  main buttons.

### 5.2 Course progression

**The course page:**

- **Units with their level** (Beginner / Intermediate), a one-line goal,
  and a quiet "2 of 4 done" (decision B8; no bars).
- **Each lesson row:** its number and title, a one-line skill, a small
  picture (the first demonstration frame), a tick with the count when done,
  and a lock when locked. The baseline row says "Optional" instead of a
  number.
- **"Up next"** marks the first numbered lesson not yet done.
- **No prerequisites:** every lesson opens.

**On a lesson:**

- "Unit 2 · Lesson 3 of 19" at the top, and Previous / Next at the bottom.
- After "Mark as completed", **Next lesson** becomes the main button.

```
Drawing course
Lessons in a recommended order. Open any lesson.

BEGINNER
1 · Start: pencil control                            1 of 1
     Optional  A first drawing from life (baseline)
  ✓ 1  Pencil control: lines and ellipses
2 · Seeing shapes                                    1 of 2
  ✓ 2  Big shapes and simple forms
  ▶ 3  Negative space                                Up next
3 · Measuring and proportion
    4  The grid method
    …
INTERMEDIATE
5 · Space and composition
    …
```

### 5.3 The lesson page and the challenge page (phone)

```
LESSON                               CHALLENGE
┌─────────────────────────────────┐  ┌─────────────────────────────────┐
│ ‹ Course                        │  │ ‹ Challenges                    │
│ UNIT 2 · LESSON 3 OF 19         │  │ CHALLENGE                       │
│ Negative space                  │  │ Scissors                        │
│ You'll learn to draw the empty  │  │ ┌─────────────────────────────┐ │
│ shapes between things.          │  │ │ FROM LIFE                   │ │
│ About 20 min · pencil, paper    │  │ │ a pair of scissors          │ │
│ ┌─────────────────────────────┐ │  │ │ (or the provided photo)     │ │
│ │ SEE IT              1 / 3 › │ │  │ └─────────────────────────────┘ │
│ │ [diagram or step photo]     │ │  │ Draw a pair of scissors,        │
│ │ ① the gaps  ② the outline   │ │  │ starting with the empty shapes  │
│ └─────────────────────────────┘ │  │ inside the handles.             │
│ DO IT                           │  │ Beginner · Pencil · Quick       │
│ 1 A real chair, or this photo ▣ │  │ Builds on: Lesson 3 ·         › │
│ 2 Draw one gap at a time …      │  │   Negative space                │
│ 3 … [ See it in 2 values › ]    │  │ [ Another one ]                 │
│ CHECK IT  (for you, not saved)  │  │ [ ✓ Mark as completed ]         │
│ ☐ Do the gaps have the sizes …  │  │ Tools: Study & Simplify ›       │
│ ☐ …                             │  └─────────────────────────────────┘
│ COMMON MISTAKE                  │
│ Drawing the parts you "know" →  │
│ compare the gaps instead        │
│ Done when: …                    │
│ [ ✓ Mark as completed ]         │
│ [ Next: Lesson 4 › ]            │
│ Practise it: 2 challenges ›     │
│ Tools: Study & Simplify ›       │
│ Why it works: a short note      │
└─────────────────────────────────┘
```

- **On a tablet in landscape and on desktop:** "See it" stays in view on
  one side, with "Do it" and "Check it" on the other.
- **In class mode:** Mark as completed stays hidden, as today. The
  demonstration and the numbered steps suit a class, shown on a tablet or
  a projector.

### 5.4 Challenges

- **The list:** compact cards.
  - Challenges drawn from life or memory get a subject label ("From life ·
    scissors") instead of today's empty picture placeholder.
  - Challenges with a provided reference keep the thumbnail.
- **Filters, in one row and remembered on the device:** Level · Subject ·
  Skill (course unit) · Medium · Quick.
- **The card:** the subject first, then the prompt, the focus line, the
  chips, "Builds on: …", Another one, Mark as completed, and the tools.

### 5.5 Contextual tool shortcuts

- **In a lesson,** a tool link sits in the step where it helps and says
  what it is for:
  - "See the three values ›" opens Study & Simplify with the subject at 3
    values;
  - "Print a 4 × 4 grid ›" opens Prepare Worksheets;
  - "Check your copy ›" opens Compare & Correct.
- **Presets:** Study & Simplify's Values (its own steps: 3, 5, 7 … values,
  optionally with Squint; as built, it offers no 2) and Create a Grid
  (columns × rows). They are applied as if the person had chosen them;
  nothing else in the tool changes. Both settings already live in the
  project store.
- **"Back to Lesson 3":** a small, dismissible pill in the tool after a
  hand-off. Today nothing leads back. It is the only addition to the tool
  screens.
- **Challenges** keep their "Tools that help" chips.

### 5.6 Deliberately not added

Streaks, points, badges, levels to unlock, leaderboards, timers, quizzes or
scores, AI feedback on drawings, prerequisites, notifications and sharing.
The self-check is for the learner alone and is never stored.

### 5.7 Both languages

- **The words live in the text,** never in the pictures.
- **The page mirrors for right to left; the pictures never do.**
- **Hebrew stays gender-neutral.** "Lesson" is שיעור and "Challenge" is
  אתגר.
- **A short glossary of drawing terms in English and Hebrew** (about 40
  terms: value, block-in, negative space, core shadow…), reviewed once by
  the Hebrew-speaking art teacher. Every lesson uses it, which keeps 20
  lessons consistent and makes each review shorter.

## 6. The M6 content editor

### 6.1 Scope

**In (M6b):**

- **Admin → Learn → Content, the outline:**
  - units and challenge subjects, with order (up and down) and moves
    between units;
  - published on/off per item;
  - status badges: New, Live, Changed in draft, Unpublished, Hebrew not
    reviewed, Rights incomplete.
- **A form for each template:**
  - English and Hebrew side by side, Hebrew right to left;
  - limits shown as you type, required marks, and a count of missing
    Hebrew fields;
  - a live preview made with the learners' own components, at phone width,
    in either language.
- **Images:**
  - upload: the browser re-encodes, removes embedded metadata, limits the
    size and makes the thumbnail, as designed in 06 §3;
  - the rights form (§6.2);
  - where each image is used;
  - replace, which makes a new file: older versions keep theirs.
- **Publishing:** the checklist (§6.3), a per-field diff, publish (with a
  recent sign-in), history, and restoring any version as a new draft.
- **View as** Free, Pro or signed out: lists and pages built from the draft
  and the live catalog. The admin's own access never changes.
- **Review marks** per item (teaching and Hebrew: who and when), and audit
  entries for everything.

**Out:**

- rich text or Markdown (plain text, with line breaks);
- a page builder;
- drawing on pictures inside the editor (annotations are made with the
  studio's tools, then uploaded);
- SVG uploads, which can carry scripts;
- video;
- scheduled publishing, or several drafts at once;
- comment threads and approval chains;
- roles other than admin;
- machine translation;
- a bulk-import screen (the CLI import stays for bulk).

### 6.2 Image rights record

Today's licence record (M4) is kept and extended:

| Field | Status | Meaning |
|---|---|---|
| kind | as today | own, commissioned, cc0, public-domain, licensed. No "AI-generated" and no stock sites (decision B5) |
| title, author | as today | The work and its creator, as the source states them |
| source | as today | The https page of the original |
| **identifier** | new | The source's own ID: accession number, file ID, or contract number |
| licenceUrl | as today | Required for cc0 and licensed |
| rights | as today | What the source states about the rights, and where |
| **evidence** | new | Where dated copies of that statement are kept, or an archive link. Required for every third-party image |
| **commercialUse** | new | yes / no / unclear. Only "yes" can be published (Pro is paid) |
| attribution | as today | The credit text a licence requires, shown under the picture |
| modelRelease | as today | yes / not-needed, for identifiable people |
| **propertyRelease** | new | yes / not-needed, for private property, artworks still in copyright, or prominent logos |
| **derivedFrom** | new | The image this one was made from (an annotated or value version). It inherits that image's rights, and the chain is shown |
| **changes** | new | What was changed: re-encoded, resized, cropped, annotated |
| checkedAt | as today | The date the rights were checked |
| **checkedBy** | new | The admin who checked them |
| notes | as today | Anything else |

### 6.3 The publish checklist

**Blocks publication:**

- **Text:** a published item missing English or Hebrew in a required field
  (as today).
- **Lessons:** a lesson missing an objective, a demonstration frame, 3–6
  steps, 2–4 checks, a mistake and its fix, or "Done when".
- **Images:**
  - an image without a complete rights record;
  - commercial use not "yes";
  - a person shown without a model release;
  - a commissioned image without a reference to its written licence.
- **Files:** a missing or altered image file (as today).
- **IDs:** a published ID removed, or changed in kind (as today).
- **Links:** a challenge linking to an unknown lesson.

**Warns:**

- an item opened by an access list being unpublished (as today);
- teaching or Hebrew review not recorded;
- alt text that only repeats the caption;
- oversized demonstration pictures (they are kept to 1,600 px; references
  stay at 3,200 px for printing).

### 6.4 From draft to published

- **One shared draft.** Saving checks that nobody else saved in between, so
  two tabs never silently overwrite each other.
- **The order of work:** save draft → checklist → diff → publish. Publishing
  needs a recent sign-in, as the catalog does.
- **Items carry their state:**
  - a new item stays "Draft · admins only" until it is published;
  - an unfinished lesson can wait in the draft, unpublished, while others
    go live;
  - publishing batches (M7) is this, and nothing more.
- **Restore** makes a new draft from any version (today's rule: items
  published since are kept, unpublished).
- **The audit** records every save, publish and restore, every upload, and
  every change to a rights record, with before and after.
- **The editor never** changes plan access (that is Admin → Plans), never
  deletes a published ID, and never shows a draft to anyone but admins.

## 7. What stays unchanged

- **Every M5 feature keeps working:**
  - the addresses under `/app/learn`;
  - completions and history;
  - class mode with "Next student";
  - worksheets from cards and "Use my photo";
  - tool hand-off and the marks on saves;
  - locked states;
  - Random and Quick.
- **Items not converted** keep today's card.
- **Content stays readable by the M5 release,** so rolling back to
  `ab42467` shows plainer cards and breaks nothing. M6a tests this and
  drills it on staging.
- **Free and Pro are unchanged:** no catalog or plan change. Learn stays
  admins-only until the owner publishes access (M9).
- **Production and GitHub Pages are untouched.** Staging only; the rollback
  floor stays `224bb65`.

## 8. Audit of the four CC0 reference images

### 8.1 What was checked (2026-11-19, 13:16–13:28 UTC)

For each image, five independent checks:

1. **The museum's Open Access API record:** `share_license_status` and
   `copyright`.
2. **The object page as served:** its page data.
3. **The museum's print file:** downloaded again and hashed against the
   original we stored in M4, and its embedded XMP rights checked.
4. **Our re-encoded file:** hashed against its asset ID, and compared with
   the museum's picture at thumbnail size, to show it is the same picture,
   uncropped.
5. **Staging:** `learn-status` lists the same asset IDs, with every file
   matching its recorded bytes.

**The museum's policy** (clevelandart.org/open-access):

- CC0 images "can be used in any application … all without fees or
  restriction";
- CC0 works "do not require attribution or citation";
- citing the museum "does not imply endorsement … nor does it grant
  permission to use the CMA's trademarks".

**The API documentation** defines `share_license_status` as "CC0",
"Copyrighted" or "Other", and gives image files only for CC0 works.

**Where the evidence is kept.** Dated, unmodified copies of the four API
records, the four object pages, the policy page and the API documentation
are in the private seed folder (`learn-seed-m4/evidence-2026-11-19/`), with
SHA-256 sums and a README. They are never in this repository.

### 8.2 The four images

| | mug | still-life | glass-mug | butterfly |
|---|---|---|---|---|
| Used by | D-START-01 | D-SHAPE-01 | D-LINE-04 | CH-017 |
| Work | *Mug*, c. 1760, soft-paste porcelain | *Still Life with Fish, Bread, and Kettle*, c. 1772, oil on canvas | *Handled Mug*, 1700s, glass | *Butterfly*, 1800s, watercolor |
| Creator (as the museum states) | Worcester Porcelain Factory (British, established 1751) | Luis Meléndez (Spanish, 1716–1780) | No maker named: America, Stiegel type, 18th century | Mary Altha Nims (American, 1817–1907) |
| Museum identifiers | Accession 1972.177; API 146736 | Accession 1983.97; API 151555 | Accession 1951.107; API 128092 | Accession 1934.140; API 114511 |
| Object page | clevelandart.org/art/1972.177 | clevelandart.org/art/1983.97 | clevelandart.org/art/1951.107 | clevelandart.org/art/1934.140 |
| API record | openaccess-api.clevelandart.org/api/artworks/146736 | …/api/artworks/151555 | …/api/artworks/128092 | …/api/artworks/114511 |
| Museum file | `1972.177_print.jpg`, 2634 × 3400, SHA-256 `49d1738390c9…` | `1983.97_print.jpg`, 3400 × 2434, `845fb4531f97…` | `1951.107_print.jpg`, 2563 × 3400, `4ed3237d80cb…` | `1934.140_print.jpg`, 3400 × 2684, `953e12970382…` |
| Same as the M4 download | Yes, byte-identical | Yes | Yes | Yes |
| API: share_license_status / copyright | CC0 / none | CC0 / none | CC0 / none | CC0 / none |
| Object page data | CC0 | CC0 | CC0 | CC0 |
| Embedded in the museum's file (XMP dc:rights) | Object URL + CC0 1.0 deed | Same | Same | Same |
| Underlying work | Public domain (c. 1760) | Public domain (artist died 1780) | Public domain (1700s) | Public domain (artist died 1907) |
| People shown | None; the printed decorative figures are not real people | None | None | None |
| Release needed | No | No | No | No |
| Our file | 2479 × 3200 JPEG, metadata removed | 3200 × 2291 | 2412 × 3200 | 3200 × 2526 |
| Same picture (mean difference at 48 × 48 px; a different picture: 67/255) | 1.06/255 | 1.23/255 | 0.96/255 | 0.59/255 |
| On staging | Yes, bytes verified | Yes | Yes | Yes |
| **Commercial use** | **Yes** | **Yes** | **Yes** | **Yes** |

**Our asset IDs** (the SHA-256 of our files, as stored on staging):

| Key | Asset ID |
|---|---|
| mug | `2c7bad1c5e91134593d13ad74b21e57b5b3a32e5a5ebf139195cc14680647299` |
| still-life | `6b9ef56e34d6aa10a36b688d5e997c1a956f8b3201cf1a3a4dc462112aed38d9` |
| glass-mug | `d6c45c8952da188e492a178cbcf91849443f325c8bb736b9802aedcdfc368082` |
| butterfly | `ac8786926eb7c02478a5786692a1ebfd418751059c7cb8e457b059ad1a8a8fb1` |

**Conclusion:**

- **Suitable for commercial use, including Pro and printed worksheets.**
- **What that rests on:**
  - the photographs are CC0 by the museum's designation, stated in four
    places;
  - the works themselves are long in the public domain;
  - no person, trademark or third-party right is shown.
- **Attribution is not required.** We credit the museum anyway, as a
  citation, never with its logo.

### 8.3 Flags: nothing that affects the rights

1. **No written licence exists, and none can be had.** The museum states
   that it does not issue separate agreements for CC0 content. The evidence
   is its public designation, now kept in dated copies with checksums.
   Archive snapshots of the four object pages already exist (2022–2026, not
   made by us). A fresh snapshot at publication would be a public action,
   so it is left to the owner.
2. **Creators and dates are the museum's,** not independently researched.
   The conclusion does not depend on them: every work is centuries old.
3. **The API's `filesize` field differs by 3–10 KB from the bytes served.**
   It is a metadata quirk; identity was established by hashing.
4. **"Copyright … Adobe / Kodak / Hewlett-Packard" strings inside the
   museum files** belong to embedded colour profiles, not to the images.
5. **Our re-encoding removed the embedded CC0 statement from our copies.**
   The rights record in the database carries it, and the credit line shows
   it.
6. **"Worcester" appears only as the historical maker's name.** The museum
   appears only as a citation.
7. **The Hebrew credit for the mug spells Worcester "וּוּסטר".** The Hebrew
   reviewer should check the spelling; it is not a rights issue.

### 8.4 Teaching fit (not a rights question)

- **The mug (lesson 1).** Its busy printed scene distracts from the point
  (the outline, the opening, the handle). An own photo of a plain mug, side
  view, one light, would serve better. Keep the museum mug as an extra.
- **The still life (lesson 3).** It has good big masses, but it is a dark
  oil painting that is hard to read on a phone. It works well behind the
  2- and 3-value versions (§4).
- **The glass mug (lesson 2).** Its transparency shows both ellipses, which
  is right for the ellipse demonstration. The engraving and reflections make
  it hard as "the thing to draw" for a beginner.
- **The butterfly (CH-017).** A good challenge reference: symmetry and
  pattern, with Grid and Worksheets. Keep it.

## 9. Risks

| Risk | Mitigation |
|---|---|
| **Content production is the real bottleneck:** diagrams for 14 lessons, step sequences for 17, and about 20 subject photos, in two languages, with reviews | Template limits; label-free pictures that serve both languages; annotated photos made with the studio's tools; step photos of real drawings; batches (M7), the first needing diagrams for only 2 lessons |
| Lessons grow long on a phone | Hard limits (6 steps, 4 checks, 140–200 characters); swipeable demonstration; "Why it works" folded; the owner's iPhone check of M6a before any editor work |
| New content breaks M5, or a rollback | Additions only; M5's fields stay required; a test reads M6 content with M5's schema; a rollback drill on staging |
| A locked lesson leaks its pictures or steps | One resolver: every lesson picture is authorized like a reference; tests per field, as Free, Pro, admin and signed out; the locked 403 still carries only the list entry |
| Course and challenges drift together again | The editor offers each template only its own fields |
| Rights of new pictures (people, commissioned work) | The publish checklist (§6.3); CC0 sculpture for the figure and the head; written licences; releases |
| Hebrew terms differ between lessons | The glossary, reviewed once; review marks per item |
| The editor grows beyond need | The in/out list (§6.1); it reuses the catalog's draft and publish flow |
| Learners lean on the grid | Lessons 6–9 fade it, and lesson 9 checks a copy made without it |
| Reordering changes "First N" access | Lists are frozen IDs, with the existing drift note; Free and Pro are None today |
| More pictures cost phone data | Demonstration frames up to 1,600 px, thumbnails first, loaded as needed |

## 10. Milestones

**M6a — the lesson format and screens (staging, admins only).** Approved on
2026-11-19.

- **Schema:** the additions in §3.2, with validation, the M5-compatibility
  test, and the item and asset authorization extended to the new fields.
- **Screens:**
  - the lesson page, with the teaching visible on the page;
  - the challenge card and list changes;
  - course units with "Up next", and the optional baseline;
  - the two doors on the Learn home and on Home, with Class mode moved to
    the bottom;
  - "Lesson" in the interface;
  - the Skill filter;
  - tool links with presets, and "Back to the lesson".
- **Test content, imported with the existing CLI:**
  - the three test lessons rewritten in the template, D-START-01 as the
    optional baseline;
  - the three challenges linked to them;
  - the pictures (B13 and refinement 4): accurate diagrams drawn in code,
    and versions of the CC0 references annotated with the studio's own
    algorithms. No invented demonstrations of real drawings.
- **Tests:**
  - unit and end-to-end in English and Hebrew, desktop and iPhone, with
    axe;
  - entitlements for every new picture field;
  - the rollback read test;
  - the usual staging verification.
- **Then stop.** The owner sees the working lesson experience, on a real
  iPhone and iPad, before M6b starts.

**M6b — the content editor (staging):** §6, with its tests:

- the editor end to end;
- validation and the rights checklist;
- audit entries;
- admin only, and a recent sign-in to publish;
- "View as".

**M7 — content in batches, in the template, as planned:**

1. units 1–2;
2. unit 3;
3. unit 4;
4. units 5–6.

Challenges are linked as their lessons arrive. Photographed demonstrations
of real drawings come with M7, from real artwork.

## 11. Decisions

Approved by the owner on 2026-11-19, with the refinements in §12.

| # | Decision | Outcome |
|---|---|---|
| B1 | The progression: 6 units, 20 lesson IDs unchanged; lines before shapes, the grid into the beginner path, the portrait out of it (§2.3) | **Approved,** with D-START-01 as an optional baseline (refinement 2) and the Values and light unit explicit about shading simple forms (refinement 3) |
| B2 | The lesson template (7 parts) and the challenge brief, with "Lesson" replacing "Exercise" in the interface (§3) | **Approved;** the teaching stays visible on the page (refinement 6) |
| B3 | Challenges link to the lessons they build on; the Skill filter is the course units; an optional focus line (§3.4) | **Approved;** challenges stay separate from the course (refinement 7) |
| B4 | Two optional splits (perspective, the figure) by restoring D-PERSP-02 and D-FIG-02 with their original meaning | **Approved as recommended:** not now; the educator may ask in M7 |
| B5 | Picture policy: no words inside pictures; diagrams, step photos of real drawings, tool-annotated photos; no AI-generated images and no stock sites (§4, §6.2) | **Approved** |
| B6 | Who makes the pictures | **Settled for M6a by refinement 4:** accurate diagrams drawn in code and annotated rights-verified references; no invented demonstrations of real drawings. M6a does not wait for artwork or for an educator to be named |
| B7 | Self-check: tickable but never saved | **Approved** |
| B8 | Unit progress as quiet text ("2 of 4 done") | **Approved** |
| B9 | Tool links in steps, presets for Study & Simplify and Create a Grid, and "Back to the lesson" (§5.5) | **Approved;** quick access to every tool is kept (refinement 7) |
| B10 | The editor's scope and the rights checklist: commercial use "yes", evidence, releases (§6) | **Approved,** for M6b |
| B11 | Reviews (teaching and Hebrew) recorded per item in M6, and required before an item opens to Free or Pro (the M9 checklist), not for staging tests | **Approved,** for M6b |
| B12 | M6 in two steps: M6a (format and screens) → owner's check → M6b (editor) → M7 | **Approved:** M6a only, then stop (refinements 5 and 10) |
| B13 | M6a's test pictures: diagrams drawn in code, and the CC0 images annotated with the studio's tools. An own photo of a plain mug replaces the museum mug when the owner provides one | **Approved** |

## 12. The owner's refinements (2026-11-19)

1. **B1–B5 and B7–B13 approved,** subject to the points below.
2. **D-START-01 is an optional baseline drawing,** not a mandatory first
   lesson. The first lesson teaches basic pencil control and line exercises
   (D-LINE-04). IDs, history and entitlements are preserved.
   - Applied: the `optional` flag (§3.1); no number; skipped by "Start",
     "Continue", "Next lesson" and the unit counts (§2.3).
3. **The Values and light unit explicitly teaches shading simple 3-D
   forms,** including the light source, core shadow, cast shadow and gradual
   value transitions.
   - Applied: lessons 9 and 10 (§2.3), their diagrams (§4), and 02.
4. **B6 does not block M6a.** It uses accurate code-generated instructional
   diagrams and annotated, rights-verified reference images, and never
   fabricates demonstrations of real drawings.
   - Applied: §4 (In M6a), §10.
5. **M6a only:** the lesson schema and the learner experience, with the
   three existing test lessons.
6. **Concise and visual, especially on phones.** Teaching is not hidden
   inside a long "More help" accordion.
   - Applied: §3.1. Lessons have no "More help"; "Why it works" is a short
     visible note, and only the picture credits fold.
7. **Challenges stay separate** from the structured course, and quick access
   to every studio tool is kept.
   - Applied: the studio's navigation is unchanged; lessons keep a "Tools
     that help" row beside the links in their steps; challenges keep theirs.
8. **Unchanged:** the security checks, the draft and publish history, the
   Free/Pro settings and M5 compatibility.
9. **Tested locally and on staging.** No production change, and no new
   Free/Pro access.
10. **Stop after M6a,** and show the owner the working lesson experience
    before M6b starts.
