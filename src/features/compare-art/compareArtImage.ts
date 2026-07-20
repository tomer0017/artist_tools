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

    const cleanup = () => {
      if (input.parentNode) input.parentNode.removeChild(input);
    };

    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      cleanup();
      if (!file) {
        resolve(null);
        return;
      }
      try {
        const dataUrl = await readFileAsDataUrl(file);
        const meta = await loadImageMeta(dataUrl, file.name);
        resolve({ dataUrl, meta });
      } catch (err) {
        reject(err instanceof Error ? err : new ImagePickError('Failed to load image.'));
      }
    };

    document.body.appendChild(input);
    input.click();
    // Safety cleanup if the user cancels (iOS fires no change event then).
    setTimeout(cleanup, 60_000);
  });
}
