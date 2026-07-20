// Shared image/GIF save + share helper.
//
// One implementation for every export surface in the app (Compare Art, Grid,
// Value, Measure, …). On iOS the fastest reliable path to the Photos library is
// the native Web Share sheet with the file ONLY — no title/text/url, which can
// make iOS treat the action as generic sharing instead of "Save Image". A
// browser cannot force a save to Photos or choose which targets Apple shows, so
// this helper opens the best native flow and the UI guides the user to pick
// "Save Image".

export type ShareResult = 'shared' | 'cancelled' | 'unsupported' | 'error';

/** Minimal shape of the Web Share bits we rely on (typed for older lib.dom). */
type ShareCapableNavigator = Navigator & {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
};

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  json: 'application/json',
};

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'application/json': 'json',
};

/** Infer a MIME type from a filename's extension. */
export function mimeForFilename(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

/** The canonical file extension for a MIME type (no leading dot). */
export function extForMime(mime: string): string {
  return EXT_BY_MIME[mime] ?? 'bin';
}

/** True for GIF media (used to pick "Save GIF" vs "Save Image" wording). */
export function isGif(mime: string): boolean {
  return mime === 'image/gif';
}

/**
 * Build a File carrying the correct name + MIME so the OS share sheet and Photos
 * recognise it as an image/GIF (not a generic download).
 */
export function makeShareFile(blob: Blob, filename: string, mime = mimeForFilename(filename)): File {
  return new File([blob], filename, { type: mime });
}

/** Whether the platform can share this file via the Web Share API. */
export function canShareFile(file: File, nav: Navigator = navigator): boolean {
  const n = nav as ShareCapableNavigator;
  try {
    return !!(n.share && n.canShare && n.canShare({ files: [file] }));
  } catch {
    return false;
  }
}

/** Best-effort iOS detection (covers iPadOS reporting as MacIntel). */
export function isIOS(nav: Navigator = navigator): boolean {
  const ua = nav.userAgent || '';
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1)
  );
}

/** Coarse-pointer (touch) device — where the Save-to-Photos share flow wins. */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints ?? 0) > 0;
}

/**
 * Share a file via the native sheet — FILES ONLY, deliberately no title/text/url
 * so iOS surfaces "Save Image". Returns a discriminated result instead of
 * throwing so callers can distinguish cancel from real failure.
 */
export async function shareFile(file: File, nav: Navigator = navigator): Promise<ShareResult> {
  const n = nav as ShareCapableNavigator;
  if (!n.share || !n.canShare || !n.canShare({ files: [file] })) return 'unsupported';
  try {
    await n.share({ files: [file] });
    return 'shared';
  } catch (err) {
    const name = (err as Error)?.name;
    if (name === 'AbortError') return 'cancelled';
    console.error('[saveMedia] share failed:', err);
    return 'error';
  }
}

/**
 * Classic download (anchor + object URL). Used on desktop and as a fallback.
 * Revokes the object URL after the click has a chance to start.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 1000);
  } catch (error) {
    console.error('[saveMedia] download failed:', error);
  }
}

/** Convert a data URL to a Blob (browser). */
export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

/** Render a canvas to a Blob with the given type (falls back via dataURL). */
export function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (canvas.toBlob) {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('canvas.toBlob returned null'))),
        mime,
        quality,
      );
    } else {
      dataUrlToBlob(canvas.toDataURL(mime, quality)).then(resolve, reject);
    }
  });
}
