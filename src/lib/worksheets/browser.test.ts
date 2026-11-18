import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_GRID_SETTINGS, type GridSettings } from '@/types/project';
import { exportSize } from '@/lib/grid/geometry';
import { DESKTOP_LIMITS, previewSize } from '@/lib/sketch/sizing';
import { DEFAULT_CONTROLS } from '@/lib/sketch/styles';
import { outlineSize, photoRect } from './sheets';

// Making a set in the browser: the sheets in order, one canvas at a time and
// freed; the outline traced by the sketch engine as Study traces it (its own
// worker, shut down afterwards); the values by the Values algorithm in gray,
// drawn without smoothing so only the study's grays reach the sheet.

const sketch = vi.hoisted(() => ({
  load: vi.fn(),
  paths: vi.fn(async () => ({ width: 1500, height: 1000, layers: [{ d: 'M0 0L1 1', fill: '#000000', loops: 1 }] })),
  dispose: vi.fn(),
  drawPaths: vi.fn(),
}));
const photo = vi.hoisted(() => ({ naturalWidth: 1200, naturalHeight: 800, isPhoto: true }));
vi.mock('@/lib/sketch/browser', () => ({
  decodeImage: vi.fn(async () => photo),
  readPixels: vi.fn((_img: unknown, size: { width: number; height: number }) => new Uint8ClampedArray(size.width * size.height * 4)),
  drawPaths: sketch.drawPaths,
  encodePng: vi.fn(),
  isConstrainedDevice: () => false,
  sketchLimits: () => DESKTOP_LIMITS,
  spawnSketchWorker: vi.fn(),
}));
vi.mock('@/lib/sketch/client', () => ({
  SketchClient: class {
    load = sketch.load;
    paths = sketch.paths;
    dispose = sketch.dispose;
  },
}));
const values = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock('@/lib/values/posterize', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/values/posterize')>();
  return {
    ...real,
    studyValues: (...args: Parameters<typeof real.studyValues>) => {
      values.calls.push(args[3]);
      return real.studyValues(...args);
    },
  };
});
vi.mock('@/lib/saveMedia', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/saveMedia')>()),
  canvasToBlob: vi.fn(async (c: HTMLCanvasElement) => new Blob([`${c.width}x${c.height}`], { type: 'image/png' })),
}));

import { makeWorksheets } from './browser';

type Call = [string, ...unknown[]];
const logs = new Map<HTMLCanvasElement, Call[]>();
const created: HTMLCanvasElement[] = [];
function recorder(canvas: HTMLCanvasElement) {
  const log = logs.get(canvas)!;
  return new Proxy({} as Record<string, unknown>, {
    get: (_, prop) => {
      if (prop === 'getImageData') return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4).fill(200), width: w, height: h });
      return typeof prop === 'string' ? (...args: unknown[]) => void log.push([prop, ...args]) : undefined;
    },
    set: (_, prop, value) => {
      log.push([`set ${String(prop)}`, value]);
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

beforeEach(() => {
  logs.clear();
  created.length = 0;
  values.calls.length = 0;
  vi.clearAllMocks();
  const make = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    const el = make(tag);
    if (tag === 'canvas') created.push(el as HTMLCanvasElement);
    return el;
  }) as typeof document.createElement);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    if (!logs.has(this)) logs.set(this, []);
    return recorder(this) as never;
  });
});
afterEach(() => vi.restoreAllMocks());

const gs: GridSettings = { ...DEFAULT_GRID_SETTINGS, rotation: 90, imageScale: 1.3 };
const sheetCanvases = () => created.filter((c) => logs.get(c)?.some((call) => call[0] === 'fillRect' && call[3] === exportSize(gs).w));

