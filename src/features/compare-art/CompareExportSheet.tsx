// Compare Art — export sheet (still comparison, difference image, animated GIF).
//
// Every export renders through the SAME canonical scene renderer used on screen,
// so the output matches the visible alignment exactly. GIF encoding is chunked
// and cancellable so the UI never freezes.
//
// Large GIFs and the Compare+Diff animation are Pro features: they stay
// visible with a lock for other plans, and the server confirms the account's
// plan before any GIF is encoded.

import { useEffect, useRef, useState } from 'react';
import { Download, Loader2, Lock, X } from 'lucide-react';
import { ProNotice } from '@/components/common/ProFeature';
import { useSaveMedia } from '@/components/common/SaveMedia';
import { useAccount, useHasFeature } from '@/components/shell/account';
import { authorizeFeatures } from '@/lib/features-client';
import type { FeatureId } from '@/lib/plans';
import { canvasToBlob } from '@/lib/saveMedia';
import { useCompare } from './compareArtState';
import {
  ANALYSIS_MAX_DIM,
  GIF_SIZE_MAX_DIM,
  GifAnimation,
  GifSize,
  GifSpeed,
} from './compareArtTypes';
import {
  PreparedImage,
  analyzeSceneDifference,
  applyCrop,
  exportSceneSize,
  prepareImage,
  renderSceneToCanvas,
} from './compareArtCanvas';
import { sceneSizeForArtwork, cropPixelRect } from './compareArtGeometry';
import {
  CancelledError,
  GifProgress,
  buildGifFrameSpecs,
  generateComparisonGif,
} from './compareArtGif';

