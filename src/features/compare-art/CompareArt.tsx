// Compare Art — top-level workspace.
//
// Owns the isolated provider and the mobile-first chrome: a compact top toolbar,
// the shared comparison canvas, a prominent-but-non-blocking alignment status,
// a bottom action bar and the control/export sheets. Fully self-contained: it
// touches no other workspace's state.

import { useState } from 'react';
import {
  Camera,
  Contrast,
  Download,
  FlipHorizontal2,
  ImagePlus,
  Layers,
  Lock,
  Redo2,
  SlidersHorizontal,
  Sparkles,
  Undo2,
  X,
} from 'lucide-react';
import { CompareProvider, useCompare } from './compareArtState';
import { CompareIntroModal, useCompareIntro } from './onboarding';
import { openImagePicker } from './compareArtImage';
import { ImageCrop, NudgeStep } from './compareArtTypes';
import CompareUploadStep from './CompareUploadStep';
import CompareCanvas, { AnchorState, computeAnchorTransform } from './CompareCanvas';
import CompareCropScreen from './CompareCropScreen';
import CompareBottomSheet from './CompareBottomSheet';
import CompareOverlayBar from './CompareOverlayBar';
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
  // Locked-comparison zoom: pinch/pan move both images together (a view-only
  // camera in the canvas), alignment untouched.
  const [viewLocked, setViewLocked] = useState(false);
  // "Update Artwork" picker menu + in-flight flag.
  const [updateMenu, setUpdateMenu] = useState(false);
  const [updatingArt, setUpdatingArt] = useState(false);
  // Auto-collapse the Align sheet while the painter is dragging on the canvas.
  const [sheetCollapsed, setSheetCollapsed] = useState(false);
  // Brief fade when swapping split sides.
  const [flipFlash, setFlipFlash] = useState(false);
  const [cropReq, setCropReq] = useState<
    { role: 'artwork' | 'reference'; original: string; initialCrop: ImageCrop | null } | null
  >(null);

  // Replace ONLY the painting (camera or library). Everything else — reference,
  // crop, alignment, zoom, mode, opacity, split, grid — is preserved because
  // setArtwork touches only the artwork image + its meta.
  const updateArtwork = async (capture: boolean) => {
    setUpdateMenu(false);
    setUpdatingArt(true);
    try {
      const res = await openImagePicker(capture);
      if (res) store.setArtwork(res.dataUrl, res.meta);
    } catch (e) {
      console.error('[CompareArt] Update artwork failed:', e);
    } finally {
      setUpdatingArt(false);
    }
  };

  const newComparison = () => {
    if (confirm('Start a new comparison? This clears both images and alignment.')) {
      store.resetComparison();
      setSheet(null);
    }
  };

  const doFlipSides = () => {
    store.toggleSplitSwapped();
    setFlipFlash(true);
    window.setTimeout(() => setFlipFlash(false), 180);
  };

  const requestCrop = (role: 'artwork' | 'reference', original: string, initialCrop?: ImageCrop | null) => {
    setCropReq({ role, original, initialCrop: initialCrop ?? null });
  };

  // The pre-comparison crop screen takes over the whole workspace when active.
  if (cropReq) {
    return (
      <CompareCropScreen
        role={cropReq.role}
        image={cropReq.original}
        initialCrop={cropReq.initialCrop}
        onCancel={() => setCropReq(null)}
        onConfirm={(result) => {
          store.applyImageCrop(cropReq.role, result);
          setCropReq(null);
        }}
      />
    );
  }

  if (!store.bothLoaded) {
    return <CompareUploadStep onRequestCrop={requestCrop} />;
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
    setSheetCollapsed(false);
    setSheet((cur) => (cur === s ? null : s));
  };

  // Smart Align is a primary action — startable directly from the workspace
  // (the alignment status card) and from the Align sheet. It kicks off the
  // 2-point tap flow.
  const startSmartAlign = () => {
    setViewLocked(false);
    setAnchor({ step: 0 });
    setSheet(null);
  };

  // The bottom-bar slot that changes with the active comparison mode.
  const contextControl =
    session.mode === 'split'
      ? { icon: <FlipHorizontal2 className="h-5 w-5" />, label: 'Flip Sides', active: false, onClick: doFlipSides }
      : session.mode === 'difference'
        ? { icon: <Contrast className="h-5 w-5" />, label: 'Difference', active: sheet === 'mode', onClick: () => openSheet('mode') }
        : session.mode === 'blink'
          ? { icon: <Contrast className="h-5 w-5" />, label: 'Blink', active: sheet === 'mode', onClick: () => openSheet('mode') }
          : { icon: <Contrast className="h-5 w-5" />, label: 'Opacity', active: sheet === 'opacity', onClick: () => openSheet('opacity') };

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
          {MODE_LABELS[session.mode]}
          {session.mode === 'overlay' && ` · ${Math.round(session.opacity * 100)}%`}
        </span>

        <div className="relative flex items-center gap-1">
          {/* Painter-oriented: update the painting after more time at the easel. */}
          <button
            onClick={() => setUpdateMenu((v) => !v)}
            disabled={updatingArt}
            aria-haspopup="menu"
            aria-expanded={updateMenu}
            data-onboarding="compare-update"
            className="flex items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-foreground active:scale-95 disabled:opacity-50"
          >
            <Camera className="h-4 w-4" />
            Update Artwork
          </button>
          <button
            onClick={newComparison}
            className="btn-tool"
            aria-label="New comparison"
            title="New comparison"
          >
            <X className="h-4 w-4" />
          </button>

          {updateMenu && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setUpdateMenu(false)} />
              <div
                role="menu"
                className="absolute right-0 top-full z-40 mt-1 w-44 overflow-hidden rounded-lg border border-border bg-card shadow-xl"
              >
                <button
                  role="menuitem"
                  onClick={() => updateArtwork(true)}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-foreground active:bg-secondary"
                >
                  <Camera className="h-4 w-4" /> Camera
                </button>
                <button
                  role="menuitem"
                  onClick={() => updateArtwork(false)}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-foreground active:bg-secondary"
                >
                  <ImagePlus className="h-4 w-4" /> Photo Library
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Canvas */}
      <CompareCanvas
        selectedLayer={session.artworkLocked ? 'reference' : selectedLayer}
        anchor={anchor}
        onAnchorPoint={handleAnchorPoint}
        viewLocked={viewLocked}
        onGestureActivity={() => {
          if (sheet === 'align') setSheetCollapsed(true);
        }}
        onGestureEnd={() => setSheetCollapsed(false)}
      />

      {/* Brief fade when swapping split sides. */}
      <div
        className={`pointer-events-none absolute inset-0 z-10 bg-background transition-opacity duration-150 ${
          flipFlash ? 'opacity-40' : 'opacity-0'
        }`}
      />

      {/* Persistent alignment toolbar — the alignment workspace's home for every
          alignment tool. All three stay visible the whole time you're comparing
          (Smart Align never disappears after a run; Manual and Smart coexist;
          Lock & Zoom no longer floats over/overlaps anything). It's hidden only
          during the brief Smart Align tap sequence, which shows its own prompt. */}
      {!anchor && (
        <div className="absolute right-2 top-16 z-20 flex flex-col gap-2">
          <AlignToolBtn icon={<Sparkles className="h-5 w-5" />} label="Smart Align" primary onClick={startSmartAlign} />
          <AlignToolBtn icon={<SlidersHorizontal className="h-5 w-5" />} label="Manual" active={sheet === 'align'} onClick={() => openSheet('align')} />
          <AlignToolBtn icon={<Lock className="h-5 w-5" />} label={viewLocked ? 'Locked' : 'Lock & Zoom'} active={viewLocked} onClick={() => setViewLocked((v) => !v)} />
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

      {/* Overlay quick controls — always-visible opacity + one-tap GIF */}
      {session.mode === 'overlay' && <CompareOverlayBar />}

      {/* Bottom action bar */}
      <div data-onboarding="compare-bar" className="flex items-stretch justify-around gap-1 border-t border-border px-1 py-1 toolbar-surface">
        <BarButton icon={<Layers className="h-5 w-5" />} label="Mode" active={sheet === 'mode'} onClick={() => openSheet('mode')} />
        <BarButton icon={contextControl.icon} label={contextControl.label} active={contextControl.active} onClick={contextControl.onClick} />
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
        collapsed={sheet === 'align' && sheetCollapsed}
        maxVh={56}
        onClose={() => {
          setSheet(null);
          setCropActive(false);
          setSheetCollapsed(false);
        }}
      >
        <AlignSheet
          selectedLayer={selectedLayer}
          setSelectedLayer={setSelectedLayer}
          nudgeStep={nudgeStep}
          setNudgeStep={setNudgeStep}
          cropActive={cropActive}
          onToggleCrop={() => setCropActive((v) => !v)}
          onRecrop={(role) => {
            setSheet(null);
            const original =
              role === 'artwork'
                ? session.artworkOriginal ?? session.artwork!
                : session.referenceOriginal ?? session.reference!;
            const crop = role === 'artwork' ? session.artworkCrop : session.referenceCrop;
            requestCrop(role, original, crop);
          }}
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

// A button in the persistent right-side alignment toolbar. `primary` marks the
// always-recommended action (Smart Align); `active` marks a currently-on tool
// (Manual sheet open, or view Locked).
function AlignToolBtn({
  icon,
  label,
  active,
  primary,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  primary?: boolean;
  onClick: () => void;
}) {
  const tone = active
    ? 'border-primary bg-primary text-primary-foreground'
    : primary
      ? 'border-primary/50 bg-primary text-primary-foreground'
      : 'border-border bg-card/95 text-foreground';
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      title={label}
      className={`flex w-[68px] flex-col items-center gap-1 rounded-2xl border px-1 py-2 text-[10px] font-semibold leading-tight shadow-lg backdrop-blur-sm transition-colors active:scale-95 ${tone}`}
    >
      {icon}
      <span className="text-center">{label}</span>
    </button>
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

// Mounts the first-run visual onboarding above the whole Compare workspace (so
// it teaches before the upload step too) and handles Help-triggered replays.
function CompareIntroLayer() {
  const { open, close } = useCompareIntro();
  return <CompareIntroModal open={open} onStart={close} onClose={close} />;
}

export default function CompareArt() {
  return (
    <CompareProvider>
      <Workspace />
      <CompareIntroLayer />
    </CompareProvider>
  );
}
