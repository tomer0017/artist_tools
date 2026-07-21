// Compare Art — the ONE canonical scene renderer.
//
// Everything the painter sees or exports goes through renderSceneToCanvas():
// the interactive preview, the still export, the difference export and every
// GIF frame. Because there is a single drawing pipeline and geometry is stored
// resolution-independently, a reference aligned on screen is pixel-identical in
// every exported frame — the single most important correctness property of this
// feature.

import {
  CompareMode,
  CropRect,
  EXPORT_MAX_DIM,
  GridConfig,
  Transform,
} from './compareArtTypes';
import {
  Size,
  cropPixelRect,
  resolvePlacement,
  sceneSizeForArtwork,
} from './compareArtGeometry';
import { DifferenceMetric, Sensitivity } from './compareArtTypes';
import { DifferenceStats, computeDifference } from './compareArtDifference';

/** A decoded, size-capped drawable kept in memory for fast re-draws. */
export interface PreparedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
}

/**
 * Decode a data URL into a size-capped canvas, applying EXIF orientation so a
 * phone photo never loads sideways. Uses createImageBitmap when available
 * (handles orientation + gives matching dimensions), falling back to <img>.
 */
export async function prepareImage(
  dataUrl: string,
  maxDim = EXPORT_MAX_DIM,
): Promise<PreparedImage> {
  let src: CanvasImageSource;
  let w: number;
  let h: number;

  try {
    const blob = await (await fetch(dataUrl)).blob();
    // `from-image` bakes EXIF orientation into the bitmap pixels.
    const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    src = bmp;
    w = bmp.width;
    h = bmp.height;
  } catch {
    // Fallback path (older browsers / jsdom): plain <img>.
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Failed to decode image'));
      el.src = dataUrl;
    });
    src = img;
    w = img.naturalWidth || img.width;
    h = img.naturalHeight || img.height;
  }

  const longest = Math.max(w, h);
  const k = longest > maxDim ? maxDim / longest : 1;
  const cw = Math.max(1, Math.round(w * k));
  const ch = Math.max(1, Math.round(h * k));

  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, cw, ch);
  }
  // Release the intermediate bitmap once copied to the canvas.
  if (typeof ImageBitmap !== 'undefined' && src instanceof ImageBitmap) src.close();

  return { source: canvas, width: cw, height: ch };
}

export interface FrameOverride {
  /** Force a single layer (used by Blink and by GIF blink frames). */
  only?: 'artwork' | 'reference';
  /** Force a specific reference opacity (used by GIF opacity-pulse frames). */
  opacity?: number;
  /** Force the difference overlay on/off regardless of mode. */
  showDifference?: boolean;
}

export interface SceneInputs {
  artwork: PreparedImage | null;
  reference: PreparedImage | null;
  scene: Size;
  artworkTransform: Transform;
  referenceTransform: Transform;
  opacity: number;
  mode: CompareMode;
  grayscale: boolean;
  referenceHidden: boolean;
  splitOrientation: 'horizontal' | 'vertical';
  splitPosition: number;
  /** Split mode only: swap which image is on each side. Default false. */
  splitSwapped?: boolean;
  grid: GridConfig;
  includeGrid: boolean;
  /** Pre-computed difference overlay (RGBA) plus the size it was computed at. */
  differenceOverlay?: { data: Uint8ClampedArray; width: number; height: number } | null;
  frame?: FrameOverride;
  background?: string;
}

function drawLayer(
  ctx: CanvasRenderingContext2D,
  img: PreparedImage,
  transform: Transform,
  scene: Size,
  grayscale: boolean,
  alpha: number,
) {
  const { drawW, drawH, cx, cy } = resolvePlacement(img, scene, transform);
  ctx.save();
  ctx.globalAlpha = alpha;
  if (grayscale) ctx.filter = 'grayscale(1)';
  ctx.translate(cx, cy);
  ctx.rotate(transform.rotation);
  ctx.scale(transform.flipH ? -1 : 1, 1);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img.source, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();
}

