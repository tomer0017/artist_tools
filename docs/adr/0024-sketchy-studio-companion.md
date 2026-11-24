# 0024 — Sketchy, the studio companion: an SVG puppet with a pose engine, a versioned configuration edited in Admin → Companion, per-capability access, and only safe, predefined actions

**Status:** Accepted (2026-11-24), under the founder's brief "Sketchy — The
Intelligent Studio Companion" (full ownership, 80/20, production first).

## Context
The founder wants a living mascot in the studio: Sketchy, the fox artist of
the official character sheet (orange fox, brown beret, red scarf, brown vest
with drawing tools, big expressive eyes, a large tail). He should walk, run,
jump, sit, rest, blink and breathe, move his tail and ears, wave, laugh,
think, look curious, celebrate, hold a sign, point at a tool and draw; live
mainly on Home without ever blocking navigation, buttons, canvases or work;
know the studio's real capabilities and the person's real access; suggest
useful things at the right moments, with real buttons; offer a menu (surprise
me, a drawing tip, a challenge, improve my drawing, choose a tool, a lesson,
practice sheets, preparing a class, hide him); spin an animated roulette of
the challenges the person may open; and be managed without code in a new
Admin → Companion: on/off, size, pace, cooldowns, animations with previews,
tips in English and Hebrew with screen, audience, trigger, animation and
action, and future Free/Pro access. Hebrew and English, RTL, keyboard,
reduced motion and an option to hide him are required; he must not slow the
studio down, and no paid service may be added without approval.

## Decision

### 1. The character: one layered SVG puppet, driven by a small pose engine
- **Why not frames or a 3D render:** producing a consistent set of rendered
  animation frames from the reference needs paid image or video generation
  (not approved) and would weigh megabytes; a Rive or Lottie file needs a
  designer's editor. A hand-drawn SVG puppet in the character sheet's
  three-quarter view gives every requested move, stays sharp at any size,
  has a transparent background, weighs a few kilobytes inside the code, and
  mirrors for walking left and for Hebrew.
- **The rig** (`src/components/companion/rig.tsx`): every moving part is a
  group with a pivot (tail, legs with knees, arms with elbows and wrists,
  torso, scarf end, head, ears, beret, eyes, irises, brows), plus faces
  (open, happy, closed, wide eyes; six mouths), props (the sign's post, a
  pencil, a brush, a sketchpad, a pointing finger) and effects (sparkles,
  confetti, a thought bubble, "?", "zzz", "!", dust). No text is ever part of
  the picture.
- **The clips** (`clips.ts`): 14 animations, each a pure function of time
  (angles, offsets, scales per part, the face, props, effects, a jump's
  lift), with a two-joint arm solver for poses that put a paw somewhere
  exact (the chin, the pad).
- **The engine** (`engine.ts`): plays one clip, blends from the current pose
  into the next (240 ms, so nothing jumps), and lays the shared life on top
  (blinking, breathing, tail sway, ear twitches). It writes only `transform`
  and `display` attributes, skips unchanged values, draws calm clips at about
  30 frames a second, and stops entirely when he is off screen, the tab is
  hidden or he is still. With reduced motion it draws each clip once, at its
  still moment, and never loops.

### 2. Where he lives and how he behaves
- **Home's hero** and the **Learn home's header**: the stage
  (`Stage.tsx`) measures the page and lets him stand only on the free side
  of the text (right in English, left in Hebrew), below the brand row on
  phones, smaller when the room is small (`geometry.ts`, tested). His sign
  goes beside him, as wide as the room there allows, covering at most the
  paw that holds its post, never his head or body, never the navigation or
  the tool cards; with too little room it goes below his feet. The stage
  layer takes no pointer events except on him, his sign and his menu.
- **Behaviour** (the director in `Stage.tsx`): he walks in from the edge,
  looks around and waves; the first time he introduces himself; on a new
  day he greets the person; after a save or a completed lesson or challenge
  (from elsewhere in the studio) he celebrates and offers what could come
  next; after a quiet while he may hold up a suggestion; now and then he
  walks to another free spot, sits, sketches, thinks or laughs, and after a
  long quiet he rests (and wakes when the pointer comes near). He never
  moves while his menu, a sign or the roulette is open and never offers
  anything while the person is using the page (a tap, key or scroll in the
  last 4 seconds). On desktops his eyes follow the pointer.
