import { describe, expect, it } from 'vitest';
import { DEFAULT_GRID_SETTINGS, type GridSettings } from '@/types/project';
import { A4_CM, cellCounts, divisionLines, exportSize, fillImageScale, gridLines, imageRect, rotatedSize, squareLines, turn } from './geometry';

// Create a Grid's geometry: the lines and the image's place, for the
// preview, the saved image and the blank grid.

const a4 = (portrait = true): GridSettings => ({
  ...DEFAULT_GRID_SETTINGS,
  canvasWidth: portrait ? A4_CM.short : A4_CM.long,
  canvasHeight: portrait ? A4_CM.long : A4_CM.short,
  unit: 'cm',
});

describe('columns × rows', () => {
  it('divides each side evenly, as always', () => {
    expect(divisionLines(4, 2400)).toEqual([600, 1200, 1800]);
    expect(divisionLines(3, 1000)).toEqual([333, 667]);
    expect(divisionLines(1, 500)).toEqual([]);
  });
});

describe('square cells', () => {
  it('are squares in canvas units, from the top-left corner, with a partial cell at the far edge', () => {
    const gs: GridSettings = { ...a4(), cellMode: 'square', cellSize: 3 };
    const { w, h } = exportSize(gs);
    expect({ w, h }).toEqual({ w: 2400, h: 3394 });
    const lines = gridLines(gs, w, h);
    // 21 cm wide: 7 whole cells, so 6 lines and no partial cell.
    expect(lines.xs).toEqual([343, 686, 1029, 1371, 1714, 2057]);
    // 29.7 cm tall: 9 whole cells and a partial one (2.7 cm).
    expect(lines.ys).toHaveLength(9);
    expect(lines.ys[0]).toBe(Math.round((3 / 29.7) * 3394));
    expect(lines.ys[8]).toBe(Math.round((27 / 29.7) * 3394));
    expect(cellCounts(gs)).toEqual({ across: 7, down: 10, partial: true });
    // The same cell in pixels across and down (within rounding): square on paper.
    const across = lines.xs[1] - lines.xs[0];
    const down = lines.ys[1] - lines.ys[0];
    expect(Math.abs(across - down)).toBeLessThanOrEqual(1);
  });

  it('never draws a line on the border when the side is a whole number of cells, whatever the rounding', () => {
    expect(squareLines(0.3, 0.9, 900)).toHaveLength(2);
    expect(squareLines(0.1, 29.7, 3394)).toHaveLength(296);
    expect(squareLines(5, 20, 2400)).toEqual([600, 1200, 1800]);
    expect(cellCounts({ ...DEFAULT_GRID_SETTINGS, canvasWidth: 20, canvasHeight: 30, cellMode: 'square', cellSize: 5 })).toEqual({ across: 4, down: 6, partial: false });
  });

  it('a cell larger than the canvas is one cell; nonsense sizes draw no lines', () => {
    expect(squareLines(100, 21, 2400)).toEqual([]);
    expect(squareLines(0, 21, 2400)).toEqual([]);
    expect(squareLines(-3, 21, 2400)).toEqual([]);
    expect(squareLines(Number.NaN, 21, 2400)).toEqual([]);
    expect(squareLines(1e-6, 21, 2400)).toHaveLength(1000);
  });

  it('columns × rows mode ignores the cell size', () => {
    expect(gridLines({ ...DEFAULT_GRID_SETTINGS, cellSize: 1 }, 2400, 3360)).toEqual({ xs: [600, 1200, 1800], ys: [840, 1680, 2520] });
    expect(cellCounts(DEFAULT_GRID_SETTINGS)).toEqual({ across: 4, down: 4, partial: false });
  });
});

describe('A4', () => {
  it('is exactly 21 × 29.7 cm, portrait or landscape', () => {
    expect(A4_CM).toEqual({ short: 21, long: 29.7 });
    expect(exportSize(a4(false))).toEqual({ w: 2400, h: Math.round(2400 / (29.7 / 21)) });
  });
});

describe('rotation', () => {
  it('turns left, right and half way round', () => {
    expect(turn(0, 90)).toBe(90);
    expect(turn(0, -90)).toBe(270);
    expect(turn(270, 90)).toBe(0);
    expect(turn(90, 180)).toBe(270);
    expect(turn(180, 180)).toBe(0);
    expect(rotatedSize(1200, 800, 90)).toEqual({ w: 800, h: 1200 });
    expect(rotatedSize(1200, 800, 180)).toEqual({ w: 1200, h: 800 });
  });

  it('fits and fills the image as it is turned, and keeps it where it was moved to', () => {
    const gs = { ...DEFAULT_GRID_SETTINGS, rotation: 90 as const, imageOffsetX: 5, imageOffsetY: -2 };
    const rect = imageRect(gs, 1200, 800, 10, 500, 700);
    // Turned, the image is 800 wide × 1200 tall: it fits the 70 cm height.
    expect(rect.boundsH).toBeCloseTo(700, 9);
    expect(rect.boundsW).toBeCloseTo((800 / 1200) * 700, 9);
    expect(rect.x + rect.boundsW / 2).toBeCloseTo(250 + 50, 9);
    expect(rect.y + rect.boundsH / 2).toBeCloseTo(350 - 20, 9);
    // Fill: the turned image covers the whole canvas.
    const fill = fillImageScale(gs, 1200, 800);
    const filled = imageRect({ ...gs, imageScale: fill }, 1200, 800, 10, 500, 700);
    expect(filled.boundsW).toBeGreaterThanOrEqual(500 - 1e-9);
    expect(filled.boundsH).toBeGreaterThanOrEqual(700 - 1e-9);
    expect(Math.min(filled.boundsW - 500, filled.boundsH - 700)).toBeCloseTo(0, 9);
  });
});
