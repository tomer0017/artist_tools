# Sketchy — continuous art scenes

Status: the owner clarified that image-frame animation, like the existing implementation, is desired. The continuous-video directions below are retained as the initial brief; README.md describes the implemented sprite deliverables and their limits.

## Shared invariants

Use OFFICIAL_CHARACTER.png as the identity and body-proportion reference. The eight supplied November 25 scene screenshots specify actions and props, not changes to anatomy or wardrobe. Retain the official orange fox, cream muzzle and tail tip, brown beret and artist vest, cream shirt, red scarf, and original paws. Do not adopt the longer legs, trousers or boots from secondary references.

Produce eight separate silent clips, with a fixed orthographic-style camera, fixed exposure, no cuts, zoom, reframing or perspective changes. Work at 24 fps or higher. Use a common 960 × 540 composition and a common standing fox height of 360 pixels from floor to highest ear/beret point. Floor at y=500. The standing reference height is the calibration: sitting, bending and jumping must change pose naturally without rescaling body parts. Keep the fox's head size, limb lengths and tail volume constant throughout every clip and across clips. Place additional people and props within the composition; never auto-fit the fox to accommodate them.

Natural continuous movement: anticipation, connected hand/brush contact, follow-through, gentle breathing, blinking and tail motion. No still-image slideshow, cross-faded poses, morphing faces, melting props, duplicate limbs or abrupt pose substitutions. Props remain spatially anchored. Painting marks appear progressively at the brush/pencil contact point. Render genuine transparency if the chosen video pipeline supports alpha; otherwise retain an opaque neutral master and identify that limitation explicitly. Do not claim an opaque video is a transparent website asset.

Runtime sizing must use the calibrated character height, not the bounding box of the scene. At 168px standing fox height, the full 960px scene needs 448px of width. Reserve that space in the Hero; where insufficient, postpone the scene or offer a dedicated scene viewport rather than shrinking the fox. Keep existing Hero-only behavior, accessible interaction, pause when hidden, and a reduced-motion still.

## Scene directions

1. **Sunflowers — 12 seconds.** Reference: `צילום מסך 2026-11-25 ב-19.05.34.png`. Fox studies the fixed sunflower easel, leans closer with spectacles, dips a brush into a palette, makes several connected painting strokes, leans back and presents the painting with an open paw. Return gently to the starting study pose for a seamless loop. Easel and artwork never move or change size.

2. **Flower-crown portrait — 10 seconds.** Reference: `צילום מסך 2026-11-25 ב-19.05.12.png`. Fox adjusts a flower crown, looks at the colorful fox portrait, picks up the palette, adds a finishing stroke, and turns toward the viewer with a modest smile. Keep the crown placement and petals stable. End with a held presentation, not a forced loop across incompatible poses.

3. **Girl with a Pearl Earring — 12 seconds.** Reference: `צילום מסך 2026-11-25 ב-19.05.04.png`. Study the portrait with a magnifier, lower it, turn toward the adjacent drawing easel, draw the face contour with connected pencil strokes, then present the sketch. Keep the source portrait, its scale and the model's identity stable. The fox pivots through continuous body motion rather than switching front/back images.

4. **Mona Lisa sitting — 16 seconds.** Reference: `צילום מסך 2026-11-25 ב-19.04.45.png`. Mona Lisa walks two small steps to the chair and sits naturally while the seated fox observes with sketchbook. Fox draws at the easel, then stands and raises the finished portrait toward her; she smiles. Keep the chair, stool, model and easel in a common fixed coordinate space. Preserve the fox's body size while sitting and standing. End on the reveal; no abrupt loop.

5. **The Scream — 10 seconds.** Reference: `צילום מסך 2026-11-25 ב-19.04.28.png`. Fox considers the painting, gradually widens eyes, lifts both paws to cheeks and opens mouth in an exaggerated imitation, then relaxes into a laugh and returns to the starting pose. Keep head volume constant as the mouth opens. Maintain a seamless return with a brief calm hold.

6. **American Gothic — 14 seconds.** Reference: `צילום מסך 2026-11-25 ב-19.04.23.png`. Couple hold their pose beside the easel. Fox alternates gaze between them and paper, sketches continuously, then presents the drawing. Couple give a restrained approving gesture and fox laughs. Keep the pitchfork rigid and stable, hands anatomically consistent and both people at constant scale. End on the reveal.

7. **Flower-crown painting process — 16 seconds.** Reference: `צילום מסך 2026-11-25 ב-19.04.05.png`. Start with flower-crown self-observation, inspect the portrait sketch, pick up the palette, paint red and green passages with visible connected strokes, add highlights, and present the completed colorful self-portrait. This is the longer painting-process variant, separate from scene 2. Painted areas progress through physical strokes rather than a whole-canvas dissolve. Hold the final result.

8. **Art slot machine — 10 seconds.** Reference: `צילום מסך 2026-11-25 ב-19.06.21.png`. Fox reaches for the lever, grips and pulls it smoothly; three reels accelerate, spin, then decelerate and stop one at a time on art icons. Fox follows the reels with eyes, makes a small excited jump without changing body scale, lands with knee compression, and smiles. Keep cabinet, lever pivot, reel windows and icon tracks geometrically stable. Return lever and fox to the initial pose for a loop. Decorative animation must not replace the application's actual challenge selection logic.

## Acceptance checks before integration

- View every clip at full speed and inspect first, middle, final, and extreme-motion frames.
- Compare standing fox height and head width against the shared calibration across all scenes; reject camera or anatomy drift.
- Check hands, brush contact, prop stability and floor contact throughout motion.
- Confirm actual frame progression, smooth motion, declared duration and frame rate. Merely encoding repeated stills at 24 fps does not satisfy this requirement.
- Check alpha on dark and light backgrounds when available; document opaque-only outputs.
- Confirm full-scene visibility at desktop and mobile Hero dimensions without shrinking the calibrated fox.
- Keep generated masters and reviewed runtime derivatives separate. Do not deploy unrevised generation output automatically.

Implemented with the built-in ImageGen tool after clarification. Exact executed prompts are saved in prompts.json; calibration and playback sequences are in calibration.json. See README.md.
