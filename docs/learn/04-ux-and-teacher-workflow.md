# 04 — Screens, flows and the teacher workflow (proposal, for approval)

The design goal: choose a drawing task in a few taps, put the tablet down,
draw on paper. The software stays one tap away when help is needed. No
timers, no streaks, no scores, no forms, no classroom management, no
AI scoring of anyone's artwork.

## Where Learn lives

- **A studio view at `/app/learn`**, like the account and plans pages, so
  the tools stay alive behind it: opening Create a Grid from an exercise and
  coming back loses nothing.
- **Entry points:** a Learn section on Home ("Learn to draw" and "Pick a
  challenge"), and a Learn item in the desktop navigation bar.
- **Phones:** the bottom bar already has six items; a seventh would make
  every label harder to tap. Recommendation: on phones, Learn is reached
  from Home in v1, and its use is measured before changing the bar.
  **Decision needed** (see 07).
- **Worksheets on their own (the owner's decision, 2026-11-19, A20 in 07):**
  Prepare Worksheets should eventually be reachable from Home as a feature
  in its own right, as well as from Create a Grid and Study & Simplify. Not
  built in M4; designed with the Learn screens.

## Screens

### S1 · Learn home (`/app/learn`)
- Two large choices: **Curriculum** (with "Continue: <next exercise>" for
  personal accounts, from their own completions) and **Challenges** (with
  **Random**, **Quick** and **Browse**).
- A **Class mode** switch in the header (see S7).
- Nothing else: no progress bars, streaks or badges. A plain count of
  completed exercises appears only on the history page.

### S2 · Curriculum (`/app/learn/curriculum`)
- Three groups, in the recommended order (02):
  - **Core** (12 exercises);
  - **Next steps** (8);
  - **Colour** (7).
- Each exercise shows its title, a small thumbnail, a "completed" tick with
  the number of times, and a lock when it is not in the plan.
- A one-line recommendation to start with the core in pencil before colour,
  never a requirement.

### S3 · Exercise card (`/app/learn/exercises/<id>`)
- **Title**, a **large reference image** (tap for full screen and zoom), the
  **short instruction**.
- **More help** (collapsed): the guide, the common mistake and its fix, the
  success criterion.
- **Tool shortcuts** (chips), e.g. "Open in Create a Grid", "Check with
  Compare & Correct". A shortcut opens the tool with the exercise's reference
  already loaded (no upload).
- **Prepare Worksheets** (primary button) when a worksheet is useful;
  exercises with static worksheets (dot pairs, value strips, perspective
  guides) show **Print worksheet** instead.
- **Mark as completed** (secondary, optional; hidden in class mode). Tapping
  it again on another day records another completion; "Undo" for a few
  seconds after a tap.
- Layout: on a tablet in landscape, the reference on the left and the text
  and actions on the right; in portrait and on phones, one column with the
  actions reachable without scrolling past the image.

### S4 · Challenges (`/app/learn/challenges`)
- Filters in one row: level (Beginner, Intermediate, Advanced), subject
  group, pencil or colour, quick only. Remembered on this device.
- **Random** picks among the challenges the account may use that match the
  filters, skipping the ones completed most recently. **Quick** is Random
  limited to quick challenges.
- A grid of cards: thumbnail, title, level, "quick" mark, lock if not in the
  plan.

### S5 · Challenge card (`/app/learn/challenges/<id>`)
- As S3, plus **Another one** (a new random pick with the same filters) and,
  for challenges drawn from one's own subject, **Use my photo** (opens
  Prepare Worksheets with a photo from the camera or files, which never
  leaves the device).

### S6 · Prepare Worksheets

> **As built in M3 (ADR-0016):** one sheet in Create a Grid and Study &
> Simplify. The frame is Create a Grid's (no separate Frame section); the
> pages are switches (the blank grid off at first; 3 or 5 values); the
> result is aligned **PNG images**, saved together (on phones, one share
> sheet with Print) or one at a time. The design below remains the target
> for the Learn screens.
Opens as a full-screen sheet over the card, with the reference already
loaded. Three short sections on one screen, a live page preview beside them:

1. **Frame** — rotate left or right (90°), rotate 180°, zoom and move the
   image in the page frame, Fit or Fill; paper A4, portrait or landscape
   (chosen automatically from the image, changeable).
2. **Pages** — switches, each with a thumbnail: **Original**, **Outline**
   (Clean Outline; Pencil Study as an option), **Reference with grid**,
   **Blank grid**, **Values** (3 or 5). Grid: columns × rows, or a square
   cell size in centimetres; line strength; letters and numbers along the
   edges (on by default, to help find a square).
3. **Create PDF** — one multipage A4 PDF; then **Print**, **Share** or
   **Save** (on an iPad, Share includes Print).

The last choices of pages and grid are remembered on this device; the image
is not. Every page carries a 5 cm scale bar and "Print at 100% (actual
size)", so a wrong print scale is visible at once.

