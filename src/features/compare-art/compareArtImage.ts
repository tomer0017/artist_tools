// Compare Art — image input helpers.
//
// Opens a native picker (photo library / file / camera where supported) and
// returns a data URL plus intrinsic dimensions. EXIF orientation is normalised
// later at decode time (prepareImage), so dimensions here are indicative.

import { ImageMeta } from './compareArtTypes';

export class ImagePickError extends Error {}

/** Read a File into a data URL. */
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new ImagePickError('Unsupported file type. Please choose an image.'));
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result;
      if (typeof result === 'string') resolve(result);
      else reject(new ImagePickError('Failed to read image file.'));
    };
    reader.onerror = () => reject(new ImagePickError('Failed to read image file.'));
    reader.readAsDataURL(file);
  });
}

/** Measure a data URL's intrinsic size. */
export function loadImageMeta(dataUrl: string, name?: string): Promise<ImageMeta> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () =>
      resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height, name });
    img.onerror = () => reject(new ImagePickError('Failed to decode image.'));
    img.src = dataUrl;
  });
}

/**
 * Open the OS image picker and resolve with the chosen image, or null if the
 * user cancels. `capture` requests the camera on mobile when available.
 */
export function openImagePicker(capture = false): Promise<{ dataUrl: string; meta: ImageMeta } | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (capture) input.setAttribute('capture', 'environment');
    // iOS Safari requires the input to be attached to fire the picker reliably.
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    input.style.opacity = '0';

    // A picker cancel must ALWAYS settle the promise (resolve null), otherwise
    // the caller's "busy" state would stick and disable its controls forever.
    // Desktop browsers fire no `change` on cancel, so we settle from three
    // signals — whichever comes first — all guarded so we settle exactly once:
    //   1. `change`  — a file was chosen (or explicitly none).
    //   2. `cancel`  — modern browsers' native file-dialog cancel event.
    //   3. window `focus` returning with no file — a fallback for the rest.
    let settled = false;
    const teardown = () => {
      window.removeEventListener('focus', onFocus);
      if (input.parentNode) input.parentNode.removeChild(input);
    };
    const finish = (value: { dataUrl: string; meta: ImageMeta } | null) => {
      if (settled) return;
      settled = true;
      teardown();
      resolve(value);
    };
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      teardown();
      reject(err instanceof Error ? err : new ImagePickError('Failed to load image.'));
    };

    const onFocus = () => {
      // The window regains focus when the dialog closes. Give `change` a beat to
      // arrive; if no file materialised, treat it as a cancel.
      window.setTimeout(() => {
        if (!settled && !(input.files && input.files.length)) finish(null);
      }, 500);
    };

    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        finish(null);
        return;
      }
      // Claim settlement now so the focus/cancel fallbacks can't race us, then
      // read + decode asynchronously.
      if (settled) return;
      settled = true;
      teardown();
      try {
        const dataUrl = await readFileAsDataUrl(file);
        const meta = await loadImageMeta(dataUrl, file.name);
        resolve({ dataUrl, meta });
      } catch (err) {
        fail(err);
      }
    };
    input.addEventListener('cancel', () => finish(null));

    document.body.appendChild(input);
    window.addEventListener('focus', onFocus);
    input.click();
  });
}
