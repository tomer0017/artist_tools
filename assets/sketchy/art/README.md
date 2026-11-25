# Art scenes (2026-11-25)

`portrait-original.gif` is the owner's supplied nine-frame Mona Lisa performance.
`scenes-alpha.png` was generated with OpenAI ImageGen from the owner's supplied
art reference sheets (`7add9647…png` and `e5f7a717…png`), requesting six successive
poses each for the challenge machine, seated sketchbook, and painted-sheep dream.
No stock artwork, services, or new database models are used.

`node scripts/sketchy/art-scenes.mjs` reproduces the transparent runtime WebP strips,
removing isolated alpha residue and preserving frame registration. `ArtScene.tsx`
controls timing, pauses, meaningful action buttons and reduced-motion presentation.
Scenes replace the hero character briefly, are interruptible, and are spaced at
least three minutes apart. They respect the existing draw/sit/rest/point settings.

These are deliberately short sprite performances, not full 3D character rigs.