- **Away from his stages** (tool screens, Learn's other screens): only a
  short celebration in the corner after a save or a completion
  (`Celebration.tsx`): no pointer events, never over the navigation bar, two
  or three seconds. During work in a tool he never appears on his own.

### 3. What he knows, and why it is never invented
A registry of the studio's real capabilities (`src/lib/companion/registry.ts`):
the five tools with the feature the server must grant each, what each helps
with, which tools combine (short plans: photo → drawing, fixing proportions,
planning colors), Learn's course and challenges, and the worksheets. Every
button is checked against the account the server sent (`canRun`): a tool the
plan locks, Learn not shown, or worksheets missing mean the tip is not
offered at all. Guided help never claims to have looked at a drawing: it
asks what the person wants to improve and opens the right tools.

### 4. Only predefined actions
A tip's button is one of a fixed list (`ACTION_TYPES`): no button, open a
tool, spin the roulette, the class roulette, the next lesson, a Learn page, a
lesson or challenge by ID, practice sheets, another drawing tip, "improve my
drawing", "choose a tool". The studio performs it through its router with the
person's own access. No code, function name or address is ever stored or
followed; the server refuses anything else when saving.

### 5. The suggestions ("intelligence")
A pure, tested rule engine (`src/lib/companion/brain.ts`): a tip fits when its
screen, moment (first visit, arrival, a quiet while, after a save, after a
completion, or only when asked), audience (artist, student, teacher — what the
person said, or class mode for teachers) and "right after this tool" match,
and its button can run. Among fitting tips, those not seen in the last three
days win, by weight; a seen one comes back only when nothing fresher fits.
Proactive suggestions respect the admin's pace: seconds of quiet first,
minutes between two, a daily cap, and a snooze after "Not now" (celebrating
something the person did ignores the cooldown, never the cap). The interface
is a `SuggestionProvider` (context in, one of the given tips out), so a
conversational model behind a server endpoint can stand in later without
the studio changing, and can still only return tips with safe actions. No AI
service is called today.

### 6. Configuration: one versioned document, edited live in Admin → Companion
Kind `companion` in `config_versions` (ADR-0006): settings, the access of each
capability, every tip, and a tip-ID counter (IDs are never reused, even after
a restore). Until the first save the code's defaults apply
(`src/lib/companion/defaults.ts`: on for everyone, a balanced pace, all
animations, 47 tips in English and Hebrew). Each save in Admin → Companion
publishes a new version at once through the guarded compare-and-swap Learn
uses (`publishIfUnchanged`), re-applied on top of anything published
meanwhile, refused for a tip changed since it was opened, audited
(`admin.companion_changed`) and restorable. Read tolerantly (ADR-0014): a
value from a newer release keeps its tip out of the studio and blocks
writing over it.

### 7. Access: per capability, like Learn's items (ADR-0023)
Five capabilities — Sketchy himself, suggestions, the roulette, guided help,
teacher tools — and every tip each have an access mode: Free, Pro, Admin
only, Blocked, resolved on the server from the account's fresh entitlements
(`src/server/companion/live.ts`). Today everything is Free. Billing, PayPal
and the plan catalog are not touched; making a capability Pro later is one
choice in Admin → Companion.

### 8. Data, privacy and performance
- The studio asks `/api/companion` once, and again only when the account
  summary's `companion.key` changes (an admin's save, a plan change): the
  account check it already makes every minute carries it, so there is no
  polling of its own. The response holds only this account's tips.
- The person's choices (hide him, who they are) are on their account
  (`users.companion`, `POST /api/me/companion`), so every device follows;
  they are in the data download and removed with the account. What he
  remembers about pace and seen tips stays in this browser
  (`studio-companion*` keys), removed by "Sign out and remove the work
  stored here".
- His code loads after Home (lazy), only for accounts he is shown to.

## Consequences
- The look is a 2D adaptation of the 3D-rendered character sheet, faithful in
  shapes, colours and costume but not a movie render. Frames from an artist or
  a paid generator could replace the rig later behind the same engine API
  (`play`, `look`), without changing his behaviour, the admin or the data.
