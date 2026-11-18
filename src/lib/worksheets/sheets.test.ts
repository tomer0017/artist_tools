// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DEFAULT_GRID_SETTINGS, type GridRotation, type GridSettings } from '@/types/project';
import { drawExport } from '@/lib/grid/draw';
import { exportSize, fillImageScale, imageRect } from '@/lib/grid/geometry';
import { DESKTOP_LIMITS, MOBILE_LIMITS } from '@/lib/sketch/sizing';
import {
  DEFAULT_CHOICES,
  SHEET_ORDER,
  drawGridSheet,
  drawOnPaper,
  orderedSheets,
  otherToolNeeded,
  outlineSize,
  photoRect,
  readChoices,
  sheetFilename,
  valuesSize,
} from './sheets';

// Prepare Worksheets: every sheet has the size of Create a Grid's saved image
// and the photo (or its outline, or its values) exactly where that image puts
// it; the grid sheets are Create a Grid's own images.

type Call = [string, ...unknown[]];
function recorder() {
  const log: Call[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_, prop) => (typeof prop === 'string' ? (...args: unknown[]) => void log.push([prop, ...args]) : undefined),
    set: (_, prop, value) => {
      log.push([`set ${String(prop)}`, value]);
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, log };
}
const draws = (log: Call[]) => log.filter((c) => c[0] === 'drawImage' || c[0] === 'translate' || c[0] === 'rotate');

const photo = { source: { photo: true } as unknown as CanvasImageSource, naturalWidth: 1200, naturalHeight: 800 };
const CASES: [string, Partial<GridSettings>][] = [
  ['fitted', {}],
  ['zoomed and moved', { imageScale: 2.37, imageOffsetX: 3.3, imageOffsetY: -12.75 }],
  ['filling the canvas', { imageScale: fillImageScale(DEFAULT_GRID_SETTINGS, 1200, 800) }],
  ...([90, 180, 270] as GridRotation[]).map((rotation): [string, Partial<GridSettings>] => [`turned ${rotation}°`, { rotation, imageOffsetX: 2, imageScale: 1.4 }]),
  ['A4 with 3 cm squares', { canvasWidth: 21, canvasHeight: 29.7, cellMode: 'square', cellSize: 3, rotation: 90 }],
];

describe('every sheet lines up with Create a Grid’s saved image', () => {
  for (const [name, change] of CASES) {
    it(`the photo, its outline and its values go exactly where the grid image has the photo: ${name}`, () => {
      const gs: GridSettings = { ...DEFAULT_GRID_SETTINGS, ...change };
      const { w, h } = exportSize(gs);
      const rect = photoRect(gs, photo);
      expect(rect).toEqual(imageRect(gs, 1200, 800, w / gs.canvasWidth, w, h));

      const grid = recorder();
      drawExport(grid.ctx, gs, photo);
      for (const picture of [photo.source, { outline: true } as unknown as CanvasImageSource]) {
        const sheet = recorder();
        drawOnPaper(sheet.ctx, gs, picture, rect);
        // White paper, then the picture clipped to the canvas, placed by the same calls as the grid image's photo.
        expect(sheet.log.slice(0, 2)).toStrictEqual([['set fillStyle', '#ffffff'], ['fillRect', 0, 0, w, h]]);
        expect(draws(sheet.log)).toStrictEqual(draws(grid.log).map((c) => (c[0] === 'drawImage' ? [c[0], picture, ...c.slice(2)] : c)));
        expect(sheet.log.some((c) => c[0] === 'moveTo' || c[0] === 'strokeRect')).toBe(false);
      }
    });
  }

  it('the grid sheets are Create a Grid’s own images, call for call', () => {
    for (const [, change] of CASES) {
      const gs: GridSettings = { ...DEFAULT_GRID_SETTINGS, ...change };
      for (const blank of [false, true]) {
        const sheet = recorder();
        const grid = recorder();
        drawGridSheet(sheet.ctx, gs, photo, blank);
        drawExport(grid.ctx, gs, blank ? null : photo, { blank });
        expect(sheet.log).toStrictEqual(grid.log);
      }
    }
  });
});