function drawGrid(ctx: CanvasRenderingContext2D, scene: Size, grid: GridConfig) {
  const { width: w, height: h } = scene;
  let cols = grid.columns;
  let rows = grid.rows;
  if (grid.square) {
    // Lock to square cells based on the smaller nominal division.
    const cell = Math.min(w / grid.columns, h / grid.rows);
    cols = Math.max(1, Math.round(w / cell));
    rows = Math.max(1, Math.round(h / cell));
  }
  const lw = Math.max(0.5, grid.lineWidth * (w / 600));

  ctx.save();
  ctx.strokeStyle = grid.lineColor;
  ctx.lineWidth = lw;
  ctx.globalAlpha = grid.opacity;

  for (let i = 1; i < cols; i++) {
    const x = Math.round((i / cols) * w) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let i = 1; i < rows; i++) {
    const y = Math.round((i / rows) * h) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  if (grid.emphasizeCenter) {
    ctx.globalAlpha = Math.min(1, grid.opacity + 0.35);
    ctx.lineWidth = lw * 1.6;
    ctx.beginPath();
    ctx.moveTo(Math.round(w / 2) + 0.5, 0);
    ctx.lineTo(Math.round(w / 2) + 0.5, h);
    ctx.moveTo(0, Math.round(h / 2) + 0.5);
    ctx.lineTo(w, Math.round(h / 2) + 0.5);
    ctx.stroke();
  }
  ctx.restore();
}

function drawDifferenceOverlay(
  ctx: CanvasRenderingContext2D,
  scene: Size,
  overlay: { data: Uint8ClampedArray; width: number; height: number },
) {
  const tmp = document.createElement('canvas');
  tmp.width = overlay.width;
  tmp.height = overlay.height;
  const tctx = tmp.getContext('2d');
  if (!tctx) return;
  tctx.putImageData(new ImageData(overlay.data, overlay.width, overlay.height), 0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(tmp, 0, 0, scene.width, scene.height);
  ctx.restore();
}

/**
 * Render the full comparison scene into a fresh canvas of `scene` size.
 * The result includes NO editing chrome (handles, borders) — only the imagery,
 * optional difference overlay and optional grid — so it is export-ready.
 */
export function renderSceneToCanvas(inputs: SceneInputs): HTMLCanvasElement {
  const {
    artwork,
    reference,
    scene,
    artworkTransform,
    referenceTransform,
    opacity,
    mode,
    grayscale,
    referenceHidden,
    splitOrientation,
    splitPosition,
    splitSwapped = false,
    grid,
    includeGrid,
    differenceOverlay,
    frame,
    background = '#141416',
  } = inputs;

  const canvas = document.createElement('canvas');
  canvas.width = scene.width;
  canvas.height = scene.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  ctx.fillStyle = background;
  ctx.fillRect(0, 0, scene.width, scene.height);

  const showReference = !referenceHidden && reference;
  const showDifference = frame?.showDifference ?? mode === 'difference';

  // ── Frame overrides (Blink screen mode / GIF frames) ─────────────────────
  if (frame?.only === 'artwork') {
    if (artwork) drawLayer(ctx, artwork, artworkTransform, scene, grayscale, 1);
  } else if (frame?.only === 'reference') {
    if (reference) drawLayer(ctx, reference, referenceTransform, scene, grayscale, 1);
  } else if (mode === 'split') {
    // Base fills the scene; the other image is clipped to the split region.
    // By default the artwork is the base (left/top) and the reference fills the
    // region (right/bottom). `splitSwapped` swaps only which image is on each
    // side — geometry, split position and everything else are unchanged.
    const baseImg = splitSwapped ? reference : artwork;
    const baseT = splitSwapped ? referenceTransform : artworkTransform;
    const baseVisible = splitSwapped ? !referenceHidden : true;
    const regionImg = splitSwapped ? artwork : reference;
    const regionT = splitSwapped ? artworkTransform : referenceTransform;
    const regionVisible = splitSwapped ? true : !referenceHidden;

    if (baseImg && baseVisible) drawLayer(ctx, baseImg, baseT, scene, grayscale, 1);
    if (regionImg && regionVisible) {
      ctx.save();
      if (splitOrientation === 'horizontal') {
        const x = splitPosition * scene.width;
        ctx.beginPath();
        ctx.rect(x, 0, scene.width - x, scene.height);
      } else {
        const y = splitPosition * scene.height;
        ctx.beginPath();
        ctx.rect(0, y, scene.width, scene.height - y);
      }
      ctx.clip();
      drawLayer(ctx, regionImg, regionT, scene, grayscale, 1);
      ctx.restore();
    }
  } else {
    // Overlay / Difference base: artwork then reference at opacity.
    if (artwork) drawLayer(ctx, artwork, artworkTransform, scene, grayscale, 1);
    const refAlpha = frame?.opacity ?? opacity;
    if (showReference && !showDifference) {
      drawLayer(ctx, reference!, referenceTransform, scene, grayscale, refAlpha);
    }
  }

  // ── Difference overlay ───────────────────────────────────────────────────
  if (showDifference && differenceOverlay) {
    drawDifferenceOverlay(ctx, scene, differenceOverlay);
  }

  // ── Grid (always fixed to scene bounds, independent of opacity) ──────────
  if (grid.enabled && includeGrid) {
    drawGrid(ctx, scene, grid);
  }

  return canvas;
}

/**
 * Render a single layer alone into a canvas (used to build the artwork-only and
 * reference-only buffers that feed difference analysis). No grid, no chrome.
 */
export function renderLayerToCanvas(
  img: PreparedImage | null,
  transform: Transform,
  scene: Size,
  grayscale = false,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = scene.width;
  canvas.height = scene.height;
  const ctx = canvas.getContext('2d');
  if (!ctx || !img) return canvas;
  drawLayer(ctx, img, transform, scene, grayscale, 1);
  return canvas;
}

/** Extract the crop sub-rectangle of a scene canvas into a new canvas. */
export function applyCrop(sceneCanvas: HTMLCanvasElement, crop: CropRect): HTMLCanvasElement {
  const scene = { width: sceneCanvas.width, height: sceneCanvas.height };
  const { sx, sy, sw, sh } = cropPixelRect(crop, scene);
  if (sx === 0 && sy === 0 && sw === scene.width && sh === scene.height) return sceneCanvas;
  const out = document.createElement('canvas');
  out.width = sw;
  out.height = sh;
  const ctx = out.getContext('2d');
  if (ctx) ctx.drawImage(sceneCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
  return out;
}

/** Convenience: the scene size to use for export, given the artwork. */
export function exportSceneSize(artwork: PreparedImage): Size {
  return sceneSizeForArtwork({ width: artwork.width, height: artwork.height }, EXPORT_MAX_DIM);
}

/**
 * Render artwork-only and reference-only buffers at a small analysis resolution
 * (both in identical scene geometry) and compute the painter difference overlay.
 * Returns null if either image is missing. Browser-only (needs canvas).
 */
export function analyzeSceneDifference(
  artwork: PreparedImage | null,
  reference: PreparedImage | null,
  artworkTransform: Transform,
  referenceTransform: Transform,
  scene: Size,
  metric: DifferenceMetric,
  sensitivity: Sensitivity,
  monochrome: boolean,
  maxDim: number,
): { overlay: Uint8ClampedArray; width: number; height: number; stats: DifferenceStats } | null {
  if (!artwork || !reference) return null;
  const longest = Math.max(scene.width, scene.height);
  const k = longest > maxDim ? maxDim / longest : 1;
  const aScene: Size = {
    width: Math.max(1, Math.round(scene.width * k)),
    height: Math.max(1, Math.round(scene.height * k)),
  };

  const artCanvas = renderLayerToCanvas(artwork, artworkTransform, aScene);
  const refCanvas = renderLayerToCanvas(reference, referenceTransform, aScene);
  const actx = artCanvas.getContext('2d');
  const rctx = refCanvas.getContext('2d');
  if (!actx || !rctx) return null;
  const aData = actx.getImageData(0, 0, aScene.width, aScene.height);
  const rData = rctx.getImageData(0, 0, aScene.width, aScene.height);

  const result = computeDifference(
    { data: aData.data, width: aScene.width, height: aScene.height },
    { data: rData.data, width: aScene.width, height: aScene.height },
    metric,
    sensitivity,
    monochrome,
  );
  return { overlay: result.overlay, width: aScene.width, height: aScene.height, stats: result.stats };
}
