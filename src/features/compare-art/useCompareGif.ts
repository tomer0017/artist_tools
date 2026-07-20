// Compare Art — shared GIF export hook.
//
// Wraps prepare → render → encode → download so the one-tap "Create Opacity GIF"
// button in Overlay mode can trigger the app's most common action without
// opening the Export screen. It reuses the SAME renderer, gifenc encoder and
// frame specs as the Export sheet — nothing about the encoding pipeline changes.

import { useCallback, useRef, useState } from 'react';
import { useCompare } from './compareArtState';
import {
  ANALYSIS_MAX_DIM,
  GIF_SIZE_MAX_DIM,
  GifAnimation,
} from './compareArtTypes';
import { analyzeSceneDifference, prepareImage } from './compareArtCanvas';
import { sceneSizeForArtwork } from './compareArtGeometry';
import {
  CancelledError,
  GifProgress,
  generateComparisonGif,
} from './compareArtGif';

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export interface QuickGifState {
  busy: boolean;
  progress: GifProgress | null;
  error: string | null;
  generate: (animation?: GifAnimation) => Promise<void>;
  cancel: () => void;
}

export function useCompareGif(): QuickGifState {
  const store = useCompare();
  const { session } = store;
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<GifProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const handle = useRef<{ cancel: () => void } | null>(null);

  const cancel = useCallback(() => handle.current?.cancel(), []);

  const generate = useCallback(
    async (animation: GifAnimation = 'opacity-pulse') => {
      if (!session.artwork || !session.reference) return;
      setError(null);
      setBusy(true);
      setProgress(null); // "Preparing…" until frames start
      try {
        const art = await prepareImage(session.artwork);
        const ref = await prepareImage(session.reference);
        const scene = sceneSizeForArtwork(
          { width: art.width, height: art.height },
          GIF_SIZE_MAX_DIM[session.gif.size],
        );
        const overlay =
          animation === 'compare-diff'
            ? (() => {
                const r = analyzeSceneDifference(
                  art,
                  ref,
                  session.artworkTransform,
                  session.referenceTransform,
                  scene,
                  session.difference.metric,
                  session.difference.sensitivity,
                  session.difference.monochrome,
                  ANALYSIS_MAX_DIM,
                );
                return r ? { data: r.overlay, width: r.width, height: r.height } : null;
              })()
            : null;

        const h = generateComparisonGif(
          {
            artwork: art,
            reference: ref,
            artworkTransform: session.artworkTransform,
            referenceTransform: session.referenceTransform,
            crop: session.crop,
            scene,
            grid: session.grid,
            includeGrid: session.gif.includeGrid && session.grid.enabled,
            grayscale: session.grayscale,
            animation,
            speed: session.gif.speed,
            loop: session.gif.loop,
            differenceOverlay: overlay,
          },
          setProgress,
        );
        handle.current = h;
        const blob = await h.promise;
        downloadBlob(blob, `compare-${animation}-${Date.now()}.gif`);
      } catch (e) {
        if (!(e instanceof CancelledError)) {
          console.error('[useCompareGif] generation failed:', e);
          setError('GIF failed. Try a smaller output size in Export.');
        }
      } finally {
        setBusy(false);
        setProgress(null);
        handle.current = null;
      }
    },
    [session],
  );

  return { busy, progress, error, generate, cancel };
}
