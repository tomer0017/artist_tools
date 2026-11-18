import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_GRID_SETTINGS, type GridSettings, type GridRotation } from '@/types/project';
import { drawExport } from '@/lib/grid/draw';
import { exportSize, fillImageScale, imageRect } from '@/lib/grid/geometry';
import { gridPrintLayout } from './gridPdf';
import { REFERENCE_DPI, canvasTextRenderer, rasterizeReference, renderPdfPreview } from './gridPdfBrowser';

// The browser half of Create a Grid's PDF: the photo on page 1 is placed
// exactly as in the saved grid image (rotation, fit, fill, zoom, offsets),
// at 300 dpi of its printed size; the words are drawn in the page's
// direction, shrunk to fit; the save sheet's picture shows both pages.

type Call = [string, ...unknown[]];
const logs = new Map<HTMLCanvasElement, Call[]>();
function recorder(log: Call[]) {
  // Text is measured like a browser does: in proportion to the font size set (half an em per letter).
  let fontPx = 10;
  return new Proxy({} as Record<string, unknown>, {
    get: (_, prop) => {
      if (prop === 'measureText') return (text: string) => ({ width: text.length * fontPx * 0.5 });
      return typeof prop === 'string' ? (...args: unknown[]) => void log.push([prop, ...args]) : undefined;
    },
    set: (_, prop, value) => {
      if (prop === 'font') fontPx = Number(/([\d.]+)px/.exec(String(value))?.[1] ?? fontPx);
      log.push([`set ${String(prop)}`, value]);
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}
beforeEach(() => {
  logs.clear();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    if (!logs.has(this)) logs.set(this, []);
    return recorder(logs.get(this)!) as never;
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(() => 'data:image/png;base64,AAAA');
});
afterEach(() => vi.restoreAllMocks());

const photo = { source: {} as CanvasImageSource, naturalWidth: 1200, naturalHeight: 800 };
const placement = (log: Call[]) => log.slice(log.findIndex((c) => c[0] === 'clip') + 1, log.findIndex((c) => c[0] === 'restore'));

describe('the photo on page 1', () => {
  const cases: [string, Partial<GridSettings>][] = [
    ['as fitted', {}],
    ['zoomed and moved', { imageScale: 2.37, imageOffsetX: 3.3, imageOffsetY: -12.75 }],
    ['filling the canvas', { imageScale: fillImageScale(DEFAULT_GRID_SETTINGS, 1200, 800) }],
    ...([90, 180, 270] as GridRotation[]).map((rotation): [string, Partial<GridSettings>] => [`turned ${rotation}°`, { rotation, imageOffsetX: 2, imageScale: 1.4 }]),
    ['square cells on A4', { canvasWidth: 21, canvasHeight: 29.7, cellMode: 'square', cellSize: 3, rotation: 90 }],
  ];

  for (const [name, change] of cases) {
    it(`is placed exactly as in the saved grid image: ${name}`, () => {
      const gs: GridSettings = { ...DEFAULT_GRID_SETTINGS, ...change };
      const layout = gridPrintLayout(gs);
      const canvas = rasterizeReference(gs, photo, layout);
      const px = REFERENCE_DPI / 25.4;
      expect([canvas.width, canvas.height]).toEqual([Math.round(layout.canvas.w * px), Math.round(layout.canvas.h * px)]);
      const log = logs.get(canvas)!;
      // The saved image's background, then the photo clipped to the canvas, and no grid (the PDF draws it as vectors).
      expect(log.slice(0, 2)).toStrictEqual([['set fillStyle', '#2a2a2a'], ['fillRect', 0, 0, canvas.width, canvas.height]]);
      expect(log.some((c) => c[0] === 'moveTo' || c[0] === 'strokeRect')).toBe(false);
      // The same placement function as the saved grid image, at this size, exactly.
      const rect = imageRect(gs, 1200, 800, canvas.width / gs.canvasWidth, canvas.width, canvas.height);
      const placed = placement(log);
      if (rect.rotation === 0) {
        expect(placed).toStrictEqual([['drawImage', photo.source, rect.x, rect.y, rect.w, rect.h]]);
      } else {
        expect(placed).toStrictEqual([
          ['translate', rect.x + rect.boundsW / 2, rect.y + rect.boundsH / 2],
          ['rotate', (rect.rotation * Math.PI) / 180],
          ['drawImage', photo.source, -rect.w / 2, -rect.h / 2, rect.w, rect.h],
        ]);
      }
      // And relative to the canvas, where the saved PNG puts it (within half a pixel of either).
      const png = document.createElement('canvas');
      drawExport(png.getContext('2d')!, gs, photo);
      const { w: W, h: H } = exportSize(gs);
      const draw = (l: Call[]) => l.find((c) => c[0] === 'drawImage')! as [string, unknown, number, number, number, number];
      const [, , , , pw, ph] = draw(placement(logs.get(png)!));
      const [, , , , rw, rh] = draw(placed);
      expect(Math.abs(pw / W - rw / canvas.width)).toBeLessThan(0.5 / canvas.width + 0.5 / W);
      expect(Math.abs(ph / H - rh / canvas.height)).toBeLessThan(1 / canvas.height + 1 / H);
    });
  }
});

describe('the words and the picture', () => {
  it('words are drawn in the page direction, and shrunk to fit their width', async () => {
    const render = canvasTextRenderer({ rtl: true, fontFamily: 'Rubik, sans-serif' });
    const text = await render('להדפיס ב־100%', { sizeMm: 3, maxWidthMm: 5 });
    const log = [...logs.values()].at(-1)!;
    expect(log).toContainEqual(['set direction', 'rtl']);
    expect(log).toContainEqual(['set textAlign', 'right']);
    // At 3 mm (36 px) the 13 letters would be 234 px wide: shrunk to 5 mm (60 px at 12 px per mm), plus a little room.
    expect(text.wMm).toBeLessThanOrEqual(5 + 0.5);
    expect(text.data).toMatch(/^data:image\/png/);
    const ltr = canvasTextRenderer({ rtl: false, fontFamily: 'Rubik, sans-serif' });
    await ltr('50 mm', { sizeMm: 3, maxWidthMm: 40 });
    expect([...logs.values()].at(-1)!).toContainEqual(['set textAlign', 'left']);
  });

  it('the save sheet shows both pages: the photo only on the first', () => {
    const gs: GridSettings = { ...DEFAULT_GRID_SETTINGS };
    const layout = gridPrintLayout(gs);
    const reference = rasterizeReference(gs, photo, layout);
    const preview = renderPdfPreview(gs, layout, reference);
    expect(preview.width).toBe(Math.round(210 * 2.4) * 2 + 24);
    const draws = logs.get(preview)!.filter((c) => c[0] === 'drawImage');
    expect(draws).toHaveLength(1);
    expect(draws[0][1]).toBe(reference);
  });
});
