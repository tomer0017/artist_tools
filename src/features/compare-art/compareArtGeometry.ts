// Compare Art — pure geometry helpers.
//
// One coordinate system rules everything: "scene space", a rectangle
// [0,0] .. [sceneW, sceneH] whose aspect ratio equals the artwork's. The
// artwork fills the scene exactly; the reference is placed with a Transform.
// Because transforms are stored normalised (translation in scene-WIDTH units,
// scale as a multiplier on the contain-fit), the identical geometry renders at
// any resolution — which is what keeps the on-screen preview and the exported
// GIF pixel-for-pixel identical.

import { CropRect, Transform } from './compareArtTypes';

export interface Size {
  width: number;
  height: number;
}

export interface Vec2 {
  x: number;
  y: number;
}

/**
 * Scene dimensions for a given artwork, capped to `maxDim` on the long side.
 * The scene always carries the artwork's aspect ratio.
 */
export function sceneSizeForArtwork(artwork: Size, maxDim: number): Size {
  const w = Math.max(1, artwork.width);
  const h = Math.max(1, artwork.height);
  const longest = Math.max(w, h);
  const k = longest > maxDim ? maxDim / longest : 1;
  return { width: Math.round(w * k), height: Math.round(h * k) };
}

/** Contain-fit scale: largest factor fitting `img` inside `scene`. */
export function containFitScale(img: Size, scene: Size): number {
  if (!img.width || !img.height) return 1;
  return Math.min(scene.width / img.width, scene.height / img.height);
}

/**
 * Resolve a Transform into a concrete placement in a scene of the given size.
 * Returns the image's drawn size and centre, both in scene pixels.
 */
export function resolvePlacement(
  img: Size,
  scene: Size,
  t: Transform,
): { drawW: number; drawH: number; cx: number; cy: number } {
  const fit = containFitScale(img, scene);
  const drawW = img.width * fit * t.scale;
  const drawH = img.height * fit * t.scale;
  const cx = scene.width / 2 + t.tx * scene.width;
  const cy = scene.height / 2 + t.ty * scene.width;
  return { drawW, drawH, cx, cy };
}

/**
 * How the scene maps onto a display/canvas area: uniform scale + centring
 * offset (letterboxed). Used to convert pointer coordinates to scene space.
 */
export function sceneToCanvasMapping(
  scene: Size,
  canvas: Size,
): { scale: number; originX: number; originY: number } {
  const scale = Math.min(canvas.width / scene.width, canvas.height / scene.height);
  const originX = (canvas.width - scene.width * scale) / 2;
  const originY = (canvas.height - scene.height * scale) / 2;
  return { scale, originX, originY };
}

/** Canvas/screen point → scene point. */
export function canvasToScene(pt: Vec2, scene: Size, canvas: Size): Vec2 {
  const { scale, originX, originY } = sceneToCanvasMapping(scene, canvas);
  return { x: (pt.x - originX) / scale, y: (pt.y - originY) / scale };
}

/** Apply a translation given in *canvas* pixels to a transform (returns new). */
export function translateByCanvasDelta(
  t: Transform,
  dxCanvas: number,
  dyCanvas: number,
  scene: Size,
  canvas: Size,
): Transform {
  const { scale } = sceneToCanvasMapping(scene, canvas);
  const dSceneX = dxCanvas / scale;
  const dSceneY = dyCanvas / scale;
  return {
    ...t,
    tx: t.tx + dSceneX / scene.width,
    ty: t.ty + dSceneY / scene.width,
  };
}

/** Clamp a scale multiplier to a sane range. */
export function clampScale(s: number): number {
  return Math.max(0.05, Math.min(20, s));
}

/**
 * Pinch/rotate update that keeps the content under `pivotScene` fixed (no jump
 * when the second finger lands / moves). `t0` is the transform snapshot at
 * gesture start; `factor` and `deltaRotation` are relative to that snapshot.
 */
export function pivotTransform(
  t0: Transform,
  pivotScene: Vec2,
  factor: number,
  deltaRotation: number,
  scene: Size,
): Transform {
  const scale = clampScale(t0.scale * factor);
  const effFactor = scale / t0.scale; // account for clamping
  const c0x = scene.width / 2 + t0.tx * scene.width;
  const c0y = scene.height / 2 + t0.ty * scene.width;

  // Vector from pivot to old centre, scaled and rotated about the pivot.
  const vx = c0x - pivotScene.x;
  const vy = c0y - pivotScene.y;
  const cos = Math.cos(deltaRotation);
  const sin = Math.sin(deltaRotation);
  const nx = pivotScene.x + effFactor * (vx * cos - vy * sin);
  const ny = pivotScene.y + effFactor * (vx * sin + vy * cos);

  return {
    ...t0,
    scale,
    rotation: t0.rotation + deltaRotation,
    tx: (nx - scene.width / 2) / scene.width,
    ty: (ny - scene.height / 2) / scene.width,
  };
}

