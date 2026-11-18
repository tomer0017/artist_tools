import type { GridSettings } from '@/types/project';
import type { GState as JsPdfGState, jsPDF as JsPdf } from 'jspdf';
import { cellCounts, gridFractions, type GridLines } from '@/lib/grid/geometry';
import { BLANK_LINE_COLOR } from '@/lib/grid/draw';
import { CALIBRATION_MM, SAFE_MARGIN_MM, pageMm, type Orientation } from './paper';

// ─── Print: Create a Grid's A4 PDF ────────────────────────────────────────────
// Two pages with one layout: the reference with its grid, then the same grid
// blank, for paper. The canvas area, the grid lines (exact PDF vectors) and
// the scale are identical on both pages, so the pages line up. Printed at
// 100 %, the canvas appears at its real size when it fits inside the page,
// otherwise reduced to fit (the page says by how much); a 50 mm bar shows at
// once whether the print was scaled.
//
// Pure: jsPDF, the photo (already placed, as JPEG) and the text (as images,
// drawn by the browser in the page language) are handed in.

/** The band under the grid: the page's name and scale, how to print, and the 50 mm bar. */
export const FOOTER_MM = 21;

export interface GridPrintLayout {
  orientation: Orientation;
  /** The page, mm. */
  page: { w: number; h: number };
  /** The canvas and its grid on both pages: mm from the page's top-left corner. */
  canvas: { x: number; y: number; w: number; h: number };
  /** Printed size ÷ real size: 1 is true size. */
  scale: number;
  /** Top of the footer band, mm. */
  footerTop: number;
  /** The calibration bar: its left end, its line (mm), and its length (50 mm). */
  bar: { x: number; y: number; length: number };
}

const unitMm = (unit: GridSettings['unit']) => (unit === 'in' ? 25.4 : 10);

/** The canvas's real size, in millimetres. */
export function canvasMm(gs: Pick<GridSettings, 'canvasWidth' | 'canvasHeight' | 'unit'>): { w: number; h: number } {
  const u = unitMm(gs.unit);
  return { w: gs.canvasWidth * u, h: gs.canvasHeight * u };
}

/** The largest scale (never above true size) at which the canvas fits the page's printable area above the footer. */
function fitScale(gs: Pick<GridSettings, 'canvasWidth' | 'canvasHeight' | 'unit'>, orientation: Orientation): number {
  const page = pageMm(orientation);
  const real = canvasMm(gs);
  return Math.min(1, (page.w - 2 * SAFE_MARGIN_MM) / real.w, (page.h - 2 * SAFE_MARGIN_MM - FOOTER_MM) / real.h);
}

/**
 * Where everything goes on the A4 pages: the orientation that prints the
 * canvas largest (portrait on a tie) unless one is asked for, the scale, the
 * canvas area centred above the footer, and the bar.
 */
export function gridPrintLayout(gs: Pick<GridSettings, 'canvasWidth' | 'canvasHeight' | 'unit'>, orientation?: Orientation): GridPrintLayout {
  const chosen = orientation ?? (fitScale(gs, 'landscape') > fitScale(gs, 'portrait') ? 'landscape' : 'portrait');
  const page = pageMm(chosen);
  const scale = fitScale(gs, chosen);
  const real = canvasMm(gs);
  const w = real.w * scale;
  const h = real.h * scale;
  const areaW = page.w - 2 * SAFE_MARGIN_MM;
  const areaH = page.h - 2 * SAFE_MARGIN_MM - FOOTER_MM;
  return {
    orientation: chosen,
    page,
    scale,
    canvas: { x: SAFE_MARGIN_MM + (areaW - w) / 2, y: SAFE_MARGIN_MM + (areaH - h) / 2, w, h },
    footerTop: page.h - SAFE_MARGIN_MM - FOOTER_MM,
    bar: { x: SAFE_MARGIN_MM, y: page.h - SAFE_MARGIN_MM - 3, length: CALIBRATION_MM },
  };
}

/** Grid lines on paper: as on screen, in proportion to the printed width, never under 0.1 mm. */
export const gridLineWidthMm = (gs: Pick<GridSettings, 'lineWidth'>, canvasWidthMm: number): number => Math.max(0.1, (gs.lineWidth * canvasWidthMm) / 600);

/** The page's description: the grid, and the scale it is printed at. */
export function gridPrintDetail(gs: GridSettings, layout: GridPrintLayout): { trueSize: boolean; percent: string; cellOnPaperMm: string; across: number; down: number } {
  const counts = cellCounts(gs);
  return {
    trueSize: layout.scale >= 1 - 1e-9,
    percent: `${Math.round(layout.scale * 1000) / 10}`,
    cellOnPaperMm: `${Math.round(gs.cellSize * unitMm(gs.unit) * layout.scale * 10) / 10}`,
    across: counts.across,
    down: counts.down,
  };
}

/** Text drawn as an image (by the browser, in the page language), with its size on paper. */
export interface TextImage {
  /** A PNG, as a data URL. */
  data: string;
  wMm: number;
  hMm: number;
}
export type TextRenderer = (text: string, options: { sizeMm: number; maxWidthMm: number; bold?: boolean }) => Promise<TextImage>;

