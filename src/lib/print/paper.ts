// ─── Print: paper ─────────────────────────────────────────────────────────────
// A4 (ISO 216) exactly, in millimetres, and how far from the edges anything is
// placed. Home printers cannot print the outer 3–5 mm (sometimes more), so
// everything stays at least 12.7 mm (half an inch) inside the page.

export type Orientation = 'portrait' | 'landscape';

/** A4: 210 × 297 mm. */
export const A4_MM = { short: 210, long: 297 } as const;

/** PDF points per millimetre (72 points to the inch). */
export const PT_PER_MM = 72 / 25.4;

/** Nothing closer to any edge than this. */
export const SAFE_MARGIN_MM = 12.7;

/** The calibration bar: printed at 100 %, it measures exactly this. */
export const CALIBRATION_MM = 50;

/** The page in millimetres, portrait or landscape. */
export function pageMm(orientation: Orientation): { w: number; h: number } {
  return orientation === 'portrait' ? { w: A4_MM.short, h: A4_MM.long } : { w: A4_MM.long, h: A4_MM.short };
}

export const mmToPt = (mm: number): number => mm * PT_PER_MM;
