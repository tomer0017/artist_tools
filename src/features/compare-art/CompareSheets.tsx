// Compare Art — control sheet bodies (mode, align, opacity, grid).
//
// Each is a small, touch-first panel rendered inside CompareBottomSheet. They
// read/write the isolated Compare store. Alignment status and the "align first"
// guidance live here so they are prominent but non-blocking.
//
// Sliders and the precision pad act on the images in screen directions, so
// they stay left to right in every language; the rest follows the page.

import { useLocale, useTranslations } from 'use-intl';
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
  const t = useTranslations('compareTool');
  const store = useCompare();
  const { session } = store;
  const modes: { value: CompareMode; label: string }[] = [
    { value: 'overlay', label: t('modes.overlay') },
    { value: 'blink', label: t('modes.blink') },
    { value: 'split', label: t('modes.split') },
    { value: 'difference', label: t('modes.difference') },
  ];

  return (
    <div className="space-y-4">
      <Field label={t('view.mode')}>
        <Seg value={session.mode} options={modes} onChange={store.setMode} ariaLabel={t('view.mode')} />
      </Field>

      <label className="flex items-center justify-between rounded-lg bg-secondary/40 px-3 py-2.5">
        <span className="text-sm text-foreground">{t('view.grayscale')}</span>
        <input
          type="checkbox"
          className="h-5 w-5 accent-primary"
          checked={session.grayscale}
          onChange={(e) => store.setGrayscale(e.target.checked)}
          aria-label={t('view.grayscaleLabel')}
        />
      </label>

      {session.mode === 'blink' && (
        <Field label={t('view.blinkSpeed')}>
          <Seg<BlinkSpeed>
            value={session.blinkSpeed}
            options={[
              { value: 'slow', label: t('view.slow') },
              { value: 'normal', label: t('view.normal') },
              { value: 'fast', label: t('view.fast') },
            ]}
            onChange={store.setBlinkSpeed}
            ariaLabel={t('view.blinkSpeed')}
          />
          <p className="text-[11px] text-muted-foreground">{t('view.blinkTip')}</p>
        </Field>
      )}

      {session.mode === 'split' && (
        <Field label={t('view.splitOrientation')}>
          <Seg<SplitOrientation>
            value={session.splitOrientation}
            options={[
              { value: 'horizontal', label: t('view.verticalBar') },
              { value: 'vertical', label: t('view.horizontalBar') },
            ]}
            onChange={store.setSplitOrientation}
            ariaLabel={t('view.splitOrientation')}
          />
        </Field>
      )}

      {session.mode === 'difference' && <DifferenceControls />}
    </div>
  );
}

