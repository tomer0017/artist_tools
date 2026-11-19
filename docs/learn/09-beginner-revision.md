# 09 — The beginner revision (approved 2026-11-19)

**Status: approved by the owner on 2026-11-19, with nine refinements (§6),
and implemented for the first five lessons only** ([ADR-0020](../adr/0020-beginner-lessons.md)).
It revises the M6a lesson ([08](08-m6-design-review.md), ADR-0019) after the
owner's review: "pedagogically too advanced and visually too dense for a
complete beginner". M6b, M7 and the full curriculum wait for the owner.

**The learner it is written for:** a 15-year-old who has never held a pencil
and cannot yet draw a straight line, a circle, a square or a triangle.

**The principle:** Pareto 80/20, meaning maximum learning value with minimum
friction, complexity and effort. Each lesson teaches one new, small skill.

## 1. The sequence
| Stage | Lessons (about 10 minutes each, on paper) |
|---|---|
| 1 Pencil and lines | light and dark lines · straight lines · curved lines |
| 2 Flat shapes | circles · squares and triangles · shapes make things |
| 3 Simple 3-D forms | cube · cylinder (the first ellipse) · sphere · cone |
| 4 Value and light | a value scale and smooth transitions · shading a ball (light source, core shadow, cast shadow) · shading a box and a cylinder |
| 5 Observation and proportion | the outline of a simple object · big shapes and negative space · measuring with the pencil · a simple still life |
| 6 Realistic drawing | the grid method · a realistic eye · one finished drawing |

**Later modules, each separate:**

- **Colour:** the colour wheel, complementary colours, mixing.
- **Art history:** short visual cards, each one movement or artist with one
  or two properly licensed works, linked to a skill. For example, Rembrandt
  for light and shadow.

**Not before their prerequisites:**

- complex objects, decorated mugs, still-life paintings and ellipses;
- several tools at once.

## 2. The first five micro-lessons (built)
Every lesson has:

- one picture, drawn in code;
- a task of one to three lines that works on plain paper;
- one small thing to make;
- "Done when";
- a common mistake with its own picture.

Each also has an optional A4 practice sheet that goes from tracing, to dots
only, to an empty box for the creative drawing. The sheets have no words.

| # | ID | Lesson | Task (short) | Make something |
|---|---|---|---|---|
| 1 | D-HAND-01 (new) | Light and dark lines | Hold the pencil back from the tip; rows of light, medium and dark lines | A field of grass: dark at the bottom, light at the top |
| 2 | D-LINE-01 | Straight lines | Two dots, rehearse in the air, one stroke with eyes on the end dot; 10 pairs | A fence: ten posts, two rails |
| 3 | D-LINE-02 | Curved lines | Arcs through three dots; S-curves | A rainbow: five arcs, one inside the other |
| 4 | D-FLAT-01 (new) | Circles | A centre dot and four dots; round twice lightly; 10 with dots, 5 without | A caterpillar of circles |
| 5 | D-FLAT-02 (new) | Squares and triangles | Join corner dots, corner to corner; 5 of each on dots, 3 without | A slice of pizza: a triangle with circle toppings |

D-LINE-01 and D-LINE-02 are IDs the original plan reserved and never used
([02](02-curriculum.md)), now used for the same skills. IDs are never reused
for something else.

**The starter challenges** are new, in a "First challenges" group, at
beginner level, drawn from memory or imagination:

- **CH-051 A robot made of shapes:** builds on lessons 4, 5 and 2.
- **CH-052 A street of houses:** builds on lessons 5, 2 and 1.

**Lesson 6, "Shapes make things",** comes next, with the rest of stage 2.

## 3. The lesson page
The page and its help sheet are specified in [ADR-0020 §1](../adr/0020-beginner-lessons.md).

**The page:**

- the title, the objective and one picture;
- "Your task", in one to three lines;
- "Make something";
- "Done when";
- one button: **"I did it — next lesson"**.

**Below the button, quietly:**

- Practice sheet;
- Need help?;
- "Printing is optional".

**"Need help?"** holds:

- the mistake and its fix;
- why it works;
- what you need;
- tools (only if the lesson names some);
- more practice;
- credits.

The button records only the person's own word, once a day and never in
class mode, and offers Undo. Nothing judges the drawing.

## 4. The M6a lessons
**Unpublished, with their IDs, pictures and history kept.** Nothing is
deleted. Each moves to the stage where it belongs:

| Lesson | Moves to |
|---|---|
| D-LINE-04 (a glass from lines and ellipses) | Stage 3 |
| D-SHAPE-01 (big shapes, still life) | Stage 5 |
| D-START-01 (the mug baseline, optional) | Stage 5 |

**Visibility:**

- Admins see them as drafts, without a number, at the end of the course.
- Learners do not see them.
- They will be rewritten when their stages are built.

**Their challenges** (CH-002, CH-012, CH-017) are unchanged. Their links to
these lessons show nothing to learners until the lessons return.

## 5. Reused and changed
**Reused as they were:**

- the content model and its versions;
- import, publish and restore;
- private assets with their rights records;
- access rules in Admin → Plans;
- history and class mode;
- the worksheet system (static PDFs);
- tool hand-offs, presets and the way back;
- the course list, the Learn home and the challenges screen;
- every security check.

**Changed:**

- the lesson page and its help sheet;
- the publishing rules: one picture, a task of 1–3 lines, no self-checks;
- one optional content field, `create`;
- drafts are no longer numbered;
- the private test content (version 3).

## 6. The owner's refinements (2026-11-19)
1. **The stages:** keep the six drawing stages, followed later by colour and
   concise, visual art-history modules.
2. **The lessons:** the first five micro-lessons and their IDs, extremely
   beginner-friendly.
3. **Something to make:** a small, enjoyable creative application where
   appropriate, never another full lesson.
4. **The button:** one "I did it — next lesson" action. Completion stays
   honest and controlled by the person, and never implies the drawing was
   assessed.
5. **Practice sheets:** one optional printable sheet per lesson. Every
   lesson also works on plain paper without a printer.
6. **The M6a lessons:** unpublish the three test lessons, keeping their IDs,
   assets and history. Delete nothing.
7. **The page:** keep it minimal, but do not force it into one phone screen.
   Readability, picture size and one obvious next action come first.
   Desktop may use two columns.
8. **Three products:**
   - **Course** teaches progressively.
   - **Challenges** give independent practice.
   - **Tools** support artists at any level.
9. **No extras:** no unnecessary UI, infrastructure, abstractions or
   dependencies.

**Scope:** only the revised lesson experience, the first five lessons with
their diagrams and optional sheets, and two starter challenges, verified on
staging in English and Hebrew. The scope excludes:

- production;
- M6b (the content editor);
- the full curriculum.

## 7. Limitations still open
- **Hebrew review:** the Hebrew is gender-neutral, but no native-speaking
  art teacher has reviewed it yet (A14).
- **Pictures:** they are diagrams, not photographs of a real hand or real
  drawings.
  - **The grip** is shown as a marked zone on a pencil, not as a hand.
  - **Real demonstrations** need the owner's own drawings, or a
    rights-cleared educator's.
- **Stages not yet built:** stage 2's "Shapes make things", and stages 3–6
  with colour and art history.
- **The M6a challenges:**
  - **Level:** they are rated beginner, but suit a learner after stage 5
    better.
  - **Links:** they point at unpublished lessons.

  Re-levelling and re-linking them belongs with the full curriculum.