describe('the pictures made from the photo', () => {
  const gs: GridSettings = { ...DEFAULT_GRID_SETTINGS };

  it('the outline is drawn at about its size on the sheet, at its traced proportions, within the saved-outline limit', () => {
    const rect = photoRect(gs, photo);
    const size = outlineSize({ width: 1500, height: 1000 }, rect, DESKTOP_LIMITS);
    expect(Math.max(size.width, size.height)).toBe(Math.ceil(Math.max(rect.w, rect.h)));
    expect(size.width / size.height).toBeCloseTo(1.5, 2);
    // Zoomed far in: no larger than the limit for a saved outline.
    const zoomed = photoRect({ ...gs, imageScale: 8 }, photo);
    expect(Math.max(...Object.values(outlineSize({ width: 1500, height: 1000 }, zoomed, MOBILE_LIMITS)))).toBe(MOBILE_LIMITS.outlineExportSide);
  });

  it('the values are worked at about their size on the sheet, never above the photo’s own pixels, within the device’s limit', () => {
    const rect = photoRect(gs, photo);
    expect(valuesSize(photo, rect, DESKTOP_LIMITS)).toEqual({ width: 1200, height: 800 });
    const big = { naturalWidth: 6000, naturalHeight: 4000 };
    const bigRect = photoRect(gs, big);
    const size = valuesSize(big, bigRect, DESKTOP_LIMITS);
    expect(size.width * size.height).toBeLessThanOrEqual(DESKTOP_LIMITS.pencilExportPixels);
    expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(Math.ceil(Math.max(bigRect.w, bigRect.h)));
    expect(valuesSize(big, bigRect, MOBILE_LIMITS).width * valuesSize(big, bigRect, MOBILE_LIMITS).height).toBeLessThanOrEqual(MOBILE_LIMITS.pencilExportPixels);
  });
});

describe('a set', () => {
  it('is made in a fixed order, each sheet once, and names its files by number, sheet and canvas', () => {
    expect(orderedSheets(['values', 'grid', 'original', 'grid'])).toEqual(['original', 'grid', 'values']);
    const gs: GridSettings = { ...DEFAULT_GRID_SETTINGS };
    expect(orderedSheets(SHEET_ORDER).map((kind, i) => sheetFilename(kind, i + 1, gs, 5))).toEqual([
      'worksheet-1-original-50x70cm.png',
      'worksheet-2-outline-50x70cm.png',
      'worksheet-3-grid-4x4-50x70cm.png',
      'worksheet-4-grid-blank-4x4-50x70cm.png',
      'worksheet-5-values-5-50x70cm.png',
    ]);
    expect(sheetFilename('grid', 2, { ...gs, canvasWidth: 21, canvasHeight: 29.7, cellMode: 'square', cellSize: 3 }, 3)).toBe('worksheet-2-grid-3cm-squares-21x29.7cm.png');
  });

  it('needs the other tool only for the sheets that are its work', () => {
    expect(otherToolNeeded('grid', ['original', 'grid', 'blank'])).toBeNull();
    expect(otherToolNeeded('grid', ['original', 'outline'])).toBe('value');
    expect(otherToolNeeded('value', ['original', 'outline', 'values'])).toBeNull();
    expect(otherToolNeeded('value', ['values', 'blank'])).toBe('grid');
  });

  it('remembers its choices safely: anything unexpected gives the defaults', () => {
    expect(DEFAULT_CHOICES).toEqual({ sheets: ['original', 'outline', 'grid', 'values'], levels: 5 });
    for (const raw of [null, 'x', 42, [], { sheets: 'all' }]) expect(readChoices(raw)).toEqual(DEFAULT_CHOICES);
    expect(readChoices({ sheets: ['blank', 'nonsense', 'original'], levels: 3 })).toEqual({ sheets: ['original', 'blank'], levels: 3 });
    expect(readChoices({ sheets: [], levels: 7 })).toEqual({ sheets: [], levels: 5 });
  });
});
