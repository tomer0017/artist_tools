import { describe, expect, it } from 'vitest';
import { WIDTH_RATIO, aimAt, dockGeometry, geometryOf, holdPoints, signPlacement, type Measured } from './geometry';

// Where Sketchy may stand (ADR-0024): only beside the text, never above the
// top limit, smaller when the room is small, and mirrored in Hebrew.

const desktop: Measured = { width: 1152, floor: 240, textEnd: 480, topLimit: 8, rtl: false, narrow: false };
const phone: Measured = { width: 390, floor: 212, textEnd: 288, topLimit: 52, rtl: false, narrow: true };

describe('his room', () => {
  it('on a desktop: full size, several spots, all on the free side of the text', () => {
    const g = geometryOf(desktop, 100)!;
    expect(g.height).toBe(168);
    expect(g.spots.length).toBeGreaterThan(1);
    for (const x of g.spots) expect(x - g.width / 2).toBeGreaterThan(desktop.textEnd);
    for (const x of g.spots) expect(x + g.width / 2).toBeLessThanOrEqual(desktop.width);
    expect(g.facing).toBe('left');
    expect(g.offstage).toBeGreaterThan(desktop.width);
  });

  it('on a phone: smaller, one spot that fits beside the text and below the brand row', () => {
    const g = geometryOf(phone, 100)!;
    expect(g.compact).toBe(true);
    expect(g.width).toBeLessThanOrEqual(phone.width - phone.textEnd);
    expect(g.floor - g.height).toBeGreaterThanOrEqual(phone.topLimit);
    expect(g.spots[0] - g.width / 2).toBeGreaterThan(phone.textEnd);
  });

  it('in Hebrew: everything mirrored (the free side is the left)', () => {
    const g = geometryOf({ ...phone, rtl: true }, 100)!;
    expect(g.facing).toBe('right');
    expect(g.spots[0] + g.width / 2).toBeLessThan(phone.width - phone.textEnd);
    expect(g.offstage).toBeLessThan(0);
  });

  it('with too little room he is not placed at all', () => {
    expect(geometryOf({ ...phone, textEnd: 360 }, 100)).toBeNull();
    expect(geometryOf({ ...phone, topLimit: 180 }, 100)).toBeNull();
  });

  it('the admin size scales him, within the room', () => {
    expect(geometryOf(desktop, 70)!.height).toBe(Math.round(168 * 0.7));
    // 140% would be 235 px: the room above the floor (232 px) caps him.
    expect(geometryOf(desktop, 140)!.height).toBe(Math.min(Math.round(168 * 1.4), desktop.floor - desktop.topLimit));
    expect(geometryOf(phone, 140)!.width).toBeLessThanOrEqual(phone.width - phone.textEnd);
    expect(WIDTH_RATIO).toBeCloseTo(248 / 292);
  });
});

