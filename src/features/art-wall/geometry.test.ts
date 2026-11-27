import { describe, expect, it } from 'vitest';
import { fittedQuad, quadMeta, defaultQuad, outerCm } from './placement';
import { cropRatio, fitCrop, rotatedSize } from './render/artwork';
import { frameGeometry } from './render/frame';
import { apply3, invert3, isConvex, squareToQuad } from './render/photo';
import { interiorScale } from './render/interior';
import { placeFrame } from './render/scene';
import { newProject, type Pt } from './types';

const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('Art on Your Wall geometry', () => {
  it('keeps the sofa at one size whatever the artwork\'s size, the artwork in view and the sofa in front', () => {
    const p = { ...newProject('scale', 'scale'), space: { ...newProject('scale', 'scale').space, mode: 'room' as const } };
    for (const [W, H] of [[1200, 800], [800, 1000]]) {
      // The artwork's size never changes the room's scale: the sofa keeps its size.
      const scales = [50, 120, 250].map((width) => interiorScale(p, W, H, width, width).s);
      scales.forEach((s) => close(s, scales[0]));
      // Nor does the sofa's own size; the artwork only moves up with the sofa's back.
      const v = interiorScale(p, W, H, 80, 80);
      const big = interiorScale({ ...p, space: { ...p.space, room: { ...p.space.room, sofaScale: 1.3 } } }, W, H, 80, 80);
      close(big.s, v.s);
      expect(big.artBottom).toBeLessThan(v.artBottom);
      // A very large piece stays in view: its top inside the picture, its width within it.
      for (const width of [50, 250]) {
        const project = { ...p, artwork: { ...p.artwork, widthCm: width, heightCm: width } };
        const { place } = placeFrame(project, project.frame, W, H);
        expect(place.y).toBeGreaterThanOrEqual(0);
        expect(place.w).toBeLessThan(W);
      }
    }
  });
  it('maps the unit square exactly onto any convex quad, and back', () => {
    const quad: [Pt, Pt, Pt, Pt] = [{ x: 10, y: 20 }, { x: 210, y: 35 }, { x: 190, y: 260 }, { x: 25, y: 240 }];
    const h = squareToQuad(quad);
    [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([u, v], i) => {
      const p = apply3(h, u, v);
      close(p.x, quad[i].x);
      close(p.y, quad[i].y);
    });
    const back = apply3(invert3(h), quad[2].x, quad[2].y);
    close(back.x, 1);
    close(back.y, 1);
    expect(isConvex(quad)).toBe(true);
    expect(isConvex([quad[0], quad[2], quad[1], quad[3]])).toBe(false);
  });

  it('frames add their face, mat and gap on every side', () => {
    const p = newProject('t', 't');
    expect(frameGeometry(50, 40, { ...p.frame, type: 'classic', widthCm: 3, mat: { enabled: true, widthCm: 5, color: '#fff' } })).toMatchObject({ outerW: 66, outerH: 56 });
    expect(frameGeometry(50, 40, { ...p.frame, type: 'floating', widthCm: 1, gapCm: 2 })).toMatchObject({ outerW: 56, outerH: 46 });
    expect(frameGeometry(50, 40, { ...p.frame, type: 'frameless' })).toMatchObject({ outerW: 50, outerH: 40 });
  });

  it('a fixed crop shape keeps its ratio in the rotated image', () => {
    const crop = fitCrop(4000, 3000, { aspect: '4:5', custom: { w: 1, h: 1 }, rotation: 0, x: 0, y: 0, w: 1, h: 1 }, 4 / 5);
    close(cropRatio(4000, 3000, crop), 0.8, 1e-9);
    const r = rotatedSize(100, 50, 90);
    close(r.w, 50);
    close(r.h, 100);
  });

  it('a placed piece keeps its new proportions and size when the frame changes', () => {
    const p = newProject('t', 't');
    const photo = { w: 4000, h: 3000 };
    const placed = { ...p, space: { ...p.space, mode: 'photo' as const, photo: { ...p.space.photo, quad: defaultQuad(p, photo), ...quadMeta(p) } } };
    const wider = { ...placed, frame: { ...placed.frame, mat: { ...placed.frame.mat, widthCm: placed.frame.mat.widthCm + 10 } } };
    const q = fittedQuad(wider, photo)!;
    const o = outerCm(wider);
    const w = Math.hypot((q[1].x - q[0].x) * photo.w, (q[1].y - q[0].y) * photo.h);
    const h = Math.hypot((q[3].x - q[0].x) * photo.w, (q[3].y - q[0].y) * photo.h);
    close(h / w, o.h / o.w, 1e-6);
    // Wider by the mat: the piece on the photo grows with it.
    const before = fittedQuad(placed, photo)!;
    expect(q[1].x - q[0].x).toBeGreaterThan(before[1].x - before[0].x);
  });
});
