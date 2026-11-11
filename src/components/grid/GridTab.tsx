import { useRef, useState, useCallback, useEffect } from 'react';
import { useTranslations } from 'use-intl';
import { useProject } from '@/hooks/useProjectStore';
import { useIsMobile } from '@/hooks/use-mobile';
import ImageUploader from '@/components/common/ImageUploader';
import { Download, RefreshCw } from 'lucide-react';
import ToolHeader from '@/components/shell/ToolHeader';
import ToolEmptyState from '@/components/shell/ToolEmptyState';
import type { GridSettings } from '@/types/project';
import { useSaveMedia } from '@/components/common/SaveMedia';
import { canvasToBlob } from '@/lib/saveMedia';
import type { gridEn } from '@/i18n/messages/tools/grid';

// Numbers go into messages as the strings they always were (no locale
// formatting), so the English text stays exactly as before.
export default function GridTab() {
  const t = useTranslations('gridTool');
  const { image, gridImage, setGridImage, initGridImageFromReference, gridSettings, setGridSettings } = useProject();
  const { save } = useSaveMedia();
  // Mobile panel: the common presets first, every setting one tap away.
  const [panel, setPanel] = useState<'preset' | 'customize'>('preset');
  const [imageNaturalSize, setImageNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const isMobile = useIsMobile();

  // Grid works on its OWN image (see the store): initialize it once from the
  // main reference so the tool never opens empty when a reference exists, then
  // keep the two documents fully independent.
  useEffect(() => {
    initGridImageFromReference();
  }, [initGridImageFromReference]);

  const activeImage = gridImage;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const exportCanvasRef = useRef<HTMLCanvasElement>(null);

  // Touch/drag state for moving image
  const dragRef = useRef<{ startX: number; startY: number; initOX: number; initOY: number } | null>(null);
  // Pinch-to-scale state
  const pinchRef = useRef<{ initDist: number; initScale: number } | null>(null);

  const gs = gridSettings;
  const aspect = gs.canvasWidth / gs.canvasHeight;

  const update = useCallback((partial: Partial<GridSettings>) => {
    setGridSettings(partial);
  }, [setGridSettings]);

  const getFitScale = useCallback((imageWidth: number, imageHeight: number) => {
    if (!imageWidth || !imageHeight) return 1;
    return Math.min(gs.canvasWidth / imageWidth, gs.canvasHeight / imageHeight);
  }, [gs.canvasWidth, gs.canvasHeight]);

  const fitImage = useCallback(() => {
    update({ imageScale: 1, imageOffsetX: 0, imageOffsetY: 0 });
  }, [update]);

  const fillCanvas = useCallback(() => {
    if (!imageNaturalSize) return;
    const fitScale = getFitScale(imageNaturalSize.w, imageNaturalSize.h);
    const fillScale = Math.max(gs.canvasWidth / imageNaturalSize.w, gs.canvasHeight / imageNaturalSize.h);
    update({
      imageScale: fillScale / fitScale,
      imageOffsetX: 0,
      imageOffsetY: 0,
    });
  }, [getFitScale, gs.canvasHeight, gs.canvasWidth, imageNaturalSize, update]);

  const resetImagePosition = useCallback(() => {
    update({ imageOffsetX: 0, imageOffsetY: 0 });
  }, [update]);

  // Draw grid onto visible canvas
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const maxW = container.clientWidth - 16;
    const maxH = container.clientHeight - 16;
    const scale = Math.min(maxW / gs.canvasWidth, maxH / gs.canvasHeight);
    const w = Math.round(gs.canvasWidth * scale);
    const h = Math.round(gs.canvasHeight * scale);

    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;

    // Background
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(0, 0, w, h);

    // Draw image if present
    if (activeImage) {
      const img = new Image();
      img.onerror = (e) => {
        console.error('[GridTab] Failed to load image for grid preview:', e);
      };
      img.onload = () => {
        try {
          ctx.save();
          ctx.beginPath();
          ctx.rect(0, 0, w, h);
          ctx.clip();

          const baseScale = getFitScale(img.naturalWidth, img.naturalHeight);
          const imgW = img.naturalWidth * baseScale * gs.imageScale * scale;
          const imgH = img.naturalHeight * baseScale * gs.imageScale * scale;
          const ox = gs.imageOffsetX * scale;
          const oy = gs.imageOffsetY * scale;

          // Center image then apply offset
          const cx = (w - imgW) / 2 + ox;
          const cy = (h - imgH) / 2 + oy;
          ctx.drawImage(img, cx, cy, imgW, imgH);
          ctx.restore();

          drawGrid(ctx, w, h);
        } catch (error) {
          console.error('[GridTab] Failed to draw grid preview canvas:', error);
        }
      };
      img.src = activeImage;
    } else {
      drawGrid(ctx, w, h);
    }
  }, [activeImage, getFitScale, gs]);

  const drawGrid = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number) => {
    ctx.strokeStyle = gs.lineColor;
    ctx.globalAlpha = gs.lineOpacity;
    ctx.lineWidth = gs.lineWidth;

    // Columns
    for (let i = 1; i < gs.columns; i++) {
      const x = Math.round((i / gs.columns) * w);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    // Rows
    for (let i = 1; i < gs.rows; i++) {
      const y = Math.round((i / gs.rows) * h);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Border
    ctx.globalAlpha = Math.min(1, gs.lineOpacity + 0.3);
    ctx.strokeRect(0, 0, w, h);
    ctx.globalAlpha = 1;
  }, [gs]);

  useEffect(() => {
    draw();
  }, [draw]);

  // Resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(el);
    return () => ro.disconnect();
  }, [draw]);

  useEffect(() => {
    if (!activeImage) {
      setImageNaturalSize(null);
      return;
    }
    const img = new Image();
    img.onload = () => {
      setImageNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.onerror = (e) => {
      console.error('[GridTab] Failed to load image to read natural size:', e);
    };
    img.src = activeImage;
  }, [activeImage]);

  // Drag to move image
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (!activeImage) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initOX: gs.imageOffsetX,
      initOY: gs.imageOffsetY,
    };
  }, [activeImage, gs.imageOffsetX, gs.imageOffsetY]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const container = containerRef.current;
    if (!container) return;
    const maxW = container.clientWidth - 16;
    const maxH = container.clientHeight - 16;
    const scale = Math.min(maxW / gs.canvasWidth, maxH / gs.canvasHeight);

    const dx = (e.clientX - dragRef.current.startX) / scale;
    const dy = (e.clientY - dragRef.current.startY) / scale;
    update({
      imageOffsetX: dragRef.current.initOX + dx,
      imageOffsetY: dragRef.current.initOY + dy,
    });
  }, [gs.canvasWidth, gs.canvasHeight, update]);

  const handlePointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  // Touch pinch for scaling
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const d = Math.hypot(
        e.touches[1].clientX - e.touches[0].clientX,
        e.touches[1].clientY - e.touches[0].clientY,
      );
      pinchRef.current = { initDist: d, initScale: gs.imageScale };
    }
  }, [gs.imageScale]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchRef.current) {
      e.preventDefault();
      const d = Math.hypot(
        e.touches[1].clientX - e.touches[0].clientX,
        e.touches[1].clientY - e.touches[0].clientY,
      );
      const ratio = d / pinchRef.current.initDist;
      update({ imageScale: Math.max(0.25, Math.min(8, pinchRef.current.initScale * ratio)) });
    }
  }, [update]);

  const handleTouchEnd = useCallback(() => {
    pinchRef.current = null;
  }, []);

  // Wheel to scale image
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!activeImage) return;
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.95 : 1.05;
    update({ imageScale: Math.max(0.25, Math.min(8, gs.imageScale * factor)) });
  }, [activeImage, gs.imageScale, update]);

  // Export
  const handleExport = useCallback(() => {
    const exportW = 2400;
    const exportH = Math.round(exportW / aspect);
    const canvas = document.createElement('canvas');
    canvas.width = exportW;
    canvas.height = exportH;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(0, 0, exportW, exportH);

    const doExport = () => {
      try {
        drawGridOnCtx(ctx, exportW, exportH);
        const filename = `grid-${gs.columns}x${gs.rows}-${gs.canvasWidth}x${gs.canvasHeight}${gs.unit}.png`;
        canvasToBlob(canvas, 'image/png')
          .then((blob) => save({ blob, filename, mime: 'image/png', title: t('saveTitle') }))
          .catch((error) => console.error('[GridTab] Failed to export grid PNG:', error));
      } catch (error) {
        console.error('[GridTab] Failed to export grid PNG:', error);
      }
    };

    if (activeImage) {
      const img = new Image();
      img.onerror = (e) => {
        console.error('[GridTab] Failed to load image for grid PNG export:', e);
      };
      img.onload = () => {
        try {
          const baseScale = getFitScale(img.naturalWidth, img.naturalHeight);
          const unitScale = exportW / gs.canvasWidth;
          const imgW = img.naturalWidth * baseScale * gs.imageScale * unitScale;
          const imgH = img.naturalHeight * baseScale * gs.imageScale * unitScale;
          const ox = gs.imageOffsetX * (exportW / gs.canvasWidth);
          const oy = gs.imageOffsetY * (exportW / gs.canvasWidth);
          const cx = (exportW - imgW) / 2 + ox;
          const cy = (exportH - imgH) / 2 + oy;
          ctx.save();
          ctx.beginPath();
          ctx.rect(0, 0, exportW, exportH);
          ctx.clip();
          ctx.drawImage(img, cx, cy, imgW, imgH);
          ctx.restore();
        } catch (error) {
          console.error('[GridTab] Failed to draw image onto grid export canvas:', error);
        }
        doExport();
      };
      img.src = activeImage;
    } else {
      doExport();
    }
  }, [activeImage, aspect, getFitScale, gs, save, t]);

  const drawGridOnCtx = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number) => {
    ctx.strokeStyle = gs.lineColor;
    ctx.globalAlpha = gs.lineOpacity;
    ctx.lineWidth = Math.max(1, gs.lineWidth * (w / 600));

    for (let i = 1; i < gs.columns; i++) {
      const x = Math.round((i / gs.columns) * w);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let i = 1; i < gs.rows; i++) {
      const y = Math.round((i / gs.rows) * h);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.globalAlpha = Math.min(1, gs.lineOpacity + 0.3);
    ctx.strokeRect(0, 0, w, h);
    ctx.globalAlpha = 1;
  }, [gs]);

  const GRID_COLORS = ['#ffffff', '#f59e0b', '#ef4444', '#3b82f6', '#10b981', '#8b5cf6'];

  const fitButtons = activeImage && (
    <SegmentedRow
      label={t('fit.label')}
      options={[
        { label: t('fit.fit'), onClick: fitImage },
        { label: t('fit.fill'), onClick: fillCanvas },
        { label: t('fit.center'), onClick: resetImagePosition },
      ]}
    />
  );

  const replaceButton = (
    <ImageUploader
      onImageLoad={setGridImage}
      compact
      label={isMobile ? undefined : t('replaceImage')}
      icon={<RefreshCw className="w-4 h-4" />}
    />
  );

  const sizes = {
    columns: `${gs.columns}`,
    rows: `${gs.rows}`,
    width: `${gs.canvasWidth}`,
    height: `${gs.canvasHeight}`,
    unit: gs.unit,
  };

  return (
    <div className="relative flex-1 flex flex-col min-h-0">
      <ToolHeader
        tool="grid"
        task={activeImage ? t('task.withImage', sizes) : t('task.empty')}
        actions={activeImage ? replaceButton : undefined}
      />
      {/* No image yet: explain the method instead of showing an empty grid.
          The canvas stays mounted (hidden) so its effects keep their refs. */}
      {!activeImage && (
        <ToolEmptyState
          tool="grid"
          heading={t('empty.heading')}
          steps={[t('empty.step1'), t('empty.step2'), t('empty.step3')]}
        >
          <ImageUploader primary label={t('empty.upload')} onImageLoad={setGridImage} />
        </ToolEmptyState>
      )}
      {/* The gridded preview (canvas, drag and pinch) stays left to right in every language. */}
      {isMobile ? (
        <>
          <div
            ref={containerRef}
            data-onboarding="grid-canvas"
            dir="ltr"
            className={`relative flex-1 canvas-area flex items-center justify-center p-2 min-h-0 ${activeImage ? '' : 'hidden'}`}
          >
            <canvas
              ref={canvasRef}
              className="rounded shadow-lg cursor-move touch-none"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onWheel={handleWheel}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              style={{ maxWidth: '100%', maxHeight: '100%' }}
            />
          </div>

          {activeImage && (
            <div className="shrink-0 border-t border-border bg-card px-3 pb-3 pt-2 space-y-2.5">
              <SegmentedTabs<'preset' | 'customize'> value={panel} onChange={setPanel}
                options={[{ value: 'preset', label: t('panel.preset') }, { value: 'customize', label: t('panel.customize') }]} />
              {panel === 'preset' ? (
                <GridPresets gs={gs} update={update} />
              ) : (
                <div className="max-h-[36vh] overflow-y-auto space-y-3 pe-1">
                  <GridControls gs={gs} update={update} activeImage={activeImage} colors={GRID_COLORS} />
                </div>
              )}
              {fitButtons}
              <button
                onClick={handleExport}
                data-onboarding="grid-export"
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-[15px] font-semibold text-primary-foreground active:opacity-90"
              >
                <Download className="h-5 w-5" /> {t('saveImage')}
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-1 min-h-0">
          {/* Desktop sidebar */}
          <div className={`w-64 panel-surface border-e border-border p-3 space-y-4 overflow-y-auto shrink-0 ${activeImage ? '' : 'hidden'}`}>
            <div>
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1.5">{t('sidebar.grid')}</p>
              <GridPresets gs={gs} update={update} />
            </div>
            {fitButtons}
            <details className="group">
              <summary className="flex min-h-[40px] cursor-pointer list-none items-center justify-between text-sm font-medium text-foreground">
                {t('sidebar.customize')}
                <span className="text-muted-foreground transition-transform group-open:rotate-180">▾</span>
              </summary>
              <div className="space-y-4 pt-2">
                <GridControls gs={gs} update={update} activeImage={activeImage} colors={GRID_COLORS} />
              </div>
            </details>
          </div>

          {/* Desktop canvas */}
          <div
            ref={containerRef}
            data-onboarding="grid-canvas"
            dir="ltr"
            className={`relative flex-1 canvas-area flex items-center justify-center p-4 min-h-0 ${activeImage ? '' : 'hidden'}`}
          >
            <canvas
              ref={canvasRef}
              className="rounded shadow-lg cursor-move touch-none"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onWheel={handleWheel}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              style={{ maxWidth: '100%', maxHeight: '100%' }}
            />

          </div>
        </div>
      )}

      {/* Export bar — primary canvas actions live here (image + export). */}
      {!isMobile && activeImage && (
        <div className="flex items-center justify-between px-3 py-2 toolbar-surface border-t border-border shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-muted-foreground">
              {t('summary', sizes)}
            </span>
          </div>
          <button
            onClick={handleExport}
            data-onboarding="grid-export"
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-primary text-primary-foreground rounded-lg hover:opacity-90 active:scale-95 transition-transform"
          >
            <Download className="w-4 h-4" />
            {t('saveImage')}
          </button>
        </div>
      )}

      <canvas ref={exportCanvasRef} className="hidden" />
    </div>
  );
}

// ─── Presets ──────────────────────────────────────────
// Each note is a message key (gridTool.presets.notes).
const GRID_PRESETS: { n: number; note: keyof typeof gridEn.presets.notes }[] = [
  { n: 3, note: 'simple' },
  { n: 4, note: 'recommended' },
  { n: 8, note: 'detailed' },
];

function GridPresets({ gs, update }: { gs: GridSettings; update: (p: Partial<GridSettings>) => void }) {
  const t = useTranslations('gridTool.presets');
  return (
    <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t('label')}>
      {GRID_PRESETS.map(({ n, note: noteKey }) => {
        const active = gs.columns === n && gs.rows === n;
        const note = t(`notes.${noteKey}`);
        return (
          <button key={n} role="radio" aria-checked={active} aria-label={t('option', { n: `${n}`, note })}
            onClick={() => update({ columns: n, rows: n })}
            className={`flex flex-col items-center gap-1 rounded-xl border py-2 transition-colors ${
              active ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-secondary/40 text-foreground hover:border-primary/40'
            }`}>
            <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
              <rect x="2" y="2" width="20" height="20" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
              {Array.from({ length: n - 1 }, (_, i) => {
                const p = 2 + ((i + 1) * 20) / n;
                return <path key={i} d={`M${p} 2V22M2 ${p}H22`} stroke="currentColor" strokeWidth="1" />;
              })}
            </svg>
            <span className="text-sm font-semibold leading-none">{n} × {n}</span>
            <span className={`text-[10px] leading-none ${active ? 'text-primary' : 'text-muted-foreground'}`}>{note}</span>
          </button>
        );
      })}
    </div>
  );
}

