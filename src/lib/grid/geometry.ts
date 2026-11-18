import type { GridRotation, GridSettings } from '@/types/project';

// ─── Create a Grid: geometry ──────────────────────────────────────────────────
// Where the grid lines and the image go on a canvas of a given pixel size,
// shared by the preview, the saved grid image and the blank grid (and, later,
// printing). Pure: no DOM. The formulas are the ones Create a Grid has always
// used, in the same order of operations, so a grid without the newer settings
// (rotation, square cells) comes out exactly as before (geometry.test.ts
// proves it against the earlier code).

/** Width of a saved grid image, in pixels; its height follows the canvas ratio. */
export const EXPORT_WIDTH = 2400;

/** Lines further apart than this never stop a square grid from being drawn (a guard against absurd sizes). */
const MAX_LINES = 1000;

/** The saved image's pixel size: 2400 wide, as tall as the canvas ratio makes it. */
export function exportSize(gs: Pick<GridSettings, 'canvasWidth' | 'canvasHeight'>): { w: number; h: number } {
  const aspect = gs.canvasWidth / gs.canvasHeight;
  return { w: EXPORT_WIDTH, h: Math.round(EXPORT_WIDTH / aspect) };
}

/** The on-screen canvas: as large as fits in `maxW × maxH`, at the canvas ratio; `scale` is pixels per canvas unit. */
export function previewSize(gs: Pick<GridSettings, 'canvasWidth' | 'canvasHeight'>, maxW: number, maxH: number): { scale: number; w: number; h: number } {
  const scale = Math.min(maxW / gs.canvasWidth, maxH / gs.canvasHeight);
  return { scale, w: Math.round(gs.canvasWidth * scale), h: Math.round(gs.canvasHeight * scale) };
}

/** Inner lines dividing `size` pixels into `n` equal parts (columns × rows). */
export function divisionLines(n: number, size: number): number[] {
  const lines: number[] = [];
  for (let i = 1; i < n; i++) lines.push(Math.round((i / n) * size));
  return lines;
}

/**
 * Inner lines every `cell` units along a side `length` units long drawn on
 * `size` pixels: square cells from the top-left corner, a partial cell at the
 * far edge when the side is not a whole number of cells.
 */
export function squareLines(cell: number, length: number, size: number): number[] {
  const lines: number[] = [];
  if (!(cell > 0) || !(length > 0)) return lines;
  // A line that would fall on the far edge (a whole number of cells) is the border, not a line.
  const end = length - length * 1e-9;
  for (let i = 1; i * cell < end && lines.length < MAX_LINES; i++) lines.push(Math.round(((i * cell) / length) * size));
  return lines;
}

export interface GridLines {
  /** Vertical lines (x, in pixels). */
  xs: number[];
  /** Horizontal lines (y, in pixels). */
  ys: number[];
}

type LineSettings = Pick<GridSettings, 'columns' | 'rows' | 'canvasWidth' | 'canvasHeight'> & Partial<Pick<GridSettings, 'cellMode' | 'cellSize'>>;

/** The grid's inner lines on a canvas of `w × h` pixels. */
export function gridLines(gs: LineSettings, w: number, h: number): GridLines {
  if (gs.cellMode === 'square' && gs.cellSize !== undefined && gs.cellSize > 0) {
    return { xs: squareLines(gs.cellSize, gs.canvasWidth, w), ys: squareLines(gs.cellSize, gs.canvasHeight, h) };
  }
  return { xs: divisionLines(gs.columns, w), ys: divisionLines(gs.rows, h) };
}

/**
 * Where the inner lines fall, as fractions (0–1) of each side, unrounded: for
 * drawing the same grid at any size, such as exact vectors in a PDF. The same
 * lines as gridLines() (same count, same tests at the edges).
 */
export function gridFractions(gs: LineSettings): GridLines {
  if (gs.cellMode === 'square' && gs.cellSize !== undefined && gs.cellSize > 0) {
    return { xs: squareFractions(gs.cellSize, gs.canvasWidth), ys: squareFractions(gs.cellSize, gs.canvasHeight) };
  }
  const even = (n: number) => Array.from({ length: Math.max(0, n - 1) }, (_, i) => (i + 1) / n);
  return { xs: even(gs.columns), ys: even(gs.rows) };
}

function squareFractions(cell: number, length: number): number[] {
  const out: number[] = [];
  if (!(cell > 0) || !(length > 0)) return out;
  const end = length - length * 1e-9;
  for (let i = 1; i * cell < end && out.length < MAX_LINES; i++) out.push((i * cell) / length);
  return out;
}

