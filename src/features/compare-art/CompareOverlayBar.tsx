// Compare Art — quick comparison controls.
//
// The most common loop is: adjust opacity → inspect → adjust → make a GIF.
// These pieces keep that loop one tap deep: `OpacityControl` is the always-
// visible slider (Compare step) and `QuickGifButton` is the one-tap GIF with
// inline progress / cancel (Save step). The Export sheet keeps every advanced
// option.

import { Film, Loader2, X } from 'lucide-react';
import { useCompare } from './compareArtState';
import { useCompareGif } from './useCompareGif';

export function OpacityControl() {
  const store = useCompare();
  const pct = Math.round(store.session.opacity * 100);
  return (
    <div className="flex items-center gap-3">
      <span className="shrink-0 whitespace-nowrap text-xs font-medium text-muted-foreground">
        Reference <span className="inline-block w-9 text-right tabular-nums text-foreground">{pct}%</span>
      </span>
      <input
        type="range"
        min={0}
        max={100}
        value={pct}
        onChange={(e) => store.setOpacity(Number(e.target.value) / 100)}
        onPointerUp={(e) => store.commitOpacity(Number((e.target as HTMLInputElement).value) / 100)}
        className="h-8 min-w-0 flex-1 accent-primary"
        aria-label="Reference opacity"
      />
    </div>
  );
}

export function QuickGifButton({ label = 'Create Opacity GIF' }: { label?: string }) {
  const gif = useCompareGif();

  const phaseLabel = !gif.progress
    ? 'Preparing…'
    : gif.progress.phase === 'frames'
      ? 'Rendering…'
      : gif.progress.phase === 'encoding'
        ? 'Encoding…'
        : 'Done';

  return (
    <div>
      {gif.busy ? (
        <div className="flex min-h-[48px] items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <div className="flex-1">
            <div className="text-xs text-foreground">
              {phaseLabel}
              {gif.progress?.phase === 'frames' && ` ${gif.progress.current + 1}/${gif.progress.total}`}
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full bg-primary transition-all"
                style={{
                  width: gif.progress ? `${((gif.progress.current + 1) / gif.progress.total) * 100}%` : '8%',
                }}
              />
            </div>
          </div>
          <button
            onClick={gif.cancel}
            className="flex min-h-[40px] items-center gap-1 rounded-lg bg-secondary px-3 text-xs text-muted-foreground active:scale-95"
            aria-label="Cancel GIF"
          >
            <X className="h-3.5 w-3.5" /> Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => gif.generate('opacity-pulse')}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-3 text-[15px] font-semibold text-primary-foreground active:scale-[0.99]"
        >
          <Film className="h-5 w-5" /> {label}
        </button>
      )}
      {gif.error && <p className="mt-1 text-[11px] text-destructive">{gif.error}</p>}
    </div>
  );
}

export default function CompareOverlayBar() {
  return (
    <div className="space-y-2 border-t border-border px-3 py-2 toolbar-surface">
      <OpacityControl />
      <QuickGifButton />
    </div>
  );
}
