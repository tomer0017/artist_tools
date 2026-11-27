// Wall Studio and Room Studio: the whole picture, composed at any size (the
// preview, or a saved image). Order: the wall (and the room behind), the light
// on the wall, the framed piece with its shadow, the picture light, then the
// sofa and decor in front. The light's colour reaches the wall, the frame and
// the room — never the artwork, which only gets brighter or dimmer.

import { finishOf, isRound, roomOf, type FrameSpec, type LightSpec, type LightTemp, type WallProject } from '../types';
import { frameGeometry, renderFramed } from './frame';
import type { RoomView } from './room';
import { drawInterior, interiorScale } from './interior';
import { paintWall } from './wall';
import { css, ctxOf, makeCanvas, rgbOf, shade, type Ctx, type RGB } from './util';

const LIGHT: Record<LightTemp, RGB> = { warm: [255, 201, 140], neutral: [255, 242, 222], cool: [214, 229, 255] };

export interface Placement {
  /** The framed piece's outer box on the canvas, px. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Pixels per centimetre at the wall. */
  s: number;
  round: boolean;
}

/** Where the framed piece lands on a canvas of W × H for this project (wall or room). */
export function placeFrame(project: WallProject, frame: FrameSpec, W: number, H: number): { place: Placement; view: RoomView | null } {
  const art = project.artwork;
  const round = isRound(art);
  const g = frameGeometry(art.widthCm, round ? art.widthCm : art.heightCm, frame);
  const outerH = round ? g.outerW : g.outerH;
  if (project.space.mode === 'room') {
    const { s, artBottom } = interiorScale(project, W, H, g.outerW, outerH);
    const w = g.outerW * s, h = outerH * s;
    return { place: { x: (W - w) / 2, y: artBottom - h, w, h, s, round }, view: { W, H, s, cx: W / 2, horizon: 0 } };
  }

  const zoom = Math.min(0.8, Math.max(0.2, project.space.zoom));
  const s = Math.min((W * zoom) / g.outerW, (H * Math.min(0.86, zoom * 1.9)) / outerH);
  const w = g.outerW * s;
  const h = outerH * s;
  return { place: { x: (W - w) / 2, y: (H - h) / 2 - H * 0.02, w, h, s, round }, view: null };
}

function silhouette(ctx: Ctx, p: Placement): void {
  ctx.beginPath();
  if (p.round) ctx.arc(p.x + p.w / 2, p.y + p.h / 2, p.w / 2, 0, Math.PI * 2);
  else ctx.rect(p.x, p.y, p.w, p.h);
}

/** The piece's shadow on the wall: a soft one, and a tight contact shadow. */
function wallShadow(ctx: Ctx, p: Placement, depthCm: number, lightAbove: boolean, strength = 1): void {
  const d = Math.max(0.6, depthCm);
  const layers: [number, number, number, number][] = lightAbove
    ? [[1.4 + d * 0.9, 0, d * 1.05, 0.38], [d * 0.22, 0, d * 0.22, 0.3]]
    : [[1.2 + d * 0.8, d * 0.3, d * 0.55, 0.32], [d * 0.2, d * 0.08, d * 0.14, 0.28]];
  for (const [blur, dx, dy, alpha] of layers) {
    ctx.save();
    ctx.shadowColor = `rgba(0,0,0,${(alpha * strength).toFixed(3)})`;
    ctx.shadowBlur = blur * p.s;
    ctx.shadowOffsetX = dx * p.s;
    ctx.shadowOffsetY = dy * p.s;
    silhouette(ctx, p);
    ctx.fillStyle = 'rgb(60,60,60)';
    ctx.fill();
    ctx.restore();
  }
}

