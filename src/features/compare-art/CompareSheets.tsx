// Compare Art — control sheet bodies (mode, align, opacity, grid).
//
// Each is a small, touch-first panel rendered inside CompareBottomSheet. They
// read/write the isolated Compare store. Alignment status and the "align first"
// guidance live here so they are prominent but non-blocking.

import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Crop,
  Eye,
  EyeOff,
  FlipHorizontal2,
  Lock,
  RotateCcw,
  RotateCw,
  Unlock,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useCompare, NudgeAction } from './compareArtState';
import {
  BlinkSpeed,
  CompareMode,
  DifferenceMetric,
  NudgeStep,
  Sensitivity,
  SplitOrientation,
} from './compareArtTypes';

// ── shared bits ───────────────────────────────────────────────────────────────
function Seg<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="flex gap-1 rounded-lg bg-secondary/60 p-1" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`flex-1 rounded-md px-2 py-2 text-xs font-medium transition-colors ${
            value === o.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      {/* Strong contrast so section titles stay legible over the blurred sheet. */}
      <label className="block text-[11px] font-semibold uppercase tracking-wider text-foreground/90">
        {label}
      </label>
      {children}
    </div>
  );
}

// ── Mode sheet ────────────────────────────────────────────────────────────────
export function ModeSheet() {
  const store = useCompare();
  const { session } = store;
  const modes: { value: CompareMode; label: string }[] = [
    { value: 'overlay', label: 'Overlay' },
    { value: 'blink', label: 'Blink' },
    { value: 'split', label: 'Split' },
    { value: 'difference', label: 'Difference' },
  ];

  return (
    <div className="space-y-4">
      <Field label="Comparison mode">
        <Seg value={session.mode} options={modes} onChange={store.setMode} ariaLabel="Comparison mode" />
      </Field>

      <label className="flex items-center justify-between rounded-lg bg-secondary/40 px-3 py-2.5">
        <span className="text-sm text-foreground">Grayscale (compare values)</span>
        <input
          type="checkbox"
          className="h-5 w-5 accent-primary"
          checked={session.grayscale}
          onChange={(e) => store.setGrayscale(e.target.checked)}
          aria-label="Grayscale comparison"
        />
      </label>

      {session.mode === 'blink' && (
        <Field label="Blink speed">
          <Seg<BlinkSpeed>
            value={session.blinkSpeed}
            options={[
              { value: 'slow', label: 'Slow' },
              { value: 'normal', label: 'Normal' },
              { value: 'fast', label: 'Fast' },
            ]}
            onChange={store.setBlinkSpeed}
            ariaLabel="Blink speed"
          />
          <p className="text-[11px] text-muted-foreground">Tip: press and hold the canvas to reveal the reference.</p>
        </Field>
      )}

      {session.mode === 'split' && (
        <Field label="Split orientation">
          <Seg<SplitOrientation>
            value={session.splitOrientation}
            options={[
              { value: 'horizontal', label: 'Vertical bar' },
              { value: 'vertical', label: 'Horizontal bar' },
            ]}
            onChange={store.setSplitOrientation}
            ariaLabel="Split orientation"
          />
        </Field>
      )}

      {session.mode === 'difference' && <DifferenceControls />}
    </div>
  );
}

function DifferenceControls() {
  const store = useCompare();
  const { difference } = store.session;
  return (
    <div className="space-y-3 rounded-lg border border-border bg-secondary/20 p-3">
      <Field label="Difference metric">
        <Seg<DifferenceMetric>
          value={difference.metric}
          options={[
            { value: 'value', label: 'Value' },
            { value: 'color', label: 'Color' },
          ]}
          onChange={(v) => store.setDifference({ metric: v })}
          ariaLabel="Difference metric"
        />
      </Field>
      <Field label="Sensitivity">
        <Seg<Sensitivity>
          value={difference.sensitivity}
          options={[
            { value: 'subtle', label: 'Subtle' },
            { value: 'balanced', label: 'Balanced' },
            { value: 'strong', label: 'Strong' },
          ]}
          onChange={(v) => store.setDifference({ sensitivity: v })}
          ariaLabel="Sensitivity"
        />
      </Field>
      <label className="flex items-center justify-between">
        <span className="text-sm text-foreground">Monochrome map</span>
        <input
          type="checkbox"
          className="h-5 w-5 accent-primary"
          checked={difference.monochrome}
          onChange={(e) => store.setDifference({ monochrome: e.target.checked })}
          aria-label="Monochrome difference map"
        />
      </label>

      {!difference.monochrome && (
        <div className="space-y-1 text-[11px]">
          <p className="font-medium text-muted-foreground">Legend</p>
          {difference.metric === 'value' ? (
            <div className="flex flex-wrap gap-3">
              <LegendItem color="#f59e0b" label="Artwork lighter" />
              <LegendItem color="#3b82f6" label="Artwork darker" />
              <LegendItem color="transparent" label="Close match" />
            </div>
          ) : (
            <div className="flex flex-wrap gap-3">
              <LegendItem color="#ef4444" label="Too warm" />
              <LegendItem color="#38bdf8" label="Too cool" />
              <LegendItem color="#f59e0b" label="Too light" />
              <LegendItem color="#3b82f6" label="Too dark" />
            </div>
          )}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        Color comparison depends on the lighting and white balance of the artwork photo.
      </p>
      <p className="text-[11px] text-muted-foreground" dir="rtl">
        השוואת הצבע מושפעת מהתאורה ומאיזון הלבן בתצלום הציור.
      </p>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-muted-foreground">
      <span
        className="inline-block h-3 w-3 rounded-sm border border-border"
        style={{ background: color === 'transparent' ? 'repeating-linear-gradient(45deg,#333,#333 2px,#222 2px,#222 4px)' : color }}
      />
      {label}
    </span>
  );
}

// ── Opacity sheet ─────────────────────────────────────────────────────────────
export function OpacitySheet() {
  const store = useCompare();
  const { session } = store;
  const pct = Math.round(session.opacity * 100);
  return (
    <div className="space-y-4">
      <Field label={`Reference opacity — ${pct}%`}>
        <input
          type="range"
          min={0}
          max={100}
          value={pct}
          onChange={(e) => store.setOpacity(Number(e.target.value) / 100)}
          onPointerUp={(e) => store.commitOpacity(Number((e.target as HTMLInputElement).value) / 100)}
          className="w-full accent-primary"
          aria-label="Reference opacity"
        />
        <div className="flex gap-2">
          {[0, 25, 50, 75, 100].map((v) => (
            <button
              key={v}
              onClick={() => store.commitOpacity(v / 100)}
              className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium ${
                pct === v ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'
              }`}
            >
              {v}%
            </button>
          ))}
        </div>
      </Field>
      <button
        onClick={store.toggleReferenceHidden}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-secondary px-3 py-2.5 text-sm font-medium text-foreground active:scale-95"
      >
        {session.referenceHidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
        {session.referenceHidden ? 'Show reference' : 'Hide reference'}
      </button>
    </div>
  );
}

