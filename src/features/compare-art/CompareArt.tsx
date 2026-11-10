// Compare Art — top-level workspace.
//
// Owns the isolated provider and the step-by-step chrome around the shared
// comparison canvas: Images → Align → Compare → Save. Each step shows one
// short explanation and one obvious primary action in a panel BELOW the canvas
// (never over the artwork); every advanced tool (manual nudges, crop, modes,
// grid settings, export options) stays one tap away in the existing sheets.
// Fully self-contained: it touches no other workspace's state.

import { useState } from 'react';
import {
  ArrowRight,
  Camera,
  Contrast,
  Download,
  FlipHorizontal2,
  Grid3X3,
  ImagePlus,
  Layers,
  Lock,
  MoreVertical,
  Redo2,
  SlidersHorizontal,
  Sparkles,
  Undo2,
  X,
} from 'lucide-react';
import ToolHeader, { HeaderIconButton, StepIndicator } from '@/components/shell/ToolHeader';
import { CompareProvider, useCompare } from './compareArtState';
import { CompareIntroModal, useCompareIntro } from './onboarding';
import { openImagePicker } from './compareArtImage';
import { ImageCrop, NudgeStep } from './compareArtTypes';
import CompareUploadStep from './CompareUploadStep';
import CompareCanvas, { AnchorState, computeAnchorTransform } from './CompareCanvas';
import CompareCropScreen from './CompareCropScreen';
import CompareBottomSheet from './CompareBottomSheet';
import { OpacityControl, QuickGifButton } from './CompareOverlayBar';
import { AlignSheet, GridSheet, ModeSheet } from './CompareSheets';
import CompareExportSheet from './CompareExportSheet';
import { Vec2 } from './compareArtGeometry';

type Sheet = 'mode' | 'align' | 'grid' | 'export' | null;
type Phase = 'images' | 'align' | 'compare' | 'save';
const PHASES: Phase[] = ['images', 'align', 'compare', 'save'];
const PHASE_LABELS = ['Images', 'Align', 'Compare', 'Save'];

const MODE_LABELS: Record<string, string> = {
  overlay: 'Overlay',
  blink: 'Blink',
  split: 'Split',
  difference: 'Difference',
};

// Smart Align asks for the same two features on each image, alternating so
// the painter compares like with like. Colour = which image (amber artwork,
// blue reference — matching the upload slots and the canvas dots).
const ANCHOR_STEPS: { image: 'Artwork' | 'Reference'; text: string }[] = [
  { image: 'Artwork', text: 'Tap a clear feature — e.g. the left eye.' },
  { image: 'Reference', text: 'Tap the SAME feature here.' },
  { image: 'Artwork', text: 'Tap a second feature — e.g. the right eye.' },
  { image: 'Reference', text: 'Tap that SAME second feature here.' },
];

