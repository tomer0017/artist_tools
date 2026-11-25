// The walking cycle: the founder's side-view GIF (assets/sketchy/source/walk.gif, 8 frames of 120 ms)
// as one strip of 300 × 360 frames, the same height and floor line as his other poses, so walking
// and standing join without a jump. Every frame gets the same crop and scale (his bob and sway stay
// as drawn); resizing smooths the GIF's on/off edges. No artwork is redrawn.
// Run from the repository root: node scripts/sketchy/walk-cycle.mjs
import sharp from 'sharp';

const SOURCE = 'assets/sketchy/source/walk.gif';
const OUT = 'public/sketchy/walk-cycle.webp';
const FRAME = { w: 300, h: 360 };
const FLOOR = 345; // where his soles rest in every sprite
const HEIGHT = 310; // beret to soles, as his standing poses

const { pages } = await sharp(SOURCE, { animated: true }).metadata();
const frames = [];
let minx = Infinity, maxx = -1, miny = Infinity, maxy = -1;
for (let i = 0; i < pages; i++) {
  const { data, info } = await sharp(SOURCE, { page: i }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++)
      if (data[(y * info.width + x) * 4 + 3]) {
        minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y);
      }
  frames.push({ data, info });
}
const scale = HEIGHT / (maxy - miny + 1);
const size = Math.round(frames[0].info.width * scale);
const left = Math.round(FRAME.w / 2 - ((minx + maxx + 1) / 2) * scale);
const top = Math.round(FLOOR - (maxy + 1) * scale);
const tiles = [];
for (const [i, { data, info }] of frames.entries()) {
  const small = await sharp(data, { raw: info }).resize(size, size, { kernel: 'lanczos3' }).png().toBuffer();
  // Place the resized frame in the sprite frame (cropping what falls outside it).
  const cut = { left: Math.max(0, -left), top: Math.max(0, -top) };
  const piece = await sharp(small)
    .extract({ left: cut.left, top: cut.top, width: Math.min(size - cut.left, FRAME.w - Math.max(0, left)), height: Math.min(size - cut.top, FRAME.h - Math.max(0, top)) })
    .png()
    .toBuffer();
  tiles.push({ input: piece, left: i * FRAME.w + Math.max(0, left), top: Math.max(0, top) });
}
await sharp({ create: { width: FRAME.w * frames.length, height: FRAME.h, channels: 4, background: '#00000000' } })
  .composite(tiles)
  .webp({ quality: 90, alphaQuality: 100 })
  .toFile(OUT);
console.log(`${OUT}: ${frames.length} frames, scale ${scale.toFixed(3)}, offset ${left},${top}`);
