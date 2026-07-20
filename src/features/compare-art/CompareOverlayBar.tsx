// Compare Art — Overlay-mode quick controls.
//
// Overlay is the primary mode. The most common loop is: adjust opacity → inspect
// → adjust opacity → inspect → make a GIF. This bar keeps the opacity slider
// permanently visible (no sheet needed) and adds a one-tap "Create Opacity GIF"
// shortcut for the app's most frequent action. It sits below the canvas so it
// never covers the comparison. The Export sheet keeps every advanced option.

import { Film, Loader2, X } from 'lucide-react';
import { useCompare } from './compareArtState';
import { useCompareGif } from './useCompareGif';

export default function CompareOverlayBar() {
  const store = useCompare();
  const { session } = store;
  const gif = useCompareGif();
  const pct = Math.round(session.opacity * 100);

  const phaseLabel = !gif.progress
    ? 'Preparing…'
    : gif.progress.phase === 'frames'
      ? 'Rendering…'
      : gif.progress.phase === 'encoding'
        ? 'Encoding…'
        : 'Done';

  return (
    <div className="border-t border-border toolbar-surface px-3 py-2">
      <div className="flex items-center gap-3">
        <span className="w-16 shrink-0 text-[11px] font-medium text-muted-foreground">
          Opacity {pct}%
        </span>
        <input
          type="range"
          min={0}
          max={100}
          value={pct}
          onChange={(e) => store.setOpacity(Number(e.target.value) / 100)}
          onPointerUp={(e) => store.commitOpacity(Number((e.target as HTMLInputElement).value) / 100)}
          className="min-w-0 flex-1 accent-primary"
          aria-label="Reference opacity"
        />
      </div>

      {gif.busy ? (
        <div className="mt-2 flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <div className="flex-1">
            <div className="flex items-center justify-between text-[11px] text-foreground">
              <span>
                {phaseLabel}
                {gif.progress?.phase === 'frames' &&
                  ` ${gif.progress.current + 1}/${gif.progress.total}`}
              </span>
            </div>
            <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full bg-primary transition-all"
                style={{
                  width: gif.progress
                    ? `${((gif.progress.current + 1) / gif.progress.total) * 100}%`
                    : '8%',
                }}
              />
            </div>
          </div>
          <button
            onClick={gif.cancel}
            className="flex items-center gap-1 rounded-md bg-secondary px-2 py-1.5 text-[11px] text-muted-foreground active:scale-95"
            aria-label="Cancel GIF"
          >
            <X className="h-3 w-3" /> Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => gif.generate('opacity-pulse')}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground active:scale-95"
        >
          <Film className="h-4 w-4" /> Create Opacity GIF
        </button>
      )}

      {gif.error && <p className="mt-1 text-[11px] text-destructive">{gif.error}</p>}
    </div>
  );
}