/** The gallery light on the surroundings: dimmer room, a pool of light on the piece. */
function galleryLight(ctx: Ctx, W: number, H: number, p: Placement, light: LightSpec): void {
  const k = light.intensity / 100;
  const tint = LIGHT[light.temperature];
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = css(shade([255, 255, 255], -0.12 - 0.12 * k));
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  const cx = p.x + p.w / 2;
  const cy = p.y + p.h * 0.42;
  const r = Math.max(p.w, p.h) * 1.05;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, 1.12);
  const g = ctx.createRadialGradient(0, 0, r * 0.15, 0, 0, r);
  g.addColorStop(0, css(tint, 0.42 * k + 0.1));
  g.addColorStop(0.6, css(tint, 0.16 * k + 0.04));
  g.addColorStop(1, css(tint, 0));
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = g;
  ctx.fillRect(-W * 2, -H * 2, W * 4, H * 4);
  ctx.restore();
  ctx.save();
  ctx.globalCompositeOperation = 'soft-light';
  ctx.fillStyle = css(tint, 0.25 * k + 0.05);
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

/** The picture light's fixture and its cone on the wall (drawn before the piece, so the colour stays off the artwork). */
function pictureLightCone(ctx: Ctx, p: Placement, light: LightSpec): void {
  const k = light.intensity / 100;
  const tint = LIGHT[light.temperature];
  const cx = p.x + p.w / 2;
  const top = p.y - 8 * p.s;
  const rx = Math.max(p.w * 0.75, 40 * p.s);
  const ry = Math.max(p.h * 0.9, 30 * p.s);
  ctx.save();
  ctx.translate(cx, top);
  ctx.scale(rx / ry, 1);
  const g = ctx.createRadialGradient(0, 0, 0, 0, ry * 0.2, ry);
  g.addColorStop(0, css(tint, 0.75 * k + 0.15));
  g.addColorStop(0.35, css(tint, 0.38 * k + 0.08));
  g.addColorStop(1, css(tint, 0));
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, ry * 1.2, 0, Math.PI);
  ctx.fill();
  ctx.restore();
}

