import { describe, expect, it } from 'vitest';
import { DEFAULT_GRID_SETTINGS, normalizeGridSettings, type GridSettings } from '@/types/project';
import { drawExport, drawPreview, exportFilename } from './draw';
import { exportSize, previewSize } from './geometry';

// Create a Grid's preview and saved image, before and after the geometry was
// moved into src/lib/grid: the earlier code (GridTab.tsx at 224bb65) is
// copied below verbatim as `legacy…`, and both draw onto a context that
// records every call and every property set, in order. For grids without the
// newer settings (no rotation, columns × rows), the records must be equal —
// the same calls, with the same numbers, bit for bit — so the PNG a browser
// makes from them is the same as before.

type Call = [string, ...unknown[]];

function recorder() {
  const log: Call[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_, prop) => (typeof prop === 'string' ? (...args: unknown[]) => void log.push([prop, ...args]) : undefined),
    set: (_, prop, value) => {
      log.push([`set ${String(prop)}`, value]);
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, log };
}

/** A decoded image as the canvas sees it (only its size matters here). */
const photo = (naturalWidth: number, naturalHeight: number) => ({ naturalWidth, naturalHeight }) as unknown as HTMLImageElement;

// ─── The earlier code, verbatim (only `gs`, the image and the context made parameters) ───
function legacyGetFitScale(gs: GridSettings, imageWidth: number, imageHeight: number) {
  if (!imageWidth || !imageHeight) return 1;
  return Math.min(gs.canvasWidth / imageWidth, gs.canvasHeight / imageHeight);
}

function legacyDrawGrid(gs: GridSettings, ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.strokeStyle = gs.lineColor;
  ctx.globalAlpha = gs.lineOpacity;
  ctx.lineWidth = gs.lineWidth;

  // Columns
  for (let i = 1; i < gs.columns; i++) {
    const x = Math.round((i / gs.columns) * w);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }

  // Rows
  for (let i = 1; i < gs.rows; i++) {
    const y = Math.round((i / gs.rows) * h);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // Border
  ctx.globalAlpha = Math.min(1, gs.lineOpacity + 0.3);
  ctx.strokeRect(0, 0, w, h);
  ctx.globalAlpha = 1;
}

/** The preview: `draw()` with the image already loaded (its onload ran). */
function legacyPreview(gs: GridSettings, ctx: CanvasRenderingContext2D, img: HTMLImageElement | null, maxW: number, maxH: number) {
  const scale = Math.min(maxW / gs.canvasWidth, maxH / gs.canvasHeight);
  const w = Math.round(gs.canvasWidth * scale);
  const h = Math.round(gs.canvasHeight * scale);

  // Background
  ctx.fillStyle = '#2a2a2a';
  ctx.fillRect(0, 0, w, h);

  if (img) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();

    const baseScale = legacyGetFitScale(gs, img.naturalWidth, img.naturalHeight);
    const imgW = img.naturalWidth * baseScale * gs.imageScale * scale;
    const imgH = img.naturalHeight * baseScale * gs.imageScale * scale;
    const ox = gs.imageOffsetX * scale;
    const oy = gs.imageOffsetY * scale;

    // Center image then apply offset
    const cx = (w - imgW) / 2 + ox;
    const cy = (h - imgH) / 2 + oy;
    ctx.drawImage(img, cx, cy, imgW, imgH);
    ctx.restore();

    legacyDrawGrid(gs, ctx, w, h);
  } else {
    legacyDrawGrid(gs, ctx, w, h);
  }
  return { w, h };
}

function legacyDrawGridOnCtx(gs: GridSettings, ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.strokeStyle = gs.lineColor;
  ctx.globalAlpha = gs.lineOpacity;
  ctx.lineWidth = Math.max(1, gs.lineWidth * (w / 600));

  for (let i = 1; i < gs.columns; i++) {
    const x = Math.round((i / gs.columns) * w);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let i = 1; i < gs.rows; i++) {
    const y = Math.round((i / gs.rows) * h);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.globalAlpha = Math.min(1, gs.lineOpacity + 0.3);
  ctx.strokeRect(0, 0, w, h);
  ctx.globalAlpha = 1;
}

/** The saved image: `handleExport()` with the image loaded; returns its size and file name. */
function legacyExport(gs: GridSettings, ctx: CanvasRenderingContext2D, img: HTMLImageElement | null) {
  const aspect = gs.canvasWidth / gs.canvasHeight;
  const exportW = 2400;
  const exportH = Math.round(exportW / aspect);

  ctx.fillStyle = '#2a2a2a';
  ctx.fillRect(0, 0, exportW, exportH);

  if (img) {
    const baseScale = legacyGetFitScale(gs, img.naturalWidth, img.naturalHeight);
    const unitScale = exportW / gs.canvasWidth;
    const imgW = img.naturalWidth * baseScale * gs.imageScale * unitScale;
    const imgH = img.naturalHeight * baseScale * gs.imageScale * unitScale;
    const ox = gs.imageOffsetX * (exportW / gs.canvasWidth);
    const oy = gs.imageOffsetY * (exportW / gs.canvasWidth);
    const cx = (exportW - imgW) / 2 + ox;
    const cy = (exportH - imgH) / 2 + oy;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, exportW, exportH);
    ctx.clip();
    ctx.drawImage(img, cx, cy, imgW, imgH);
    ctx.restore();
  }
  legacyDrawGridOnCtx(gs, ctx, exportW, exportH);
  const filename = `grid-${gs.columns}x${gs.rows}-${gs.canvasWidth}x${gs.canvasHeight}${gs.unit}.png`;
  return { w: exportW, h: exportH, filename };
}