### S7 · Class mode
- A switch in the Learn header: "Class mode — nothing you do is saved to
  your account."
- While it is on: **Mark as completed** is hidden, nothing is written to the
  account's history, and "recent references" are kept only in this browser
  tab (and forgotten when class mode is turned off or the tab closes).
  Everything else works the same.
- It is a setting of this browser, not a role, an account or a classroom:
  there are no student profiles anywhere.
- It turns itself off after a long idle period (proposed: 12 hours), so a
  teacher's personal history is not silently skipped for days.

### S8 · My history (`/app/learn/history`, personal accounts)
- A list of completions (date, exercise or challenge), newest first; remove
  one with a tap. No streaks, no daily targets, no penalties.
- Included in the account's data download and removed with the account
  (ADR-0010).

### S9 · A locked exercise or challenge
- In lists: the title, a lock, and the thumbnail only if the admin allows
  previews (see 05).
- On its own page: the same locked layout as the tools (part of Pro, or not
  available on any plan), with **Back to Learn** and **Compare plans**. The
  instructions, the guide and the full-size reference are never sent.

## The teacher workflow: one tablet, five students

The scenario: at the start of a lesson, a teacher prepares a worksheet
package for each of five students from one image each, prints it, hands it
over, and moves on.

1. **Turn on Class mode** (once per lesson).
2. **Choose a reference**: Learn → Challenges → "A butterfly" (or any
   exercise or challenge, or **Use my photo**).
3. **Prepare Worksheets**: the butterfly is already in the frame. Check the
   suggested pages (Original, Outline, Reference with grid, Blank grid;
   Values if wanted) and the grid (4 × 4 by default, or a cell size).
4. **Create PDF → Print** (AirPrint from the iPad's share sheet) or Save.
5. **Next student**: back to the library with the same page and grid
   choices; the previous image is cleared from the composer.

Targets (to verify in usability testing, not promised):

- From the Learn home to a printed package: at most 6 taps with a library
  reference, at most 8 with the teacher's own photo.
- The same image is never uploaded or configured twice.
- Every page of a package shares the same crop and placement, so the
  outline, the grid and the original line up exactly.

What the teacher does not need: student accounts, a teacher role,
classroom records, assignments or gradebooks.

### Printing and accuracy

- Pages are true A4: 210 × 297 mm (portrait) or 297 × 210 mm (landscape).
  Content keeps at least 12.7 mm from every edge (home printers leave 3–5 mm
  or more unprintable), and the scale bar and grids stay away from the top
  and bottom edges.
- Physical accuracy depends on printing at **100% / actual size**: "fit to
  page" shrinks everything to about 96–97%.
  - The PDF asks viewers to preselect no scaling (`PrintScaling /None`).
  - The scale bar on every page makes a wrong scale visible at once.
  - The print guidance says so in one line.
  - A one-page calibration sheet (a 10 cm line to measure) is available
    beside the package.
- Whether the iPad's print sheet itself scales PDFs is not yet verified; it
  is tested on the owner's devices before Learn claims physical accuracy
  from a tablet.
- When the reference is too small for the chosen print size (below about
  150 pixels per inch on paper), the composer says so before creating the
  PDF.

## Accessibility and comfort

- Touch targets of at least 44 × 44 px; everything reachable by keyboard;
  visible focus.
- Every provided reference has alternative text in English and Hebrew.
- Right-to-left layout in Hebrew; numbers, sizes and grid labels stay left
  to right (as in the existing tools).
- No time limits anywhere; reduced motion respected.
- Checked with axe (WCAG 2.1 AA) in English and Hebrew, desktop and phone,
  as the rest of the studio is.
