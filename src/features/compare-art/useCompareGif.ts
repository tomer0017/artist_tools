// Compare Art — shared GIF export hook.
//
// Wraps prepare → render → encode → download so the one-tap "Create Opacity GIF"
// button in Overlay mode can trigger the app's most common action without
// opening the Export screen. It reuses the SAME renderer, gifenc encoder and
// frame specs as the Export sheet — nothing about the encoding pipeline changes.

import { useCallback, useRef, useState } from 'react';
import { useSaveMedia } from '@/components/common/SaveMedia';
import { useAccount, useHasFeature } from '@/components/shell/account';
import { authorizeFeatures } from '@/lib/features-client';
import type { FeatureId } from '@/lib/plans';
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
  const { save } = useSaveMedia();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<GifProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const handle = useRef<{ cancel: () => void } | null>(null);
  const account = useAccount();
  const largeAllowed = useHasFeature('export.gif_large');
  const differenceAllowed = useHasFeature('export.gif_difference');

  const cancel = useCallback(() => handle.current?.cancel(), []);

  const generate = useCallback(
    async (animation: GifAnimation = 'opacity-pulse') => {
      if (!session.artwork || !session.reference) return;
      if (animation === 'compare-diff' && !differenceAllowed) {
        setError('Compare + Difference GIFs are part of Pro.');
        return;
      }
      // The one-tap GIF uses the saved size, or the largest the plan includes.
      const size = session.gif.size === 'high' && !largeAllowed ? 'standard' : session.gif.size;
      setError(null);
      setBusy(true);
      setProgress(null); // "Preparing…" until frames start
      const needed: FeatureId[] = ['export.gif'];
      if (size === 'high') needed.push('export.gif_large');
      if (animation === 'compare-diff') needed.push('export.gif_difference');
      const access = await authorizeFeatures(needed);
      if (access !== 'ok' && access !== 'unavailable') {
        setBusy(false);
        if (access === 'locked') {
          setError('Your plan does not include this GIF.');
          void account?.refresh();
        }
        if (access === 'limit') setError('You have used all the GIFs your plan includes for now. See your account page for when more are available.');
        return;
      }
      try {
        const art = await prepareImage(session.artwork);
        const ref = await prepareImage(session.reference);
        const scene = sceneSizeForArtwork(
          { width: art.width, height: art.height },
          GIF_SIZE_MAX_DIM[size],
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
        save({ blob, filename: `compare-${animation}-${Date.now()}.gif`, mime: 'image/gif' });
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
    [session, save, account, largeAllowed, differenceAllowed],
  );

  return { busy, progress, error, generate, cancel };
}
