/**
 * Sketch engine — scene analysis maps.
 *
 * These are the maps that let stage 4 answer "would a painter draw this line?"
 * for a contour, rather than "is this gradient strong?". They are deliberately
 * cheap heuristics that run client-side in a few milliseconds; none of them
 * needs a model, and none of them invents geometry — they only *weight*
 * contours that were already extracted from the photograph.
 */

import { clamp01, gaussBlur, normalizeMap, percentile, type Gradient } from './imageOps';

/** A facial accent is roughly round; a hair strand or wrinkle is not. */
const MAX_ACCENT_ELONGATION = 4.5;
const MIN_ACCENT_FILL = 0.3;

export interface AnalysisMaps {
  /**
   * 0..1 — fine detail with no large-scale structure behind it. High on fabric
   * weave, skin pores, grass, foliage, gravel, wall stipple and sensor noise;
   * low on real object boundaries.
   */
  clutter: Float32Array;
  /**
   * 0..1 — how likely this region belongs to the subject rather than the
   * backdrop. Combines large-scale structure density, a mild centre prior and
   * the inverse of clutter.
   */
  subject: Float32Array;
  /**
   * 0..1 — compact dark accents: eyes, pupils, nostrils, the lash line, the
   * lip gap, dark holes in objects. These are the internal marks a painter
   * places early, so they get to outrank their own (short) length.
   */
  feature: Float32Array;
}

export function buildAnalysisMaps(
  base: Float32Array,
  shape: Float32Array,
  fineGrad: Gradient,
  shapeGrad: Gradient,
  w: number,
  h: number,
  diag: number,
): AnalysisMaps {
  // Regional energy: blur the gradient magnitudes so they describe *areas*
  // ("there is a lot of fine detail around here") rather than single edges.
  const fineEnergy = gaussBlur(fineGrad.mag, w, h, diag * 0.014);
  const coarseEnergy = gaussBlur(shapeGrad.mag, w, h, diag * 0.014);
  // A flat wall has no energy at either scale and must not read as clutter, so
  // the fine/coarse ratio is gated by how much fine energy there is at all.
  const fineRef = Math.max(1e-3, percentile(fineEnergy, 0.9));

  const rawClutter = new Float32Array(w * h);
  for (let p = 0; p < rawClutter.length; p++) {
    const f = fineEnergy[p];
    const c = coarseEnergy[p];
    rawClutter[p] = clamp01(f / fineRef) * (f / (f + 2.2 * c + 1e-3));
  }
  const clutter = normalizeMap(rawClutter, 0.1, 0.92);

  const structure = normalizeMap(gaussBlur(shapeGrad.mag, w, h, diag * 0.055), 0.05, 0.95);

  const subject = new Float32Array(w * h);
  const cx = w / 2;
  const cy = h * 0.46; // subjects usually sit a little above the centre line
  const rx = w * 0.58;
  const ry = h * 0.62;
  for (let y = 0; y < h; y++) {
    const dy = (y - cy) / ry;
    for (let x = 0; x < w; x++) {
      const dx = (x - cx) / rx;
      const centre = Math.exp(-(dx * dx + dy * dy));
      const p = y * w + x;
      subject[p] = clamp01(0.5 * structure[p] + 0.28 * centre + 0.22 * (1 - clutter[p]));
    }
  }

  return {
    clutter,
    subject: gaussBlur(subject, w, h, diag * 0.02),
    feature: buildFeatureMap(base, shape, w, h, diag),
  };
}

/**
 * Compact dark accents. A pixel qualifies when it is meaningfully darker than
 * its neighbourhood; connected runs of those pixels are kept only when they are
 * small (an eye, a nostril) rather than a large mass (hair, a shadow side),
 * because large dark masses are already described by their own contour.
 *
 * Small is not enough on its own — a single hair strand or a wrinkle is also a
 * small dark component, and marking those as features hands them the priority
 * reserved for eyes and nostrils. So a component must also be *blobby*:
 * roughly as wide as it is tall, and actually filling its bounding box.
 */
function buildFeatureMap(
  base: Float32Array,
  shape: Float32Array,
  w: number,
  h: number,
  diag: number,
): Float32Array {
  const n = w * h;
  const local = gaussBlur(shape, w, h, diag * 0.06);
  const dark = new Uint8Array(n);
  // Threshold relative to the image's own contrast, so a low-key photo still
  // resolves its accents and a flat one does not fire everywhere.
  const spread = Math.max(6, percentile(base, 0.9) - percentile(base, 0.1));
  const delta = spread * 0.16;
  for (let p = 0; p < n; p++) if (local[p] - base[p] > delta) dark[p] = 1;

  // Erode by one pixel before labelling. Without this a lash line, a stray
  // strand or a wrinkle acts as a one-pixel bridge that fuses the iris to the
  // eyebrow into a single long component — which then fails the shape test and
  // the eyes lose their accent status entirely. Severing hairline connections
  // is the difference between finding the eyes and finding nothing.
  const core = new Uint8Array(n);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      if (!dark[p]) continue;
      if (
        dark[p - 1] && dark[p + 1] && dark[p - w] && dark[p + w] &&
        dark[p - w - 1] && dark[p - w + 1] && dark[p + w - 1] && dark[p + w + 1]
      ) {
        core[p] = 1;
      }
    }
  }
  dark.set(core);

  const maxArea = Math.max(24, Math.round(n * 0.006));
  const minArea = 4;
  const out = new Float32Array(n);
  const seen = new Uint8Array(n);
  const stack: number[] = [];
  const members: number[] = [];

  for (let seed = 0; seed < n; seed++) {
    if (!dark[seed] || seen[seed]) continue;
    members.length = 0;
    stack.length = 0;
    stack.push(seed);
    seen[seed] = 1;
    let area = 0;
    let minX = w;
    let maxX = -1;
    let minY = h;
    let maxY = -1;
    while (stack.length) {
      const p = stack.pop()!;
      area++;
      if (area <= maxArea) members.push(p);
      const x = p % w;
      const y = (p / w) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const o = ny * w + nx;
          if (dark[o] && !seen[o]) {
            seen[o] = 1;
            stack.push(o);
          }
        }
      }
    }
    if (area > maxArea || area < minArea) continue;
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    const elongation = Math.max(bw, bh) / Math.max(1, Math.min(bw, bh));
    if (elongation > MAX_ACCENT_ELONGATION) continue; // a strand or a wrinkle
    if (area / (bw * bh) < MIN_ACCENT_FILL) continue; // a scribble, not a mark
    for (let i = 0; i < members.length; i++) out[members[i]] = 1;
  }

  // Bleed generously: the mark that matters is usually the contour *around*
  // the accent (the lid line around an iris), not the accent blob itself, and
  // that contour sits well outside it.
  return normalizeMap(gaussBlur(out, w, h, diag * 0.022), 0, 0.85);
}
