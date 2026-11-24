// ─── Where Sketchy may stand (ADR-0024) ───────────────────────────────────────
// Pure: from what the stage measured of the page (its width, the floor line,
// where the text ends, how high he may reach) to his size and the free spots
// he walks between. He stands only on the "end" side of the text (right in
// English, left in Hebrew), never over it, never above the top limit (the
// brand and account row on phones), and gets smaller when the room is small;
// with too little room he only peeks (compact) and does not walk around.

export interface Measured {
  /** The stage's width (CSS px). */
  width: number;
  /** The line he stands on, from the stage's top. */
  floor: number;
  /** How far the text reaches into the stage: its end edge in the reading direction (from the stage's start). */
  textEnd: number;
  /** He never reaches above this line (from the stage's top). */
  topLimit: number;
  rtl: boolean;
  /** A phone-sized screen. */
  narrow: boolean;
}

export interface Geometry {
  /** His height and width (CSS px). */
  height: number;
  width: number;
  floor: number;
  /** The centres (x from the stage's left) of the places he may stand, nearest the end edge first. */
  spots: number[];
  /** Where he walks in from and out to (just beyond the end edge). */
  offstage: number;
  /** Which way he faces when standing (toward the text, the middle of the page). */
  facing: 'left' | 'right';
  /** Too little room to walk around: he stays at his one spot. */
  compact: boolean;
}

/** His width for a height (the figure's view box). */
export const WIDTH_RATIO = 248 / 292;
const MIN_HEIGHT = 64;
const GAP = 12;
const EDGE = 6;

export function geometryOf(m: Measured, sizePercent: number): Geometry | null {
  const base = (m.narrow ? 104 : 168) * (sizePercent / 100);
  const free = Math.max(0, m.width - m.textEnd - GAP - EDGE);
  const tallest = Math.max(0, m.floor - m.topLimit);
  const height = Math.round(Math.min(base, tallest, free / WIDTH_RATIO));
  if (height < MIN_HEIGHT) return null;
  const width = height * WIDTH_RATIO;
  // Free room measured from the end edge inwards: spots at the end, the middle of the room, and its start.
  const room = free - width;
  const fromEnd = [EDGE + width / 2];
  if (room > width * 1.2) fromEnd.push(EDGE + width / 2 + room / 2);
  if (room > width * 2.6) fromEnd.push(EDGE + width / 2 + room - width * 0.2);
  const toX = (d: number) => (m.rtl ? d : m.width - d);
  return {
    height,
    width,
    floor: m.floor,
    spots: fromEnd.map(toX),
    offstage: m.rtl ? -width / 2 - 4 : m.width + width / 2 + 4,
    facing: m.rtl ? 'right' : 'left',
    compact: fromEnd.length === 1,
  };
}

/** The narrowest sign worth showing beside him (narrower: it goes below him instead). */
export const SIGN_MIN = 220;
export const SIGN_MAX = 300;
const MARGIN = 8;

/**
 * Where the sign goes and how wide it is: beside him on the side he faces,
 * covering at most his outer paw (where he holds its post), never his head
 * or body; as wide as the room there allows; kept below the top limit. With
 * too little room beside him it goes just below his feet instead.
 */
export function signPlacement(
  fox: { left: number; right: number; top: number; height: number },
  signHeight: number,
  stage: { width: number; topLimit: number; floor: number },
  facing: 'left' | 'right',
): { left: number; top: number; width: number; below: boolean; maxHeight: number | null } {
  const paw = (fox.right - fox.left) * 0.16;
  const room = facing === 'left' ? fox.left + paw - MARGIN : stage.width - (fox.right - paw) - MARGIN;
  if (room >= SIGN_MIN) {
    const width = Math.round(Math.min(SIGN_MAX, room));
    const left = facing === 'left' ? fox.left + paw - width : fox.right - paw;
    // Between the top limit and his floor: what comes after the hero (the Pro banner, the tool cards) stays clear.
    const available = Math.max(80, stage.floor + 2 - stage.topLimit);
    const height = Math.min(signHeight, available);
    const want = fox.top + fox.height * 0.1 - 16;
    const top = Math.max(stage.topLimit, Math.min(want, stage.floor + 2 - height));
    return { left: Math.round(Math.max(MARGIN, left)), top: Math.round(top), width, below: false, maxHeight: signHeight > available ? Math.round(available) : null };
  }
  const width = Math.round(Math.min(SIGN_MAX + 20, stage.width - 2 * MARGIN));
  const center = (fox.left + fox.right) / 2;
  const left = Math.min(Math.max(MARGIN, center - width / 2), stage.width - width - MARGIN);
  return { left: Math.round(left), top: Math.round(stage.floor + 6), width, below: true, maxHeight: null };
}

/** The angle (degrees, 0 = ahead, 90 = straight down) from his shoulder to a target, for pointing. */
export function aimAt(shoulder: { x: number; y: number }, target: { x: number; y: number }): number {
  const dx = Math.abs(target.x - shoulder.x);
  const dy = target.y - shoulder.y;
  const deg = (Math.atan2(dy, Math.max(1, dx)) * 180) / Math.PI;
  return Math.round(Math.max(-35, Math.min(80, deg)));
}