describe('making a set', () => {
  it('makes the chosen sheets in order, at the grid image’s size, named, with progress, each canvas freed', async () => {
    const progress: [number, number][] = [];
    const sheets = await makeWorksheets('data:image/png;base64,AAAA', {
      gs,
      sheets: ['values', 'grid', 'original', 'outline'],
      levels: 3,
      outline: DEFAULT_CONTROLS,
      onProgress: (done, total) => progress.push([done, total]),
    });
    const { w, h } = exportSize(gs);
    expect(sheets.map((s) => [s.kind, s.filename, s.width, s.height])).toEqual([
      ['original', 'worksheet-1-original-50x70cm.png', w, h],
      ['outline', 'worksheet-2-outline-50x70cm.png', w, h],
      ['grid', 'worksheet-3-grid-4x4-50x70cm.png', w, h],
      ['values', 'worksheet-4-values-3-50x70cm.png', w, h],
    ]);
    expect(new TextDecoder().decode(await sheets[0].blob.arrayBuffer())).toBe(`${w}x${h}`);
    expect(sheets.every((s) => s.thumbnail instanceof Blob)).toBe(true);
    expect(progress).toEqual([[0, 4], [1, 4], [2, 4], [3, 4], [4, 4]]);
    // Every canvas, sheets and pictures and thumbnails alike, is shrunk to nothing afterwards.
    expect(created.length).toBeGreaterThanOrEqual(10);
    for (const c of created) expect([c.width, c.height]).toEqual([0, 0]);
  });

  it('traces the outline as Study does, in a worker of its own that is shut down, and draws its paths where the photo goes', async () => {
    await makeWorksheets('data:image/png;base64,AAAA', { gs, sheets: ['outline'], levels: 5, outline: { lineWeight: 60, detail: 40, shading: 50 } });
    const working = previewSize({ width: 1200, height: 800 }, DESKTOP_LIMITS);
    expect(sketch.load).toHaveBeenCalledWith(expect.any(Uint8ClampedArray), working.width, working.height, false);
    expect(sketch.paths).toHaveBeenCalledWith({ lineWeight: 60, detail: 40, shading: 50 });
    expect(sketch.dispose).toHaveBeenCalledTimes(1);
    const rect = photoRect(gs, photo);
    const size = outlineSize({ width: 1500, height: 1000 }, rect, DESKTOP_LIMITS);
    expect(sketch.drawPaths).toHaveBeenCalledWith(expect.anything(), [{ d: 'M0 0L1 1', fill: '#000000', loops: 1 }], { width: 1500, height: 1000 }, size);
    // On the sheet: white paper, the outline turned and placed like the photo.
    const sheet = logs.get(sheetCanvases()[0])!;
    expect(sheet.slice(0, 2)).toStrictEqual([['set fillStyle', '#ffffff'], ['fillRect', 0, 0, exportSize(gs).w, exportSize(gs).h]]);
    const draw = sheet.find((c) => c[0] === 'drawImage')!;
    expect(draw.slice(2)).toEqual([-rect.w / 2, -rect.h / 2, rect.w, rect.h]);
    expect((draw[1] as HTMLCanvasElement).tagName).toBe('CANVAS');
  });

  it('shuts the outline’s worker down when tracing fails, and makes nothing more', async () => {
    sketch.paths.mockRejectedValueOnce(new Error('worker stopped'));
    await expect(makeWorksheets('data:image/png;base64,AAAA', { gs, sheets: ['outline', 'grid'], levels: 5, outline: DEFAULT_CONTROLS })).rejects.toThrow('worker stopped');
    expect(sketch.dispose).toHaveBeenCalledTimes(1);
    for (const c of created) expect([c.width, c.height]).toEqual([0, 0]);
  });

  it('studies the values in gray, at Study’s neutral contrast and brightness, and puts only their grays on the sheet', async () => {
    await makeWorksheets('data:image/png;base64,AAAA', { gs, sheets: ['values'], levels: 3, outline: DEFAULT_CONTROLS });
    expect(values.calls).toEqual([{ mode: 'grayscale', levels: 3, focus: 'none', contrast: 100, brightness: 100, isolatedIdx: null }]);
    const sheet = logs.get(sheetCanvases()[0])!;
    const smoothingOff = sheet.findIndex((c) => c[0] === 'set imageSmoothingEnabled' && c[1] === false);
    expect(smoothingOff).toBeGreaterThan(-1);
    expect(smoothingOff).toBeLessThan(sheet.findIndex((c) => c[0] === 'drawImage'));
  });

  it('stops between sheets when the sheet is closed', async () => {
    const stop = new AbortController();
    const made = makeWorksheets('data:image/png;base64,AAAA', {
      gs,
      sheets: ['original', 'grid', 'blank'],
      levels: 5,
      outline: DEFAULT_CONTROLS,
      signal: stop.signal,
      onProgress: (done) => {
        if (done === 1) stop.abort();
      },
    });
    await expect(made).rejects.toThrow('The sheets were not made');
  });
});
