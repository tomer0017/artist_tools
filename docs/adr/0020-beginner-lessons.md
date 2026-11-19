# 0020 — Beginner lessons: one small skill per lesson, one button on, the rest behind "Need help?"

**Status:** Accepted (2026-11-19). It revises ADR-0019's lesson page and
publishing rules, after the owner's review of M6a. The approved direction is
in [docs/learn/09-beginner-revision.md](../learn/09-beginner-revision.md).
Everything else of ADR-0019, ADR-0018 and ADR-0017 stays. Learn is still
dark-launched: no published plan includes a Learn module, so only admins see
it. M6b (the content editor) and the full curriculum wait for the owner.

## Context
The owner found M6a "pedagogically too advanced and visually too dense" for
the target learner: a 15-year-old who has never held a pencil. The M6a page
had seven parts and about twenty elements. These included a four-picture
carousel, a checklist and a row of tools, and the first lesson was a glass
drawn with ellipses.

The owner approved a revised direction with these refinements:

- **Pareto 80/20:** maximum learning value, minimum friction and effort.
- **One small skill per lesson,** extremely beginner-friendly.
- **A small creative application,** so beginners make something, not only
  drills.
- **One "I did it — next lesson" action,** honest and controlled by the
  person, never implying the drawing was assessed.
- **An optional printable sheet per lesson;** every lesson also works on
  plain paper without a printer.
- **The three M6a lessons unpublished,** keeping their IDs, assets and
  history. Nothing is deleted.
- **A minimal page,** but not forced into one phone screen: readability and
  picture size first. Desktop may use two columns.
- **Course, Challenges and Tools stay distinct.**
- **No new infrastructure,** abstractions or dependencies.

## Decision

### 1. The lesson page (`src/components/learn/LessonCard.tsx`)
**The page itself:**

1. "‹ Drawing course", "Lesson n of N", the title and a one-line objective.
2. **One picture,** as wide as the page on a phone, with its caption; a tap
   opens it full screen. The button sits beside the caption, never over the
   picture: pictures do not mirror for right to left.
3. **Your task:** one to three short lines on paper. A line may still carry
   a small subject picture or a tool link with its preset (ADR-0019 §5).
4. **Make something:** one line that uses the new skill (grass in three
   greys, a fence, a rainbow).
5. **Done when:** the drawing described, never a score.
6. **One button on.** Its label, by case:

   | When | Label | Records the lesson? |
   |---|---|---|
   | Usually | "I did it — next lesson" | Yes |
   | After the last lesson | "I did it — back to the course" | Yes |
   | Already done today, or in class mode | "Next lesson" or "Back to the course" (a link) | No |

   When the button records the lesson:
   - it records the person's own word that they did the task, once a day,
     never in class mode;
   - a short note then says "Marked as done: <title>", with **Undo**, on the
     page it leads to (the studio's existing toast, at the top of the
     screen);
   - if recording fails, the page stays and says so.
7. Below the button, quietly:
   - **Practice sheet** (the static PDF), or **Prepare worksheets** for a
     lesson drawn from a reference;
   - **Need help?**;
   - "Printing is optional: any paper works".

**"Need help?"** is a sheet over the page, rising from the bottom on a
phone. It is the existing Radix dialog, as the tool introductions use it. It
holds:

- the lesson's own common mistake, with its picture and the fix;
- why it works;
- what you need, and the time;
- the tools the lesson names (shortcuts, with the way back);
- the challenges that practise the skill;
- the picture credits.

**Removed from the page:**

- the carousel (`DemoCarousel.tsx` is deleted);
- the self-check list;
- the step numbers when there is only one line;
- the worksheet inside a step;
- the tools row, "Practise it" and "Why it works" on the page;
- Previous and All lessons.

**Layout:**

- From `lg` up, the picture stays beside the task, in two columns.
- On a phone, everything sits in one column. Text is larger than M6a's (the
  task at 17 px), and the button spans the width.

