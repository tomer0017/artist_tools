// The saved image: the same renderer as the preview, at the chosen size. A
// comparison is a grid of the same scene with each kept frame.

import { loadRoomAssets } from './render/assets';
import { canvasToBlob } from './images';
import { fittedQuad } from './placement';
import { frameGeometry } from './render/frame';
import { composePhoto } from './render/photo';
import { framedFor, renderScene, type PieceArt } from './render/scene';
import { ctxOf, makeCanvas } from './render/util';
import { SHAPES, isRound, type FrameSpec, type Pt, type WallProject } from './types';

export interface ArtSource {
  canvas: HTMLCanvasElement;
  key: string;
}

/** The canvas size for a wall or room image of this shape, longest side `long`. */
export function sceneSize(project: WallProject, long: number): { w: number; h: number } {
  const ratio = SHAPES[project.output.shape];
  return ratio >= 1 ? { w: long, h: Math.round(long / ratio) } : { w: Math.round(long * ratio), h: long };
}

/** The photo's corners in pixels of a canvas w × h. */
export const quadPx = (quad: [Pt, Pt, Pt, Pt], w: number, h: number): [Pt, Pt, Pt, Pt] => quad.map((p) => ({ x: p.x * w, y: p.y * h })) as [Pt, Pt, Pt, Pt];

/** Draw "My Room" for this project on a canvas the size of `photo`. */
export function renderPhotoScene(target: HTMLCanvasElement, project: WallProject, art: ArtSource, photo: HTMLCanvasElement, frame: FrameSpec = project.frame): void {
  const ctx = ctxOf(target);
  const quad = fittedQuad(project, { w: photo.width, h: photo.height });
  if (!quad) {
    ctx.drawImage(photo, 0, 0, target.width, target.height);
    return;
  }
  const corners = quadPx(quad, target.width, target.height);
  const edge = Math.max(...[0, 1, 2, 3].map((i) => Math.hypot(corners[(i + 1) % 4].x - corners[i].x, corners[(i + 1) % 4].y - corners[i].y)));
  const g = frameGeometry(project.artwork.widthCm, isRound(project.artwork) ? project.artwork.widthCm : project.artwork.heightCm, frame);
  const s = Math.max(1, Math.min(40, (edge * 1.15) / g.outerW));
  const framed = framedFor(art.canvas, art.key, project.artwork, frame, s, false);
  let base = photo;
  if (photo.width !== target.width || photo.height !== target.height) {
    base = makeCanvas(target.width, target.height);
    const bc = ctxOf(base);
    bc.imageSmoothingEnabled = true;
    bc.imageSmoothingQuality = 'high';
    bc.drawImage(photo, 0, 0, base.width, base.height);
  }
  composePhoto(ctx, { photo: base, framed, quad: corners, shadow: project.space.photo.shadow, match: project.space.photo.match });
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number): void {
  ctx.save();
  ctx.font = `600 ${Math.round(size)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  const w = ctx.measureText(text).width + size * 1.2;
  ctx.fillStyle = 'rgba(20,20,22,0.72)';
  ctx.beginPath();
  ctx.roundRect?.(x, y, w, size * 1.7, size * 0.85);
  if (!ctx.roundRect) ctx.rect(x, y, w, size * 1.7);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + size * 0.6, y + size * 0.86);
  ctx.restore();
}

export interface ExportInput {
  project: WallProject;
  art: ArtSource;
  photo: HTMLCanvasElement | null;
  /** Longest side, px. */
  long: number;
  /** Frames to compare side by side (two or more), or null for one image. */
  compare: FrameSpec[] | null;
  /** Labels for the compared frames ("Frame 1"…). */
  labels?: string[];
  /** The other artworks on the wall (wall and room scenes). */
  others?: PieceArt[];
}

/** Render the final image and encode it. */
export async function exportImage(input: ExportInput): Promise<Blob> {
  const { project, art, photo, long } = input;
  await loadRoomAssets(project);
  const mime = project.output.format === 'png' ? 'image/png' : 'image/jpeg';
  const photoMode = project.space.mode === 'photo' && photo && project.space.photo.quad;
  const single = (frame: FrameSpec, w: number, h: number): HTMLCanvasElement => {
    const canvas = makeCanvas(w, h);
    if (photoMode && photo) renderPhotoScene(canvas, project, art, photo, frame);
    else renderScene(canvas, project, { art: art.canvas, artKey: art.key, frame, others: input.others });
    return canvas;
  };
  let size: { w: number; h: number };
  if (photoMode && photo) {
    const scale = Math.min(1, long / Math.max(photo.width, photo.height));
    size = { w: Math.round(photo.width * scale), h: Math.round(photo.height * scale) };
  } else size = sceneSize(project, long);

  let out: HTMLCanvasElement;
  const frames = input.compare && input.compare.length > 1 ? input.compare.slice(0, 4) : null;
  if (frames) {
    const cw = Math.round(size.w / 2);
    const ch = Math.round(size.h / 2);
    const rows = frames.length > 2 ? 2 : 1;
    out = makeCanvas(cw * 2, ch * rows);
    const ctx = ctxOf(out);
    ctx.fillStyle = '#18181b';
    ctx.fillRect(0, 0, out.width, out.height);
    frames.forEach((frame, i) => {
      const x = (i % 2) * cw;
      const y = Math.floor(i / 2) * ch;
      ctx.drawImage(single(frame, cw, ch), x, y);
      label(ctx, input.labels?.[i] ?? String(i + 1), x + ch * 0.04, y + ch * 0.04, Math.max(12, ch * 0.045));
    });
    // Hairlines between the cells.
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(cw - 1, 0, 2, out.height);
    if (rows > 1) ctx.fillRect(0, ch - 1, out.width, 2);
  } else out = single(project.frame, size.w, size.h);
  if (mime === 'image/jpeg') {
    // JPEG has no transparency: settle on white where nothing was drawn.
    const flat = makeCanvas(out.width, out.height);
    const fc = ctxOf(flat);
    fc.fillStyle = '#fff';
    fc.fillRect(0, 0, flat.width, flat.height);
    fc.drawImage(out, 0, 0);
    out = flat;
  }
  return canvasToBlob(out, mime, 0.92);
}