// ── Align sheet ───────────────────────────────────────────────────────────────
interface AlignProps {
  selectedLayer: 'artwork' | 'reference';
  setSelectedLayer: (l: 'artwork' | 'reference') => void;
  nudgeStep: NudgeStep;
  setNudgeStep: (s: NudgeStep) => void;
  cropActive: boolean;
  onToggleCrop: () => void;
  onRecrop: (role: 'artwork' | 'reference') => void;
}

export function AlignSheet({
  selectedLayer,
  setSelectedLayer,
  nudgeStep,
  setNudgeStep,
  cropActive,
  onToggleCrop,
  onRecrop,
}: AlignProps) {
  const store = useCompare();
  const { session } = store;
  const nudge = (a: NudgeAction) => store.nudgeReference(nudgeStep, a);

  return (
    <div className="space-y-4">
      {/* Smart Align lives in the persistent alignment toolbar now, so this sheet
          is purely the MANUAL toolkit (nudge, layer, fit, mirror, crop). */}

      {/* Re-crop each source image (region to compare) */}
      <Field label="Re-crop source image">
        <div className="flex gap-2">
          <button
            onClick={() => onRecrop('artwork')}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-secondary px-3 py-2 text-xs font-medium text-foreground active:scale-95"
          >
            <Crop className="h-3.5 w-3.5" /> Artwork
          </button>
          <button
            onClick={() => onRecrop('reference')}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-secondary px-3 py-2 text-xs font-medium text-foreground active:scale-95"
          >
            <Crop className="h-3.5 w-3.5" /> Reference
          </button>
        </div>
      </Field>

      {/* Layer selector */}
      <Field label="Adjust layer">
        <div className="flex gap-2">
          <button
            onClick={() => setSelectedLayer('reference')}
            aria-pressed={selectedLayer === 'reference'}
            className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium ${
              selectedLayer === 'reference' ? 'bg-blue-500 text-white' : 'bg-secondary text-muted-foreground'
            }`}
          >
            Reference
          </button>
          <button
            onClick={() => {
              if (session.artworkLocked) return;
              setSelectedLayer('artwork');
            }}
            aria-pressed={selectedLayer === 'artwork'}
            disabled={session.artworkLocked}
            className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium ${
              selectedLayer === 'artwork' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'
            } ${session.artworkLocked ? 'opacity-50' : ''}`}
          >
            Artwork
          </button>
          <button
            onClick={store.toggleArtworkLock}
            className="flex items-center justify-center rounded-lg bg-secondary px-3 py-2 text-muted-foreground active:scale-95"
            aria-label={session.artworkLocked ? 'Unlock artwork' : 'Lock artwork'}
            title={session.artworkLocked ? 'Unlock artwork' : 'Lock artwork'}
          >
            {session.artworkLocked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
          </button>
        </div>
        {session.artworkLocked && (
          <p className="text-[11px] text-muted-foreground">Artwork is locked (fixed base). Unlock to move it.</p>
        )}
      </Field>

      {/* Precision step */}
      <Field label="Nudge amount">
        <Seg<NudgeStep>
          value={nudgeStep}
          options={[
            { value: 'fine', label: 'Fine' },
            { value: 'normal', label: 'Normal' },
          ]}
          onChange={setNudgeStep}
          ariaLabel="Nudge amount"
        />
      </Field>

      {/* Precision pad */}
      <div className="grid grid-cols-2 gap-3">
        <div className="grid grid-cols-3 grid-rows-3 gap-1.5">
          <span />
          <PadBtn onClick={() => nudge('up')} label="Move up"><ArrowUp className="h-4 w-4" /></PadBtn>
          <span />
          <PadBtn onClick={() => nudge('left')} label="Move left"><ArrowLeft className="h-4 w-4" /></PadBtn>
          <span />
          <PadBtn onClick={() => nudge('right')} label="Move right"><ArrowRight className="h-4 w-4" /></PadBtn>
          <span />
          <PadBtn onClick={() => nudge('down')} label="Move down"><ArrowDown className="h-4 w-4" /></PadBtn>
          <span />
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <PadBtn onClick={() => nudge('scaleUp')} label="Scale up"><ZoomIn className="h-4 w-4" /></PadBtn>
          <PadBtn onClick={() => nudge('scaleDown')} label="Scale down"><ZoomOut className="h-4 w-4" /></PadBtn>
          <PadBtn onClick={() => nudge('rotateCcw')} label="Rotate counter-clockwise"><RotateCcw className="h-4 w-4" /></PadBtn>
          <PadBtn onClick={() => nudge('rotateCw')} label="Rotate clockwise"><RotateCw className="h-4 w-4" /></PadBtn>
        </div>
      </div>

      {/* Presets */}
      <Field label="Fit presets">
        <div className="grid grid-cols-4 gap-2">
          <MiniBtn onClick={store.fitReference}>Fit</MiniBtn>
          <MiniBtn onClick={store.fillReference}>Fill</MiniBtn>
          <MiniBtn onClick={store.matchArtworkBounds}>Match</MiniBtn>
          <MiniBtn onClick={store.resetReferenceTransform}>Reset</MiniBtn>
        </div>
      </Field>

      {/* Actions — mirror the reference horizontally. (Smart Align is promoted
          to the top of this sheet.) */}
      <button
        onClick={store.flipReference}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-secondary px-3 py-2.5 text-sm font-medium text-foreground active:scale-95"
      >
        <FlipHorizontal2 className="h-4 w-4" /> Flip reference
      </button>

      <button
        onClick={onToggleCrop}
        className={`flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium active:scale-95 ${
          cropActive ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground'
        }`}
      >
        <Crop className="h-4 w-4" /> {cropActive ? 'Done cropping' : 'Crop region'}
      </button>
      {cropActive && (
        <div className="space-y-2 rounded-lg border border-border bg-secondary/20 p-3">
          <p className="text-[11px] text-muted-foreground">
            Trim away easel / wall around the painting. The source images stay unchanged.
          </p>
          <CropSlider label="Left" value={session.crop.x} max={1 - session.crop.w}
            onChange={(x) => store.setCropLive({ ...session.crop, x })} onCommit={() => store.setCrop(session.crop)} />
          <CropSlider label="Top" value={session.crop.y} max={1 - session.crop.h}
            onChange={(y) => store.setCropLive({ ...session.crop, y })} onCommit={() => store.setCrop(session.crop)} />
          <CropSlider label="Width" value={session.crop.w} min={0.1} max={1 - session.crop.x}
            onChange={(w) => store.setCropLive({ ...session.crop, w })} onCommit={() => store.setCrop(session.crop)} />
          <CropSlider label="Height" value={session.crop.h} min={0.1} max={1 - session.crop.y}
            onChange={(h) => store.setCropLive({ ...session.crop, h })} onCommit={() => store.setCrop(session.crop)} />
          <button onClick={store.resetCrop} className="w-full text-center text-[11px] text-muted-foreground">
            Reset crop
          </button>
        </div>
      )}
    </div>
  );
}

