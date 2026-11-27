// My Room: where the framed piece sits on the photo. Corners are kept 0…1 of
// the photo; geometry (scale, rotation, real size) is done in photo pixels.

import { frameGeometry } from './render/frame';
import { isRound, type Pt, type WallProject } from './types';

export type Quad = [Pt, Pt, Pt, Pt];
type Size = { w: number; h: number };

const toPx = (q: Quad, s: Size): Quad => q.map((p) => ({ x: p.x * s.w, y: p.y * s.h })) as Quad;
const toUnit = (q: Quad, s: Size): Quad => q.map((p) => ({ x: p.x / s.w, y: p.y / s.h })) as Quad;
const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);

export const centroid = (q: Quad): Pt => ({ x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4, y: (q[0].y + q[1].y + q[2].y + q[3].y) / 4 });

/** The framed piece's outer size, cm. */
export function outerCm(project: WallProject): { w: number; h: number } {
  const round = isRound(project.artwork);
  const g = frameGeometry(project.artwork.widthCm, round ? project.artwork.widthCm : project.artwork.heightCm, project.frame);
  return { w: g.outerW, h: round ? g.outerW : g.outerH };
}

/** Photo pixels per centimetre from the calibration, if set. */
export function pxPerCm(project: WallProject, photo: Size): number | null {
  const cal = project.space.photo.calibration;
  if (!cal || cal.cm <= 0) return null;
  const d = dist({ x: cal.a.x * photo.w, y: cal.a.y * photo.h }, { x: cal.b.x * photo.w, y: cal.b.y * photo.h });
  return d > 1 ? d / cal.cm : null;
}

/** A level rectangle of the piece's size (real size when calibrated) centred at `at` (0…1). */
export function defaultQuad(project: WallProject, photo: Size, at: Pt = { x: 0.5, y: 0.42 }): Quad {
  const outer = outerCm(project);
  const k = pxPerCm(project, photo);
  const w = k ? outer.w * k : photo.w * 0.3;
  const h = w * (outer.h / outer.w);
  const cx = at.x * photo.w;
  const cy = at.y * photo.h;
  return toUnit([{ x: cx - w / 2, y: cy - h / 2 }, { x: cx + w / 2, y: cy - h / 2 }, { x: cx + w / 2, y: cy + h / 2 }, { x: cx - w / 2, y: cy + h / 2 }], photo);
}

export function scaleQuad(q: Quad, k: number, photo: Size): Quad {
  const px = toPx(q, photo);
  const c = centroid(px);
  return toUnit(px.map((p) => ({ x: c.x + (p.x - c.x) * k, y: c.y + (p.y - c.y) * k })) as Quad, photo);
}

export function rotateQuad(q: Quad, degrees: number, photo: Size): Quad {
  const px = toPx(q, photo);
  const c = centroid(px);
  const a = (degrees * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return toUnit(px.map((p) => ({ x: c.x + (p.x - c.x) * cos - (p.y - c.y) * sin, y: c.y + (p.x - c.x) * sin + (p.y - c.y) * cos })) as Quad, photo);
}

export const translateQuad = (q: Quad, dx: number, dy: number): Quad => q.map((p) => ({ x: p.x + dx, y: p.y + dy })) as Quad;

/** The top edge's angle, degrees. */
export function quadAngle(q: Quad, photo: Size): number {
  const px = toPx(q, photo);
  return (Math.atan2(px[1].y - px[0].y, px[1].x - px[0].x) * 180) / Math.PI;
}

/** The piece's width on the photo, px (mean of top and bottom edges). */
export function quadWidth(q: Quad, photo: Size): number {
  const px = toPx(q, photo);
  return (dist(px[0], px[1]) + dist(px[3], px[2])) / 2;
}

/**
 * The corners to draw with: the saved ones, kept to the piece's current
 * proportions and size (a mat, a wider frame or new dimensions change them;
 * the top edge stays where it was put).
 */
export function fittedQuad(project: WallProject, photo: Size): Quad | null {
  const q = project.space.photo.quad;
  if (!q) return null;
  const outer = outerCm(project);
  const aspect = outer.h / outer.w;
  let quad = q;
  const savedAspect = project.space.photo.quadAspect;
  if (savedAspect && Math.abs(savedAspect - aspect) > 1e-4) {
    const f = aspect / savedAspect;
    quad = [q[0], q[1], { x: q[1].x + (q[2].x - q[1].x) * f, y: q[1].y + (q[2].y - q[1].y) * f }, { x: q[0].x + (q[3].x - q[0].x) * f, y: q[0].y + (q[3].y - q[0].y) * f }];
  }
  const savedWidth = project.space.photo.quadWidthCm;
  if (savedWidth && Math.abs(outer.w / savedWidth - 1) > 0.002) quad = scaleQuad(quad, outer.w / savedWidth, photo);
  return quad;
}

/** What to save with a quad: the piece's proportions and width it was placed for. */
export function quadMeta(project: WallProject): { quadAspect: number; quadWidthCm: number } {
  const outer = outerCm(project);
  return { quadAspect: outer.h / outer.w, quadWidthCm: outer.w };
}