function Seg<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  locked,
  onLocked,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  ariaLabel: string;
  /** Options the account's plan does not include: shown with a lock, choosing one calls onLocked. */
  locked?: T[];
  onLocked?: (v: T) => void;
}) {
  return (
    <div className="flex gap-1 rounded-lg bg-secondary/60 p-1" role="group" aria-label={ariaLabel}>
      {options.map((o) => {
        const isLocked = locked?.includes(o.value) ?? false;
        return (
          <button
            key={o.value}
            onClick={() => (isLocked ? onLocked?.(o.value) : onChange(o.value))}
            aria-pressed={value === o.value}
            className={`flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-2 text-xs font-medium ${
              value === o.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
            }`}
          >
            {o.label}
            {isLocked && (
              <>
                <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="sr-only">(Pro)</span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default function CompareExportSheet() {
  const store = useCompare();
  const { session } = store;
  const { save } = useSaveMedia();

  const artRef = useRef<PreparedImage | null>(null);
  const refRef = useRef<PreparedImage | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState<null | string>(null);
  const [progress, setProgress] = useState<GifProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const gifHandle = useRef<{ cancel: () => void } | null>(null);
  const account = useAccount();
  const largeAllowed = useHasFeature('export.gif_large');
  const differenceAllowed = useHasFeature('export.gif_difference');
  // Which Pro option to explain (null: none); 'refused' when the server said no.
  const [proNotice, setProNotice] = useState<FeatureId | 'refused' | null>(null);

  // A setting saved before the plan changed falls back to what the plan includes.
  useEffect(() => {
    if (!largeAllowed && session.gif.size === 'high') store.setGif({ size: 'standard' });
    if (!differenceAllowed && session.gif.animation === 'compare-diff') store.setGif({ animation: 'opacity-pulse' });
  }, [largeAllowed, differenceAllowed, session.gif.size, session.gif.animation, store]);

  // Decode high-resolution copies for export when the sheet opens.
  useEffect(() => {
    let alive = true;
    setReady(false);
    (async () => {
      try {
        if (session.artwork) artRef.current = await prepareImage(session.artwork);
        if (session.reference) refRef.current = await prepareImage(session.reference);
        if (alive) setReady(true);
      } catch (e) {
        console.error('[CompareExportSheet] prepare failed:', e);
        if (alive) setError('Could not prepare images for export.');
      }
    })();
    return () => {
      alive = false;
    };
  }, [session.artwork, session.reference]);

  const includeGrid = session.grid.enabled && session.grid.includeInExport;

  const buildDifferenceOverlay = (scene: { width: number; height: number }) => {
    const res = analyzeSceneDifference(
      artRef.current,
      refRef.current,
      session.artworkTransform,
      session.referenceTransform,
      scene,
      session.difference.metric,
      session.difference.sensitivity,
      session.difference.monochrome,
      ANALYSIS_MAX_DIM,
    );
    return res ? { data: res.overlay, width: res.width, height: res.height } : null;
  };

  const exportStill = async (kind: 'comparison' | 'difference') => {
    if (!artRef.current) return;
    setError(null);
    setBusy(kind);
    try {
      const scene = exportSceneSize(artRef.current);
      const overlay = kind === 'difference' ? buildDifferenceOverlay(scene) : null;
      const canvas = renderSceneToCanvas({
        artwork: artRef.current,
        reference: refRef.current,
        scene,
        artworkTransform: session.artworkTransform,
        referenceTransform: session.referenceTransform,
        opacity: session.opacity,
        mode: kind === 'difference' ? 'difference' : session.mode,
        grayscale: session.grayscale,
        referenceHidden: session.referenceHidden,
        splitOrientation: session.splitOrientation,
        splitPosition: session.splitPosition,
        splitSwapped: session.splitSwapped,
        grid: session.grid,
        includeGrid,
        differenceOverlay: overlay,
        frame: kind === 'difference' ? { showDifference: true } : undefined,
      });
      const cropped = applyCrop(canvas, session.crop);
      const blob = await canvasToBlob(cropped, 'image/png');
      save({ blob, filename: `compare-${kind}-${Date.now()}.png`, mime: 'image/png' });
    } catch (e) {
      console.error('[CompareExportSheet] still export failed:', e);
      setError('Export failed. The image may be too large.');
    } finally {
      setBusy(null);
    }
  };

  const gifScene = artRef.current
    ? sceneSizeForArtwork(
        { width: artRef.current.width, height: artRef.current.height },
        GIF_SIZE_MAX_DIM[session.gif.size],
      )
    : { width: 0, height: 0 };
  const gifCrop = cropPixelRect(session.crop, gifScene);
  const gifFrames = buildGifFrameSpecs(session.gif.animation).length;
  const heavy = gifCrop.sw * gifCrop.sh * gifFrames > 6_000_000;

  const exportGif = async () => {
    if (!artRef.current || !refRef.current) return;
    setError(null);
    setProNotice(null);
    setBusy('gif');
    const needed: FeatureId[] = ['export.gif'];
    if (session.gif.size === 'high') needed.push('export.gif_large');
    if (session.gif.animation === 'compare-diff') needed.push('export.gif_difference');
    const access = await authorizeFeatures(needed);
    if (access !== 'ok' && access !== 'unavailable') {
      setBusy(null);
      if (access === 'locked') {
        setProNotice(needed.find((f) => f !== 'export.gif') ?? 'refused');
        void account?.refresh();
      }
      if (access === 'limit') setError('You have used all the GIFs your plan includes for now. See your account page for when more are available.');
      return;
    }
    setProgress({ phase: 'frames', current: 0, total: gifFrames });
    try {
      const scene = gifScene;
      const overlay =
        session.gif.animation === 'compare-diff' ? buildDifferenceOverlay(scene) : null;
      const handle = generateComparisonGif(
        {
          artwork: artRef.current,
          reference: refRef.current,
          artworkTransform: session.artworkTransform,
          referenceTransform: session.referenceTransform,
          crop: session.crop,
          scene,
          grid: session.grid,
          includeGrid: session.gif.includeGrid && session.grid.enabled,
          grayscale: session.grayscale,
          animation: session.gif.animation,
          speed: session.gif.speed,
          loop: session.gif.loop,
          differenceOverlay: overlay,
        },
        (p) => setProgress(p),
      );
      gifHandle.current = handle;
      const blob = await handle.promise;
      save({ blob, filename: `compare-${session.gif.animation}-${Date.now()}.gif`, mime: 'image/gif' });
    } catch (e) {
      if (e instanceof CancelledError) {
        // user cancelled — no error surfaced
      } else {
        console.error('[CompareExportSheet] GIF export failed:', e);
        setError('GIF generation failed. Try a smaller output size.');
      }
    } finally {
      setBusy(null);
      setProgress(null);
      gifHandle.current = null;
    }
  };

  if (!ready) {
    return (
      <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Preparing export…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Still exports */}
      <section className="space-y-2">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Still images</p>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => exportStill('comparison')}
            disabled={!!busy}
            className="flex items-center justify-center gap-2 rounded-lg bg-secondary px-3 py-3 text-sm font-medium text-foreground active:scale-95 disabled:opacity-50"
          >
            {busy === 'comparison' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Save comparison
          </button>
          <button
            onClick={() => exportStill('difference')}
            disabled={!!busy}
            className="flex items-center justify-center gap-2 rounded-lg bg-secondary px-3 py-3 text-sm font-medium text-foreground active:scale-95 disabled:opacity-50"
          >
            {busy === 'difference' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Save difference
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground">PNG · uses the current alignment, crop and grid settings.</p>
      </section>

      {/* GIF export */}
      <section className="space-y-3 border-t border-border pt-4">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Animated GIF</p>
        {(!largeAllowed || !differenceAllowed) && (
          <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Lock className="h-3 w-3 shrink-0" aria-hidden="true" /> Large size and Compare+Diff are Pro features.
          </p>
        )}

        <Seg<GifAnimation>
          value={session.gif.animation}
          options={[
            { value: 'opacity-pulse', label: 'Opacity pulse' },
            { value: 'blink', label: 'Blink' },
            { value: 'compare-diff', label: 'Compare+Diff' },
          ]}
          onChange={(v) => store.setGif({ animation: v })}
          ariaLabel="GIF animation type"
          locked={differenceAllowed ? [] : ['compare-diff']}
          onLocked={() => setProNotice('export.gif_difference')}
        />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="mb-1 text-[11px] text-muted-foreground">Speed</p>
            <Seg<GifSpeed>
              value={session.gif.speed}
              options={[
                { value: 'slow', label: 'Slow' },
                { value: 'normal', label: 'Norm' },
                { value: 'fast', label: 'Fast' },
              ]}
              onChange={(v) => store.setGif({ speed: v })}
              ariaLabel="GIF speed"
            />
          </div>
          <div>
            <p className="mb-1 text-[11px] text-muted-foreground">Size</p>
            <Seg<GifSize>
              value={session.gif.size}
              options={[
                { value: 'small', label: 'S' },
                { value: 'standard', label: 'M' },
                { value: 'high', label: 'L' },
              ]}
              onChange={(v) => store.setGif({ size: v })}
              ariaLabel="GIF output size"
              locked={largeAllowed ? [] : ['high']}
              onLocked={() => setProNotice('export.gif_large')}
            />
          </div>
        </div>

        {proNotice && <ProNotice feature={proNotice === 'refused' ? null : proNotice} onClose={() => setProNotice(null)} />}

        <div className="flex items-center justify-between gap-4">
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" className="h-4 w-4 accent-primary" checked={session.gif.loop}
              onChange={(e) => store.setGif({ loop: e.target.checked })} /> Loop
          </label>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" className="h-4 w-4 accent-primary" checked={session.gif.includeGrid}
              onChange={(e) => store.setGif({ includeGrid: e.target.checked })} /> Include grid
          </label>
        </div>

        <p className="text-[11px] text-muted-foreground">
          Output ≈ {gifCrop.sw}×{gifCrop.sh}px · {gifFrames} frames
          {heavy && <span className="text-amber-400"> · large file — consider a smaller size</span>}
        </p>

        {busy === 'gif' && progress ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-foreground">
              <span>
                {progress.phase === 'frames' && `Preparing frames… ${progress.current + 1}/${progress.total}`}
                {progress.phase === 'encoding' && 'Encoding GIF…'}
                {progress.phase === 'done' && 'Ready'}
              </span>
              <button
                onClick={() => gifHandle.current?.cancel()}
                className="flex items-center gap-1 rounded-md bg-secondary px-2 py-1 text-[11px] text-muted-foreground"
              >
                <X className="h-3 w-3" /> Cancel
              </button>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${((progress.current + 1) / progress.total) * 100}%` }}
              />
            </div>
          </div>
        ) : (
          <button
            onClick={exportGif}
            disabled={!!busy}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-3 text-sm font-semibold text-primary-foreground active:scale-95 disabled:opacity-50"
          >
            <Download className="h-4 w-4" /> Create GIF
          </button>
        )}
        <p className="text-[11px] text-muted-foreground">
          The GIF uses the exact alignment shown on screen.
        </p>
      </section>

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
