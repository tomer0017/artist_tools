import type { GridSettings } from '@/types/project';
import type { ToolId } from '@/lib/account';
import { exportSize, imageRect, type ImageRect } from '@/lib/grid/geometry';
import { BLANK_BACKGROUND, drawExport, drawImageClipped, exportFilename, fillBackground, type LoadedImage } from '@/lib/grid/draw';
import { MAX_CANVAS_PIXELS, fitSize, type SketchLimits, type Size } from '@/lib/sketch/sizing';

// ─── Prepare Worksheets: what a set is made of ─────────────────────────────────
// Practice sheets from one photo (Learn plan M3), saved as PNG images: the
// original, a Clean Outline, the reference with its grid, the blank grid and
// a values study. Every sheet has the size of Create a Grid's saved image and
// the photo in the same place (its placement, imageRect), so the sheets line
// up exactly. Nothing is drawn twice: the grid sheets are Create a Grid's own
// images, the outline is Study & Simplify's Clean Outline and the values are
// its Values algorithm (src/lib/values).

export type SheetKind = 'original' | 'outline' | 'grid' | 'blank' | 'values';

/** The order of the sheets in a set, and in the numbers of their file names. */
export const SHEET_ORDER: readonly SheetKind[] = ['original', 'outline', 'grid', 'blank', 'values'];

/** The tool whose work a sheet is (the server checks it): the original is the photo itself. */
export const SHEET_TOOL: Record<SheetKind, Extract<ToolId, 'grid' | 'value'> | null> = {
  original: null,
  outline: 'value',
  grid: 'grid',
  blank: 'grid',
  values: 'value',
};

export const VALUE_LEVELS = [3, 5] as const;
export type ValueLevels = (typeof VALUE_LEVELS)[number];

/** What to make, remembered on this device (never the photo). */
export interface WorksheetChoices {
  sheets: SheetKind[];
  levels: ValueLevels;
}

/** Everything but the blank grid, which is optional; 5 values. */
export const DEFAULT_CHOICES: WorksheetChoices = { sheets: ['original', 'outline', 'grid', 'values'], levels: 5 };

export const CHOICES_KEY = 'studio-worksheet-choices';

/** Remembered choices, read safely: anything unexpected gives the defaults. */
export function readChoices(raw: unknown): WorksheetChoices {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CHOICES, sheets: [...DEFAULT_CHOICES.sheets] };
  const value = raw as { sheets?: unknown; levels?: unknown };
  const sheets = Array.isArray(value.sheets) ? SHEET_ORDER.filter((kind) => (value.sheets as unknown[]).includes(kind)) : [...DEFAULT_CHOICES.sheets];
  const levels = (VALUE_LEVELS as readonly unknown[]).includes(value.levels) ? (value.levels as ValueLevels) : DEFAULT_CHOICES.levels;
  return { sheets, levels };
}

/** The chosen sheets, in set order, each once. */
export function orderedSheets(chosen: readonly SheetKind[]): SheetKind[] {
  return SHEET_ORDER.filter((kind) => chosen.includes(kind));
}

/** The other of the two tools whose work a set uses, if the chosen sheets need it. */
export function otherToolNeeded(from: 'grid' | 'value', chosen: readonly SheetKind[]): 'grid' | 'value' | null {
  const other = from === 'grid' ? 'value' : 'grid';
  return chosen.some((kind) => SHEET_TOOL[kind] === other) ? other : null;
}

/** Where the photo goes on every sheet: exactly where Create a Grid's saved image has it. */
export function photoRect(gs: GridSettings, photo: Pick<LoadedImage, 'naturalWidth' | 'naturalHeight'>): ImageRect {
  const { w, h } = exportSize(gs);
  return imageRect(gs, photo.naturalWidth, photo.naturalHeight, w / gs.canvasWidth, w, h);
}

type Ctx = Parameters<typeof drawExport>[0];

/**
 * A picture of the photo (the photo itself, its outline or its values, all
 * at the photo's proportions) where the photo goes, on white paper. The
 * canvas must have the size from exportSize().
 */
export function drawOnPaper(ctx: Ctx, gs: GridSettings, picture: CanvasImageSource, rect: ImageRect): void {
  const { w, h } = exportSize(gs);
  fillBackground(ctx, w, h, BLANK_BACKGROUND);
  drawImageClipped(ctx, picture, rect, w, h);
}

/** The reference with its grid, or the blank grid: Create a Grid's own saved images, unchanged. */
export function drawGridSheet(ctx: Ctx, gs: GridSettings, photo: LoadedImage, blank: boolean): void {
  if (blank) drawExport(ctx, gs, null, { blank: true });
  else drawExport(ctx, gs, photo);
}

/**
 * The outline's size: about the photo's size on the sheet (so it is drawn
 * about 1:1, sharp), at the proportions it was traced at, within the sketch
 * engine's limit for a saved outline.
 */
export function outlineSize(traced: Size, rect: ImageRect, limits: SketchLimits): Size {
  const side = Math.max(1, Math.min(limits.outlineExportSide, Math.ceil(Math.max(rect.w, rect.h))));
  const scale = side / Math.max(traced.width, traced.height);
  return fitSize(Math.round(traced.width * scale), Math.round(traced.height * scale), MAX_CANVAS_PIXELS, side);
}

/**
 * The values study's size: about the photo's size on the sheet, never above
 * the photo's own pixels, within the device's limit for a saved study.
 */
export function valuesSize(photo: Pick<LoadedImage, 'naturalWidth' | 'naturalHeight'>, rect: ImageRect, limits: SketchLimits): Size {
  return fitSize(photo.naturalWidth, photo.naturalHeight, Math.min(limits.pencilExportPixels, MAX_CANVAS_PIXELS), Math.max(1, Math.ceil(Math.max(rect.w, rect.h))));
}

/** File names: the sheet's number in the set, what it is, and the canvas (the grid sheets keep Create a Grid's names). */
export function sheetFilename(kind: SheetKind, number: number, gs: GridSettings, levels: ValueLevels): string {
  const canvas = `${gs.canvasWidth}x${gs.canvasHeight}${gs.unit}`;
  switch (kind) {
    case 'original':
      return `worksheet-${number}-original-${canvas}.png`;
    case 'outline':
      return `worksheet-${number}-outline-${canvas}.png`;
    case 'grid':
      return `worksheet-${number}-${exportFilename(gs)}`;
    case 'blank':
      return `worksheet-${number}-${exportFilename(gs, true)}`;
    case 'values':
      return `worksheet-${number}-values-${levels}-${canvas}.png`;
  }
}