export interface JsPdfModule {
  jsPDF: typeof JsPdf;
  GState: typeof JsPdfGState;
}

export interface GridPdfInput {
  gs: GridSettings;
  layout: GridPrintLayout;
  /** The canvas area with the photo placed exactly as in the saved grid image, as JPEG; it fills layout.canvas. */
  reference: Uint8Array;
  /** The words on the pages, in the page language. */
  /** `detail`: the grid, then the scale; each part is joined after the page's name with ` · `. */
  words: { title: string; reference: string; blank: string; detail: string[]; print: string; bar: string };
  /** Right to left (Hebrew): text and the bar's label are mirrored. */
  rtl: boolean;
  renderText: TextRenderer;
}

/** The two-page A4 PDF: the reference with its grid, then the same grid blank. */
export async function buildGridPdf(lib: JsPdfModule, input: GridPdfInput): Promise<ArrayBuffer> {
  const { gs, layout } = input;
  const doc = new lib.jsPDF({ orientation: layout.orientation, unit: 'mm', format: 'a4', compress: true, putOnlyUsedFonts: true, floatPrecision: 4 });
  doc.setProperties({ title: input.words.title, creator: 'Studio Companion' });
  // Ask viewers to print at actual size (most honour it; the bar shows if one did not).
  doc.viewerPreferences({ PrintScaling: 'None' });

  const lines = gridFractions(gs);
  const width = gridLineWidthMm(gs, layout.canvas.w);
  const c = layout.canvas;

  // Page 1: the reference, then its grid on top.
  doc.addImage(input.reference, 'JPEG', c.x, c.y, c.w, c.h, 'reference', 'NONE');
  drawGrid(doc, lib, layout, lines, { color: gs.lineColor, opacity: gs.lineOpacity, width });
  await drawFooter(doc, input, input.words.reference);

  // Page 2: the same grid, the same place, dark lines on the paper.
  doc.addPage('a4', layout.orientation);
  drawGrid(doc, lib, layout, lines, { color: BLANK_LINE_COLOR, opacity: gs.lineOpacity, width });
  await drawFooter(doc, input, input.words.blank);

  return doc.output('arraybuffer');
}

/** Inner lines as exact vectors, then the border a little stronger (as on screen and in the saved image). */
function drawGrid(doc: JsPdf, lib: JsPdfModule, layout: GridPrintLayout, lines: GridLines, style: { color: string; opacity: number; width: number }) {
  const c = layout.canvas;
  doc.saveGraphicsState();
  doc.setDrawColor(style.color);
  doc.setLineWidth(style.width);
  doc.setGState(new lib.GState({ 'stroke-opacity': style.opacity }));
  for (const f of lines.xs) {
    const x = c.x + f * c.w;
    doc.line(x, c.y, x, c.y + c.h);
  }
  for (const f of lines.ys) {
    const y = c.y + f * c.h;
    doc.line(c.x, y, c.x + c.w, y);
  }
  doc.setGState(new lib.GState({ 'stroke-opacity': Math.min(1, style.opacity + 0.3) }));
  doc.rect(c.x, c.y, c.w, c.h, 'S');
  doc.restoreGraphicsState();
}

/**
 * The parts of the footer's first line, joined with ` · `. Right to left, a
 * right-to-left mark (U+200F) ends each part, so a part ending in a number or
 * a Latin unit (`4×4`, `cm`) cannot pull the next part's number into its run
 * and swap their order. (Isolates, U+2067…2069, would do the same, but
 * WebKit's canvas ignores them; the mark works in both engines.)
 */
export const footerLine = (parts: string[], rtl: boolean): string => parts.join(rtl ? '\u200f · ' : ' · ');

/** The page's name and scale, how to print it, and the 50 mm bar with its label. */
async function drawFooter(doc: JsPdf, input: GridPdfInput, pageName: string) {
  const { layout, words, rtl, renderText } = input;
  const margin = SAFE_MARGIN_MM;
  const width = layout.page.w - 2 * margin;
  const place = (img: TextImage, y: number) => doc.addImage(img.data, 'PNG', rtl ? layout.page.w - margin - img.wMm : margin, y, img.wMm, img.hMm);

  place(await renderText(footerLine([pageName, ...words.detail], rtl), { sizeMm: 3.2, maxWidthMm: width, bold: true }), layout.footerTop + 1.5);
  place(await renderText(words.print, { sizeMm: 3.2, maxWidthMm: width }), layout.footerTop + 7.5);

  // The bar: exactly 50 mm between its two end marks.
  const b = layout.bar;
  const start = rtl ? layout.page.w - margin - b.length : b.x;
  doc.saveGraphicsState();
  doc.setDrawColor('#000000');
  doc.setLineWidth(0.35);
  doc.line(start, b.y, start + b.length, b.y);
  doc.line(start, b.y - 2, start, b.y + 2);
  doc.line(start + b.length, b.y - 2, start + b.length, b.y + 2);
  doc.restoreGraphicsState();
  const label = await renderText(words.bar, { sizeMm: 3, maxWidthMm: 40 });
  doc.addImage(label.data, 'PNG', rtl ? start - 3 - label.wMm : start + b.length + 3, b.y - label.hMm / 2, label.wMm, label.hMm);
}
