// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { GState, jsPDF } from 'jspdf';
import { DEFAULT_GRID_SETTINGS, type GridSettings } from '@/types/project';
import { inspectPdf, type InspectedPage, type Stroke } from '@/test/pdfInspect';
import { buildGridPdf, footerLine, gridLineWidthMm, gridPrintDetail, gridPrintLayout, type GridPrintLayout } from './gridPdf';
import { SAFE_MARGIN_MM } from './paper';

// Create a Grid's A4 PDF, made by the real jsPDF and read back from the file:
// A4 exactly, both pages with the same canvas area and the same lines (exact
// vectors), square cells with their partial edges, the 50 mm bar, line widths
// and opacity, and the text within the margins (mirrored right to left).

/** A 1 × 1 JPEG for the photo, and a 1 × 1 PNG for the text: what they show does not matter here. */
const JPEG = Uint8Array.from(Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64'));
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const WORDS = { title: 'Grid', reference: 'Reference with grid', blank: 'Blank grid', detail: ['4×4 grid', 'true size'], print: 'Print at 100% (Actual size).', bar: '50 mm' };
const close = (a: number, b: number, within = 1e-3) => Math.abs(a - b) <= within;
/** jsPDF writes colours to 2 decimals (1/100 of each channel): the same colour within that. */
const sameColor = (a: string, b: string) => [1, 3, 5].every((i) => Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)) <= 2);

async function make(gs: GridSettings, options: { orientation?: 'portrait' | 'landscape'; rtl?: boolean } = {}) {
  const layout = gridPrintLayout(gs, options.orientation);
  const placedText: { text: string; maxWidthMm: number }[] = [];
  const bytes = await buildGridPdf(
    { jsPDF, GState },
    {
      gs,
      layout,
      reference: JPEG,
      words: WORDS,
      rtl: options.rtl ?? false,
      renderText: async (text, o) => {
        placedText.push({ text, maxWidthMm: o.maxWidthMm });
        return { data: PNG, wMm: Math.min(o.maxWidthMm, text.length * 1.6), hMm: o.sizeMm * 1.4 };
      },
    },
  );
  return { layout, pdf: inspectPdf(bytes), placedText };
}

/** The grid's own strokes on a page: inside the canvas area (the bar and its marks are below it). */
const gridStrokes = (page: InspectedPage, layout: GridPrintLayout) => page.lines.filter((l) => l.y1 <= layout.canvas.y + layout.canvas.h + 1e-6 && l.y2 <= layout.canvas.y + layout.canvas.h + 1e-6);
const geometry = (lines: Stroke[]) => lines.map((l) => [l.x1, l.y1, l.x2, l.y2].map((v) => Math.round(v * 1e4) / 1e4));

const A4_3CM: GridSettings = { ...DEFAULT_GRID_SETTINGS, canvasWidth: 21, canvasHeight: 29.7, unit: 'cm', cellMode: 'square', cellSize: 3 };

describe('the A4 pages', () => {
  it('are exactly A4, two of them, portrait or landscape, and ask to print at actual size', async () => {
    const portrait = await make(DEFAULT_GRID_SETTINGS);
    expect(portrait.layout.orientation).toBe('portrait');
    expect(portrait.pdf.pages).toHaveLength(2);
    for (const page of portrait.pdf.pages) {
      expect(page.mediaBox).toEqual([0, 0, 595.28, 841.89]);
      expect(close(page.widthMm, 210, 0.01) && close(page.heightMm, 297, 0.01)).toBe(true);
    }
    expect(portrait.pdf.printScalingNone).toBe(true);

    const landscape = await make({ ...DEFAULT_GRID_SETTINGS, canvasWidth: 70, canvasHeight: 50 });
    expect(landscape.layout.orientation).toBe('landscape');
    for (const page of landscape.pdf.pages) expect(page.mediaBox).toEqual([0, 0, 841.89, 595.28]);
    expect((await make(DEFAULT_GRID_SETTINGS, { orientation: 'landscape' })).pdf.pages[1].mediaBox).toEqual([0, 0, 841.89, 595.28]);
  });

  it('print the canvas at its true size when it fits, reduced to fit otherwise (never enlarged), inside the margins and above the footer', () => {
    const small = gridPrintLayout({ canvasWidth: 15, canvasHeight: 20, unit: 'cm' });
    expect(small.scale).toBe(1);
    expect(small.canvas).toEqual({ x: expect.closeTo(30, 9), y: expect.closeTo(38, 9), w: 150, h: 200 });
    const big = gridPrintLayout({ canvasWidth: 50, canvasHeight: 70, unit: 'cm' });
    expect(big.scale).toBeCloseTo(Math.min(184.6 / 500, 250.6 / 700), 12);
    const inches = gridPrintLayout({ canvasWidth: 16, canvasHeight: 20, unit: 'in' });
    expect(inches.scale).toBeCloseTo(Math.min(184.6 / 406.4, 250.6 / 508), 12);
    for (const l of [small, big, inches, gridPrintLayout(A4_3CM), gridPrintLayout({ canvasWidth: 120, canvasHeight: 35, unit: 'cm' })]) {
      expect(l.canvas.x).toBeGreaterThanOrEqual(SAFE_MARGIN_MM - 1e-9);
      expect(l.canvas.y).toBeGreaterThanOrEqual(SAFE_MARGIN_MM - 1e-9);
      expect(l.canvas.x + l.canvas.w).toBeLessThanOrEqual(l.page.w - SAFE_MARGIN_MM + 1e-9);
      expect(l.canvas.y + l.canvas.h).toBeLessThanOrEqual(l.footerTop + 1e-9);
      expect(l.scale).toBeLessThanOrEqual(1);
    }
  });
});