describe('his sign and his pointing', () => {
  it('held up on the post in his paw, beside his head: never over his face, as wide as the room allows', () => {
    // English: he stands at the right, facing left; the sign takes the room on his left.
    const fox = { left: 290, right: 375, top: 110, height: 100 };
    const hold = holdPoints({ left: 290, top: 110, width: 85, height: 100 }, 'left');
    const at = signPlacement(fox, 180, { width: 390, topLimit: 52, floor: 212 }, 'left');
    expect(at.below).toBe(false);
    expect(at.left).toBeGreaterThanOrEqual(8);
    // Its inner edge is the board's line just past his cheek (a third into his box from the side he faces).
    expect(at.left + at.width).toBeCloseTo(hold.inner, 0);
    expect(at.left + at.width).toBeLessThanOrEqual(fox.left + 85 * 0.36);
    expect(at.top).toBeGreaterThanOrEqual(52);
    // Its bottom rests on the post (which goes up behind the board), or comes down over his paw before
    // its text scrolls (here the room above his paw is short).
    const bottom = at.top + Math.min(180, at.maxHeight ?? 180);
    expect(bottom).toBeGreaterThanOrEqual(hold.post.y);
    expect(bottom).toBeLessThanOrEqual(hold.pawBottom + 1);
    expect(at.maxHeight).toBe(Math.round(hold.pawBottom - 52));
    // A sign that fits above the post sits on it; one a little taller comes down over his paw, unscrolled.
    const fits = signPlacement(fox, 100, { width: 390, topLimit: 52, floor: 212 }, 'left');
    expect(fits.top + 100).toBeCloseTo(hold.post.y + 6, 0);
    expect(fits.maxHeight).toBeNull();
    const taller = signPlacement(fox, 118, { width: 390, topLimit: 52, floor: 212 }, 'left');
    expect(taller).toMatchObject({ top: 52, maxHeight: null });
    // Hebrew: mirrored.
    const he = signPlacement({ left: 15, right: 100, top: 110, height: 100 }, 180, { width: 390, topLimit: 52, floor: 212 }, 'right');
    expect(he.left).toBeCloseTo(holdPoints({ left: 15, top: 110, width: 85, height: 100 }, 'right').inner, 0);
    expect(he.left).toBeGreaterThanOrEqual(15 + 85 * 0.64 - 1);
    expect(he.left + he.width).toBeLessThanOrEqual(390 - 8);
  });

  it('with no room above his paw it comes down from the top limit, never below his floor', () => {
    const at = signPlacement({ left: 290, right: 375, top: 110, height: 100 }, 180, { width: 390, topLimit: 150, floor: 212 }, 'left');
    expect(at).toMatchObject({ below: false, top: 150, maxHeight: 80 });
  });

  it('knows where his post and the board line are, mirrored with him', () => {
    const right = holdPoints({ left: 0, top: 0, width: 300 * (248 / 292) * 1.2, height: 360 * 1.2 }, 'right');
    const left = holdPoints({ left: 0, top: 0, width: 300 * (248 / 292) * 1.2, height: 360 * 1.2 }, 'left');
    expect(right.post.y).toBeCloseTo(190 * 1.2);
    expect(left.post.y).toBeCloseTo(right.post.y);
    expect(right.inner + left.inner).toBeCloseTo(300 * (248 / 292) * 1.2);
    expect(right.post.x).toBeGreaterThan(right.inner);
    expect(left.post.x).toBeLessThan(left.inner);
  });

  it('below his feet when the room beside him is too narrow', () => {
    const at = signPlacement({ left: 150, right: 235, top: 110, height: 100 }, 180, { width: 390, topLimit: 52, floor: 212 }, 'left');
    expect(at.below).toBe(true);
    expect(at.top).toBeGreaterThan(212);
    expect(at.left).toBeGreaterThanOrEqual(8);
    expect(at.left + at.width).toBeLessThanOrEqual(390 - 8);
  });

  it('on a desktop: a full-width sign beside him, below the top limit', () => {
    const at = signPlacement({ left: 960, right: 1103, top: 70, height: 168 }, 150, { width: 1152, topLimit: 8, floor: 238 }, 'left');
    expect(at).toMatchObject({ width: 300, below: false });
    expect(at.top).toBeGreaterThanOrEqual(8);
  });

  it('aims down toward a card below him, never wildly', () => {
    expect(aimAt({ x: 100, y: 100 }, { x: 300, y: 100 })).toBe(0);
    expect(aimAt({ x: 100, y: 100 }, { x: 100, y: 400 })).toBe(80);
    expect(aimAt({ x: 100, y: 100 }, { x: 200, y: -400 })).toBe(-35);
  });
});

describe('his floating corner', () => {
  // A phone: the scrolling area ends where the bottom bar begins.
  const phoneArea = { left: 0, right: 390, top: 47, bottom: 763 };

  it('on a phone: bigger than in the hero, at the end of the reading direction, above the bottom bar', () => {
    const g = dockGeometry(phoneArea, 390, false, true, 100);
    expect(g.height).toBeGreaterThanOrEqual(112);
    expect(g.height).toBeLessThanOrEqual(132);
    expect(g.floor).toBeLessThanOrEqual(763);
    expect(g.floor).toBeGreaterThan(763 - 12);
    expect(g.spots).toHaveLength(1);
    expect(g.spots[0] + g.width / 2).toBeLessThanOrEqual(390);
    expect(g.offstage).toBeGreaterThan(390 + g.width / 2);
    expect(g).toMatchObject({ facing: 'left', compact: true, topLimit: 47 + 8 });
  });

  it('in Hebrew: the left corner, facing right', () => {
    const g = dockGeometry(phoneArea, 390, true, true, 100);
    expect(g.spots[0] - g.width / 2).toBeGreaterThanOrEqual(0);
    expect(g.spots[0]).toBeLessThan(195);
    expect(g.offstage).toBeLessThan(-g.width / 2);
    expect(g.facing).toBe('right');
  });

  it('on a desktop: clear of the scrollbar (inside the scrolling area), scaled by the admin size', () => {
    const area = { left: 0, right: 1265, top: 56, bottom: 800 };
    const g = dockGeometry(area, 1280, false, false, 100);
    expect(g.height).toBe(150);
    expect(g.spots[0] + g.width / 2).toBeLessThanOrEqual(1265 - 8);
    expect(dockGeometry(area, 1280, false, false, 120).height).toBe(180);
  });
});