/** Angle (radians) of the segment a→b. */
export function angleOf(a: Vec2, b: Vec2): number {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

/** Euclidean distance. */
export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function midpoint(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Two-point alignment: given corresponding points on the artwork (fixed) and
 * the reference (to be moved), solve for the similarity transform (translation,
 * uniform scale, rotation) that best maps the reference points onto the artwork
 * points. Points are in scene coordinates.
 *
 * We derive the transform that the *already-placed* reference must additionally
 * receive. `refPlacement` describes where the reference currently sits so we can
 * compose the correction.
 */
export function solveTwoPointAlignment(
  artA: Vec2,
  artB: Vec2,
  refA: Vec2,
  refB: Vec2,
  current: Transform,
  refImg: Size,
  scene: Size,
): Transform {
  const dArt = distance(artA, artB);
  const dRef = distance(refA, refB);
  if (dRef < 1e-6 || dArt < 1e-6) return current;

  const factor = dArt / dRef; // additional scale
  const rot = angleOf(artA, artB) - angleOf(refA, refB); // additional rotation

  const newScale = clampScale(current.scale * factor);
  const effFactor = newScale / current.scale;
  const rotation = current.rotation + rot;

  // Where does refA land after applying (scale about refImg centre? no —
  // about scene) ... simplest: treat refA as a point that must map to artA.
  // Compute refA's new position under the additional scale+rotation about the
  // reference's current centre, then translate so it coincides with artA.
  const cx = scene.width / 2 + current.tx * scene.width;
  const cy = scene.height / 2 + current.ty * scene.width;
  const vx = refA.x - cx;
  const vy = refA.y - cy;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const rAx = cx + effFactor * (vx * cos - vy * sin);
  const rAy = cy + effFactor * (vx * sin + vy * cos);

  const shiftX = artA.x - rAx;
  const shiftY = artA.y - rAy;
  const ncx = cx + shiftX;
  const ncy = cy + shiftY;

  return {
    ...current,
    scale: newScale,
    rotation,
    tx: (ncx - scene.width / 2) / scene.width,
    ty: (ncy - scene.height / 2) / scene.width,
  };
}

/** Scale + centre the reference to exactly match the artwork (scene) bounds. */
export function matchArtworkBounds(refImg: Size, scene: Size): Transform {
  // Reference contain-fits the scene at scale=1 already; "match bounds" means
  // cover the scene so the reference fills the artwork area.
  const fit = containFitScale(refImg, scene);
  const cover = Math.max(scene.width / refImg.width, scene.height / refImg.height);
  return {
    tx: 0,
    ty: 0,
    scale: cover / fit,
    rotation: 0,
    flipH: false,
  };
}

/** Fill (cover) the scene, preserving aspect. */
export function fillTransform(refImg: Size, scene: Size): Transform {
  return matchArtworkBounds(refImg, scene);
}

/** Fit (contain) the scene, preserving aspect — the default. */
export function fitTransform(): Transform {
  return { tx: 0, ty: 0, scale: 1, rotation: 0, flipH: false };
}

/** Normalise + clamp a crop rect to stay inside the scene. */
export function sanitizeCrop(c: CropRect): CropRect {
  const x = Math.min(Math.max(c.x, 0), 0.99);
  const y = Math.min(Math.max(c.y, 0), 0.99);
  const w = Math.min(Math.max(c.w, 0.01), 1 - x);
  const h = Math.min(Math.max(c.h, 0.01), 1 - y);
  return { x, y, w, h };
}

/** Pixel rectangle of a crop within a scene of the given size. */
export function cropPixelRect(
  crop: CropRect,
  scene: Size,
): { sx: number; sy: number; sw: number; sh: number } {
  return {
    sx: Math.round(crop.x * scene.width),
    sy: Math.round(crop.y * scene.height),
    sw: Math.max(1, Math.round(crop.w * scene.width)),
    sh: Math.max(1, Math.round(crop.h * scene.height)),
  };
}
