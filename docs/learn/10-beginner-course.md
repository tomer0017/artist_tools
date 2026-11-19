# 10 — The 15-lesson beginner course (sprint to 2026-11-26)

**Status:** the sprint brief of 2026-11-19 (deadline Thursday 2026-11-26,
Israel time). Lessons 1–15 are built as private test content (version 4) and
are published on staging for admins only. Lessons 16–29 are specified. Work
stops here for the founder's review. Production is unchanged.

The brief builds on [09](09-beginner-revision.md): the same learner (a
15-year-old who has never held a drawing pencil), the same lesson page
([ADR-0020](../adr/0020-beginner-lessons.md)) and the Pareto principle.

## 1. The course map
Lessons 1–15 are built; 16–19 are P1, specified but not built; 20–29 are
specified only. "Needs" lists the lessons that come first.

| # | ID | Lesson | Stage | Needs |
|---|---|---|---|---|
| 1 | D-HAND-01 | Light, medium and dark lines | 1 Pencil control | — |
| 2 | D-LINE-01 | Straight lines | 1 | 1 |
| 3 | D-LINE-02 | Curved lines | 1 | 2 |
| 4 | D-FLAT-01 | Circles | 1 | 3 |
| 5 | D-FLAT-02 | Squares and triangles | 1 | 2, 4 |
| 6 | D-BUILD-01 | Shapes make things | 2 Drawing with shapes | 4, 5 |
| 7 | D-BUILD-02 | Guide lines | 2 | 1, 6 |
| 8 | D-BUILD-03 | Final lines | 2 | 1, 7 |
| 9 | D-FORM-01 | Cube | 3 Simple 3-D forms | 5, 8 |
| 10 | D-LINE-04 | Cylinder and the ellipse | 3 | 4, 9 |
| 11 | D-FORM-02 | Sphere | 3 | 10 |
| 12 | D-FORM-03 | Cone | 3 | 7, 10 |
| 13 | D-SHAPE-03 | Forms make things | 3 | 9–12 |
| 14 | D-VAL-01 | Five values | 4 Values and light | 1, 5 |
| 15 | D-VAL-02 | Smooth shading | 4 | 14 |
| 16 | D-LIGHT-01 | Light on a ball | 4 | 11, 15 |
| 17 | D-LIGHT-03 | Core shadow and cast shadow | 4 | 16 |
| 18 | D-LIGHT-02 | Light on a box | 4 | 9, 14, 16 |
| 19 | D-LIGHT-05 | Light on a cylinder | 4 | 10, 15, 17 |
| 20 | D-OBS-08 | The outline of a real object | 5 Drawing from observation | 3, 8 |
| 21 | D-SHAPE-01 | Big shapes and negative space | 5 | 20 |
| 22 | D-OBS-03 | Comparing height, width and angles | 5 | 21 |
| 23 | D-OBS-04 | Measuring with the pencil | 5 | 22 |
| 24 | D-OBS-07 | A plain cup, then a simple still life | 5 | 10, 16–19, 23 |
| 25 | D-COPY-02 | Proportions in a reference photo | 6 First realistic drawing | 23 |
| 26 | D-COPY-01 | The grid method | 6 | 25 |
| 27 | D-COPY-03 | Building an eye | 6 | 7, 11, 26 |
| 28 | D-COPY-04 | Light, shadow and detail in the eye | 6 | 16, 17, 27 |
| 29 | D-SUBJ-04 | A finished realistic drawing | 6 | 24, 26, 28 |

**The full specification is private:** `curriculum-spec.md`, next to the
seed folders, outside the repository. It answers the brief's six questions
for every lesson: what the person can do after it, what it needs, what to
draw, what the picture shows, the common mistake, and "Done when". It is
generated from the content for lessons 1–15 and written for lessons 16–29.

**How the IDs were chosen:**
- **Lessons 1–5:** they keep their IDs and history.
- **D-LINE-04:** M6a's glass lesson (lines and ellipses on a glass) teaches
  the same skill as lesson 10, so it is rewritten as that micro-lesson. Its
  M6a version stays in the content history, and its files stay stored.
