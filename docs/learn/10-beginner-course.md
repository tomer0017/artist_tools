# 10 — The beginner drawing course (lessons 1–29)

**Status:**
- **The first sprint** (brief of 2026-11-19, deadline 2026-11-26): lessons
  1–15 built.
- **The founder's approval of 2026-11-20:** lessons 1–15 approved, and lessons
  16–29 to be built the same way.
- **On staging, admins only:** all 29 lessons, built as private test content
  (versions 4–9). Release and verification: deploy/RELEASES.md.
- **Next:** work stops here for the founder's review. Production and the
  published plans are unchanged.

The course builds on [09](09-beginner-revision.md): the same learner (a
15-year-old who has never held a drawing pencil), the same lesson page
([ADR-0020](../adr/0020-beginner-lessons.md)) and the Pareto principle.

## 1. The course
"Needs" lists the lessons that come first. Light and shadow starts with the
cube, as the founder decided.

| # | ID | Lesson | Stage | Needs | Content |
|---|---|---|---|---|---|
| 1 | D-HAND-01 | Light, medium and dark lines | 1 Pencil control | — | v4 |
| 2 | D-LINE-01 | Straight lines | 1 | 1 | v4 |
| 3 | D-LINE-02 | Curved lines | 1 | 2 | v4 |
| 4 | D-FLAT-01 | Circles | 1 | 3 | v4 |
| 5 | D-FLAT-02 | Squares and triangles | 1 | 2, 4 | v4 |
| 6 | D-BUILD-01 | Shapes make things | 2 Drawing with shapes | 4, 5 | v4 |
| 7 | D-BUILD-02 | Guide lines | 2 | 1, 6 | v4 |
| 8 | D-BUILD-03 | Final lines | 2 | 1, 7 | v4 |
| 9 | D-FORM-01 | Cube | 3 Simple 3-D forms | 5, 8 | v4 |
| 10 | D-LINE-04 | Cylinder and the ellipse | 3 | 4, 9 | v4 |
| 11 | D-FORM-02 | Sphere | 3 | 10 | v4 |
| 12 | D-FORM-03 | Cone | 3 | 7, 10 | v4 |
| 13 | D-SHAPE-03 | Forms make things | 3 | 9–12 | v4 |
| 14 | D-VAL-01 | Five values | 4 Values and light | 1, 5 | v4 |
| 15 | D-VAL-02 | Smooth shading | 4 | 14 | v4 |
| 16 | D-LIGHT-02 | Light on a box | 4 | 9, 14 | v5 |
| 17 | D-LIGHT-01 | Light on a ball | 4 | 11, 15, 16 | v5 |
| 18 | D-LIGHT-03 | Core shadow and cast shadow | 4 | 17 | v5 |
| 19 | D-LIGHT-05 | Light on a cylinder, then optional simple apple | 4 | 10, 15, 18 | v9 |
| 20 | D-OBS-08 | The outline of a real object | 5 Drawing from observation | 3, 8 | v6 |
| 21 | D-SHAPE-01 | Big shapes and negative space | 5 | 20 | v6 |
| 22 | D-OBS-03 | Comparing height, width and angles | 5 | 21 | v6 |
| 23 | D-OBS-04 | Measuring with the pencil | 5 | 22 | v6 |
| 24 | D-OBS-07 | A cup, then a simple still life; optional mug comparison | 5 | 10, 16–19, 23 | v9 |
| 25 | D-COPY-02 | Proportions in a photo | 6 First realistic drawing | 23 | v7 |
| 26 | D-COPY-01 | The grid method | 6 | 25 | v7 |
| 27 | D-COPY-03 | Building an eye | 6 | 7, 11, 26 | v8 |
| 28 | D-COPY-04 | Shading an eye | 6 | 17, 18, 27 | v8 |
| 29 | D-SUBJ-04 | A finished drawing | 6 | 24, 26, 28 | v8 |

**The full specification is private:** `curriculum-spec.md`, next to the
seed folders, outside the repository. It is generated from the content and
answers six questions for every lesson:
- what the person can do after it;
- what it needs;
- what to draw;
- what the picture shows;
- the common mistake;
- "Done when".

**How the IDs were chosen:**
- **Lessons 1–5** keep their IDs and history.
- **M6a's lessons, rewritten for the same skills:** D-LINE-04, the glass
  lesson, is now lesson 10, cylinder and ellipse. D-SHAPE-01, the
  big-shapes lesson, is now lesson 21. Their M6a versions stay in the
  content history, and their files stay stored.
