import { useCallback, useEffect, useRef, useState } from 'react';
// Imported module by module (not through '@/lib/sketch'), so the engine
// itself is bundled only into the worker, not into the page.
import { SketchClient } from '@/lib/sketch/client';
import { outlineExportSize, pencilExportSize, previewSize, type Size } from '@/lib/sketch/sizing';
import type { SketchControls, SketchStyle } from '@/lib/sketch/styles';
import type { SketchView } from '@/lib/sketch/protocol';
import { decodeImage, encodePng, isConstrainedDevice, pathsToPng, readPixels, sketchLimits, spawnSketchWorker } from '@/lib/sketch/browser';

/**
 * Sketch mode's drawing, computed in a Web Worker.
 *
 * The photo is read once at the working size and sent to the worker; each
 * control change then asks only for a new render, which the worker answers
 * from its cached stages. Leaving Sketch shuts the worker down after a short
 * grace period, which returns all of its memory.
 */

/** How long the worker (and its caches) outlives a switch to another study. */
const IDLE_SHUTDOWN_MS = 20_000;

export interface SketchSave {
  blob: Blob;
  size: Size;
}

export interface SketchDrawing {
  /** Object URL of what is on screen (the drawing, or its lines over the photo). */
  url: string | null;
  /** The style and view `url` shows. */
  shown: { style: SketchStyle; view: SketchView } | null;
  busy: boolean;
  failed: boolean;
  retry: () => void;
  /** Working size of the drawing, and the photo's own size. */
  working: Size | null;
  photo: Size | null;
  /** The drawing as a PNG at the largest size the limits allow. */
  savePng: () => Promise<SketchSave | null>;
  /** Clean Outline as a true vector SVG (null for Pencil Study). */
  saveSvg: () => Promise<Blob | null>;
  /** A fresh object URL of the drawing (not the overlay), e.g. for the study sheet. The caller revokes it. */
  drawingUrl: () => Promise<string | null>;
}

interface Picture {
  image: string;
  imageId: number;
  working: Size;
  photo: Size;
}

interface Shown {
  url: string;
  imageId: number;
  style: SketchStyle;
  view: SketchView;
  key: string;
}

/** False while the page is in the background (another app or tab is in front). */
function usePageVisible(): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== 'hidden');
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible;
}

