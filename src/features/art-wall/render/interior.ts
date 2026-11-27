import type { WallProject } from '../types';
import { roomImage } from './assets';
import { SOFAS } from './room';
import { ctxOf, makeCanvas, rgbOf, type Ctx } from './util';

const tinted = new Map<string, HTMLCanvasElement>();
/** Original photographic texture and luminance, with only the upholstery colour changed. */
function sofaImage(project: WallProject) {
  const { sofaStyle, sofaColor } = project.space.room;
  const id = `${sofaStyle}|${sofaColor}`;
  if (tinted.has(id)) return tinted.get(id)!;
  const image = roomImage(`sofa-${sofaStyle}`);
  if (!image) return null;
  const c = makeCanvas(image.naturalWidth, image.naturalHeight);
  const ctx = ctxOf(c);
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const color = rgbOf(sofaColor);
  for (let i = 0; i < data.data.length; i += 4) {
    // Retain dark feet and neutral seams. Source upholstery is neutral grey.
    const lum = (data.data[i] + data.data[i + 1] + data.data[i + 2]) / 3;
    if (lum < 48) continue;
    for (let k = 0; k < 3; k++) data.data[i + k] = Math.min(255, color[k] * (lum / 180) + Math.max(0, lum - 185) * 0.25);
  }
  ctx.putImageData(data, 0, 0);
  tinted.set(id, c);
  if (tinted.size > 6) tinted.delete(tinted.keys().next().value!);
  return c;
}

/** The sofa's size against its real one, as the person set it (0.7…1.3). */
export const sofaScaleOf = (project: WallProject): number => Math.min(1.3, Math.max(0.7, project.space.room.sofaScale || 1));

/**
 * One scale for the artwork and the sofa, set by the room and the picture's
 * size only: a larger or smaller artwork (or sofa) never zooms the room, so
 * the sofa keeps its size and the artwork grows against it. Only a piece
 * wider than the room's view widens it.
 */
export function interiorScale(project: WallProject, W: number, H: number, outerW: number, outerH: number) {
  const sofa = SOFAS[project.space.room.sofaStyle];
  void outerH;
  const s = Math.min(W / 440, H / 285, (W * 0.94) / outerW);
  const sofaBottom = H * 0.93;
  return { s, sofaBottom, artBottom: sofaBottom - sofa.back * sofaScaleOf(project) * s - project.space.aboveSofaCm * s };
}

/** The room photograph behind everything. */
export function drawInterior(ctx: Ctx, project: WallProject, W: number, H: number) {
  const image = roomImage(project.space.room.id);
  if (!image) throw new Error('Room has not loaded');
  const k = Math.max(W / image.naturalWidth, H / image.naturalHeight);
  ctx.drawImage(image, (W - image.naturalWidth * k) / 2, H - image.naturalHeight * k, image.naturalWidth * k, image.naturalHeight * k);
}

/** The sofa and its floor shadow: the front-most layer, over the artwork where they meet. */
export function drawSofaLayer(ctx: Ctx, project: WallProject, W: number, s: number, sofaBottom: number) {
  const sofa = sofaImage(project);
  if (!sofa) throw new Error('Furniture has not loaded');
  const dims = SOFAS[project.space.room.sofaStyle];
  // Scaled as a whole (its proportions kept), standing on the same floor line.
  const sofaSize = sofaScaleOf(project);
  const w = dims.w * sofaSize * s, h = dims.back * sofaSize * s;
  // A broad floor shadow plus a tighter contact shadow anchors the furniture.
  ctx.save();
  ctx.translate(W / 2, sofaBottom - 1.5 * s);
  ctx.scale(1, 0.13);
  const shadow = ctx.createRadialGradient(0, 0, w * 0.12, 0, 0, w * 0.58);
  shadow.addColorStop(0, 'rgba(20,16,12,.42)');
  shadow.addColorStop(0.65, 'rgba(20,16,12,.17)');
  shadow.addColorStop(1, 'rgba(20,16,12,0)');
  ctx.fillStyle = shadow;
  ctx.fillRect(-w * .65, -w * .65, w * 1.3, w * 1.3);
  ctx.restore();
  ctx.drawImage(sofa, (W - w) / 2, sofaBottom - h, w, h);
}
