// Compare Art — isolated persistence.
//
// Follows the project convention (base64 image in localStorage) but defends
// against its main risk: two full-size photos can blow the ~5 MB quota. So
// images are downscaled before storage, and if a write still overflows we fall
// back to persisting settings ONLY and flag the images for re-selection rather
// than silently corrupting the session.

import { CompareSession, SESSION_VERSION, defaultSession } from './compareArtTypes';

const STORAGE_KEY = 'compare-art-session';

/** Longest side used for the persisted (not the working) copy of an image. */
const PERSIST_MAX_DIM = 1400;
const PERSIST_QUALITY = 0.82;

export interface LoadResult {
  session: CompareSession;
  /** True when settings were restored but one/both images could not be. */
  imagesDropped: boolean;
}

export function loadSession(): LoadResult {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { session: defaultSession(), imagesDropped: false };
    const parsed = JSON.parse(raw) as Partial<CompareSession> & { imagesDropped?: boolean };
    if (parsed.version !== SESSION_VERSION) {
      // Unknown/older schema — start clean rather than mis-reading fields.
      return { session: defaultSession(), imagesDropped: false };
    }
    const base = defaultSession();
    const session: CompareSession = {
      ...base,
      ...parsed,
      // Nested objects: merge so new fields get defaults on older saves.
      artworkTransform: { ...base.artworkTransform, ...parsed.artworkTransform },
      referenceTransform: { ...base.referenceTransform, ...parsed.referenceTransform },
      crop: { ...base.crop, ...parsed.crop },
      grid: { ...base.grid, ...parsed.grid },
      difference: { ...base.difference, ...parsed.difference },
      gif: { ...base.gif, ...parsed.gif },
    };
    return { session, imagesDropped: Boolean(parsed.imagesDropped) };
  } catch (error) {
    console.error('[compareArtStorage] Failed to read session:', error);
    return { session: defaultSession(), imagesDropped: false };
  }
}

export function saveSession(session: CompareSession): void {
  const payload = { ...session, savedAt: Date.now(), imagesDropped: false };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    // Quota exceeded (large images). Persist settings without the images so the
    // painter's alignment/grid/mode survives a reload; flag re-selection.
    console.warn('[compareArtStorage] Full save failed, persisting settings only:', error);
    try {
      const lite = { ...payload, artwork: null, reference: null, imagesDropped: true };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(lite));
    } catch (inner) {
      console.error('[compareArtStorage] Settings-only save also failed:', inner);
    }
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error('[compareArtStorage] Failed to clear session:', error);
  }
}

/**
 * Downscale a data URL to a compact JPEG suitable for persistence. Returns the
 * original string if anything goes wrong (never throws). This keeps two photos
 * comfortably inside the localStorage budget without harming the in-memory
 * working/export copies, which are decoded separately from the source.
 */
export async function compactForStorage(dataUrl: string): Promise<string> {
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('decode failed'));
      el.src = dataUrl;
    });
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const longest = Math.max(w, h);
    if (longest <= PERSIST_MAX_DIM && dataUrl.length < 900_000) return dataUrl;
    const k = longest > PERSIST_MAX_DIM ? PERSIST_MAX_DIM / longest : 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * k));
    canvas.height = Math.max(1, Math.round(h * k));
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', PERSIST_QUALITY);
  } catch (error) {
    console.error('[compareArtStorage] compactForStorage failed:', error);
    return dataUrl;
  }
}

export { STORAGE_KEY };