function SegmentedTabs<T extends string>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[];
}) {
  return (
    <div className="flex rounded-lg bg-secondary/60 p-0.5" role="tablist">
      {options.map(o => (
        <button key={o.value} role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)}
          className={`min-h-[36px] flex-1 rounded-md text-sm font-medium transition-colors ${
            value === o.value ? 'bg-card text-foreground shadow' : 'text-muted-foreground'
          }`}>{o.label}</button>
      ))}
    </div>
  );
}

// One-shot actions laid out like a segmented control (Fit / Fill / Center).
function SegmentedRow({ label, options }: { label: string; options: { label: string; onClick: () => void }[] }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex flex-1 gap-1.5">
        {options.map(o => (
          <button key={o.label} onClick={o.onClick}
            className="min-h-[40px] flex-1 rounded-lg border border-border bg-secondary/40 text-sm font-medium text-foreground active:bg-secondary hover:bg-secondary">
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Grid Controls Sub-component ──────────────────────
function GridControls({
  gs,
  update,
  activeImage,
  colors,
}: {
  gs: GridSettings;
  update: (p: Partial<GridSettings>) => void;
  activeImage: string | null;
  colors: string[];
}) {
  const t = useTranslations('gridTool.controls');
  // Number fields and sliders stay left to right in every language.
  return (
    <>
      {/* Canvas dimensions */}
      <div data-onboarding="grid-size">
        <label className="text-xs text-muted-foreground font-medium uppercase tracking-wider block mb-1.5">
          {t('canvasSize')}
        </label>
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <input
              type="number"
              inputMode="decimal"
              dir="ltr"
              value={gs.canvasWidth}
              onChange={(e) => update({ canvasWidth: Math.max(1, Number(e.target.value)) })}
              className="w-full px-2 py-1.5 text-sm bg-secondary border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <span className="text-[10px] text-muted-foreground">{t('width')}</span>
          </div>
          <span className="text-muted-foreground text-sm mt-[-14px]">×</span>
          <div className="flex-1">
            <input
              type="number"
              inputMode="decimal"
              dir="ltr"
              value={gs.canvasHeight}
              onChange={(e) => update({ canvasHeight: Math.max(1, Number(e.target.value)) })}
              className="w-full px-2 py-1.5 text-sm bg-secondary border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <span className="text-[10px] text-muted-foreground">{t('height')}</span>
          </div>
          <select
            value={gs.unit}
            onChange={(e) => update({ unit: e.target.value as 'cm' | 'in' })}
            className="px-2 py-1.5 text-sm bg-secondary border border-border rounded text-foreground mt-[-14px]"
          >
            <option value="cm">cm</option>
            <option value="in">in</option>
          </select>
        </div>
      </div>

      {/* Common presets */}
      <div>
        <label className="text-xs text-muted-foreground font-medium block mb-1.5">{t('quickRatios')}</label>
        <div className="flex flex-wrap gap-1.5">
          {[
            { label: '1:1', w: 50, h: 50 },
            { label: '3:4', w: 30, h: 40 },
            { label: '4:5', w: 40, h: 50 },
            { label: '2:3', w: 40, h: 60 },
            { label: '9:16', w: 45, h: 80 },
          ].map(p => (
            <button
              key={p.label}
              onClick={() => update({ canvasWidth: p.w, canvasHeight: p.h })}
              className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                gs.canvasWidth === p.w && gs.canvasHeight === p.h
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Grid divisions */}
      <div data-onboarding="grid-divisions">
        <label className="text-xs text-muted-foreground font-medium uppercase tracking-wider block mb-1.5">
          {t('divisions')}
        </label>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <label className="text-[10px] text-muted-foreground">{t('columns', { count: `${gs.columns}` })}</label>
            <input
              type="range"
              dir="ltr"
              min={1}
              max={16}
              value={gs.columns}
              onChange={(e) => update({ columns: Number(e.target.value) })}
              className="w-full accent-primary"
            />
          </div>
          <div className="flex-1">
            <label className="text-[10px] text-muted-foreground">{t('rows', { count: `${gs.rows}` })}</label>
            <input
              type="range"
              dir="ltr"
              min={1}
              max={16}
              value={gs.rows}
              onChange={(e) => update({ rows: Number(e.target.value) })}
              className="w-full accent-primary"
            />
          </div>
        </div>
      </div>

      {/* Line appearance */}
      <div>
        <label className="text-xs text-muted-foreground font-medium uppercase tracking-wider block mb-1.5">
          {t('lineStyle')}
        </label>
        <div className="flex items-center gap-1.5 mb-2">
          {colors.map(c => (
            <button
              key={c}
              onClick={() => update({ lineColor: c })}
              className={`w-6 h-6 rounded-sm border transition-all ${
                gs.lineColor === c ? 'border-foreground scale-110' : 'border-transparent'
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
        <div className="space-y-1.5">
          <div>
            <label className="text-[10px] text-muted-foreground">{t('opacity', { value: `${Math.round(gs.lineOpacity * 100)}` })}</label>
            <input
              type="range"
              dir="ltr"
              min={10}
              max={100}
              value={Math.round(gs.lineOpacity * 100)}
              onChange={(e) => update({ lineOpacity: Number(e.target.value) / 100 })}
              className="w-full accent-primary"
            />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">{t('thickness', { value: `${gs.lineWidth}` })}</label>
            <input
              type="range"
              dir="ltr"
              min={1}
              max={5}
              value={gs.lineWidth}
              onChange={(e) => update({ lineWidth: Number(e.target.value) })}
              className="w-full accent-primary"
            />
          </div>
        </div>
      </div>

      {/* Image scale */}
      {activeImage && (
        <div>
          <label className="text-xs text-muted-foreground font-medium uppercase tracking-wider block mb-1.5">
            {t('imageScale')}
          </label>
          {/* Slider and its readout, as one left-to-right control. */}
          <div className="flex items-center gap-2" dir="ltr">
            <input
              type="range"
              min={25}
              max={500}
              value={Math.round(gs.imageScale * 100)}
              onChange={(e) => update({ imageScale: Number(e.target.value) / 100 })}
              className="flex-1 accent-primary"
            />
            <span className="text-xs text-muted-foreground w-10 text-end">{Math.round(gs.imageScale * 100)}%</span>
          </div>
          <button
            onClick={() => update({ imageOffsetX: 0, imageOffsetY: 0 })}
            className="text-[10px] text-muted-foreground hover:text-foreground mt-1"
          >
            {t('centerImage')}
          </button>
        </div>
      )}
    </>
  );
}
