// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DESKTOP_LIMITS, MAX_CANVAS_PIXELS, MOBILE_LIMITS, fitSize, outlineExportSize, pencilExportSize, previewSize } from './sizing';

const PHOTOS = [
  { width: 4032, height: 3024 }, // iPhone, 12 MP
  { width: 3024, height: 4032 },
  { width: 8064, height: 6048 }, // 48 MP
  { width: 12000, height: 1500 }, // panorama
  { width: 1269, height: 1239 }, // the review portrait
  { width: 640, height: 480 },
  { width: 1, height: 1 },
];

describe('sketch sizes', () => {
  it('the on-screen drawing never exceeds 1.6 MP or 1600 px, never enlarges, and keeps the aspect ratio', () => {
    for (const photo of PHOTOS) {
      for (const limits of [DESKTOP_LIMITS, MOBILE_LIMITS]) {
        const s = previewSize(photo, limits);
        expect(s.width * s.height).toBeLessThanOrEqual(1_600_000);
        expect(Math.max(s.width, s.height)).toBeLessThanOrEqual(1600);
        expect(s.width).toBeLessThanOrEqual(photo.width);
        expect(s.height).toBeLessThanOrEqual(photo.height);
        expect(Math.abs(s.width / s.height - photo.width / photo.height)).toBeLessThan(0.01 * (photo.width / photo.height) + 1 / s.height);
      }
    }
    // The review portrait is processed at its own size, as approved.
    expect(previewSize({ width: 1269, height: 1239 }, DESKTOP_LIMITS)).toEqual({ width: 1269, height: 1239 });
  });

  it('a saved Pencil Study stays within the device limit (2.5 MP on phones, 4.2 MP on desktops)', () => {
    for (const photo of PHOTOS) {
      const phone = pencilExportSize(photo, MOBILE_LIMITS);
      const desk = pencilExportSize(photo, DESKTOP_LIMITS);
      expect(phone.width * phone.height).toBeLessThanOrEqual(2_500_000);
      expect(desk.width * desk.height).toBeLessThanOrEqual(4_200_000);
      expect(phone.width).toBeLessThanOrEqual(photo.width);
    }
    expect(pencilExportSize({ width: 4032, height: 3024 }, MOBILE_LIMITS)).toEqual({ width: 1825, height: 1369 });
  });

  it('a saved Clean Outline PNG is as large as the photo allows, within the side limit and the canvas limit', () => {
    for (const photo of PHOTOS) {
      for (const limits of [DESKTOP_LIMITS, MOBILE_LIMITS]) {
        const working = previewSize(photo, limits);
        const out = outlineExportSize(photo, working, limits);
        expect(Math.max(out.width, out.height)).toBeLessThanOrEqual(limits.outlineExportSide);
        expect(out.width * out.height).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);
        expect(Math.max(out.width, out.height)).toBeGreaterThanOrEqual(Math.min(limits.outlineExportSide, Math.max(working.width, working.height)));
      }
    }
    const working = previewSize({ width: 4032, height: 3024 }, MOBILE_LIMITS);
    expect(outlineExportSize({ width: 4032, height: 3024 }, working, MOBILE_LIMITS)).toEqual({ width: 2400, height: 1800 });
    expect(outlineExportSize({ width: 4032, height: 3024 }, working, DESKTOP_LIMITS)).toEqual({ width: 3200, height: 2400 });
  });

  it('fitSize never rounds over its limits', () => {
    for (let w = 1; w < 4000; w += 397) {
      for (let h = 1; h < 4000; h += 211) {
        const s = fitSize(w, h, 123_457, 999);
        expect(s.width * s.height).toBeLessThanOrEqual(123_457);
        expect(Math.max(s.width, s.height)).toBeLessThanOrEqual(999);
        expect(s.width).toBeGreaterThanOrEqual(1);
      }
    }
    expect(fitSize(0, 10, 100)).toEqual({ width: 1, height: 1 });
  });
});
