// Compare Art — top-level workspace.
//
// Owns the isolated provider and the mobile-first chrome: a compact top toolbar,
// the shared comparison canvas, a prominent-but-non-blocking alignment status,
// a bottom action bar and the control/export sheets. Fully self-contained: it
// touches no other workspace's state.

import { useState } from 'react';
import {
  Contrast,
  Download,
  Info,
  Layers,
  Move,
  Redo2,
  RefreshCw,
  SlidersHorizontal,
  Undo2,
  X,
} from 'lucide-react';
import { CompareProvider, useCompare } from './compareArtState';
import { NudgeStep } from './compareArtTypes';
import CompareUploadStep from './CompareUploadStep';
import CompareCanvas, { AnchorState, computeAnchorTransform } from './CompareCanvas';
import CompareBottomSheet from './CompareBottomSheet';
import { AlignSheet, GridSheet, ModeSheet, OpacitySheet } from './CompareSheets';
import CompareExportSheet from './CompareExportSheet';
import { Vec2 } from './compareArtGeometry';

type Sheet = 'mode' | 'align' | 'opacity' | 'grid' | 'export' | null;

const MODE_LABELS: Record<string, string> = {
  overlay: 'Overlay',
  blink: 'Blink',
  split: 'Split',
  difference: 'Difference',
};