// ─── A wide range of grids saved before (no rotation, no square cells) ───
const OLD_KEYS = ['canvasWidth', 'canvasHeight', 'unit', 'columns', 'rows', 'lineColor', 'lineOpacity', 'lineWidth', 'imageOffsetX', 'imageOffsetY', 'imageScale'] as const;
type OldSettings = Pick<GridSettings, (typeof OLD_KEYS)[number]>;

const canvases: Pick<OldSettings, 'canvasWidth' | 'canvasHeight' | 'unit'>[] = [
  { canvasWidth: 50, canvasHeight: 70, unit: 'cm' },
  { canvasWidth: 30, canvasHeight: 40, unit: 'cm' },
  { canvasWidth: 45, canvasHeight: 80, unit: 'cm' },
  { canvasWidth: 16, canvasHeight: 20, unit: 'in' },
  { canvasWidth: 120, canvasHeight: 35, unit: 'cm' },
  { canvasWidth: 21, canvasHeight: 29.7, unit: 'cm' },
];
const grids: Pick<OldSettings, 'columns' | 'rows'>[] = [
  { columns: 1, rows: 1 },
  { columns: 3, rows: 3 },
  { columns: 4, rows: 4 },
  { columns: 7, rows: 11 },
  { columns: 16, rows: 16 },
];
const looks: Pick<OldSettings, 'lineColor' | 'lineOpacity' | 'lineWidth'>[] = [
  { lineColor: '#ffffff', lineOpacity: 0.5, lineWidth: 1 },
  { lineColor: '#ef4444', lineOpacity: 0.85, lineWidth: 3 },
  { lineColor: '#3b82f6', lineOpacity: 1, lineWidth: 5 },
];
const placements: Pick<OldSettings, 'imageScale' | 'imageOffsetX' | 'imageOffsetY'>[] = [
  { imageScale: 1, imageOffsetX: 0, imageOffsetY: 0 },
  { imageScale: 2.37, imageOffsetX: 3.3, imageOffsetY: -12.75 },
  { imageScale: 0.25, imageOffsetX: -40.1, imageOffsetY: 7 },
  { imageScale: 8, imageOffsetX: 1e-3, imageOffsetY: 33.333 },
];
const photos = [photo(1200, 800), photo(800, 1200), photo(4032, 3024), photo(1, 1)];
const areas: [number, number][] = [
  [343 - 16, 380 - 16],
  [1000 - 16, 700 - 16],
];

const savedBefore: OldSettings[] = canvases.flatMap((c, i) =>
  grids.flatMap((g, j) => looks.map((l, k) => ({ ...c, ...g, ...l, ...placements[(i + j + k) % placements.length] }))),
);

describe('Create a Grid draws grids saved before exactly as it did', () => {
  it(`the preview and the saved image: the same canvas calls, bit for bit (${savedBefore.length} grids × ${photos.length + 1} images × 2 screens)`, () => {
    let compared = 0;
    for (const saved of savedBefore) {
      const gs = normalizeGridSettings(saved);
      expect(gs).toMatchObject(saved);
      expect(gs).toMatchObject({ rotation: 0, cellMode: 'divisions' });
      for (const img of [null, ...photos]) {
        for (const [maxW, maxH] of areas) {
          const before = recorder();
          const size = legacyPreview(saved as GridSettings, before.ctx, img, maxW, maxH);
          const after = recorder();
          const preview = previewSize(gs, maxW, maxH);
          expect({ w: preview.w, h: preview.h }).toEqual(size);
          drawPreview(after.ctx, gs, img && { source: img, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight }, preview);
          expect(before.log.filter((c) => c[0] === 'strokeRect')).toHaveLength(1);
          expect(after.log).toStrictEqual(before.log);
          compared += 1;
        }
        const before = recorder();
        const old = legacyExport(saved as GridSettings, before.ctx, img);
        const after = recorder();
        drawExport(after.ctx, gs, img && { source: img, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight });
        expect(before.log.filter((c) => c[0] === 'drawImage')).toHaveLength(img ? 1 : 0);
        expect(after.log).toStrictEqual(before.log);
        expect(exportSize(gs)).toEqual({ w: old.w, h: old.h });
        expect(exportFilename(gs)).toBe(old.filename);
        compared += 1;
      }
    }
    expect(compared).toBe(savedBefore.length * (photos.length + 1) * (areas.length + 1));
  });

  it('the default grid, and one saved before with every field', () => {
    const before = recorder();
    legacyExport(DEFAULT_GRID_SETTINGS, before.ctx, photo(1200, 800));
    const after = recorder();
    drawExport(after.ctx, normalizeGridSettings({ ...DEFAULT_GRID_SETTINGS }), { source: photo(1200, 800), naturalWidth: 1200, naturalHeight: 800 });
    expect(after.log).toStrictEqual(before.log);
    expect(exportFilename(DEFAULT_GRID_SETTINGS)).toBe('grid-4x4-50x70cm.png');
  });
});