describe('both pages share one grid', () => {
  it('the photo fills exactly the canvas area on page 1, and both borders are that area', async () => {
    const { layout, pdf } = await make(A4_3CM);
    const [one, two] = pdf.pages;
    expect(one.images.filter((i) => i.name === 'I0')).toHaveLength(1);
    const photo = one.images.find((i) => i.w > 100)!;
    for (const [a, b] of [[photo.x, layout.canvas.x], [photo.y, layout.canvas.y], [photo.w, layout.canvas.w], [photo.h, layout.canvas.h]]) expect(close(a, b)).toBe(true);
    expect(two.images.every((i) => i.w < 100)).toBe(true);
    const border = (page: InspectedPage) => page.rects.map((r) => [r.x, r.y, r.w, r.h].map((v) => Math.round(v * 1e4) / 1e4));
    expect(border(one)).toEqual(border(two));
    expect(border(one)).toEqual([[layout.canvas.x, layout.canvas.y, layout.canvas.w, layout.canvas.h].map((v) => Math.round(v * 1e4) / 1e4)]);
  });

  it('the same lines at the same places, as vectors; only their colour differs', async () => {
    for (const gs of [DEFAULT_GRID_SETTINGS, A4_3CM, { ...DEFAULT_GRID_SETTINGS, columns: 7, rows: 11, lineColor: '#ef4444', rotation: 90 as const, imageScale: 2.5, imageOffsetX: 3 }]) {
      const { layout, pdf } = await make(gs);
      const [one, two] = pdf.pages.map((p) => gridStrokes(p, layout));
      expect(one.length).toBeGreaterThan(0);
      expect(geometry(one)).toEqual(geometry(two));
      expect(one.every((l) => sameColor(l.color, gs.lineColor))).toBe(true);
      expect(new Set(two.map((l) => l.color))).toEqual(new Set(['#000000']));
    }
  });

  it('columns × rows: lines at even divisions of the printed canvas', async () => {
    const { layout, pdf } = await make(DEFAULT_GRID_SETTINGS);
    const c = layout.canvas;
    const vertical = gridStrokes(pdf.pages[0], layout).filter((l) => close(l.x1, l.x2));
    expect(vertical.map((l) => l.x1)).toEqual([1, 2, 3].map((i) => expect.closeTo(c.x + (c.w * i) / 4, 3)));
    for (const l of vertical) expect(close(l.y1, c.y) && close(l.y2, c.y + c.h)).toBe(true);
  });

  it('square cells stay square on paper, partial cells at the right and bottom edges, the same on both pages', async () => {
    const { layout, pdf } = await make(A4_3CM);
    const c = layout.canvas;
    const cell = 30 * layout.scale; // 3 cm, as printed
    for (const page of pdf.pages) {
      const strokes = gridStrokes(page, layout);
      const xs = strokes.filter((l) => close(l.x1, l.x2)).map((l) => l.x1);
      const ys = strokes.filter((l) => close(l.y1, l.y2)).map((l) => l.y1);
      expect(xs).toEqual([1, 2, 3, 4, 5, 6].map((i) => expect.closeTo(c.x + i * cell, 3)));
      expect(ys).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => expect.closeTo(c.y + i * cell, 3)));
      // 21 cm is 7 whole cells; 29.7 cm leaves a partial row of 2.7 cm at the bottom.
      expect(close(c.x + c.w - xs[5], cell)).toBe(true);
      expect(close(c.y + c.h - ys[8], 27 * layout.scale)).toBe(true);
    }
    // At true size, a 2.5 cm square is 25 mm on paper exactly.
    const small = await make({ ...A4_3CM, canvasWidth: 15, canvasHeight: 20, cellSize: 2.5 });
    const xs = gridStrokes(small.pdf.pages[1], small.layout).filter((l) => close(l.x1, l.x2)).map((l) => l.x1);
    for (let i = 1; i < xs.length; i++) expect(close(xs[i] - xs[i - 1], 25)).toBe(true);
  });

  it('line width and opacity as on screen: in proportion to the printed width; the border a little stronger', async () => {
    const gs: GridSettings = { ...A4_3CM, lineWidth: 3, lineOpacity: 0.6, lineColor: '#3b82f6' };
    const { layout, pdf } = await make(gs);
    for (const page of pdf.pages) {
      for (const l of gridStrokes(page, layout)) {
        expect(close(l.width, gridLineWidthMm(gs, layout.canvas.w), 1e-4)).toBe(true);
        expect(l.opacity).toBe(0.6);
      }
      expect(page.rects[0].opacity).toBe(0.9);
    }
    expect(sameColor(gridStrokes(pdf.pages[0], layout)[0].color, '#3b82f6')).toBe(true);
    expect(gridLineWidthMm({ lineWidth: 1 }, 30)).toBe(0.1);
  });
});