/** How many cells across and down, counting a partial one at the right or bottom edge. */
export function cellCounts(gs: LineSettings): { across: number; down: number; partial: boolean } {
  if (gs.cellMode === 'square' && gs.cellSize !== undefined && gs.cellSize > 0) {
    // In canvas units, the same test as the lines: a side of a whole number of cells has no partial cell.
    const across = squareLines(gs.cellSize, gs.canvasWidth, gs.canvasWidth).length + 1;
    const down = squareLines(gs.cellSize, gs.canvasHeight, gs.canvasHeight).length + 1;
    const partial = across * gs.cellSize > gs.canvasWidth * (1 + 1e-9) || down * gs.cellSize > gs.canvasHeight * (1 + 1e-9);
    return { across, down, partial };
  }
  return { across: gs.columns, down: gs.rows, partial: false };
}

/** Line width on the saved image: the on-screen width, scaled to its size (never under 1 px). */
export const exportLineWidth = (gs: Pick<GridSettings, 'lineWidth'>, w: number): number => Math.max(1, gs.lineWidth * (w / 600));

/** Width and height of an image of `w × h` after `rotation` (quarter turns swap them). */
export function rotatedSize(w: number, h: number, rotation: GridRotation = 0): { w: number; h: number } {
  return rotation === 90 || rotation === 270 ? { w: h, h: w } : { w, h };
}

/** Canvas units per image pixel that fit an image of `w × h` inside the canvas (1 without a size). */
export function fitScale(gs: Pick<GridSettings, 'canvasWidth' | 'canvasHeight'>, w: number, h: number): number {
  if (!w || !h) return 1;
  return Math.min(gs.canvasWidth / w, gs.canvasHeight / h);
}

/** The image scale (relative to fitting) at which the image, as rotated, fills the whole canvas. */
export function fillImageScale(gs: Pick<GridSettings, 'canvasWidth' | 'canvasHeight'> & Partial<Pick<GridSettings, 'rotation'>>, naturalW: number, naturalH: number): number {
  const { w, h } = rotatedSize(naturalW, naturalH, gs.rotation);
  return Math.max(gs.canvasWidth / w, gs.canvasHeight / h) / fitScale(gs, w, h);
}

export interface ImageRect {
  /** Top-left of the image as placed (of its rotated bounds), in pixels. */
  x: number;
  y: number;
  /** The image's own drawn size, before rotation. */
  w: number;
  h: number;
  /** Its bounds on the canvas, after rotation. */
  boundsW: number;
  boundsH: number;
  rotation: GridRotation;
}

/**
 * Where the image goes on a canvas of `canvasW × canvasH` pixels at
 * `pxPerUnit` pixels per canvas unit: fitted (as rotated), scaled by
 * `imageScale`, centred, then moved by the offsets (canvas units).
 */
export function imageRect(
  gs: Pick<GridSettings, 'canvasWidth' | 'canvasHeight' | 'imageScale' | 'imageOffsetX' | 'imageOffsetY'> & Partial<Pick<GridSettings, 'rotation'>>,
  naturalW: number,
  naturalH: number,
  pxPerUnit: number,
  canvasW: number,
  canvasH: number,
): ImageRect {
  const rotation = gs.rotation ?? 0;
  const turned = rotatedSize(naturalW, naturalH, rotation);
  const baseScale = fitScale(gs, turned.w, turned.h);
  const w = naturalW * baseScale * gs.imageScale * pxPerUnit;
  const h = naturalH * baseScale * gs.imageScale * pxPerUnit;
  const bounds = rotatedSize(w, h, rotation);
  const ox = gs.imageOffsetX * pxPerUnit;
  const oy = gs.imageOffsetY * pxPerUnit;
  return { x: (canvasW - bounds.w) / 2 + ox, y: (canvasH - bounds.h) / 2 + oy, w, h, boundsW: bounds.w, boundsH: bounds.h, rotation };
}

/** The next rotation: a quarter turn left (-90) or right (+90), or a half turn (180). */
export function turn(rotation: GridRotation, by: -90 | 90 | 180): GridRotation {
  return ((((rotation + by) % 360) + 360) % 360) as GridRotation;
}

/** A4 (ISO 216), exactly, in centimetres. */
export const A4_CM = { short: 21, long: 29.7 } as const;