- Worksheets-related help appears only to accounts with Worksheets
  (`export.worksheets` is in no published plan yet: admins only) — publishing
  it in Admin → Plans brings it to everyone it includes.
- Rolling back to a release before Sketchy hides him (the configuration and
  the account field stay, ignored); rolling forward brings him back as
  configured.

## Amendment (2026-11-24): the official artwork, one floating Sketchy

The founder's official character art replaced the SVG rig (`0cbe3e8`:
`public/sketchy/*.webp`, 14 poses, behind the same `play`/`look` API). After
testing it on desktop and iPhone, the founder asked for these fixes:

- **Rendering** (`raster-mesh.ts`): premultiplied alpha end to end (texture
  upload and canvas). Safari on iPhone drew the non-premultiplied canvas with
  pale fringes on every soft edge. The canvas now holds as many pixels as it
  shows, so the browser never rescales it, and the sprites are mipmapped in a
  512 × 512 texture. The shader uses highp where the GPU has it. Every pose is
  preloaded before he first moves. A change of pose fades for 170 ms instead of
  snapping. Without WebGL, the still picture of the pose shows.
- **Motion** (`raster-engine.ts`): walking and running swing the legs ±15° /
  ±21° in opposite phase at a stride cycle matched to the speed he crosses the
  screen (`strideCycle`), so his feet do not slide. His gaze eases toward the
  pointer and his head turns with it rigidly: the face is never warped. On a
  touch screen he glances toward a tap.
- **One floating Sketchy** (`Stage.tsx`, `presence.ts`): he first stands in
  the hero (or on the Learn home's cards). Once that spot scrolls half out of
  view he runs into a corner of the scrolling area (the reading direction's
  end, above a phone's bottom bar). He returns when his spot is in full view
  again. Exactly one Sketchy is ever drawn: the stage, the roulette and a
  celebration claim him with priorities, and only the top claim renders him.
  While the roulette is open he stands only beside its wheel, and he comes
  back once when it closes. Only his head and body take a tap.
- **Signs**: the board is held on the post in his paw (its bottom on the post,
  its inner edge just past his cheek; `holdPoints`). Closing a sign with ✕ or
  Escape just closes it. Only "Not now" starts the admin's snooze: closing used
  to silence him for the whole snooze (24 hours by default), which is why no
  signs appeared on desktop. Pace, cooldown and daily cap are unchanged.
  Clicking him opens his menu at once whatever the pace. Admin → Companion's
  preview shows any tip at once and scrolls into view.

### Second amendment (2026-11-24): a calm assistant in one place

The founder then tested on a real iPhone and asked for calm, helpful behaviour
over animation. The stage is simpler now:

- **One place.** He walks in once a visit from the edge of the screen into
  his corner of the scrolling area, and stays there while the page scrolls.
  There is no hero spot and no move between places. Going from Home to the
  Learn home and back, he is simply there (`visit` in `Stage.tsx`). His corner
  is measured from the scrolling area's outer sides, so it is the same with
  or without a scrollbar.
- **A small state machine.** The states are entering, idle (standing, then
  sitting after 75 s, then dozing after the admin's "rest after"), showing a
  sign, and leaving. There is no wandering, and no random sketch, think or
  laugh. A tip's own animation no longer plays before the sign; only a
  challenge to spin (or a tip marked jump or celebrate) gets a little jump
  first. A click opens the menu with no flourish.
- **The walk.** Two identical steps a cycle: from the drawn stride the legs
  swing toward each other and back, never past the drawing. The body is high
  at the passing moment and low at contact. The walking speed comes from this
  gait at a calm cadence (`gaitSpeed`, about one second per two steps), so the
  feet do not slide. A change of pose fades over 260 ms.
- **Helpful pace.** The default ("balanced") offers a suggestion after 25 s of
  quiet, then at most every 8 minutes, and no more than 10 a day; it is still
  the admin's choice. Suggestions lean toward what follows the tool used last
  and away from offering that same tool again (`affinity`). Memory
  revision 2 drops, once, a snooze stored while ✕ wrongly started one.
- **The roulette on a phone.** After a spin the result comes first, right
  under the title, with its buttons. The wheel shrinks beside "Spin again",
  and mood and category fold away behind "Change mood or category".
