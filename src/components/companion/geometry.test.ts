import { describe, expect, it } from 'vitest';
import { WIDTH_RATIO, aimAt, geometryOf, signPlacement, type Measured } from './geometry';

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
  it('beside him on a phone, as wide as the room allows, never over his head or body', () => {
    // English: he stands at the right, facing left; the sign takes the room on his left.
    const fox = { left: 290, right: 375, top: 110, height: 100 };
    const at = signPlacement(fox, 180, { width: 390, topLimit: 52, floor: 212 }, 'left');
    expect(at.below).toBe(false);
    expect(at.left).toBeGreaterThanOrEqual(8);
    expect(at.left + at.width).toBeLessThanOrEqual(fox.left + (fox.right - fox.left) * 0.16 + 1);
    expect(at.top).toBeGreaterThanOrEqual(52);
    // Never below his floor: the Pro banner and the tool cards after the hero stay clear.
    expect(at.top + Math.min(180, at.maxHeight ?? 180)).toBeLessThanOrEqual(212 + 2);
    expect(at.maxHeight).toBe(212 + 2 - 52);
    // Hebrew: mirrored.
    const he = signPlacement({ left: 15, right: 100, top: 110, height: 100 }, 180, { width: 390, topLimit: 52, floor: 212 }, 'right');
    expect(he.left).toBeGreaterThanOrEqual(100 - 85 * 0.16 - 1);
    expect(he.left + he.width).toBeLessThanOrEqual(390 - 8);
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