### 2. The content (`src/lib/learn/model.ts`), one addition
- **`create`:** an optional line, "one small thing to make with the new
  skill". It is in `textFields`, so a published lesson needs it in English
  and Hebrew, and it is copied by name in `fullItem`.
- **Everything else is ADR-0019's.** M6a's `checks` and a step's
  `worksheet` mark stay in the schema, so its drafts still read, but the
  page no longer shows them.

### 3. What is checked before publishing (`contentIssues`)
- **A published lesson needs:**
  - **exactly one picture** (`demo`);
  - **a task of 1–3 lines** (`steps`);
  - **no self-check questions** (the page would not show them).

  Previously: at least one picture, 3–6 steps and 2–4 checks.
- **Length limits:**

  | Part | Limit (characters) |
  |---|---|
  | Objective | 120 |
  | Task line | 160 (previously 220) |
  | Creative line | 140 |
  | Caption, "Why it works", skill line, focus | as before |
- **Drafts:** the structure checks stay, so an M6a lesson kept unpublished
  (four pictures, six steps, self-checks) is still valid content. A test
  proves it.

### 4. The course: drafts have no number (`src/lib/learn/course.ts`)
**Admins see unpublished items in the lists** (ADR-0017). A draft is now:

- unnumbered, and labelled "Lesson" with its Draft badge;
- skipped by "Start", "Continue", "Up next", the unit counts and the button
  on.

So an admin sees exactly the numbers learners will. After the last published
lesson, the button leads back to the course, not into a draft. A unit
holding only drafts has no number.

The button's target is now the numbered lesson after this one in course
order. An optional lesson at the start still leads to Lesson 1.

### 5. Wording
- **Hebrew stays gender-neutral:** "סיימתי — לשיעור הבא" (first person, the
  same for everyone), "המשימה", "יצירה קטנה", "עזרה".
- **A challenge with no picture to draw from** now says "From memory or
  imagination". The starter challenges ask to invent a robot or a street.

## Consequences
- **The first lessons are now drills a beginner can do,** with one thing to
  make at the end. The page shows four things before the button. Everything
  a learner might still need is one tap away, never on the page by default.
- **History stays honest:**
  - the button records only what the person says;
  - Undo is there right away, and My history removes any entry, as before;
  - nothing is recorded in class mode.
- **The test content is version 3,** with the M6a lessons unpublished but
  whole. It is private, in `studio-companion-private/learn-seed-beginner`.
  Their old challenges keep their links: a link to an unpublished lesson
  shows nothing to learners until the lesson returns.
- **No change to:**
  - routes, collections, the database, plans or entitlements;
  - the asset route, the security checks, history, class mode, worksheets
    or tool hand-offs.

## Rollback
**Releases before this one read version-3 content.** A frozen copy of M5's
schema still passes it (`src/server/learn/lessons.test.ts`). M6a's schema
has every lesson field optional and keeps unknown fields.

**What an earlier release shows:**

- **M6a (`54e2a16`):** the five lessons in its own, denser layout.
- **M5:** its plain cards.

**One limit:** M6a's publishing rules would refuse to publish version-3
content again (it asks for 3–6 steps and 2–4 checks). After a rollback,
publish content again only after returning to this release, or restore
version 2 (M6a's own content) through the existing restore.

**The floor stays `224bb65`.**

## Alternatives considered
- **A new lesson type or collection:** rejected. The exercise with `steps`
  already is the lesson, and a second type would mean a second editor and
  resolver path.
- **Keeping the carousel for several pictures:** rejected. The owner asked
  for one picture. A picture may hold numbered stages, as these do.
- **A creative step as the last task line:** rejected. It could not be shown
  as the small reward it is, or kept out of the drill count.
- **"Mark as completed" and "Next" kept as two buttons:** rejected by the
  owner (one obvious next action). Undo keeps the control that the separate
  button gave.
- **An inline "marked" line at the top of the next page:** rejected. It
  pushes the page down for a few seconds. The toast was already mounted,
  overlays nothing permanent, and carries Undo.
