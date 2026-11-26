# Eight image-based Sketchy scenes

The owner clarified on 2026-11-25 that the deliverable should use image frames like the existing animations, rather than generated video. Eight nine-frame sheets were authored with the built-in ImageGen tool, using OFFICIAL_CHARACTER.png for identity and each supplied scene screenshot for action. Exact generation prompts are in `prompts.json`. `mona-lisa-clean.png` is a second ImageGen background-extraction pass preserving the initial sheet's layout and poses.

`node scripts/sketchy/art-scenes-v2.mjs` reproduces:
- `/public/sketchy/art/v2/<scene>.webp`: nine-frame horizontal runtime strip.
- `<scene>-animated.webp`: standalone looping image animation with the same timed sequence.
- `<scene>-poster.webp`: first-frame still for reduced-motion preview.
- `src/components/companion/art-scenes-v2.json`: runtime metadata.

`public/sketchy/art/v2/index.html` previews all eight animations, with playback and light/dark background controls, and download links. No external service is required at playback.

## Registration and scale

The canvas is 640 × 360. One constant scale factor is applied to every frame of each scene; there is no per-pose trim, fit, resize, stretching, or browser zoom. The standing-height calibration is 280px, derived from the source reference landmarks recorded in `calibration.json`. Seated poses retain their natural shorter silhouette. Generated drawing variations remain; this is consistent sprite animation, not an articulated 3D model or optical-flow interpolation.

Hero sizing matches the visible 306px character in the existing 360px idle sprite. Props use additional horizontal space. Full free Hero bounds are measured independently of the number of walking spots. Home reserves a scene area beside the headline on desktop and below it on mobile. The normal fox and all scenes share the same size calibration within that area; narrow screens no longer filter out the wide scenes. No content is covered and the fox is not shrunk to fit a scene. Scenes remain Hero-only and use the existing scheduler, settings and action permissions. Resizing, tab visibility, reduced motion and interruption are handled by the normal controller.

The automatic cycle is a short stroll (when wandering is enabled), 11 visible seconds standing, 8 visible seconds sitting, then a randomly selected scene. A shuffled bag covers every eligible scene before repeating and prevents adjacent repeats across bag boundaries. No-input sleep no longer stops this cycle. Explicit menus, tips, reduced motion and hidden/offscreen state still take priority. The menu provides “Next animation” for immediate preview and a link to the full gallery. Each performance is approximately 4–8.5 seconds, with extra drawing beats and a held result. The standalone files loop by returning to the opening pose; story reveals are not presented as perfectly seamless loops. Runtime plays a performance once and returns to the normal character. Files are loaded only when a scene is selected.

Mona Lisa cleanup prompt: “Use case: background-extraction. Edit this exact nine-frame sprite sheet. Change ONLY background transparency: remove ALL studio background and floor planes, including faint smoky white/gray alpha haze in all nine cells and the gaps between them. Truly transparent outside characters, stools, easels and chair. Preserve every pose, face, object, exact size, composition, 3x3 grid registration, clothing, color and edges. Do not redraw or resize the subjects. Clean fur edge transparency. No residual rectangular background or fog. Output same dimensions as input.”
