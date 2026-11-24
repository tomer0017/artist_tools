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

/** His box's width for a height (the 300 × 360 artwork is centred in it, never stretched). */
export const WIDTH_RATIO = 248 / 292;
const MIN_HEIGHT = 64;
const GAP = 12;
const EDGE = 6;
/** His standard height: on phones big enough to read his face, where the room beside the text allows. */
export const BASE_HEIGHT = { narrow: 124, wide: 168 } as const;

export function geometryOf(m: Measured, sizePercent: number): Geometry | null {
  const base = (m.narrow ? BASE_HEIGHT.narrow : BASE_HEIGHT.wide) * (sizePercent / 100);
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

/** The artwork's frame and where the sign meets him while he holds it (raster-rig.tsx, sprite pixels, facing right). */
const SPRITE = { w: 300, h: 360 };
const HOLD = { post: { x: 235, y: 190 }, inner: 199, pawBottom: 228 };

/**
 * Where, on screen, the top of his sign's post and the inner edge of the board are while he
 * holds it: the artwork is centred in his box at its height, mirrored when he faces left.
 */
export function holdPoints(fox: { left: number; top: number; width: number; height: number }, facing: 'left' | 'right'): { post: { x: number; y: number }; inner: number; pawBottom: number } {
  const scale = fox.height / SPRITE.h;
  const offset = (fox.width - SPRITE.w * scale) / 2;
  const x = (sx: number) => (facing === 'left' ? fox.left + fox.width - (offset + sx * scale) : fox.left + offset + sx * scale);
  return { post: { x: x(HOLD.post.x), y: fox.top + HOLD.post.y * scale }, inner: x(HOLD.inner), pawBottom: fox.top + HOLD.pawBottom * scale };
}

/** The narrowest sign worth showing beside him (narrower: it goes below him instead). */
export const SIGN_MIN = 220;
export const SIGN_MAX = 300;
const MARGIN = 8;
/** Above his paw, a sign at least this tall (its text scrolls inside); otherwise it comes down over his side. */
const SIGN_MIN_HEIGHT = 110;

/**
 * Where the sign goes and how wide it is: held up beside his head on the side he faces, its
 * inner edge just past his cheek and its bottom on the top of the post in his paw (the post
 * goes up behind the board), never over his face or body; as wide as the room there allows;
 * kept between the top limit and his floor. Short of room above his paw it may come down over
 * the paw before its text has to scroll. With too little room beside him it goes just below
 * his feet instead (and he points down at it).
 */
export function signPlacement(
  fox: { left: number; right: number; top: number; height: number },
  signHeight: number,
  stage: { width: number; topLimit: number; floor: number },
  facing: 'left' | 'right',
): { left: number; top: number; width: number; below: boolean; maxHeight: number | null } {
  const hold = holdPoints({ left: fox.left, top: fox.top, width: fox.right - fox.left, height: fox.height }, facing);
  const room = facing === 'left' ? hold.inner - MARGIN : stage.width - hold.inner - MARGIN;
  if (room >= SIGN_MIN) {
    const width = Math.round(Math.min(SIGN_MAX, room));
    const left = facing === 'left' ? hold.inner - width : hold.inner;
    // What comes after the hero (the Pro banner, the tool cards) stays clear: never below his floor.
    const bottom = Math.min(hold.post.y + 6, stage.floor + 2);
    const lowest = Math.max(bottom, Math.min(hold.pawBottom, stage.floor + 2));
    const above = bottom - stage.topLimit;
    if (signHeight <= above) return { left: Math.round(left), top: Math.round(bottom - signHeight), width, below: false, maxHeight: null };
    if (signHeight <= lowest - stage.topLimit) return { left: Math.round(left), top: Math.round(stage.topLimit), width, below: false, maxHeight: null };
    if (lowest - stage.topLimit >= SIGN_MIN_HEIGHT) return { left: Math.round(left), top: Math.round(stage.topLimit), width, below: false, maxHeight: Math.round(lowest - stage.topLimit) };
    const available = Math.max(80, stage.floor + 2 - stage.topLimit);
    return { left: Math.round(left), top: Math.round(stage.topLimit), width, below: false, maxHeight: signHeight > available ? Math.round(available) : null };
  }
  const width = Math.round(Math.min(SIGN_MAX + 20, stage.width - 2 * MARGIN));
  const center = (fox.left + fox.right) / 2;
  const left = Math.min(Math.max(MARGIN, center - width / 2), stage.width - width - MARGIN);
  return { left: Math.round(left), top: Math.round(stage.floor + 6), width, below: true, maxHeight: null };
}

/**
 * His floating place once the page scrolls past his spot: in the scrolling area's bottom corner
 * at the end of the reading direction (right in English, left in Hebrew), on screen
 * coordinates, so above a phone's bottom bar (the area ends where the bar begins) and clear of
 * the scrollbar. Bigger than in a phone's hero, where the text leaves him less room.
 */
export function dockGeometry(
  area: { left: number; right: number; top: number; bottom: number },
  viewportWidth: number,
  rtl: boolean,
  narrow: boolean,
  sizePercent: number,
): Geometry & { topLimit: number } {
  const standard = narrow ? Math.min(132, Math.max(112, viewportWidth * 0.3)) : 150;
  const height = Math.round(standard * (sizePercent / 100));
  const width = height * WIDTH_RATIO;
  const gap = narrow ? 4 : 16;
  const x = rtl ? area.left + gap + width / 2 : area.right - gap - width / 2;
  return {
    height,
    width,
    // The artwork leaves a little room under his feet.
    floor: area.bottom - (narrow ? 2 : 10),
    spots: [x],
    offstage: rtl ? -width / 2 - 4 : viewportWidth + width / 2 + 4,
    facing: rtl ? 'right' : 'left',
    compact: true,
    topLimit: area.top + 8,
  };
}

/** The angle (degrees, 0 = ahead, 90 = straight down) from his shoulder to a target, for pointing. */
export function aimAt(shoulder: { x: number; y: number }, target: { x: number; y: number }): number {
  const dx = Math.abs(target.x - shoulder.x);
  const dy = target.y - shoulder.y;
  const deg = (Math.atan2(dy, Math.max(1, dx)) * 180) / Math.PI;
  return Math.round(Math.max(-35, Math.min(80, deg)));
}