- **D-SHAPE-01:** M6a's big-shapes lesson; it becomes lesson 21 when
  stage 5 is built.
- **D-START-01:** the mug baseline, still optional and still a draft.
- **Reserved IDs:** IDs from [02](02-curriculum.md) are used only for the
  skills they were reserved for, for example D-SHAPE-03, D-VAL-01 and
  D-VAL-02.
- **New IDs:** D-BUILD-01…03, D-FORM-01…03, D-LIGHT-05 and D-OBS-08.

## 2. What content version 4 changes
- **The units** follow the approved stages:
  - stage 1 is lessons 1–5;
  - stages 2, 3 and 4 hold lessons 6–8, 9–13 and 14–15;
  - stage 5 holds the two drafts, which only admins see.
  - Progress is kept, because it is stored by lesson ID.
- **Lesson 1** is retitled "Light, medium and dark lines", which is what it
  already taught.
- **Ten new lessons (6–15)**, each in the lesson template: one picture drawn
  in code, a task of 1–3 lines, something to make, "Done when", a common
  mistake with its own picture, and one A4 practice sheet.
- **Challenges** are linked to the lessons they really build on:
  - the robot, the street of houses, the leaf and the butterfly link to
    lessons 6–8;
  - the keys (CH-002) are observation work, so they move to intermediate;
  - two new starter challenges: CH-053 for stage 3 and CH-054 for stage 4
    ([03](03-challenges.md)).
- **Nothing is deleted.** Every v3 item and unit is still in the content.

## 3. Practice sheets
- **One per lesson, 15 in all.** Each is an A4 portrait PDF that goes from
  tracing, to dots or light guides, to an empty box.
- **No words.** The only text is the lesson's ID; the five-values sheet also
  prints its fill order as digits.
- **Every lesson also works on plain paper.**
- **Checked:**
  - read back with the app's PDF reader: one A4 page, no images, every mark
    at least 18 mm from the edges;
  - previews rendered with macOS's own PDF engine;
  - printing on a real printer at 100 % has not been checked.

## 4. Code
**One change.** The Learn screen scrolls up and down only (`LearnView`).

**Why:** right to left, WebKit with visible scrollbars counts the
scrollbar's width as sideways overflow. That is the case in the emulated
iPhone and in Safari on a Mac with scrollbars shown. So in Hebrew every Learn
screen could pan 5 px sideways, including the screens that already existed.

**Test:** a Hebrew phone test in `e2e/learn-screens.spec.ts`.

No schema, route, dependency, catalog or plan change.

## 5. Rights
- **Every new picture and sheet** is drawn in code from geometry: no
  third-party material and no image generator.
- **Each asset's record** says so: the author, the date, and that the
  generator is private.
- **The CC0 museum pictures** of M4/M6a, and their evidence, are unchanged.

## 6. Deferred
- **Lessons 16–19** (light and shadow): specified, not built. They wait for
  the founder's decision on their order (§7).
- **Stages 5–6 (lessons 20–29)** are specified only. Their reference photos
  must be verified CC0 or the owner's own, and a photo of a person needs
  their release.
- **Later modules:** colour, painting and art history (P2), advanced
  challenges and educator workflows.
- **Hebrew review:** a native-speaking art teacher's review (A14).
- **Physical checks:** a real iPhone and a real printer.

## 7. Decisions for the founder
1. **Approve lessons 1–15** as they are on staging, or list changes.
2. **The order of lessons 16–19:** shade the cube before the sphere? Each
   face of a cube takes one value straight from lesson 14, while the sphere
   needs lesson 15's blending.
   - Proposed: 16 light on a box, 17 light on a ball, 18 core and cast
     shadow, 19 cylinder.
   - Specified in the approved order until decided.
3. **The mug baseline (D-START-01):** offer it again as optional at the
   course start ("draw a mug now, and again at lesson 24")? Or keep it as a
   draft?
4. **The next sprint:**
   - a real beginner tries lessons 1–15 on paper;
   - then build lessons 16–19, or the M6b content editor.
