// SketchyArtLab brand assets, made from the owner's official logo
// (assets/brand/sketchyartlab-logo.png, transparent, for dark backgrounds).
//
//   node scripts/brand/logo.mjs [--preview <dir>]
//
// Writes public/brand/{mark,wordmark}.{webp,png} and logo.webp, the app icons
// (src/app/icon.png, src/app/apple-icon.png, public/favicon.ico,
// public/brand/icon-{192,512,maskable-512}.png) and the social card
// (src/app/opengraph-image.png). Nothing is redrawn: every file is the
// supplied artwork, cropped and scaled. The fox-only mark drops the drawing
// grid behind the fox by thickness (its lines are 1–4 px wide and share the
// fox's cream), keeping every thin fur tip that grows out of the fox itself.
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SOURCE = 'assets/brand/sketchyartlab-logo.png';
const DARK = { r: 24, g: 24, b: 27, alpha: 1 }; // the studio's background, hsl(240 6% 10%)
const preview = process.argv.includes('--preview') ? process.argv[process.argv.indexOf('--preview') + 1] : null;

const { data: src, info } = await sharp(SOURCE).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width;
const H = info.height;
const alpha = (i) => src[i * 4 + 3];

// ── where things are: the artwork, a transparent gap, then the wordmark ─────
const rowFilled = (y) => { for (let x = 0; x < W; x++) if (alpha(y * W + x) > 8) return true; return false; };
const bands = [];
for (let y = 0, start = -1; y <= H; y++) {
  const on = y < H && rowFilled(y);
  if (on && start < 0) start = y;
  if (!on && start >= 0) { bands.push([start, y - 1]); start = -1; }
}
if (bands.length < 2) throw new Error(`expected the artwork and the wordmark as two bands, found ${bands.length}`);
const [artBand, wordBand] = [bands[0], bands[bands.length - 1]];

// ── exact Euclidean distance transform (Felzenszwalb & Huttenlocher) ────────
function edt(isFeature) {
  const INF = 1e12;
  const f = new Float64Array(Math.max(W, H));
  const d = new Float64Array(Math.max(W, H));
  const v = new Int32Array(Math.max(W, H));
  const z = new Float64Array(Math.max(W, H) + 1);
  const out = new Float64Array(W * H);
  const pass = (n) => {
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
  };
  for (let x = 0; x < W; x++) { for (let y = 0; y < H; y++) f[y] = isFeature[y * W + x] ? 0 : INF; pass(H); for (let y = 0; y < H; y++) out[y * W + x] = d[y]; }
  for (let y = 0; y < H; y++) { for (let x = 0; x < W; x++) f[x] = out[y * W + x]; pass(W); for (let x = 0; x < W; x++) out[y * W + x] = d[x]; }
  return out; // squared distances
}

function components(mask) {
  const label = new Int32Array(W * H).fill(-1);
  const comps = [];
  const stack = new Int32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (!mask[i] || label[i] >= 0) continue;
    const id = comps.length; let top = 0; stack[top++] = i; label[i] = id;
    const c = { id, size: 0, x0: W, y0: H, x1: 0, y1: 0, pixels: [] };
    while (top) {
      const p = stack[--top]; const x = p % W; const y = (p - x) / W;
      c.size++; c.pixels.push(p);
      if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx; if (mask[n] && label[n] < 0) { label[n] = id; stack[top++] = n; }
      }
    }
    comps.push(c);
  }
  return { label, comps };
}

// ── the fox alone ───────────────────────────────────────────────────────────
const R = 3.5; // lines are at most ~4 px wide; the fox is far thicker
const inArt = (i) => { const y = Math.floor(i / W); return y >= artBand[0] && y <= artBand[1]; };
const solid = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) solid[i] = inArt(i) && alpha(i) > 40 ? 1 : 0;
const toEmpty = edt(solid.map((s) => (s ? 0 : 1)));
const core = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) core[i] = toEmpty[i] > R * R ? 1 : 0;
const toCore = edt(core);
const opened = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) opened[i] = solid[i] && toCore[i] <= R * R ? 1 : 0;
const big = components(opened);
const body = big.comps.reduce((a, b) => (b.size > a.size ? b : a));
const fox = new Uint8Array(W * H);
for (const p of body.pixels) fox[p] = 1;
// Thin pieces: keep the short ones that grow out of the fox (fur tips), drop the long lines.
const thin = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) thin[i] = solid[i] && !fox[i] ? 1 : 0;
const pieces = components(thin);
let kept = 0, dropped = 0;
for (const c of pieces.comps) {
  const extent = Math.max(c.x1 - c.x0, c.y1 - c.y0) + 1;
  let touches = false;
  for (const p of c.pixels) {
    const x = p % W, y = (p - x) / W;
    for (let dy = -1; dy <= 1 && !touches; dy++) for (let dx = -1; dx <= 1; dx++) { const n = (y + dy) * W + (x + dx); if (fox[n]) { touches = true; break; } }
    if (touches) break;
  }
  // A fur tip: attached to the fox, short, and carrying colour (the grid is cream/tan).
  let saturated = 0;
  for (const p of c.pixels) { const r = src[p * 4], g = src[p * 4 + 1], b = src[p * 4 + 2]; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); if (mx > 0 && (mx - mn) / mx > 0.45) saturated++; }
  if (touches && extent <= 40 && saturated / c.size > 0.5) { for (const p of c.pixels) fox[p] = 1; kept++; } else dropped++;
}
// Soft edges: the faint anti-aliased rim right next to the fox.
const near = edt(fox);
const markAlpha = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) markAlpha[i] = inArt(i) && (fox[i] || (near[i] <= 2.0 && !solid[i])) ? alpha(i) : 0;
console.log(`fox: body ${body.size} px; fur tips kept ${kept}, grid pieces dropped ${dropped}`);

