// Compare Art — magnifier loupe.
//
// A faithful copy of the Measure tool's magnifier (src/components/measure/
// MeasureMobile.tsx `drawMagnifier`): same 120px circle, 50px source window,
// nearest-neighbour zoom, red crosshair and translucent white ring. The Measure
// version is inline (not exported) and its file is stable/off-limits for this
// sprint, so the exact drawing is replicated here with identical constants so
// the two look and behave the same.

/** Size of the circular loupe in CSS px (matches Measure). */
export const LOUPE_SIZE = 120;
/** Source window sampled from the image, in source px (matches Measure). */
const LOUPE_SRC = 50;

/**
 * Draw the loupe onto `dst`, sampling a `LOUPE_SRC`px window centred on
 * (srcX, srcY) of `src` and magnifying it into the circle. The crosshair stays
 * centred, so the sampled point is always under the cross.
 */
export function drawLoupe(
  dst: HTMLCanvasElement,
  src: CanvasImageSource & { width: number; height: number },
  srcX: number,
  srcY: number,
): void {
  const size = LOUPE_SIZE;
  const srcSize = LOUPE_SRC;
  const ctx = dst.getContext('2d');
  if (!ctx) return;
  try {
    dst.width = size;
    dst.height = size;
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, size, size);
    ctx.imageSmoothingEnabled = false;
    const sx = Math.max(0, Math.min(src.width - srcSize, srcX - srcSize / 2));
    const sy = Math.max(0, Math.min(src.height - srcSize, srcY - srcSize / 2));
    ctx.drawImage(src, sx, sy, srcSize, srcSize, 0, 0, size, size);
    // Crosshair
    ctx.strokeStyle = '#ff3b30';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(size / 2, 0);
    ctx.lineTo(size / 2, size);
    ctx.moveTo(0, size / 2);
    ctx.lineTo(size, size / 2);
    ctx.stroke();
    ctx.restore();
    // Ring
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
    ctx.stroke();
  } catch (error) {
    console.error('[compareArtMagnifier] Failed to render loupe:', error);
  }
}
