import type { GridSettings } from '@/types/project';
import { gridFractions, imageRect } from '@/lib/grid/geometry';
import { BLANK_LINE_COLOR, drawImageClipped, fillBackground, type LoadedImage } from '@/lib/grid/draw';
import { gridLineWidthMm, type GridPrintLayout, type TextRenderer } from './gridPdf';

// ─── Print: the parts of Create a Grid's PDF that need a browser ──────────────
// The photo for page 1 (placed exactly as in the saved grid image), the text
// (drawn by the browser, so Hebrew reads right to left in the app's font), and
// a picture of both pages for the save sheet (a PDF cannot be shown there:
// the Content Security Policy allows no embedded viewer).

/** The photo's resolution on paper. */
export const REFERENCE_DPI = 300;
/** Never a larger canvas than this (iPad memory), whatever the page. */
const MAX_PIXELS = 16_000_000;
/** Text resolution: 12 px per mm, about 305 dpi. */
const TEXT_PX_PER_MM = 12;

/**
 * The canvas area with the photo, as on page 1: the same background and the
 * same placement (fit, fill, zoom, offsets, rotation) as the saved grid image,
 * at 300 dpi of the printed size. No grid: the PDF draws it as vectors.
 */
export function rasterizeReference(gs: GridSettings, image: LoadedImage, layout: GridPrintLayout, doc: Document = document): HTMLCanvasElement {
  let pxPerMm = REFERENCE_DPI / 25.4;
  const pixels = layout.canvas.w * layout.canvas.h * pxPerMm * pxPerMm;
  if (pixels > MAX_PIXELS) pxPerMm *= Math.sqrt(MAX_PIXELS / pixels);
  const w = Math.max(1, Math.round(layout.canvas.w * pxPerMm));
  const h = Math.max(1, Math.round(layout.canvas.h * pxPerMm));
  const canvas = doc.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  fillBackground(ctx, w, h);
  drawImageClipped(ctx, image.source, imageRect(gs, image.naturalWidth, image.naturalHeight, w / gs.canvasWidth, w, h), w, h);
  return canvas;
}

/** Text as an image, in the given font and direction, shrunk to fit its width if needed. */
export function canvasTextRenderer(options: { rtl: boolean; fontFamily: string; doc?: Document }): TextRenderer {
  const doc = options.doc ?? document;
  return async (text, { sizeMm, maxWidthMm, bold }) => {
    const canvas = doc.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    let size = sizeMm * TEXT_PX_PER_MM;
    const font = () => `${bold ? '600 ' : ''}${size}px ${options.fontFamily}`;
    ctx.font = font();
    let width = ctx.measureText(text).width;
    const max = maxWidthMm * TEXT_PX_PER_MM;
    if (width > max) {
      size *= max / width;
      ctx.font = font();
      width = ctx.measureText(text).width;
    }
    canvas.width = Math.max(1, Math.ceil(width) + 4);
    canvas.height = Math.max(1, Math.ceil(size * 1.4));
    // A new size resets the context: set everything again.
    ctx.font = font();
    ctx.fillStyle = '#000000';
    ctx.textBaseline = 'middle';
    ctx.direction = options.rtl ? 'rtl' : 'ltr';
    ctx.textAlign = options.rtl ? 'right' : 'left';
    ctx.fillText(text, options.rtl ? canvas.width - 2 : 2, canvas.height / 2);
    return { data: canvas.toDataURL('image/png'), wMm: canvas.width / TEXT_PX_PER_MM, hMm: canvas.height / TEXT_PX_PER_MM };
  };
}

/** Both pages side by side, small: what the save sheet shows. */
export function renderPdfPreview(gs: GridSettings, layout: GridPrintLayout, reference: HTMLCanvasElement, doc: Document = document): HTMLCanvasElement {
  const px = 2.4;
  const gap = 24;
  const pw = Math.round(layout.page.w * px);
  const ph = Math.round(layout.page.h * px);
  const canvas = doc.createElement('canvas');
  canvas.width = pw * 2 + gap;
  canvas.height = ph;
  const ctx = canvas.getContext('2d')!;
  const lines = gridFractions(gs);
  const c = layout.canvas;
  [false, true].forEach((blank, i) => {
    const ox = i * (pw + gap);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(ox, 0, pw, ph);
    const x = ox + c.x * px;
    const y = c.y * px;
    const w = c.w * px;
    const h = c.h * px;
    if (!blank) ctx.drawImage(reference, x, y, w, h);
    ctx.strokeStyle = blank ? BLANK_LINE_COLOR : gs.lineColor;
    ctx.globalAlpha = gs.lineOpacity;
    ctx.lineWidth = Math.max(1, gridLineWidthMm(gs, c.w) * px);
    for (const f of lines.xs) {
      ctx.beginPath();
      ctx.moveTo(x + f * w, y);
      ctx.lineTo(x + f * w, y + h);
      ctx.stroke();
    }
    for (const f of lines.ys) {
      ctx.beginPath();
      ctx.moveTo(x, y + f * h);
      ctx.lineTo(x + w, y + f * h);
      ctx.stroke();
    }
    ctx.globalAlpha = Math.min(1, gs.lineOpacity + 0.3);
    ctx.strokeRect(x, y, w, h);
    ctx.globalAlpha = 1;
    // The footer, suggested: two lines of text and the bar.
    ctx.fillStyle = '#9ca3af';
    ctx.fillRect(ox + 12.7 * px, (layout.footerTop + 2.5) * px, (layout.page.w - 25.4) * 0.55 * px, 1.6 * px);
    ctx.fillRect(ox + 12.7 * px, (layout.footerTop + 8.5) * px, (layout.page.w - 25.4) * 0.7 * px, 1.6 * px);
    ctx.fillStyle = '#000000';
    ctx.fillRect(ox + layout.bar.x * px, layout.bar.y * px - 1, layout.bar.length * px, 2);
  });
  return canvas;
}

/** Load an image (a data URL) for drawing. */
export function loadImage(src: string): Promise<LoadedImage> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ source: img, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight });
    img.onerror = () => reject(new Error('the image could not be loaded'));
    img.src = src;
  });
}