describe('the new settings', () => {
  it('a saved grid with unusable new settings gets their defaults, and nothing else changes', () => {
    const saved = { ...DEFAULT_GRID_SETTINGS, columns: 7, rotation: 45, cellMode: 'hexagons', cellSize: -2 };
    expect(normalizeGridSettings(saved)).toEqual({ ...DEFAULT_GRID_SETTINGS, columns: 7, rotation: 0, cellMode: 'divisions', cellSize: 3 });
    expect(normalizeGridSettings(null)).toEqual(DEFAULT_GRID_SETTINGS);
    expect(normalizeGridSettings('grid')).toEqual(DEFAULT_GRID_SETTINGS);
  });

  it('a rotated image turns about its own centre, on the same spot; the grid is drawn as before', () => {
    const gs: GridSettings = { ...DEFAULT_GRID_SETTINGS, rotation: 90, imageOffsetX: 2, imageOffsetY: -3 };
    const { ctx, log } = recorder();
    const img = photo(1200, 800);
    drawExport(ctx, gs, { source: img, naturalWidth: 1200, naturalHeight: 800 });
    const names = log.map((c) => c[0]);
    expect(names.slice(0, 9)).toEqual(['set fillStyle', 'fillRect', 'save', 'beginPath', 'rect', 'clip', 'translate', 'rotate', 'drawImage']);
    const translate = log.find((c) => c[0] === 'translate')!;
    const pxPerUnit = 2400 / 50;
    expect(translate[1]).toBeCloseTo(1200 + 2 * pxPerUnit, 9);
    expect(translate[2]).toBeCloseTo(3360 / 2 - 3 * pxPerUnit, 9);
    expect(log.find((c) => c[0] === 'rotate')![1]).toBeCloseTo(Math.PI / 2, 12);
    // Fitted as turned: 800 wide × 1200 tall into 50 × 70 cm, so its height fills the 70 cm.
    const draw = log.find((c) => c[0] === 'drawImage')!;
    expect(draw[4]).toBeCloseTo(3360, 6);
    // The grid itself: as without rotation.
    const plain = recorder();
    drawExport(plain.ctx, { ...gs, rotation: 0 }, { source: img, naturalWidth: 1200, naturalHeight: 800 });
    const gridCalls = (l: Call[]) => l.slice(l.findIndex((c) => c[0] === 'restore') + 1);
    expect(gridCalls(log)).toStrictEqual(gridCalls(plain.log));
  });

  it('the blank grid: the same lines on white, in black, without the image', () => {
    const gs: GridSettings = { ...DEFAULT_GRID_SETTINGS, cellMode: 'square', cellSize: 3, canvasWidth: 21, canvasHeight: 29.7, lineColor: '#ffffff' };
    const reference = recorder();
    drawExport(reference.ctx, gs, { source: photo(1200, 800), naturalWidth: 1200, naturalHeight: 800 });
    const blank = recorder();
    drawExport(blank.ctx, gs, { source: photo(1200, 800), naturalWidth: 1200, naturalHeight: 800 }, { blank: true });
    expect(blank.log.some((c) => c[0] === 'drawImage')).toBe(false);
    expect(blank.log.slice(0, 2)).toStrictEqual([['set fillStyle', '#ffffff'], ['fillRect', 0, 0, 2400, 3394]]);
    expect(blank.log[2]).toStrictEqual(['set strokeStyle', '#000000']);
    const lines = (l: Call[]) => l.filter((c) => c[0] === 'moveTo' || c[0] === 'lineTo' || c[0] === 'strokeRect');
    expect(lines(blank.log)).toStrictEqual(lines(reference.log));
    expect(exportFilename(gs, true)).toBe('grid-blank-3cm-squares-21x29.7cm.png');
    expect(exportFilename(gs)).toBe('grid-3cm-squares-21x29.7cm.png');
  });
});