function Workspace() {
  const store = useCompare();
  const { session } = store;

  const [sheet, setSheet] = useState<Sheet>(null);
  const [selectedLayer, setSelectedLayer] = useState<'artwork' | 'reference'>('reference');
  const [nudgeStep, setNudgeStep] = useState<NudgeStep>('normal');
  const [anchor, setAnchor] = useState<AnchorState | null>(null);
  const [cropActive, setCropActive] = useState(false);
  const [showStatus, setShowStatus] = useState(true);

  if (!store.bothLoaded) {
    return <CompareUploadStep />;
  }

  // ── 2-point (anchor) alignment flow ────────────────────────────────────────
  const handleAnchorPoint = (pt: Vec2) => {
    if (!anchor) return;
    const next: AnchorState = { ...anchor };
    if (anchor.step === 0) next.artA = pt;
    else if (anchor.step === 1) next.refA = pt;
    else if (anchor.step === 2) next.artB = pt;
    else if (anchor.step === 3) next.refB = pt;
    next.step = (anchor.step + 1) as AnchorState['step'];

    if (next.step === 4 && session.artworkMeta && session.referenceMeta) {
      const solved = computeAnchorTransform(
        next,
        session.referenceTransform,
        { width: session.referenceMeta.width, height: session.referenceMeta.height },
        { width: session.artworkMeta.width, height: session.artworkMeta.height },
      );
      if (solved) store.commitReferenceTransform(solved);
      setAnchor(null);
    } else {
      setAnchor(next);
    }
  };

  const anchorPrompts = [
    'Tap point A on your ARTWORK',
    'Tap the SAME point A on the REFERENCE',
    'Tap point B on your ARTWORK',
    'Tap the SAME point B on the REFERENCE',
  ];

  const openSheet = (s: Sheet) => {
    setCropActive(false);
    setSheet((cur) => (cur === s ? null : s));
  };

  return (
    <div className="relative flex flex-1 flex-col min-h-0">
      {/* Top toolbar */}
      <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-1.5 toolbar-surface">
        <div className="flex items-center gap-1">
          <button
            onClick={() => store.undo()}
            disabled={!store.canUndo}
            className="btn-tool disabled:opacity-30"
            aria-label="Undo"
            title="Undo"
          >
            <Undo2 className="h-4 w-4" />
          </button>
          <button
            onClick={() => store.redo()}
            disabled={!store.canRedo}
            className="btn-tool disabled:opacity-30"
            aria-label="Redo"
            title="Redo"
          >
            <Redo2 className="h-4 w-4" />
          </button>
        </div>

        <span className="text-xs font-medium text-muted-foreground">
          {MODE_LABELS[session.mode]} · {Math.round(session.opacity * 100)}%
        </span>

        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              store.removeReference();
              setSheet(null);
            }}
            className="btn-tool"
            aria-label="Replace images"
            title="Replace images"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            onClick={() => {
              if (confirm('Start a new comparison? This clears both images and alignment.')) {
                store.resetComparison();
                setSheet(null);
              }
            }}
            className="btn-tool"
            aria-label="New comparison"
            title="New comparison"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Canvas */}
      <CompareCanvas
        selectedLayer={session.artworkLocked ? 'reference' : selectedLayer}
        anchor={anchor}
        onAnchorPoint={handleAnchorPoint}
        onGestureActivity={() => setShowStatus(false)}
      />

      {/* Alignment status (prominent, non-blocking) */}
      {showStatus && !anchor && (
        <div className="pointer-events-none absolute inset-x-0 top-12 flex justify-center px-3">
          <div className="pointer-events-auto flex max-w-sm items-start gap-2 rounded-lg border border-border bg-card/95 px-3 py-2 text-[11px] text-muted-foreground shadow-lg backdrop-blur-sm">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <div>
              <p>Align the reference first for an accurate comparison.</p>
              <p dir="rtl" className="mt-0.5">כדי לקבל השוואה מדויקת, יש ליישר תחילה את הרפרנס מעל הציור.</p>
            </div>
            <button onClick={() => setShowStatus(false)} className="text-muted-foreground" aria-label="Dismiss">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Anchor prompt */}
      {anchor && (
        <div className="absolute inset-x-0 top-12 flex justify-center px-3">
          <div className="flex items-center gap-2 rounded-lg border border-primary/50 bg-card/95 px-3 py-2 text-xs font-medium text-foreground shadow-lg">
            <span>{anchorPrompts[anchor.step] ?? 'Aligning…'}</span>
            <button onClick={() => setAnchor(null)} className="text-muted-foreground" aria-label="Cancel alignment">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Bottom action bar */}
      <div className="flex items-stretch justify-around gap-1 border-t border-border px-1 py-1 toolbar-surface">
        <BarButton icon={<Layers className="h-5 w-5" />} label="Mode" active={sheet === 'mode'} onClick={() => openSheet('mode')} />
        <BarButton icon={<Move className="h-5 w-5" />} label="Align" active={sheet === 'align'} onClick={() => openSheet('align')} />
        <BarButton icon={<Contrast className="h-5 w-5" />} label="Opacity" active={sheet === 'opacity'} onClick={() => openSheet('opacity')} />
        <BarButton icon={<SlidersHorizontal className="h-5 w-5" />} label="Grid" active={sheet === 'grid'} onClick={() => openSheet('grid')} />
        <BarButton icon={<Download className="h-5 w-5" />} label="Export" active={sheet === 'export'} onClick={() => openSheet('export')} />
      </div>

      {/* Sheets */}
      <CompareBottomSheet open={sheet === 'mode'} title="Compare mode" onClose={() => setSheet(null)}>
        <ModeSheet />
      </CompareBottomSheet>
      <CompareBottomSheet
        open={sheet === 'align'}
        title="Align reference"
        subtitle="Drag on the canvas, or nudge precisely here."
        onClose={() => {
          setSheet(null);
          setCropActive(false);
        }}
      >
        <AlignSheet
          selectedLayer={selectedLayer}
          setSelectedLayer={setSelectedLayer}
          nudgeStep={nudgeStep}
          setNudgeStep={setNudgeStep}
          onStartAnchor={() => {
            setAnchor({ step: 0 });
            setSheet(null);
          }}
          cropActive={cropActive}
          onToggleCrop={() => setCropActive((v) => !v)}
        />
      </CompareBottomSheet>
      <CompareBottomSheet open={sheet === 'opacity'} title="Reference opacity" onClose={() => setSheet(null)}>
        <OpacitySheet />
      </CompareBottomSheet>
      <CompareBottomSheet open={sheet === 'grid'} title="Grid overlay" onClose={() => setSheet(null)}>
        <GridSheet />
      </CompareBottomSheet>
      <CompareBottomSheet
        open={sheet === 'export'}
        title="Export comparison"
        subtitle="Still, difference, or animated GIF."
        onClose={() => setSheet(null)}
      >
        <CompareExportSheet />
      </CompareBottomSheet>
    </div>
  );
}

function BarButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`flex flex-1 flex-col items-center gap-0.5 rounded-lg py-1.5 text-[10px] font-medium transition-colors ${
        active ? 'bg-primary/15 text-primary' : 'text-muted-foreground active:bg-secondary'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

export default function CompareArt() {
  return (
    <CompareProvider>
      <Workspace />
    </CompareProvider>
  );
}