function Workspace() {
  const store = useCompare();
  const { session } = store;

  // A restored session with both images opens straight on the comparison.
  const [phase, setPhase] = useState<Phase>(() => (store.bothLoaded ? 'compare' : 'images'));
  const [sheet, setSheet] = useState<Sheet>(null);
  const [selectedLayer, setSelectedLayer] = useState<'artwork' | 'reference'>('reference');
  const [nudgeStep, setNudgeStep] = useState<NudgeStep>('normal');
  const [anchor, setAnchor] = useState<AnchorState | null>(null);
  const [cropActive, setCropActive] = useState(false);
  // Locked-comparison zoom: pinch/pan move both images together (a view-only
  // camera in the canvas), alignment untouched.
  const [viewLocked, setViewLocked] = useState(false);
  const [moreMenu, setMoreMenu] = useState(false);
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
    setMoreMenu(false);
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
    setMoreMenu(false);
    if (confirm('Start a new comparison? This clears both images and alignment.')) {
      store.resetComparison();
      setSheet(null);
      setAnchor(null);
      setPhase('images');
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

  const goTo = (p: Phase) => {
    setSheet(null);
    setAnchor(null);
    setMoreMenu(false);
    setPhase(p);
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

  const showUpload = phase === 'images' || !store.bothLoaded;
  const phaseIndex = showUpload ? 0 : PHASES.indexOf(phase);

  const header = (
    <>
      <ToolHeader
        tool="compare"
        actions={!showUpload && (
          <>
            <HeaderIconButton label="Undo" onClick={() => store.undo()} disabled={!store.canUndo}>
              <Undo2 className="h-5 w-5" />
            </HeaderIconButton>
            <div className="relative">
              <HeaderIconButton label="More" onClick={() => setMoreMenu((v) => !v)}>
                <MoreVertical className="h-5 w-5" />
              </HeaderIconButton>
              {moreMenu && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setMoreMenu(false)} />
                  <div role="menu" className="absolute right-0 top-full z-40 mt-1 w-60 overflow-hidden rounded-xl border border-border bg-card shadow-xl">
                    <MenuItem icon={<Redo2 className="h-4 w-4" />} label="Redo" disabled={!store.canRedo} onClick={() => { setMoreMenu(false); store.redo(); }} />
                    <div className="my-1 h-px bg-border" />
                    <p className="px-3 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Update artwork (keeps alignment)
                    </p>
                    <MenuItem icon={<Camera className="h-4 w-4" />} label="Take a new photo" disabled={updatingArt} onClick={() => updateArtwork(true)} />
                    <MenuItem icon={<ImagePlus className="h-4 w-4" />} label="Choose from library" disabled={updatingArt} onClick={() => updateArtwork(false)} />
                    <div className="my-1 h-px bg-border" />
                    <MenuItem icon={<X className="h-4 w-4" />} label="New comparison" danger onClick={newComparison} />
                  </div>
                </>
              )}
            </div>
          </>
        )}
      />
      <StepIndicator
        steps={PHASE_LABELS}
        current={phaseIndex}
        canSelect={(i) => i === 0 || store.bothLoaded}
        onSelect={(i) => goTo(PHASES[i])}
      />
    </>
  );

  if (showUpload) {
    return (
      <div className="flex flex-1 flex-col min-h-0">
        {header}
        <CompareUploadStep onRequestCrop={requestCrop} onContinue={() => goTo('align')} />
      </div>
    );
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
      // Aligned — move straight on to comparing.
      setPhase('compare');
    } else {
      setAnchor(next);
    }
  };

  const openSheet = (s: Sheet) => {
    setCropActive(false);
    setSheetCollapsed(false);
    setSheet((cur) => (cur === s ? null : s));
  };

  const startSmartAlign = () => {
    setViewLocked(false);
    setAnchor({ step: 0 });
    setSheet(null);
  };

  // Artwork / 50-50 / Reference: overlay opacity presets — the quickest way to
  // see "mine", "theirs" and the blend.
  const overlay = session.mode === 'overlay';
  const viewPreset = (v: number) => {
    if (!overlay) store.setMode('overlay');
    store.setOpacity(v);
    store.commitOpacity(v);
  };
  const presetActive = (v: number) => overlay && Math.abs(session.opacity - v) < 0.01;

  return (
    <div className="relative flex flex-1 flex-col min-h-0">
      {header}

      {/* The interaction surface: never selectable, so a held finger (Smart
          Align points) cannot select the badges laid over it on iPhone. */}
      <div className="relative flex flex-1 select-none flex-col min-h-0" style={{ WebkitTouchCallout: 'none' }}>
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

        {/* Which image is on screen while Smart Align collects points. */}
        {anchor && (
          <div className="pointer-events-none absolute left-2 top-2 z-20">
            <ImageBadge image={ANCHOR_STEPS[anchor.step]?.image ?? 'Artwork'} />
          </div>
        )}

        {/* Lock & Zoom: inspect detail with both images moving together. */}
        {phase === 'compare' && !anchor && (
          <button
            onClick={() => setViewLocked((v) => !v)}
            aria-pressed={viewLocked}
            className={`absolute right-2 top-2 z-20 flex min-h-[40px] items-center gap-1.5 rounded-full border px-3 text-xs font-semibold shadow-lg backdrop-blur-sm ${
              viewLocked ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card/90 text-foreground'
            }`}
          >
            <Lock className="h-4 w-4" /> {viewLocked ? 'Locked — pinch to zoom' : 'Lock & Zoom'}
          </button>
        )}
      </div>

      {/* ── Step panels (below the canvas, never over it) ─────────────────── */}
      <div className="shrink-0 border-t border-border bg-card px-3 pb-3 pt-2.5">
        <div className="mx-auto max-w-2xl space-y-2.5">
          {anchor ? (
            <>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-muted-foreground">Smart Align · point {anchor.step + 1} of 4</p>
                  {/* Fixed two-line height: if this panel grew or shrank between
                      taps, the canvas would resize and the image would shift
                      under the finger mid-alignment. */}
                  <p className="mt-0.5 h-10 overflow-hidden text-sm leading-5 text-foreground">
                    <ImageBadge image={ANCHOR_STEPS[anchor.step]?.image ?? 'Artwork'} inline />{' '}
                    {ANCHOR_STEPS[anchor.step]?.text}
                  </p>
                </div>
                <button
                  onClick={() => setAnchor(null)}
                  className="flex min-h-[40px] items-center gap-1 rounded-lg bg-secondary px-3 text-xs font-medium text-muted-foreground"
                  aria-label="Cancel alignment"
                >
                  <X className="h-3.5 w-3.5" /> Cancel
                </button>
              </div>
              <div className="flex gap-1" aria-hidden="true">
                {[0, 1, 2, 3].map((i) => (
                  <span key={i} className={`h-1 flex-1 rounded-full ${i < anchor.step ? 'bg-primary' : i === anchor.step ? 'bg-primary/50' : 'bg-secondary'}`} />
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">Hold and slide to aim with the magnifier; the point is placed when you lift.</p>
            </>
          ) : phase === 'align' ? (
            <>
              <div>
                <p className="text-sm font-semibold text-foreground">Align the images</p>
                <p className="text-xs text-muted-foreground">Match your artwork to the reference so the differences you see are real.</p>
              </div>
              <ChoiceCard
                icon={<Sparkles className="h-5 w-5" />}
                title="Smart Align"
                badge="Recommended"
                text="Tap two matching points on each image (e.g. both eyes)."
                primary
                onClick={startSmartAlign}
              />
              <ChoiceCard
                icon={<SlidersHorizontal className="h-5 w-5" />}
                title="Manual Align"
                text="Move, scale and rotate the reference by hand."
                onClick={() => openSheet('align')}
              />
              <button onClick={() => goTo('compare')} className="flex min-h-[40px] w-full items-center justify-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
                Already lined up? Skip to Compare <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </>
          ) : phase === 'compare' ? (
            <>
              <div className="flex rounded-lg bg-secondary/60 p-0.5" role="group" aria-label="Show">
                {[
                  { v: 0, label: 'Artwork' },
                  { v: 0.5, label: '50 / 50' },
                  { v: 1, label: 'Reference' },
                ].map((o) => (
                  <button
                    key={o.label}
                    onClick={() => viewPreset(o.v)}
                    aria-pressed={presetActive(o.v)}
                    className={`min-h-[40px] flex-1 rounded-md text-sm font-medium transition-colors ${
                      presetActive(o.v) ? 'bg-primary text-primary-foreground shadow' : 'text-muted-foreground'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              {overlay ? (
                <OpacityControl />
              ) : (
                <div className="flex min-h-[32px] items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    <span className="font-semibold text-foreground">{MODE_LABELS[session.mode]}</span>
                    {session.mode === 'split' ? ' — drag the divider on the image' : session.mode === 'blink' ? ' — the images swap automatically' : ' — bright areas differ most'}
                  </span>
                  {session.mode === 'split' && (
                    <button onClick={doFlipSides} className="flex min-h-[36px] items-center gap-1 rounded-lg bg-secondary px-2.5 font-medium text-foreground">
                      <FlipHorizontal2 className="h-4 w-4" /> Flip
                    </button>
                  )}
                </div>
              )}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => store.setGrid({ enabled: !session.grid.enabled })}
                  role="switch"
                  aria-checked={session.grid.enabled}
                  className={`flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-lg text-sm font-medium ${
                    session.grid.enabled ? 'bg-primary/15 text-primary ring-1 ring-primary/40' : 'bg-secondary text-foreground'
                  }`}
                >
                  <Grid3X3 className="h-4 w-4" /> Grid {session.grid.enabled ? `${session.grid.columns}×${session.grid.rows}` : 'off'}
                </button>
                <button onClick={() => openSheet('grid')} aria-label="Grid settings" className="flex h-11 w-11 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
                  <SlidersHorizontal className="h-4 w-4" />
                </button>
                <button onClick={() => openSheet('mode')} className="flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-secondary text-sm font-medium text-foreground">
                  <Layers className="h-4 w-4" /> More views
                </button>
              </div>
              <button
                onClick={() => goTo('save')}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-[15px] font-semibold text-primary-foreground"
              >
                Next: Save <ArrowRight className="h-5 w-5" />
              </button>
            </>
          ) : (
            <>
              <div>
                <p className="text-sm font-semibold text-foreground">Create a comparison GIF</p>
                <p className="text-xs text-muted-foreground">
                  It fades between your artwork and the reference, so proportion mistakes jump out.
                </p>
              </div>
              <QuickGifButton label="Create & Save GIF" />
              <button
                onClick={() => openSheet('export')}
                className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-border bg-secondary/50 text-sm font-medium text-foreground"
              >
                <Download className="h-4 w-4" /> Save still image & more options
              </button>
            </>
          )}
        </div>
      </div>

      {/* Sheets */}
      <CompareBottomSheet open={sheet === 'mode'} title="Compare view" onClose={() => setSheet(null)}>
        <ModeSheet />
      </CompareBottomSheet>
      <CompareBottomSheet
        open={sheet === 'align'}
        title="Manual align"
        subtitle="Drag on the canvas, or nudge precisely here."
        collapsed={sheet === 'align' && sheetCollapsed}
        maxVh={56}
        headerAction={
          <button
            onClick={() => goTo('compare')}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
          >
            Done
          </button>
        }
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
      <CompareBottomSheet open={sheet === 'grid'} title="Comparison grid" onClose={() => setSheet(null)}>
        <GridSheet />
      </CompareBottomSheet>
      <CompareBottomSheet
        open={sheet === 'export'}
        title="Save comparison"
        subtitle="Still image, difference image, or a custom GIF."
        onClose={() => setSheet(null)}
      >
        <CompareExportSheet />
      </CompareBottomSheet>
    </div>
  );
}

function ImageBadge({ image, inline = false }: { image: 'Artwork' | 'Reference'; inline?: boolean }) {
  const artwork = image === 'Artwork';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-semibold ${
        inline ? 'px-2 py-0.5 text-xs' : 'px-3 py-1.5 text-xs shadow-lg'
      } ${artwork ? 'bg-primary text-primary-foreground' : 'bg-blue-500 text-white'}`}
    >
      {artwork ? 'Your artwork' : 'Reference'}
    </span>
  );
}

function ChoiceCard({ icon, title, badge, text, primary, onClick }: {
  icon: React.ReactNode; title: string; badge?: string; text: string; primary?: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
        primary ? 'border-primary bg-primary/10' : 'border-border bg-secondary/30 hover:border-primary/40'
      }`}
    >
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${primary ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground'}`}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">{title}</span>
          {badge && <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-semibold text-primary">{badge}</span>}
        </span>
        <span className="block text-xs leading-snug text-muted-foreground">{text}</span>
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

function MenuItem({ icon, label, onClick, danger, disabled }: {
  icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean; disabled?: boolean;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={`flex min-h-[44px] w-full items-center gap-2.5 px-3 text-sm active:bg-secondary hover:bg-secondary disabled:opacity-50 ${danger ? 'text-destructive' : 'text-foreground'}`}
    >
      {icon} {label}
    </button>
  );
}

// Mounts the visual onboarding above the whole Compare workspace (so it can
// teach before the upload step too) and handles Help-triggered replays.
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
