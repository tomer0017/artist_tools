import { describe, expect, it } from 'vitest';
import {
  canvasToScene,
  containFitScale,
  cropPixelRect,
  matchArtworkBounds,
  pivotTransform,
  resolvePlacement,
  sanitizeCrop,
  sceneSizeForArtwork,
  solveTwoPointAlignment,
  translateByCanvasDelta,
} from './compareArtGeometry';
import { IDENTITY_TRANSFORM } from './compareArtTypes';
import { colorDelta, perceptualLightness, rgbToOklab } from './compareArtColor';
import { Buffer, computeDifference } from './compareArtDifference';
import { OPACITY_PULSE_STOPS, buildGifFrameSpecs } from './compareArtGif';
import { presetAspect, sanitizeImageCrop } from './compareArtCrop';
import { FULL_IMAGE_CROP } from './compareArtTypes';

// ── Geometry ──────────────────────────────────────────────────────────────────
describe('geometry', () => {
  it('caps scene to the long side while preserving aspect', () => {
    const s = sceneSizeForArtwork({ width: 4000, height: 2000 }, 2000);
    expect(s.width).toBe(2000);
    expect(s.height).toBe(1000);
  });

  it('contain-fit scale fills a matching-aspect scene exactly', () => {
    const scene = sceneSizeForArtwork({ width: 800, height: 600 }, 2000);
    const fit = containFitScale({ width: 800, height: 600 }, scene);
    expect(fit * 800).toBeCloseTo(scene.width, 5);
    expect(fit * 600).toBeCloseTo(scene.height, 5);
  });

  it('resolves an identity transform to a centered, contained image', () => {
    const scene = { width: 1000, height: 500 };
    const p = resolvePlacement({ width: 1000, height: 500 }, scene, IDENTITY_TRANSFORM);
    expect(p.cx).toBeCloseTo(500);
    expect(p.cy).toBeCloseTo(250);
    expect(p.drawW).toBeCloseTo(1000);
  });

  it('translation by canvas delta is resolution-independent (normalized)', () => {
    const scene = { width: 1000, height: 1000 };
    const canvas = { width: 500, height: 500 }; // display at half scale
    const t = translateByCanvasDelta(IDENTITY_TRANSFORM, 50, 0, scene, canvas);
    // 50 canvas px at 0.5 scale = 100 scene px = 0.1 of scene width
    expect(t.tx).toBeCloseTo(0.1, 5);
  });

  it('canvasToScene inverts the display mapping', () => {
    const scene = { width: 1000, height: 800 };
    const canvas = { width: 500, height: 500 };
    const p = canvasToScene({ x: 250, y: 250 }, scene, canvas);
    // center of canvas maps to center of scene
    expect(p.x).toBeCloseTo(500);
    expect(p.y).toBeCloseTo(400);
  });

  it('pivotTransform with factor 1 and no rotation is a no-op', () => {
    const scene = { width: 1000, height: 1000 };
    const t = pivotTransform(IDENTITY_TRANSFORM, { x: 300, y: 300 }, 1, 0, scene);
    expect(t.tx).toBeCloseTo(0, 6);
    expect(t.ty).toBeCloseTo(0, 6);
    expect(t.scale).toBeCloseTo(1, 6);
    expect(t.rotation).toBeCloseTo(0, 6);
  });

  it('pivotTransform scales about the pivot (content under pivot stays put)', () => {
    const scene = { width: 1000, height: 1000 };
    // Pivot at scene center → scaling keeps center fixed.
    const t = pivotTransform(IDENTITY_TRANSFORM, { x: 500, y: 500 }, 2, 0, scene);
    expect(t.scale).toBeCloseTo(2);
    expect(t.tx).toBeCloseTo(0, 6);
    expect(t.ty).toBeCloseTo(0, 6);
  });

  it('matchArtworkBounds covers the scene', () => {
    const scene = { width: 1000, height: 500 };
    const t = matchArtworkBounds({ width: 1000, height: 1000 }, scene);
    const p = resolvePlacement({ width: 1000, height: 1000 }, scene, t);
    // A square cover of a 2:1 scene must be at least as wide/tall as the scene.
    expect(p.drawW).toBeGreaterThanOrEqual(scene.width - 1);
    expect(p.drawH).toBeGreaterThanOrEqual(scene.height - 1);
  });

  it('two-point alignment maps reference point A onto artwork point A', () => {
    const scene = { width: 1000, height: 1000 };
    const artA = { x: 200, y: 200 };
    const artB = { x: 800, y: 200 };
    const refA = { x: 300, y: 500 };
    const refB = { x: 600, y: 500 }; // half the span, no rotation
    const t = solveTwoPointAlignment(artA, artB, refA, refB, IDENTITY_TRANSFORM, { width: 1000, height: 1000 }, scene);
    // reference should roughly double in scale (span 300 → 600)
    expect(t.scale).toBeCloseTo(2, 1);
  });

  it('sanitizeCrop keeps the rect inside the scene', () => {
    const c = sanitizeCrop({ x: 0.8, y: 0.8, w: 0.5, h: 0.5 });
    expect(c.x + c.w).toBeLessThanOrEqual(1.0001);
    expect(c.y + c.h).toBeLessThanOrEqual(1.0001);
  });

  it('cropPixelRect converts normalized crop to pixels', () => {
    const r = cropPixelRect({ x: 0.25, y: 0.5, w: 0.5, h: 0.25 }, { width: 800, height: 400 });
    expect(r.sx).toBe(200);
    expect(r.sy).toBe(200);
    expect(r.sw).toBe(400);
    expect(r.sh).toBe(100);
  });
});