// ── image helpers ───────────────────────────────────────────────────────────
function withAlpha(a) {
  const out = Buffer.from(src);
  for (let i = 0; i < W * H; i++) out[i * 4 + 3] = a(i);
  return out;
}
const raw = (buf) => sharp(buf, { raw: { width: W, height: H, channels: 4 } });
async function trimmed(buf, region) {
  // Crop to the visible pixels inside `region` (y range), with a little air.
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = region[0]; y <= region[1]; y++) for (let x = 0; x < W; x++) if (buf[(y * W + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const pad = 2;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
  return raw(buf).extract({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }).png().toBuffer();
}
const markPng = await trimmed(withAlpha((i) => markAlpha[i]), artBand);
const wordPng = await trimmed(withAlpha((i) => { const y = Math.floor(i / W); return y >= wordBand[0] && y <= wordBand[1] ? alpha(i) : 0; }), wordBand);
const logoPng = await trimmed(Buffer.from(src), [0, H - 1]);

const write = async (file, buf) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, buf); console.log(`${file}  ${buf.length} bytes`); };
const resizeH = (png, h) => sharp(png).resize({ height: h, kernel: 'lanczos3' });
// A square with the fox centred: transparent for the browser tab, the studio's dark for home screens.
async function square(size, scale, background) {
  const meta = await sharp(markPng).metadata();
  const box = Math.round(size * scale);
  const fit = meta.width / meta.height > 1 ? { width: box } : { height: box };
  const fox = await sharp(markPng).resize({ ...fit, kernel: 'lanczos3' }).png().toBuffer();
  const fm = await sharp(fox).metadata();
  return sharp({ create: { width: size, height: size, channels: 4, background: background ?? { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: fox, left: Math.round((size - fm.width) / 2), top: Math.round((size - fm.height) / 2) }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}
function ico(images) {
  // PNG-compressed ICO entries (every current browser reads them).
  const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
  const dir = Buffer.alloc(16 * images.length);
  let offset = 6 + dir.length;
  images.forEach(({ size, png }, k) => {
    const e = k * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, e); dir.writeUInt8(size >= 256 ? 0 : size, e + 1);
    dir.writeUInt8(0, e + 2); dir.writeUInt8(0, e + 3); dir.writeUInt16LE(1, e + 4); dir.writeUInt16LE(32, e + 6);
    dir.writeUInt32LE(png.length, e + 8); dir.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([header, dir, ...images.map((i) => i.png)]);
}

// ── the files ───────────────────────────────────────────────────────────────
// Header art at up to 3× its CSS size (mark ≤ 44 px tall, wordmark ≤ 36 px).
await write('public/brand/mark.webp', await resizeH(markPng, 144).webp({ quality: 92, alphaQuality: 100, effort: 6 }).toBuffer());
await write('public/brand/mark.png', await resizeH(markPng, 144).png({ compressionLevel: 9 }).toBuffer());
await write('public/brand/wordmark.webp', await resizeH(wordPng, 108).webp({ quality: 92, alphaQuality: 100, effort: 6 }).toBuffer());
await write('public/brand/wordmark.png', await resizeH(wordPng, 108).png({ compressionLevel: 9 }).toBuffer());
await write('public/brand/logo.webp', await resizeH(logoPng, 720).webp({ quality: 90, alphaQuality: 100, effort: 6 }).toBuffer());
// Icons.
await write('public/favicon.ico', ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, png: await square(size, 0.98) })))));
await write('src/app/icon.png', await square(192, 0.94));
await write('src/app/apple-icon.png', await square(180, 0.8, DARK));
await write('public/brand/icon-192.png', await square(192, 0.8, DARK));
await write('public/brand/icon-512.png', await square(512, 0.8, DARK));
await write('public/brand/icon-maskable-512.png', await square(512, 0.62, DARK));
// Social card (Open Graph): the whole logo on the studio's dark.
{
  const logo = await resizeH(logoPng, 540).png().toBuffer();
  const lm = await sharp(logo).metadata();
  await write('src/app/opengraph-image.png', await sharp({ create: { width: 1200, height: 630, channels: 4, background: DARK } })
    .composite([{ input: logo, left: Math.round((1200 - lm.width) / 2), top: Math.round((630 - lm.height) / 2) }])
    .png({ compressionLevel: 9 })
    .toBuffer());
}

// ── optional review sheet: what the fox-only cut removed, in red ────────────
if (preview) {
  const sheet = Buffer.from(src);
  for (let i = 0; i < W * H; i++) if (inArt(i) && alpha(i) > 40 && !markAlpha[i]) { sheet[i * 4] = 255; sheet[i * 4 + 1] = 30; sheet[i * 4 + 2] = 60; sheet[i * 4 + 3] = 255; }
  await mkdir(preview, { recursive: true });
  await raw(sheet).flatten({ background: DARK }).png().toFile(path.join(preview, 'removed.png'));
  const onDark = await sharp(markPng).flatten({ background: DARK }).png().toBuffer();
  const onLight = await sharp(markPng).flatten({ background: { r: 250, g: 248, b: 244 } }).png().toBuffer();
  await sharp(onDark).toFile(path.join(preview, 'mark-dark.png'));
  await sharp(onLight).toFile(path.join(preview, 'mark-light.png'));
  console.log(`preview sheets in ${preview}`);
}
