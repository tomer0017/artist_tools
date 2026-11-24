import { describe, expect, it } from 'vitest';
import { dockGeometry, dockHeight, holdPoints, signPlacement } from './geometry';

// Where Sketchy is (ADR-0024): his floating corner (mirrored in Hebrew, above a
// phone's bottom bar) and his sign on the post in his paw.


describe('his sign', () => {
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

describe('his size where he floats', () => {
  it('big enough to read his face on a phone, the standard size on a desktop, scaled by the admin', () => {
    expect(dockHeight(320, true, 100)).toBe(112);
    expect(dockHeight(390, true, 100)).toBe(117);
    expect(dockHeight(500, true, 100)).toBe(132);
    expect(dockHeight(1280, false, 100)).toBe(150);
    expect(dockHeight(1280, false, 80)).toBe(120);
  });
});
