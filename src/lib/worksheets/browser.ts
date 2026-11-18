import { DEFAULT_VALUE_SETTINGS, type GridSettings } from '@/types/project';
import { exportSize, type ImageRect } from '@/lib/grid/geometry';
import type { LoadedImage } from '@/lib/grid/draw';
import { canvasToBlob } from '@/lib/saveMedia';
import { SketchClient } from '@/lib/sketch/client';
import { decodeImage, drawPaths, encodePng, isConstrainedDevice, readPixels, sketchLimits, spawnSketchWorker } from '@/lib/sketch/browser';
import { previewSize, type SketchLimits } from '@/lib/sketch/sizing';
import type { SketchControls } from '@/lib/sketch/styles';
import { preBlur, studyValues } from '@/lib/values/posterize';
import { drawGridSheet, drawOnPaper, orderedSheets, outlineSize, photoRect, sheetFilename, valuesSize, type SheetKind, type ValueLevels } from './sheets';

// ─── Prepare Worksheets: making the sheets in the browser ───────────────────────
// The photo never leaves the device. Sheets are made one after another, each
// on its own canvas that is freed as soon as it is encoded, so the memory in
// use stays about one sheet (Create a Grid's saved image, 2400 px wide).

export interface WorksheetSheet {
  kind: SheetKind;
  filename: string;
  /** The sheet, PNG. */
  blob: Blob;
  /** A small PNG of it, for the screen. */
  thumbnail: Blob;
  width: number;
  height: number;
}

export interface MakeWorksheetsOptions {
  /** Canvas, grid and framing (Create a Grid's settings). */
  gs: GridSettings;
  sheets: readonly SheetKind[];
  levels: ValueLevels;
  /** Clean Outline's controls (as set in Study & Simplify). */
  outline: SketchControls;
  /** Called before each sheet, and once more at the end. */
  onProgress?: (done: number, total: number) => void;
  /** Stops between sheets (the sheet was closed). */
  signal?: AbortSignal;
  doc?: Document;
}

const THUMBNAIL_SIDE = 360;

function canvas(doc: Document, width: number, height: number): HTMLCanvasElement {
  const c = doc.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

/** Shrink a canvas to nothing, so its memory is released now. */
function free(c: HTMLCanvasElement | null): void {
  if (!c) return;
  c.width = 0;
  c.height = 0;
}

/**
 * Clean Outline of the photo, exactly as Study & Simplify draws it: traced by
 * the sketch engine at Study's working size (in a worker of its own, shut
 * down afterwards), drawn from its vector paths at about its size on the sheet.
 */
export async function outlinePicture(img: HTMLImageElement, rect: ImageRect, controls: SketchControls, limits: SketchLimits, doc: Document = document): Promise<HTMLCanvasElement> {
  const client = new SketchClient(spawnSketchWorker, encodePng);
  try {
    const working = previewSize({ width: img.naturalWidth, height: img.naturalHeight }, limits);
    client.load(readPixels(img, working), working.width, working.height, isConstrainedDevice());
    const traced = await client.paths(controls);
    const size = outlineSize({ width: traced.width, height: traced.height }, rect, limits);
    const c = canvas(doc, size.width, size.height);
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('No 2D canvas');
    drawPaths(ctx, traced.layers, { width: traced.width, height: traced.height }, size);
    return c;
  } finally {
    client.dispose();
  }
}

/**
 * The values study of the photo: Study & Simplify's Values algorithm in gray,
 * at its default contrast and brightness, at about the photo's size on the sheet.
 */
export function valuesPicture(img: CanvasImageSource & { naturalWidth: number; naturalHeight: number }, rect: ImageRect, levels: ValueLevels, limits: SketchLimits, doc: Document = document): HTMLCanvasElement {
  const size = valuesSize(img, rect, limits);
  const c = canvas(doc, size.width, size.height);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('No 2D canvas');
  const blur = preBlur('grayscale', 'none');
  ctx.filter = blur ? `blur(${blur}px)` : 'none';
  ctx.drawImage(img, 0, 0, size.width, size.height);
  ctx.filter = 'none';
  const imageData = ctx.getImageData(0, 0, size.width, size.height);
  studyValues(imageData.data, size.width, size.height, {
    mode: 'grayscale',
    levels,
    focus: 'none',
    contrast: DEFAULT_VALUE_SETTINGS.contrast,
    brightness: DEFAULT_VALUE_SETTINGS.brightness,
    isolatedIdx: null,
  });
  ctx.putImageData(imageData, 0, 0);
  return c;
}

async function thumbnailOf(sheet: HTMLCanvasElement, doc: Document): Promise<Blob> {
  const scale = THUMBNAIL_SIDE / Math.max(sheet.width, sheet.height);
  const t = canvas(doc, Math.max(1, Math.round(sheet.width * scale)), Math.max(1, Math.round(sheet.height * scale)));
  try {
    const ctx = t.getContext('2d');
    if (!ctx) throw new Error('No 2D canvas');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(sheet, 0, 0, t.width, t.height);
    return await canvasToBlob(t, 'image/png');
  } finally {
    free(t);
  }
}

/** The chosen sheets of a set, in order, as PNG files. */
export async function makeWorksheets(photoSrc: string, options: MakeWorksheetsOptions): Promise<WorksheetSheet[]> {
  const doc = options.doc ?? document;
  const { gs, levels } = options;
  const kinds = orderedSheets(options.sheets);
  const img = await decodeImage(photoSrc);
  const photo: LoadedImage = { source: img, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight };
  const { w, h } = exportSize(gs);
  const rect = photoRect(gs, photo);
  const limits = sketchLimits();
  const made: WorksheetSheet[] = [];
  for (const [index, kind] of kinds.entries()) {
    if (options.signal?.aborted) throw new DOMException('The sheets were not made', 'AbortError');
    options.onProgress?.(index, kinds.length);
    const sheet = canvas(doc, w, h);
    let picture: HTMLCanvasElement | null = null;
    try {
      const ctx = sheet.getContext('2d');
      if (!ctx) throw new Error('No 2D canvas');
      if (kind === 'original') {
        drawOnPaper(ctx, gs, img, rect);
      } else if (kind === 'outline') {
        picture = await outlinePicture(img, rect, options.outline, limits, doc);
        drawOnPaper(ctx, gs, picture, rect);
      } else if (kind === 'values') {
        picture = valuesPicture(img, rect, levels, limits, doc);
        // Exactly the study's grays on the sheet: no smoothing between them.
        ctx.imageSmoothingEnabled = false;
        drawOnPaper(ctx, gs, picture, rect);
      } else {
        drawGridSheet(ctx, gs, photo, kind === 'blank');
      }
      free(picture);
      picture = null;
      const blob = await canvasToBlob(sheet, 'image/png');
      const thumbnail = await thumbnailOf(sheet, doc);
      made.push({ kind, filename: sheetFilename(kind, index + 1, gs, levels), blob, thumbnail, width: w, height: h });
    } finally {
      free(picture);
      free(sheet);
    }
  }
  options.onProgress?.(kinds.length, kinds.length);
  return made;
}