- **D-START-01**, the mug baseline, is published for admin review at the course start, optional and unnumbered. Lesson 24 invites an optional redraw.
- **Reserved IDs:** IDs from [02](02-curriculum.md) are used only for the
  skills they were reserved for:
  - D-SHAPE-03;
  - D-VAL-01 and D-VAL-02;
  - D-LIGHT-01…03;
  - D-OBS-03, D-OBS-04 and D-OBS-07;
  - D-COPY-01…04;
  - D-SUBJ-04.
- **New IDs:** D-BUILD-01…03, D-FORM-01…03, D-LIGHT-05 and D-OBS-08.

## 2. The content versions
Each content version was built, checked locally, then published on staging
in turn. Nothing was deleted, and each earlier version can be restored.

| Version | Adds |
|---|---|
| v4 | Lessons 6–15. Stage 1 regrouped into one unit. Lesson 1 retitled. The challenges linked to their lessons. CH-053 and CH-054 |
| v5 | Lessons 16–19, light and shadow, the cube first |
| v6 | Lessons 20–24, observation. CH-002 linked to lessons 20–22 |
| v7 | Lessons 25–29, the first realistic drawing. A sixth unit |

| v8 | Approved realistic graphite illustrations, HE/EN instructions and A4 sheets for lessons 27–29 |
| v9 | Existing simple apple after lesson 19; optional Before & After mug at course start and return in lesson 24 |

**What every numbered lesson has:**
- a demonstration picture and common-mistake guidance;
- a task of 1–3 lines, something to make, and "Done when";
- one A4 practice sheet.

**Lessons 25 and 26** also use a photo of an 18th-century mug: it is the
step picture in both, and the reference in lesson 26 that opens Create a
Grid at 4 × 4.
- **Rights:** the photo is from the Cleveland Museum of Art, released CC0.
- **Already stored:** it was imported in M4 with its rights evidence, so no
  new outside material was added.
- **Lesson 25's picture** is that photo with proportion marks drawn on it
  in code.

## 3. Practice sheets
- **One per lesson, 29 in all.** Each is an A4 portrait PDF:
  - progressive practice, light guides and space for independent drawing;
  - for observation lessons: frames to draw in, with guides only where they
    help (spaces, angles, unit marks).
- **No words.** The only text is the lesson's ID; the five-values sheet also
  prints its fill order as digits.
- **Every lesson also works on plain paper.**
- **Checked:**
  - read back with the app's PDF reader: one A4 page, no images, every mark
    at least 18 mm from the edges;
  - previews rendered with macOS's own PDF engine;
  - printing on a real printer at 100 % has not been checked.

## 4. Code
**One change, in the first sprint.** The Learn screen scrolls up and down
only (`78b7fb2`).

**Why:** right to left, WebKit with visible scrollbars counted the
scrollbar's width as sideways overflow, so every Learn screen could pan
5 px sideways in Hebrew.

**Since then:** lessons 16–29 needed no code. No schema, route,
dependency, catalog or plan change.

## 5. Rights
- The original course diagrams and worksheets were drawn in code.
- Lessons 27–29 now use founder-approved original generated graphite artwork,
  created for Studio Companion. Lesson 28 was derived from the approved eye
  construction asset, with no third-party image input. The approved image bytes
  are preserved unchanged in v9.
- Generator information, prompts, source inputs, dates, checksums and commercial-use
  terms evidence are in private content storage, alongside editable worksheet
  sources. AI generation does not establish exclusive copyright or guarantee uniqueness.
- The existing mug photo and marked demonstration reuse the Cleveland Museum of
  Art CC0 asset with its original attribution and rights evidence.
- The optional simple apple reuses the existing code-drawn asset and licence record.
- No commercial lesson assets or private provenance packages enter this repository.

## 6. Deferred
- **Later modules (P2):** colour, painting and art history, advanced
  challenges and educator workflows.
- **M6b (the content editor):** not started.
- **Hebrew review:** a native-speaking art teacher's review (A14).
- **Physical checks:** a real iPhone and a real printer.

## 7. Founder review
The approved content integration is on private staging. The next step is the
founder's hands-on review. Opening Learn to learners remains a separate decision;
Free and Pro remain closed. Existing progress IDs and numbered lesson order are
unchanged. Earlier content versions and the private pre-update snapshot support rollback.