describe('the 50 mm bar and the words', () => {
  it('a bar of exactly 50 mm with a mark at each end, on both pages, inside the margins', async () => {
    const { layout, pdf } = await make(DEFAULT_GRID_SETTINGS);
    for (const page of pdf.pages) {
      const bar = page.lines.filter((l) => l.y1 > layout.footerTop && close(l.y1, l.y2));
      expect(bar).toHaveLength(1);
      expect(Math.abs(bar[0].x2 - bar[0].x1)).toBeCloseTo(50, 3);
      expect(bar[0].color).toBe('#000000');
      const marks = page.lines.filter((l) => l.y1 > layout.footerTop && close(l.x1, l.x2));
      expect(marks.map((m) => m.x1).sort((a, b) => a - b)).toEqual([expect.closeTo(bar[0].x1, 4), expect.closeTo(bar[0].x2, 4)]);
      for (const m of marks) expect(Math.abs(m.y2 - m.y1)).toBeCloseTo(4, 4);
      expect(Math.min(bar[0].x1, bar[0].x2)).toBeGreaterThanOrEqual(SAFE_MARGIN_MM - 1e-9);
      expect(bar[0].y1).toBeLessThanOrEqual(page.heightMm - SAFE_MARGIN_MM);
    }
  });

  it('the page name, the scale, how to print, and the bar label sit in the footer within the margins; right to left mirrors them', async () => {
    const ltr = await make(DEFAULT_GRID_SETTINGS);
    expect(ltr.placedText.map((t) => t.text)).toEqual([
      'Reference with grid · 4×4 grid · true size', 'Print at 100% (Actual size).', '50 mm',
      'Blank grid · 4×4 grid · true size', 'Print at 100% (Actual size).', '50 mm',
    ]);
    for (const page of ltr.pdf.pages) {
      const text = page.images.filter((i) => i.w < 100);
      expect(text).toHaveLength(3);
      for (const t of text) {
        expect(t.y).toBeGreaterThan(ltr.layout.footerTop);
        expect(t.x).toBeGreaterThanOrEqual(SAFE_MARGIN_MM - 1e-9);
        expect(t.x + t.w).toBeLessThanOrEqual(page.widthMm - SAFE_MARGIN_MM + 1e-6);
      }
    }
    const rtl = await make(DEFAULT_GRID_SETTINGS, { rtl: true });
    // Right to left, each part ends with a right-to-left mark, so the parts keep their order (see footerLine).
    expect(rtl.placedText[0].text).toBe('Reference with grid\u200f · 4×4 grid\u200f · true size');
    expect(footerLine(['רשת 4\u200e×4', '35.8% מ־50\u200e×70 cm'], true)).toBe('רשת 4\u200e×4\u200f · 35.8% מ־50\u200e×70 cm');
    const page = rtl.pdf.pages[0];
    const lines = page.images.filter((i) => i.w < 100 && i.y < rtl.layout.bar.y - 3);
    for (const t of lines) expect(t.x + t.w).toBeCloseTo(page.widthMm - SAFE_MARGIN_MM, 2);
    const bar = page.lines.find((l) => l.y1 > rtl.layout.footerTop && close(l.y1, l.y2))!;
    expect(Math.max(bar.x1, bar.x2)).toBeCloseTo(210 - SAFE_MARGIN_MM, 3);
  });

  it('describes the scale: true size, or the percentage, and a square as printed', () => {
    expect(gridPrintDetail({ ...A4_3CM, canvasWidth: 15, canvasHeight: 20 }, gridPrintLayout({ canvasWidth: 15, canvasHeight: 20, unit: 'cm' }))).toMatchObject({ trueSize: true, percent: '100', cellOnPaperMm: '30' });
    const a4 = gridPrintLayout(A4_3CM);
    expect(gridPrintDetail(A4_3CM, a4)).toMatchObject({ trueSize: false, percent: '84.4', cellOnPaperMm: '25.3', across: 7, down: 10 });
  });
});