function DifferenceControls() {
  const t = useTranslations('compareTool');
  const locale = useLocale();
  const store = useCompare();
  const { difference } = store.session;
  return (
    <div className="space-y-3 rounded-lg border border-border bg-secondary/20 p-3">
      <Field label={t('view.metric')}>
        <Seg<DifferenceMetric>
          value={difference.metric}
          options={[
            { value: 'value', label: t('view.value') },
            { value: 'color', label: t('view.color') },
          ]}
          onChange={(v) => store.setDifference({ metric: v })}
          ariaLabel={t('view.metric')}
        />
      </Field>
      <Field label={t('view.sensitivity')}>
        <Seg<Sensitivity>
          value={difference.sensitivity}
          options={[
            { value: 'subtle', label: t('view.subtle') },
            { value: 'balanced', label: t('view.balanced') },
            { value: 'strong', label: t('view.strong') },
          ]}
          onChange={(v) => store.setDifference({ sensitivity: v })}
          ariaLabel={t('view.sensitivity')}
        />
      </Field>
      <label className="flex items-center justify-between">
        <span className="text-sm text-foreground">{t('view.monochrome')}</span>
        <input
          type="checkbox"
          className="h-5 w-5 accent-primary"
          checked={difference.monochrome}
          onChange={(e) => store.setDifference({ monochrome: e.target.checked })}
          aria-label={t('view.monochromeLabel')}
        />
      </label>

      {!difference.monochrome && (
        <div className="space-y-1 text-[11px]">
          <p className="font-medium text-muted-foreground">{t('view.legend')}</p>
          {difference.metric === 'value' ? (
            <div className="flex flex-wrap gap-3">
              <LegendItem color="#f59e0b" label={t('view.artworkLighter')} />
              <LegendItem color="#3b82f6" label={t('view.artworkDarker')} />
              <LegendItem color="transparent" label={t('view.closeMatch')} />
            </div>
          ) : (
            <div className="flex flex-wrap gap-3">
              <LegendItem color="#ef4444" label={t('view.tooWarm')} />
              <LegendItem color="#38bdf8" label={t('view.tooCool')} />
              <LegendItem color="#f59e0b" label={t('view.tooLight')} />
              <LegendItem color="#3b82f6" label={t('view.tooDark')} />
            </div>
          )}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        {t('view.colorNote')}
      </p>
      {/* The Hebrew line under the English one; Hebrew pages already say it above. */}
      {locale === 'en' && (
        <p className="text-[11px] text-muted-foreground" dir="rtl">
          השוואת הצבע מושפעת מהתאורה ומאיזון הלבן בתצלום הציור.
        </p>
      )}
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
  const t = useTranslations('compareTool');
  const store = useCompare();
  const { session } = store;
  const pct = Math.round(session.opacity * 100);
  return (
    <div className="space-y-4">
      <Field label={t('overlay.opacityValue', { value: String(pct) })}>
        <input
          type="range"
          dir="ltr"
          min={0}
          max={100}
          value={pct}
          onChange={(e) => store.setOpacity(Number(e.target.value) / 100)}
          onPointerUp={(e) => store.commitOpacity(Number((e.target as HTMLInputElement).value) / 100)}
          className="w-full accent-primary"
          aria-label={t('overlay.opacityLabel')}
        />
        {/* Laid out like the slider above: 0% on the left. */}
        <div className="flex gap-2" dir="ltr">
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
        {session.referenceHidden ? t('overlay.show') : t('overlay.hide')}
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
  const t = useTranslations('compareTool');
  const store = useCompare();
  const { session } = store;
  const nudge = (a: NudgeAction) => store.nudgeReference(nudgeStep, a);

  return (
    <div className="space-y-4">
      {/* Smart Align lives in the persistent alignment toolbar now, so this sheet
          is purely the MANUAL toolkit (nudge, layer, fit, mirror, crop). */}

      {/* Re-crop each source image (region to compare) */}
      <Field label={t('align.sheet.recrop')}>
        <div className="flex gap-2">
          <button
            onClick={() => onRecrop('artwork')}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-secondary px-3 py-2 text-xs font-medium text-foreground active:scale-95"
          >
            <Crop className="h-3.5 w-3.5" /> {t('align.sheet.artwork')}
          </button>
          <button
            onClick={() => onRecrop('reference')}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-secondary px-3 py-2 text-xs font-medium text-foreground active:scale-95"
          >
            <Crop className="h-3.5 w-3.5" /> {t('align.sheet.reference')}
          </button>
        </div>
      </Field>

      {/* Layer selector */}
      <Field label={t('align.sheet.layer')}>
        <div className="flex gap-2">
          <button
            onClick={() => setSelectedLayer('reference')}
            aria-pressed={selectedLayer === 'reference'}
            className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium ${
              selectedLayer === 'reference' ? 'bg-blue-500 text-white' : 'bg-secondary text-muted-foreground'
            }`}
          >
            {t('align.sheet.reference')}
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
            {t('align.sheet.artwork')}
          </button>
          <button
            onClick={store.toggleArtworkLock}
            className="flex items-center justify-center rounded-lg bg-secondary px-3 py-2 text-muted-foreground active:scale-95"
            aria-label={session.artworkLocked ? t('align.sheet.unlock') : t('align.sheet.lock')}
            title={session.artworkLocked ? t('align.sheet.unlock') : t('align.sheet.lock')}
          >
            {session.artworkLocked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
          </button>
        </div>
        {session.artworkLocked && (
          <p className="text-[11px] text-muted-foreground">{t('align.sheet.locked')}</p>
        )}
      </Field>

      {/* Precision step */}
      <Field label={t('align.sheet.nudge')}>
        <Seg<NudgeStep>
          value={nudgeStep}
          options={[
            { value: 'fine', label: t('align.sheet.fine') },
            { value: 'normal', label: t('align.sheet.normal') },
          ]}
          onChange={setNudgeStep}
          ariaLabel={t('align.sheet.nudge')}
        />
      </Field>

      {/* Precision pad: its arrows move the image in screen directions, so it
          keeps this layout in every language. */}
      <div className="grid grid-cols-2 gap-3" dir="ltr">
        <div className="grid grid-cols-3 grid-rows-3 gap-1.5">
          <span />
          <PadBtn onClick={() => nudge('up')} label={t('align.sheet.moveUp')}><ArrowUp className="h-4 w-4" /></PadBtn>
          <span />
          <PadBtn onClick={() => nudge('left')} label={t('align.sheet.moveLeft')}><ArrowLeft className="h-4 w-4" /></PadBtn>
          <span />
          <PadBtn onClick={() => nudge('right')} label={t('align.sheet.moveRight')}><ArrowRight className="h-4 w-4" /></PadBtn>
          <span />
          <PadBtn onClick={() => nudge('down')} label={t('align.sheet.moveDown')}><ArrowDown className="h-4 w-4" /></PadBtn>
          <span />
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <PadBtn onClick={() => nudge('scaleUp')} label={t('align.sheet.scaleUp')}><ZoomIn className="h-4 w-4" /></PadBtn>
          <PadBtn onClick={() => nudge('scaleDown')} label={t('align.sheet.scaleDown')}><ZoomOut className="h-4 w-4" /></PadBtn>
          <PadBtn onClick={() => nudge('rotateCcw')} label={t('align.sheet.rotateCcw')}><RotateCcw className="h-4 w-4" /></PadBtn>
          <PadBtn onClick={() => nudge('rotateCw')} label={t('align.sheet.rotateCw')}><RotateCw className="h-4 w-4" /></PadBtn>
        </div>
      </div>

      {/* Presets */}
      <Field label={t('align.sheet.presets')}>
        <div className="grid grid-cols-4 gap-2">
          <MiniBtn onClick={store.fitReference}>{t('align.sheet.fit')}</MiniBtn>
          <MiniBtn onClick={store.fillReference}>{t('align.sheet.fill')}</MiniBtn>
          <MiniBtn onClick={store.matchArtworkBounds}>{t('align.sheet.match')}</MiniBtn>
          <MiniBtn onClick={store.resetReferenceTransform}>{t('align.sheet.reset')}</MiniBtn>
        </div>
      </Field>

      {/* Actions — mirror the reference horizontally. (Smart Align is promoted
          to the top of this sheet.) */}
      <button
        onClick={store.flipReference}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-secondary px-3 py-2.5 text-sm font-medium text-foreground active:scale-95"
      >
        <FlipHorizontal2 className="h-4 w-4" /> {t('align.sheet.flip')}
      </button>

      <button
        onClick={onToggleCrop}
        className={`flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium active:scale-95 ${
          cropActive ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground'
        }`}
      >
        <Crop className="h-4 w-4" /> {cropActive ? t('align.sheet.cropDone') : t('align.sheet.cropRegion')}
      </button>
      {cropActive && (
        <div className="space-y-2 rounded-lg border border-border bg-secondary/20 p-3">
          <p className="text-[11px] text-muted-foreground">
            {t('align.sheet.cropHint')}
          </p>
          <CropSlider label={t('align.sheet.cropLeft')} value={session.crop.x} max={1 - session.crop.w}
            onChange={(x) => store.setCropLive({ ...session.crop, x })} onCommit={() => store.setCrop(session.crop)} />
          <CropSlider label={t('align.sheet.cropTop')} value={session.crop.y} max={1 - session.crop.h}
            onChange={(y) => store.setCropLive({ ...session.crop, y })} onCommit={() => store.setCrop(session.crop)} />
          <CropSlider label={t('align.sheet.cropWidth')} value={session.crop.w} min={0.1} max={1 - session.crop.x}
            onChange={(w) => store.setCropLive({ ...session.crop, w })} onCommit={() => store.setCrop(session.crop)} />
          <CropSlider label={t('align.sheet.cropHeight')} value={session.crop.h} min={0.1} max={1 - session.crop.y}
            onChange={(h) => store.setCropLive({ ...session.crop, h })} onCommit={() => store.setCrop(session.crop)} />
          <button onClick={store.resetCrop} className="w-full text-center text-[11px] text-muted-foreground">
            {t('align.sheet.cropReset')}
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
  const t = useTranslations('compareTool');
  return (
    <div>
      <label className="text-[11px] text-muted-foreground">
        {t('align.sheet.cropValue', { label, value: String(Math.round(value * 100)) })}
      </label>
      <input
        type="range"
        dir="ltr"
        min={Math.round(min * 100)}
        max={Math.round(Math.max(min, max) * 100)}
        value={Math.round(value * 100)}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        onPointerUp={onCommit}
        className="w-full accent-primary"
        aria-label={t('align.sheet.cropSlider', { label })}
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
  const t = useTranslations('compareTool');
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
        <span className="text-sm font-medium text-foreground">{t('grid.show')}</span>
        <input
          type="checkbox"
          className="h-5 w-5 accent-primary"
          checked={grid.enabled}
          onChange={(e) => store.setGrid({ enabled: e.target.checked })}
          aria-label={t('grid.show')}
        />
      </label>

      <Field label={t('grid.presets')}>
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
        <Field label={t('grid.columns', { value: String(grid.columns) })}>
          <input type="range" dir="ltr" min={1} max={16} value={grid.columns}
            onChange={(e) => store.setGrid({ columns: Number(e.target.value) })}
            className="w-full accent-primary" aria-label={t('grid.columnsLabel')} />
        </Field>
        <Field label={t('grid.rows', { value: String(grid.rows) })}>
          <input type="range" dir="ltr" min={1} max={16} value={grid.rows}
            onChange={(e) => store.setGrid({ rows: Number(e.target.value) })}
            className="w-full accent-primary" aria-label={t('grid.rowsLabel')} />
        </Field>
      </div>

      <Field label={t('grid.lineColor')}>
        <div className="flex gap-2">
          {colors.map((c) => (
            <button
              key={c}
              onClick={() => store.setGrid({ lineColor: c })}
              aria-label={t('grid.colorLabel', { color: c })}
              className={`h-7 w-7 rounded-sm border ${grid.lineColor === c ? 'border-foreground scale-110' : 'border-transparent'}`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label={t('grid.opacity', { value: String(Math.round(grid.opacity * 100)) })}>
          <input type="range" dir="ltr" min={10} max={100} value={Math.round(grid.opacity * 100)}
            onChange={(e) => store.setGrid({ opacity: Number(e.target.value) / 100 })}
            className="w-full accent-primary" aria-label={t('grid.opacityLabel')} />
        </Field>
        <Field label={t('grid.thickness', { value: String(grid.lineWidth) })}>
          <input type="range" dir="ltr" min={1} max={5} value={grid.lineWidth}
            onChange={(e) => store.setGrid({ lineWidth: Number(e.target.value) })}
            className="w-full accent-primary" aria-label={t('grid.thicknessLabel')} />
        </Field>
      </div>

      <label className="flex items-center justify-between">
        <span className="text-sm text-foreground">{t('grid.emphasizeCenter')}</span>
        <input type="checkbox" className="h-5 w-5 accent-primary" checked={grid.emphasizeCenter}
          onChange={(e) => store.setGrid({ emphasizeCenter: e.target.checked })} aria-label={t('grid.emphasizeCenter')} />
      </label>
      <label className="flex items-center justify-between">
        <span className="text-sm text-foreground">{t('grid.square')}</span>
        <input type="checkbox" className="h-5 w-5 accent-primary" checked={grid.square}
          onChange={(e) => store.setGrid({ square: e.target.checked })} aria-label={t('grid.squareLabel')} />
      </label>
      <label className="flex items-center justify-between">
        <span className="text-sm text-foreground">{t('grid.includeInExport')}</span>
        <input type="checkbox" className="h-5 w-5 accent-primary" checked={grid.includeInExport}
          onChange={(e) => store.setGrid({ includeInExport: e.target.checked })} aria-label={t('grid.includeInExport')} />
      </label>
    </div>
  );
}
