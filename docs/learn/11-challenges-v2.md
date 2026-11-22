# 11 — Challenges V2: the creative playground

**Status:**
- **The brief:** the founder's "Creative Playground (Challenges V2)" of
  2026-11-22.
- **Built:** the playground, the timer and saving, by
  [ADR-0021](../adr/0021-challenges-creative-playground.md); 60 new ideas in
  8 categories as private content.
- **On staging, admins only:** content version 10 on top of the owner's
  version 9. Release and verification: deploy/RELEASES.md.
- **Next:** work stops here for the founder's review. Production and the
  published plans are unchanged.

## 1. What an artist does
1. Opens Challenges: "Need an idea?"
2. Chooses a mood, or keeps "Surprise me 🎲":

   | English | Hebrew |
   |---|---|
   | Something light | בא לי משהו קליל |
   | Let me create | בא לי ליצור |
   | Challenge me! | תאתגרו אותי! |
   | Surprise me 🎲 | תפתיעו אותי 🎲 |

3. Taps **Spin** (להגריל): a short reel of titles lands on one idea (no reel
   for people who ask for less motion).
4. Reads one specific task, its twist when it has one, and a tip.
5. Draws, with any medium. Optionally: **Add a timer**: 10, 30 or 60
   minutes, or a stopwatch. "Draw whatever you can in the time you chose.
   Whatever comes out is part of the fun."
6. Then, if they like: **Mark as completed**, **Save**, or **Spin again**.

Below the playground, "All challenges" lists everything, with the filters,
now including **Saved**.

**Effort is a mood, not a level of talent:** the badges say "Light",
"Creative" and "Challenging". A beginner may pick a challenging idea, an
expert a light one.

## 2. The 60 ideas
**Private:** `studio-companion-private/challenges-v2` (`challenges.mjs`, its
output `challenges.json`, `PROVENANCE.md`). They are original text written
for Studio Companion, in English and gender-neutral Hebrew, with no pictures.
Nine start from the founder's examples in the brief.

| Category | Ideas | Light | Creative | Challenging |
|---|---|---|---|---|
| Imagination and fantasy | 8 | 3 | 3 | 2 |
| Animals and nature | 8 | 3 | 3 | 2 |
| Observation and everyday objects | 8 | 2 | 4 | 2 |
| People and characters | 8 | 2 | 4 | 2 |
| Food and objects | 7 | 4 | 1 | 2 |
| Movement and sports | 7 | 3 | 2 | 2 |
| Architecture and environments | 7 | 2 | 3 | 2 |
| Creative transformations | 7 | 2 | 3 | 2 |
| **Total** | **60** | **21** | **23** | **16** |

**Every idea has:**
- a short title and one clear task;
- one primary skill;
- a tip;
- a twist where it helps (29 of the 60).

**No idea:**
- names a medium;
- shows a finished drawing to copy;
- repeats a course lesson.

**IDs:** CH-055 … CH-114, after the existing CH-002, 012, 017 and 051–054.
Those 7 and their 4 groups are unchanged, so there are 67 challenges in 12
groups.

## 3. The timer, in short
- **Kept as timestamps in this browser:** start, time paused, target, the
  idea.
- **Worked out from the clock whenever the page is seen.** A locked phone, a
  sleeping tab or a browser closed for hours shows the right time on coming
  back.
- **Pause, Resume, Reset.** When the time is up, a kind line, and drawing
  goes on.
- **Not built:** sounds, notifications, a server timer. A closed browser
  cannot ring, and the page never says it will.

## 4. Tested
- **Simulated** (Playwright, Chromium and WebKit's iPhone 13):
  - English and Hebrew, desktop and phone;
  - moods, spins and the reel;
  - Save, after a reload;
  - Mark as completed;
  - the timer, after reloads and three hours away, with pause, resume and
    the time up;
  - Free and Pro unchanged, axe on every state.
- **Physical devices:** not yet; the founder's iPhone check is part of the
  review.

Results: deploy/RELEASES.md.

## 5. Limits, and what the founder decides
- **Saved ideas and the timer live in one browser.** They do not follow the
  person to another device; "Sign out and clear this device" removes them.
- **The Hebrew** was written directly, not reviewed by a second native
  speaker yet.
- **For the founder:**
  - the 60 ideas, their words and their efforts;
  - whether the Learn home's own Random and Quick should open the playground
    instead;
  - when Challenges goes into a plan.
