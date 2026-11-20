# Studio Companion Learn — research, specification and plan

**Status: proposal for the owner's approval. Nothing here is implemented.**
No Learn code, migration or deployment exists; no test has been written or
run for Learn. Prepared on 2026-11-18 against `be6890c`, and revised the same
day after the owner's first review.

**Start with [00-review.md](00-review.md):** the short review document,
with:

- the whole curriculum and all 50 challenges;
- the nine screens;
- the Free/Pro controls;
- the decisions still open.

## Executive summary

**What Learn is:**

- A pencil-first drawing practice companion with:
  - a curriculum of 20 drawing exercises: 12 core exercises and 8 next steps;
  - a separate colour module of 7 exercises;
  - 50 reusable challenges.
- **The 80/20 cut:** the first proposal had 46 drawing exercises. Most were
  merged or deferred, keeping the ones that train looking, measuring and
  checking, which the research links to accuracy.
- **Time on paper, not on screens:** pick a task in a few taps, put the
  tablet down, draw. Help is one tap away.
- No timers, streaks, scores, forms or classroom management.

**What it builds on:**

- **Image processing:**
  - Study & Simplify's Clean Outline and Pencil Study are called as they
    are.
  - Its Values algorithm and Create a Grid's geometry are *moved* into
    shared modules with byte-identical tests, never rewritten.
- **Access control:** the plan system that was fixed and verified on real
  staging on 2026-11-18 (ADR-0013). Learn adds one item-level rule on top of
  it, not a second authorization system.

**The teacher's need is met early:**

- Prepare Worksheets turns one image into aligned A4 pages (original,
  outline, reference with grid, blank grid, values) in one PDF.
- It ships as milestone M3, usable with the teacher's own photos before any
  curriculum content exists.
- A Class mode keeps a shared tablet from writing anything to the owner's
  personal history. It is a browser setting: there are no student accounts,
  roles or records.

**Admin control, all in Admin → Plans:**

- **Today** that editor controls only the five tools and the image and GIF
  saves (05 §2).
- **The proposal extends it:**
  - whole modules and the two PDF exports become rows with Free/Pro
    switches;
  - inside each collection, each plan has exactly one rule: All, None, or
    Selected items. Two settings can never conflict.
- **First N** counts items, and is frozen into a list when published, so
  reordering content never changes anyone's access.
- Everything is one versioned draft until published.
- Locked content and its images are never sent to accounts that cannot open
  them.

**Evidence:**

- The research supports teaching *how to look and check* early: angles,
  relative measurement, alignments, blocking in big shapes.
- It supports value as a separate early skill.
- It supports feedback about the drawing, not the person.
- It does not support claims about learning speed, "right-brain" drawing or
  upside-down copying. Learn will make none.

**Found during inspection, handled separately:**

- **The rollback hazard:**
  - Today, rolling back after a catalog with any new feature ID is published
    would reset every plan to the code defaults.
  - It is now a separate security fix with its own tests and approval
    ([catalog-rollback-safety.md](../security/catalog-rollback-safety.md)).
  - It is released before any Learn milestone that adds a feature.
- **The repository is public:**
  - so reviewed content and reference images are never committed;
  - the drafts in these documents are already readable by anyone.

**What is needed from the owner:**

- the rollback-safety fix: approved, then released to staging on 2026-11-18
  (`224bb65`, ADR-0014);
- the 19 decisions in [07-phases-qa-approvals.md](07-phases-qa-approvals.md)
  § Approval checkpoints, summarised in [00-review.md](00-review.md).

## Documents

| # | Document | Contents |
|---|---|---|
| 00 | [Review](00-review.md) | The short review document: answers to the first review, the curriculum, the 50 challenges, the nine screens, the Free/Pro controls, the open decisions |
| 01 | [Research findings](01-research.md) | Evidence by topic with strength tags; curricula and methods; image licensing; print accuracy; PDF libraries; what Learn must never claim; open questions; 87 references |
| 02 | [Curriculum](02-curriculum.md) | 12 core exercises, 8 next steps and 7 colour exercises, each with ID, English and Hebrew title, objective, materials, instruction, guide, reference, mistake and fix, tool, worksheet, success criterion; the 26 merged or deferred |
| 03 | [Challenges](03-challenges.md) | The 50 reusable challenges with level, skill area, reference, medium, quick flag and tools |
| 04 | [Screens and the teacher workflow](04-ux-and-teacher-workflow.md) | Where Learn lives, screens S1–S9, Prepare Worksheets, Class mode, history, the one-tablet-five-students flow, printing |
| 05 | [Admin and entitlements](05-admin-and-entitlements.md) | The earlier bug's status; what today's Plans editor controls; module features; the per-collection rules and First N; precedence; visibility versus authorization; admin screens |
| 06 | [Architecture](06-architecture.md) | Reuse map, content schema, reference images (storage reevaluated), the access resolver, routes, worksheets and PDF, Grid improvements, localisation, history, security, copyright, migration and rollback, risks |
| 07 | [Phases, QA and approvals](07-phases-qa-approvals.md) | The prerequisite fix, milestones M1–M9, acceptance criteria, the 19 decisions |
| 09 | [The beginner revision](09-beginner-revision.md) | After M6a, approved on 2026-11-19: the learner is a complete beginner; six stages from pencil control to realistic drawing, then colour and art history; the first five micro-lessons and two starter challenges (built); the simplified lesson page; the M6a lessons kept unpublished |
| 10 | [The beginner drawing course](10-beginner-course.md) | The founder's sprint brief of 2026-11-19 and approval of 2026-11-20: all 29 lessons built (six stages, content versions 4–7), the challenges linked to their lessons, 29 practice sheets; what is deferred and what the founder decides |
| 08 | [M6 design review](08-m6-design-review.md) | After M5, approved on 2026-11-19 with the owner's refinements: lessons that teach versus challenges that practise; the 20 lessons in 6 units with an optional baseline; the lesson template and schema additions; which lessons need diagrams; UX changes; the content editor with rights records; the audit of the four CC0 images; risks; decisions B1–B13 |