export function useSketchDrawing(options: {
  enabled: boolean;
  image: string | null;
  style: SketchStyle;
  controls: SketchControls;
  view: SketchView;
}): SketchDrawing {
  const { image, style, controls, view } = options;
  // In the background (the phone switched to another app) Sketch counts as
  // left: after the grace period its worker and memory are released, which
  // also makes the page less likely to be evicted while it is not in front.
  const pageVisible = usePageVisible();
  const enabled = options.enabled && pageVisible;
  const clientRef = useRef<SketchClient | null>(null);
  const pictureRef = useRef<Picture | null>(null);
  const shownRef = useRef<Shown | null>(null);
  const requestRef = useRef(0);
  // The settings the screen should show now. A late result for other
  // settings is dropped once these are already on screen.
  const wantedRef = useRef('');
  const [picture, setPicture] = useState<Picture | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const latest = useRef({ style, controls, view });
  latest.current = { style, controls, view };

  const show = useCallback((next: Shown | null) => {
    const previous = shownRef.current;
    shownRef.current = next;
    setShown(next);
    if (previous && previous.url !== next?.url) URL.revokeObjectURL(previous.url);
  }, []);

  const getClient = useCallback(() => {
    if (!clientRef.current) {
      const client = new SketchClient(spawnSketchWorker, encodePng);
      client.onCrash = (error) => {
        console.error('[Sketch] The drawing worker stopped:', error);
        pictureRef.current = null;
        setPicture(null);
        setBusy(false);
        setFailed(true);
      };
      clientRef.current = client;
    }
    return clientRef.current;
  }, []);

  // A different photo: nothing of the old one may be shown.
  useEffect(() => {
    if (pictureRef.current && pictureRef.current.image !== image) {
      pictureRef.current = null;
      setPicture(null);
      show(null);
    }
  }, [image, show]);

  // Load the photo into the worker (once per photo, and again after a crash or shutdown).
  useEffect(() => {
    if (!enabled || !image) return;
    const current = pictureRef.current;
    if (current && current.image === image && clientRef.current?.loaded?.imageId === current.imageId) return;
    let cancelled = false;
    // Whatever the previous photo's render does from here on, it no longer
    // decides whether the spinner shows.
    requestRef.current++;
    setBusy(true);
    setFailed(false);
    (async () => {
      try {
        const img = await decodeImage(image);
        if (cancelled) return;
        const photo = { width: img.naturalWidth, height: img.naturalHeight };
        const working = previewSize(photo, sketchLimits());
        const pixels = readPixels(img, working);
        if (cancelled) return;
        const imageId = getClient().load(pixels, working.width, working.height, isConstrainedDevice());
        const next = { image, imageId, working, photo };
        pictureRef.current = next;
        setPicture(next);
      } catch (error) {
        if (cancelled) return;
        console.error('[Sketch] Could not prepare the photo:', error);
        setBusy(false);
        setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, image, attempt, getClient]);

  // Render whenever the picture, style, view or a control changes.
  const key = `${style}|${view}|${controls.lineWeight}|${controls.detail}|${controls.shading}`;
  useEffect(() => {
    if (!enabled || !picture) return;
    wantedRef.current = key;
    if (shownRef.current?.imageId === picture.imageId && shownRef.current.key === key) {
      // Back to what is already on screen (e.g. a style tapped and untapped):
      // nothing to draw, and nothing still on its way may replace it.
      requestRef.current++;
      setBusy(false);
      return;
    }
    const request = ++requestRef.current;
    setBusy(true);
    const { style: s, controls: c, view: v } = latest.current;
    getClient()
      .render(s, c, v)
      .then((result) => {
        if (!result) return;
        if (result.imageId !== pictureRef.current?.imageId) return;
        // While a drag is under way an older frame is still worth showing;
        // once the wanted settings are on screen, a late one is not.
        const current = shownRef.current;
        if (key !== wantedRef.current && current?.imageId === result.imageId && current.key === wantedRef.current) return;
        show({ url: URL.createObjectURL(result.blob), imageId: result.imageId, style: s, view: v, key });
        setFailed(false);
        // The worker's timings and memory for the latest drawing, as a standard
        // performance mark (DevTools shows it; nothing is sent anywhere).
        try {
          performance.clearMarks('sketch:render');
          performance.mark('sketch:render', { detail: { key, width: result.width, height: result.height, ...result.timings } });
        } catch {
          /* User Timing without `detail` (old browsers): skip */
        }
      })
      .catch((error) => {
        console.error('[Sketch] Rendering failed:', error);
        if (request === requestRef.current) setFailed(true);
      })
      .finally(() => {
        if (request === requestRef.current) setBusy(false);
      });
  }, [enabled, picture, key, getClient, show]);

  // Leaving Sketch: keep the worker briefly (switching back is instant), then
  // shut it down so its memory goes back to the system.
  useEffect(() => {
    if (enabled) return;
    const id = window.setTimeout(() => {
      clientRef.current?.suspend();
      pictureRef.current = null;
      setPicture(null);
      show(null);
    }, IDLE_SHUTDOWN_MS);
    return () => window.clearTimeout(id);
  }, [enabled, show]);

  // Closing the tool: stop the worker and drop the last image.
  useEffect(
    () => () => {
      clientRef.current?.dispose();
      clientRef.current = null;
      // A result still being encoded on the page must not create a URL now.
      pictureRef.current = null;
      if (shownRef.current) URL.revokeObjectURL(shownRef.current.url);
      shownRef.current = null;
    },
    [],
  );

  const retry = useCallback(() => {
    clientRef.current?.suspend();
    pictureRef.current = null;
    setPicture(null);
    setFailed(false);
    setAttempt((a) => a + 1);
  }, []);

  const savePng = useCallback(async (): Promise<SketchSave | null> => {
    const p = pictureRef.current;
    if (!p) return null;
    const client = getClient();
    const { style: s, controls: c } = latest.current;
    const limits = sketchLimits();
    if (s === 'outline') {
      // Drawn from the vector paths, so a large file stays as sharp as the SVG.
      const { width, height, layers } = await client.paths(c);
      const size = outlineExportSize(p.photo, { width, height }, limits);
      return { blob: await pathsToPng(layers, { width, height }, size), size };
    }
    const size = pencilExportSize(p.photo, limits);
    if (size.width * size.height <= p.working.width * p.working.height) {
      // The photo is no larger than the working drawing: that is the full-size result.
      const result = await client.renderOnce('pencil', c, 'drawing');
      return result ? { blob: result.blob, size: { width: result.width, height: result.height } } : null;
    }
    // Recomputed at the larger size in a separate, short-lived worker. The
    // on-screen caches are freed first and on-screen renders wait until it is
    // done (the controls still respond), so the two never add up in memory.
    client.hold();
    try {
      await client.release();
      const img = await decodeImage(p.image);
      const pixels = readPixels(img, size);
      const result = await client.exportImage(pixels, size.width, size.height, 'pencil', c);
      return { blob: result.blob, size };
    } finally {
      client.resume();
    }
  }, [getClient]);

  const saveSvg = useCallback(async (): Promise<Blob | null> => {
    const p = pictureRef.current;
    if (!p || latest.current.style !== 'outline') return null;
    // Opens at the photo's own size; the paths are scaled into it exactly.
    const svg = await getClient().svg(latest.current.controls, p.photo.width, p.photo.height);
    return new Blob([svg], { type: 'image/svg+xml' });
  }, [getClient]);

  const drawingUrl = useCallback(async (): Promise<string | null> => {
    if (!pictureRef.current) return null;
    const { style: s, controls: c } = latest.current;
    const result = await getClient().renderOnce(s, c, 'drawing');
    return result ? URL.createObjectURL(result.blob) : null;
  }, [getClient]);

  // Only ever this photo's drawing, from the very first frame after a change.
  const visible = shown && picture && picture.image === image && shown.imageId === picture.imageId ? shown : null;
  return {
    url: visible?.url ?? null,
    shown: visible ? { style: visible.style, view: visible.view } : null,
    busy,
    failed,
    retry,
    working: picture?.working ?? null,
    photo: picture?.photo ?? null,
    savePng,
    saveSvg,
    drawingUrl,
  };
}
