# Studio Companion Learn — research, specification and plan

**Status: proposal for the owner's approval. Nothing here is implemented.**
No Learn code, migration or deployment exists; no test has been written or
run for Learn. Prepared on 2026-11-18 against `be6890c`.

## Executive summary

**What Learn is:**

- A pencil-first drawing practice companion: a curriculum of 46 drawing
  exercises in 11 units, a separate colour module of 7 exercises, and 50
  reusable challenges.
- It is designed so people spend their time on paper, not on screens.
  Pick a task in a few taps, put the tablet down, draw. Help is one tap away.
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

**Admin control:**

- Whole modules and the two PDF exports are features in the existing plan
  editor.
- Inside each collection, each plan has exactly one rule: All, None,
  First N, or Selected items. Two settings can never conflict.
- Everything is a versioned draft until published.
- Locked content and its images are never sent to accounts that cannot open
  them.

**Evidence:**

- The research supports teaching *how to look and check* early: angles,
  relative measurement, alignments, blocking in big shapes.
- It supports value as a separate early skill.
- It supports feedback about the drawing, not the person.
- It does not support claims about learning speed, "right-brain" drawing or
  upside-down copying. Learn will make none.

**A risk found during inspection:**

- **The hazard:** today, rolling back after a catalog with any new feature
  ID is published would reset every plan to the code defaults.
- **The fix:** milestone M0 removes that hazard and ships before anything
  else.

**What is needed from the owner:** the 18 decisions in
[07-phases-qa-approvals.md](07-phases-qa-approvals.md) § Approval checkpoints.
A1 (this plan and its order) is needed before M0 starts.

## Documents

| # | Document | Contents |
|---|---|---|
| 01 | [Research findings](01-research.md) | Evidence by topic with strength tags; curricula and methods; image licensing; print accuracy; PDF libraries; what Learn must never claim; open questions; 87 references |
| 02 | [Curriculum](02-curriculum.md) | 46 drawing exercises in 11 units and 7 colour exercises, each with ID, English and Hebrew title, objective, materials, instruction, guide, reference, mistake and fix, tool, worksheet, success criterion |
| 03 | [Challenges](03-challenges.md) | The 50 reusable challenges with level, skill, reference, medium, quick flag and tools |
| 04 | [Screens and the teacher workflow](04-ux-and-teacher-workflow.md) | Where Learn lives, screens S1–S9, Prepare Worksheets, Class mode, history, the one-tablet-five-students flow, printing |
| 05 | [Admin and entitlements](05-admin-and-entitlements.md) | Status of the earlier bug, module features, per-collection rules, precedence, visibility versus authorization, admin screens |
| 06 | [Architecture](06-architecture.md) | Reuse map, content schema, assets, the access resolver, routes, worksheets and PDF, Grid improvements, localisation, history, security, copyright, migration and rollback, risks |
| 07 | [Phases, QA and approvals](07-phases-qa-approvals.md) | Milestones M0–M9, acceptance criteria, the 18 decisions |