function PadBtn({ onClick, label, children }: { onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="flex h-11 items-center justify-center rounded-lg bg-secondary text-foreground active:scale-95 active:bg-primary active:text-primary-foreground"
    >
      {children}
    </button>
  );
}

function CropSlider({
  label,
  value,
  min = 0,
  max,
  onChange,
  onCommit,
}: {
  label: string;
  value: number;
  min?: number;
  max: number;
  onChange: (v: number) => void;
  onCommit: () => void;
}) {
  return (
    <div>
      <label className="text-[11px] text-muted-foreground">
        {label}: {Math.round(value * 100)}%
      </label>
      <input
        type="range"
        min={Math.round(min * 100)}
        max={Math.round(Math.max(min, max) * 100)}
        value={Math.round(value * 100)}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        onPointerUp={onCommit}
        className="w-full accent-primary"
        aria-label={`Crop ${label}`}
      />
    </div>
  );
}

function MiniBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="rounded-lg bg-secondary px-2 py-2 text-xs font-medium text-foreground active:scale-95"
    >
      {children}
    </button>
  );
}

// ── Grid sheet ────────────────────────────────────────────────────────────────
export function GridSheet() {
  const store = useCompare();
  const { grid } = store.session;
  const presets = [
    { label: '3×3', r: 3, c: 3 },
    { label: '4×4', r: 4, c: 4 },
    { label: '8×8', r: 8, c: 8 },
    { label: '10×10', r: 10, c: 10 },
  ];
  const colors = ['#ffffff', '#f59e0b', '#ef4444', '#3b82f6', '#10b981', '#000000'];

  return (
    <div className="space-y-4">
      <label className="flex items-center justify-between rounded-lg bg-secondary/40 px-3 py-2.5">
        <span className="text-sm font-medium text-foreground">Show grid</span>
        <input
          type="checkbox"
          className="h-5 w-5 accent-primary"
          checked={grid.enabled}
          onChange={(e) => store.setGrid({ enabled: e.target.checked })}
          aria-label="Show grid"
        />
      </label>

      <Field label="Presets">
        <div className="grid grid-cols-4 gap-2">
          {presets.map((p) => (
            <button
              key={p.label}
              onClick={() => store.setGrid({ rows: p.r, columns: p.c, enabled: true })}
              className={`rounded-lg px-2 py-2 text-xs font-medium ${
                grid.rows === p.r && grid.columns === p.c
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-muted-foreground'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label={`Columns: ${grid.columns}`}>
          <input type="range" min={1} max={16} value={grid.columns}
            onChange={(e) => store.setGrid({ columns: Number(e.target.value) })}
            className="w-full accent-primary" aria-label="Grid columns" />
        </Field>
        <Field label={`Rows: ${grid.rows}`}>
          <input type="range" min={1} max={16} value={grid.rows}
            onChange={(e) => store.setGrid({ rows: Number(e.target.value) })}
            className="w-full accent-primary" aria-label="Grid rows" />
        </Field>
      </div>

      <Field label="Line color">
        <div className="flex gap-2">
          {colors.map((c) => (
            <button
              key={c}
              onClick={() => store.setGrid({ lineColor: c })}
              aria-label={`Grid color ${c}`}
              className={`h-7 w-7 rounded-sm border ${grid.lineColor === c ? 'border-foreground scale-110' : 'border-transparent'}`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label={`Opacity: ${Math.round(grid.opacity * 100)}%`}>
          <input type="range" min={10} max={100} value={Math.round(grid.opacity * 100)}
            onChange={(e) => store.setGrid({ opacity: Number(e.target.value) / 100 })}
            className="w-full accent-primary" aria-label="Grid opacity" />
        </Field>
        <Field label={`Thickness: ${grid.lineWidth}px`}>
          <input type="range" min={1} max={5} value={grid.lineWidth}
            onChange={(e) => store.setGrid({ lineWidth: Number(e.target.value) })}
            className="w-full accent-primary" aria-label="Grid thickness" />
        </Field>
      </div>

      <label className="flex items-center justify-between">
        <span className="text-sm text-foreground">Emphasize center lines</span>
        <input type="checkbox" className="h-5 w-5 accent-primary" checked={grid.emphasizeCenter}
          onChange={(e) => store.setGrid({ emphasizeCenter: e.target.checked })} aria-label="Emphasize center lines" />
      </label>
      <label className="flex items-center justify-between">
        <span className="text-sm text-foreground">Square cells</span>
        <input type="checkbox" className="h-5 w-5 accent-primary" checked={grid.square}
          onChange={(e) => store.setGrid({ square: e.target.checked })} aria-label="Square grid cells" />
      </label>
      <label className="flex items-center justify-between">
        <span className="text-sm text-foreground">Include grid in export</span>
        <input type="checkbox" className="h-5 w-5 accent-primary" checked={grid.includeInExport}
          onChange={(e) => store.setGrid({ includeInExport: e.target.checked })} aria-label="Include grid in export" />
      </label>
    </div>
  );
}
