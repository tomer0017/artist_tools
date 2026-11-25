# Sketchy artwork provenance and editing

The owner supplied `source/official.png`, `poses-original.png`, and
`signs-original.png` on 2026-11-24 as the authoritative Studio Companion mascot.
No stock artwork or third-party character assets are used.

`poses-alpha.png` and `sign-alpha.png` were prepared with OpenAI ImageGen from
those supplied sheets: background/caption removal and extraction of the first
wooden-sign pose. These editable source PNGs are retained here. The prompt was
to preserve the original appearance, costume, texture, proportions and poses.

Run `node scripts/sketchy/prepare.mjs` from the repository root to reproduce the
runtime WebP sprites. It packs the alpha extractions, removes isolated alpha
residue, normalizes the floor and sizing, and separates the printed blank board
from the raised paw so the live HTML sign can occupy that space. Parchment
texture is sampled from the same sign artwork. Runtime assets total about 360 KB.

`raster-rig.tsx` defines editable joint regions in the 300 × 360 coordinate
system. `raster-mesh.ts` skins a connected transparent image mesh (one WebGL draw
per character frame). `raster-engine.ts` applies restrained joint rotations,
weight transfer, blinking, gaze, breathing and gesture motion at 30 fps, using
the existing clip durations and public controller contract. No per-frame network
requests. The original SVG renderer is no longer used by application screens.

Signs and roulette content remain real localized HTML/SVG, with the existing
APIs, access filters, user preferences and admin settings unchanged.

Limits: this is a 2.5D raster character, not a fully rigged 3D model. Gaze is
intentionally subtle. Devices without WebGL retain the approved still artwork;
reduced-motion users get a stable pose, with completion callbacks preserved.
Source animation plates are finite: direction changes mirror the artwork.

## Walking cycle

`source/walk.gif` (supplied by the founder on 2026-11-25) is the side-view walking
cycle: 8 frames of 120 ms. `node scripts/sketchy/walk-cycle.mjs` turns it into
`public/sketchy/walk-cycle.webp`: one strip of 300 × 360 frames, every frame cropped
and scaled the same way, at the same height and floor line as his standing poses.
The engine steps through the frames while he walks (`raster-engine.ts`). A planted
foot moves back about 20 sprite pixels a frame, so he crosses the screen at
`walkSpeed` and his feet stay put.