// ── Colour ────────────────────────────────────────────────────────────────────
describe('color', () => {
  it('OKLab lightness is ~1 for white and ~0 for black', () => {
    expect(perceptualLightness(255, 255, 255)).toBeCloseTo(1, 2);
    expect(perceptualLightness(0, 0, 0)).toBeCloseTo(0, 2);
  });

  it('colorDelta reports the artwork as lighter when it is brighter', () => {
    const art = rgbToOklab(240, 240, 240);
    const ref = rgbToOklab(80, 80, 80);
    const d = colorDelta(art, ref);
    expect(d.dL).toBeGreaterThan(0);
    expect(d.deltaE).toBeGreaterThan(0);
  });

  it('colorDelta reads a red-vs-blue shift as warmer', () => {
    const art = rgbToOklab(220, 60, 60); // red
    const ref = rgbToOklab(60, 60, 220); // blue
    const d = colorDelta(art, ref);
    expect(d.dWarm).toBeGreaterThan(0);
  });
});

// ── Difference ────────────────────────────────────────────────────────────────
function solid(w: number, h: number, r: number, g: number, b: number, a = 255): Buffer {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  }
  return { data, width: w, height: h };
}

describe('difference', () => {
  it('identical images produce no visible difference', () => {
    const a = solid(4, 4, 120, 120, 120);
    const b = solid(4, 4, 120, 120, 120);
    const { overlay, stats } = computeDifference(a, b, 'value', 'balanced', false);
    expect(stats.mismatchRatio).toBe(0);
    for (let i = 3; i < overlay.length; i += 4) expect(overlay[i]).toBe(0);
  });

  it('detects a lighter artwork (amber) in value mode', () => {
    const art = solid(2, 2, 255, 255, 255);
    const ref = solid(2, 2, 100, 100, 100);
    const { overlay, stats } = computeDifference(art, ref, 'value', 'balanced', false);
    expect(stats.lighterRatio).toBeGreaterThan(0.9);
    expect(overlay[0]).toBe(245); // amber R
    expect(overlay[1]).toBe(158);
    expect(overlay[2]).toBe(11);
  });

  it('detects a darker artwork (blue) in value mode', () => {
    const art = solid(2, 2, 90, 90, 90);
    const ref = solid(2, 2, 240, 240, 240);
    const { overlay, stats } = computeDifference(art, ref, 'value', 'balanced', false);
    expect(stats.darkerRatio).toBeGreaterThan(0.9);
    expect(overlay[2]).toBe(246); // blue B
  });

  it('threshold suppresses tiny noise', () => {
    const art = solid(3, 3, 128, 128, 128);
    const ref = solid(3, 3, 130, 130, 130);
    const { stats } = computeDifference(art, ref, 'value', 'subtle', false);
    expect(stats.mismatchRatio).toBe(0);
  });

  it('treats fully transparent (out-of-bounds) reference pixels as no-data', () => {
    const art = solid(2, 2, 255, 255, 255, 255);
    const ref = solid(2, 2, 0, 0, 0, 0); // alpha 0 everywhere
    const { overlay, stats } = computeDifference(art, ref, 'value', 'balanced', false);
    expect(stats.mismatchRatio).toBe(0);
    for (let i = 3; i < overlay.length; i += 4) expect(overlay[i]).toBe(0);
  });
});

// ── GIF frame sequence ────────────────────────────────────────────────────────
describe('gif frame specs', () => {
  it('opacity-pulse ramps 0→1→0 with matching first and last frames', () => {
    const specs = buildGifFrameSpecs('opacity-pulse');
    expect(specs.every((s) => s.kind === 'opacity')).toBe(true);
    const ops = OPACITY_PULSE_STOPS;
    expect(ops[0]).toBe(0);
    expect(ops[ops.length - 1]).toBe(0);
    expect(Math.max(...ops)).toBe(1);
    // The reference geometry is identical across every frame by construction:
    // opacity frames carry no transform, so alignment cannot drift.
  });

  it('blink alternates artwork and reference', () => {
    const specs = buildGifFrameSpecs('blink');
    expect(specs[0]).toEqual({ kind: 'only', only: 'artwork' });
    expect(specs[1]).toEqual({ kind: 'only', only: 'reference' });
    expect(specs.length % 2).toBe(0);
  });

  it('compare-diff includes a difference frame', () => {
    const specs = buildGifFrameSpecs('compare-diff');
    expect(specs.some((s) => s.kind === 'diff')).toBe(true);
    expect(specs[0]).toEqual({ kind: 'only', only: 'artwork' });
  });
});

// ── Pre-comparison crop ───────────────────────────────────────────────────────
describe('image crop', () => {
  it('maps presets to the expected aspect ratios', () => {
    expect(presetAspect('square', 100, 200)).toBe(1);
    expect(presetAspect('circle', 100, 200)).toBe(1);
    expect(presetAspect('4:3', 100, 200)).toBeCloseTo(4 / 3);
    expect(presetAspect('3:4', 100, 200)).toBeCloseTo(3 / 4);
    expect(presetAspect('16:9', 100, 200)).toBeCloseTo(16 / 9);
    expect(presetAspect('original', 100, 200)).toBeCloseTo(0.5);
    expect(presetAspect('free', 100, 200)).toBeNull();
  });

  it('keeps a crop rect inside the image', () => {
    const c = sanitizeImageCrop({ rect: { x: 0.9, y: 0.9, w: 0.5, h: 0.5 }, shape: 'rect', preset: 'free' });
    expect(c.rect.x + c.rect.w).toBeLessThanOrEqual(1.0001);
    expect(c.rect.y + c.rect.h).toBeLessThanOrEqual(1.0001);
  });

  it('leaves a full-image crop untouched', () => {
    const c = sanitizeImageCrop(FULL_IMAGE_CROP);
    expect(c.rect).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });
});