/** The fixture: a brass (or nickel) bar on two arms, lit from within. */
function pictureLightFixture(ctx: Ctx, p: Placement, frame: FrameSpec, light: LightSpec): void {
  const finish = finishOf(frame.finish);
  const metal: [RGB, RGB, RGB] = finish.id === 'silver' || finish.id === 'black' || finish.id === 'white' ? [[236, 238, 240], [150, 154, 160], [70, 72, 76]] : [[246, 226, 170], [184, 146, 74], [96, 70, 28]];
  const s = p.s;
  const len = Math.min(Math.max(p.w / s * 0.55, 26), 100) * s;
  const cx = p.x + p.w / 2;
  const barY = p.y - 9 * s;
  const plateY = p.y - 12 * s;
  const barH = Math.max(3, 4.6 * s);
  // Shadow of the fixture on the wall.
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 3 * s;
  ctx.shadowOffsetY = 4 * s;
  ctx.fillStyle = 'rgba(0,0,0,0.01)';
  ctx.fillRect(cx - len / 2, barY - barH / 2, len, barH);
  ctx.restore();
  // Wall plate and arms.
  ctx.fillStyle = css(metal[1]);
  ctx.fillRect(cx - 5 * s, plateY - 3 * s, 10 * s, 6 * s);
  ctx.strokeStyle = css(metal[2]);
  ctx.lineWidth = Math.max(1, 0.9 * s);
  [-0.28, 0.28].forEach((f) => {
    ctx.beginPath();
    ctx.moveTo(cx + f * 10 * s, plateY);
    ctx.quadraticCurveTo(cx + f * len * 0.5, plateY + 4 * s, cx + f * len * 0.8, barY - barH * 0.3);
    ctx.stroke();
  });
  // The bar.
  const g = ctx.createLinearGradient(0, barY - barH / 2, 0, barY + barH / 2);
  g.addColorStop(0, css(metal[0]));
  g.addColorStop(0.45, css(metal[1]));
  g.addColorStop(1, css(metal[2]));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(cx - len / 2, barY, barH * 0.3, barH / 2, 0, 0, Math.PI * 2);
  ctx.ellipse(cx + len / 2, barY, barH * 0.3, barH / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(cx - len / 2, barY - barH / 2, len, barH);
  // The glowing slit underneath.
  const tint = LIGHT[light.temperature];
  ctx.fillStyle = css(shade(tint, 0.5), 0.9);
  ctx.fillRect(cx - len / 2 + barH * 0.3, barY + barH * 0.3, len - barH * 0.6, Math.max(1, barH * 0.18));
}

const framedCache = new Map<string, HTMLCanvasElement>();
/** The framed piece at a scale (kept for a few calls: sliding the light or the room does not redraw it). */
export function framedFor(art: HTMLCanvasElement, key: string, project: WallProject, frame: FrameSpec, s: number, lightAbove: boolean): HTMLCanvasElement {
  const round = isRound(project.artwork);
  const id = `${key}|${JSON.stringify(frame)}|${project.artwork.widthCm}x${project.artwork.heightCm}|${round}|${Math.round(s * 100)}|${lightAbove}`;
  const hit = framedCache.get(id);
  if (hit) return hit;
  const canvas = renderFramed(art, project.artwork.widthCm, round ? project.artwork.widthCm : project.artwork.heightCm, frame, round, s, { lightAbove });
  framedCache.set(id, canvas);
  if (framedCache.size > 8) framedCache.delete(framedCache.keys().next().value as string);
  return canvas;
}

const backCache = new Map<string, HTMLCanvasElement>();
function cached(id: string, W: number, H: number, draw: (ctx: Ctx) => void): HTMLCanvasElement {
  const hit = backCache.get(id);
  if (hit) return hit;
  const canvas = makeCanvas(W, H);
  draw(ctxOf(canvas));
  backCache.set(id, canvas);
  if (backCache.size > 6) backCache.delete(backCache.keys().next().value as string);
  return canvas;
}

export interface SceneOptions {
  /** The cropped artwork and a key that changes when it does. */
  art: HTMLCanvasElement;
  artKey: string;
  /** Another frame than the project's (a comparison). */
  frame?: FrameSpec;
}

/** Draw the wall or room scene for this project onto `canvas` (its full size). */
export function renderScene(canvas: HTMLCanvasElement, project: WallProject, options: SceneOptions): Placement {
  const W = canvas.width;
  const H = canvas.height;
  const ctx = ctxOf(canvas);
  const frame = options.frame ?? project.frame;
  const { place, view } = placeFrame(project, frame, W, H);
  const light = project.light;
  const lightAbove = light.pictureLight;
  const space = project.space;

  // 1. The wall (and room) behind, cached per look and size.
  if (view) {
    drawInterior(ctx, project, W, H, place.s, H * 0.93);
  } else {
    const back = cached(`wall|${space.wall.color}|${space.wall.texture}|${W}x${H}|${place.s.toFixed(4)}`, W, H, (c) => paintWall(c, 0, 0, W, H, space.wall.color, space.wall.texture, place.s));
    ctx.drawImage(back, 0, 0);
  }
  // A gentle falloff toward the edges, as in any room.
  const vg = ctx.createRadialGradient(W / 2, H * 0.42, Math.min(W, H) * 0.35, W / 2, H * 0.5, Math.max(W, H) * 0.8);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, `rgba(0,0,0,${light.enabled ? 0.2 : 0.12})`);
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  // 2. Light on the wall.
  if (light.enabled) galleryLight(ctx, W, H, place, light);
  if (light.pictureLight) pictureLightCone(ctx, place, light);

  // 3. The piece and its shadow.
  wallShadow(ctx, place, frame.type === 'frameless' ? 2 : frame.depthCm, lightAbove, light.enabled ? 1.15 : 1);
  const framed = framedFor(options.art, options.artKey, project, frame, place.s, lightAbove);
  ctx.drawImage(framed, place.x, place.y, place.w, place.h);
  if (light.pictureLight) {
    pictureLightFixture(ctx, place, frame, light);
  }

  return place;
}

/** The project's wall colour as an RGB (for UI previews). */
export const wallTone = (project: WallProject): RGB => rgbOf(project.space.mode === 'room' ? roomOf(project.space.room.id).wall.color : project.space.wall.color);
