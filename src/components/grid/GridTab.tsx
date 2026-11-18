import { useRef, useState, useCallback, useEffect } from 'react';
import { useLocale, useTranslations } from 'use-intl';
import { useProject } from '@/hooks/useProjectStore';
import { useIsMobile } from '@/hooks/use-mobile';
import ImageUploader from '@/components/common/ImageUploader';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Download, FileText, Loader2, Lock, Minus, Plus, RefreshCw, RotateCcw, RotateCw } from 'lucide-react';
import ToolHeader from '@/components/shell/ToolHeader';
import ToolEmptyState from '@/components/shell/ToolEmptyState';
import type { GridSettings } from '@/types/project';
import { useSaveMedia } from '@/components/common/SaveMedia';
import { useAccount, useHasFeature } from '@/components/shell/account';
import { canvasToBlob } from '@/lib/saveMedia';
import { A4_CM, cellCounts, exportSize, fillImageScale, previewSize, turn } from '@/lib/grid/geometry';
import { drawExport, drawPreview, exportFilename, fillBackground, type LoadedImage } from '@/lib/grid/draw';
import { buildGridPdf, gridPrintDetail, gridPrintLayout } from '@/lib/print/gridPdf';
import { canvasTextRenderer, loadImage, rasterizeReference, renderPdfPreview } from '@/lib/print/gridPdfBrowser';
import type { gridEn } from '@/i18n/messages/tools/grid';

/** How far the image can be zoomed (by pinch, wheel, slider, buttons or typing), relative to fitting it. */
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 8;
const clampZoom = (scale: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, scale));
/** Exact steps: the zoom buttons change it by 1 %, the move buttons by 0.1 of the canvas unit (1 mm in cm). */
const ZOOM_STEP = 0.01;
const NUDGE_STEP = 0.1;
/** Square cells: the smallest side (in the canvas unit), and the step of the − and + buttons. */
const cellLimits = (unit: GridSettings['unit']) => (unit === 'cm' ? { min: 0.5, step: 0.5 } : { min: 0.2, step: 0.25 });
const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places;

// Numbers go into messages as the strings they always were (no locale
// formatting), so the English text stays exactly as before.
export default function GridTab() {
  const t = useTranslations('gridTool');
  const tLocked = useTranslations('studio.locked');
  const { image, gridImage, setGridImage, initGridImageFromReference, gridSettings, setGridSettings } = useProject();
  const { save, authorize } = useSaveMedia();
  const locale = useLocale();
  // The A4 PDF: offered to accounts that have it, and shown locked where another plan has it
  // (in no plan until the owner publishes it: only admins see it before that).
  const canPdf = useHasFeature('export.pdf');
  const offer = useAccount()?.account.offer;
  const pdfOffered = canPdf || offer?.free.includes('export.pdf') === true || offer?.pro.includes('export.pdf') === true;
  const [pdfBusy, setPdfBusy] = useState(false);
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

  const update = useCallback((partial: Partial<GridSettings>) => {
    setGridSettings(partial);
  }, [setGridSettings]);

  const fitImage = useCallback(() => {
    update({ imageScale: 1, imageOffsetX: 0, imageOffsetY: 0 });
  }, [update]);

  const fillCanvas = useCallback(() => {
    if (!imageNaturalSize) return;
    update({
      imageScale: fillImageScale(gs, imageNaturalSize.w, imageNaturalSize.h),
      imageOffsetX: 0,
      imageOffsetY: 0,
    });
  }, [gs, imageNaturalSize, update]);

  const resetImagePosition = useCallback(() => {
    update({ imageOffsetX: 0, imageOffsetY: 0 });
  }, [update]);

  // The image turns on the grid; the image itself (the stored photo) never changes.
  const rotate = useCallback((by: -90 | 90 | 180) => update({ rotation: turn(gs.rotation, by) }), [gs.rotation, update]);

  // Draw grid onto visible canvas (src/lib/grid: the same calls as always for a grid without the newer settings)
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const size = previewSize(gs, container.clientWidth - 16, container.clientHeight - 16);
    canvas.width = size.w;
    canvas.height = size.h;
    const ctx = canvas.getContext('2d')!;

    // Background at once; the image and the grid when the image has loaded.
    fillBackground(ctx, size.w, size.h);
    if (activeImage) {
      const img = new Image();
      img.onerror = (e) => {
        console.error('[GridTab] Failed to load image for grid preview:', e);
      };
      img.onload = () => {
        try {
          drawPreview(ctx, gs, { source: img, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight }, size);
        } catch (error) {
          console.error('[GridTab] Failed to draw grid preview canvas:', error);
        }
      };
      img.src = activeImage;
    } else {
      drawPreview(ctx, gs, null, size);
    }
  }, [activeImage, gs]);

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
      update({ imageScale: clampZoom(pinchRef.current.initScale * ratio) });
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
    update({ imageScale: clampZoom(gs.imageScale * factor) });
  }, [activeImage, gs.imageScale, update]);

  // Export: the grid with the image, or the same grid blank on white (for paper).
  // Every save is authorized by the server first (SaveMedia: Create a Grid and saving images).
  const exportGrid = useCallback((blank: boolean) => {
    const { w, h } = exportSize(gs);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;

    const doExport = (loaded: LoadedImage | null) => {
      try {
        drawExport(ctx, gs, loaded, { blank });
        const filename = exportFilename(gs, blank);
        canvasToBlob(canvas, 'image/png')
          .then((blob) => save({ blob, filename, mime: 'image/png', title: t(blank ? 'saveBlankTitle' : 'saveTitle'), tool: 'grid' }))
          .catch((error) => console.error('[GridTab] Failed to export grid PNG:', error));
      } catch (error) {
        console.error('[GridTab] Failed to export grid PNG:', error);
      }
    };

    if (activeImage && !blank) {
      const img = new Image();
      img.onerror = (e) => {
        console.error('[GridTab] Failed to load image for grid PNG export:', e);
      };
      img.onload = () => doExport({ source: img, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight });
      img.src = activeImage;
    } else {
      doExport(null);
    }
  }, [activeImage, gs, save, t]);
  const handleExport = useCallback(() => exportGrid(false), [exportGrid]);
  const handleExportBlank = useCallback(() => exportGrid(true), [exportGrid]);

  // The A4 PDF: the server is asked first (Create a Grid, and grid PDFs): no answer
  // or a refusal makes nothing, and does not even load the PDF library.
  const handleExportPdf = useCallback(async () => {
    if (!activeImage || pdfBusy) return;
    setPdfBusy(true);
    try {
      if (!(await authorize({ tool: 'grid', features: ['export.pdf'] }))) return;
      const image = await loadImage(activeImage);
      const layout = gridPrintLayout(gs);
      const reference = rasterizeReference(gs, image, layout);
      const jpeg = new Uint8Array(await (await canvasToBlob(reference, 'image/jpeg', 0.92)).arrayBuffer());
      const [lib] = await Promise.all([import('jspdf'), document.fonts?.ready]);
      const detail = gridPrintDetail(gs, layout);
      const size = { width: `${gs.canvasWidth}`, height: `${gs.canvasHeight}`, unit: gs.unit };
      const grid =
        gs.cellMode === 'square'
          ? t('pdf.squares', { size: `${gs.cellSize}`, unit: gs.unit, paper: detail.cellOnPaperMm })
          : t('pdf.divisions', { columns: `${gs.columns}`, rows: `${gs.rows}` });
      const rtl = locale === 'he';
      const pdf = await buildGridPdf(lib, {
        gs,
        layout,
        reference: jpeg,
        words: {
          title: t('pdf.title', size),
          reference: t('pdf.reference'),
          blank: t('pdf.blank'),
          detail: [grid, detail.trueSize ? t('pdf.trueSize') : t('pdf.reduced', { ...size, percent: detail.percent })],
          print: t('pdf.print'),
          bar: t('pdf.bar'),
        },
        rtl,
        renderText: canvasTextRenderer({ rtl, fontFamily: getComputedStyle(document.body).fontFamily }),
      });
      const preview = await canvasToBlob(renderPdfPreview(gs, layout, reference), 'image/png');
      await save({
        blob: new Blob([pdf], { type: 'application/pdf' }),
        filename: exportFilename(gs).replace(/\.png$/, '-a4.pdf'),
        mime: 'application/pdf',
        title: t('pdf.saveTitle'),
        tool: 'grid',
        authorized: true,
        preview,
      });
    } catch (error) {
      console.error('[GridTab] Failed to make the grid PDF:', error);
    } finally {
      setPdfBusy(false);
    }
  }, [activeImage, authorize, gs, locale, pdfBusy, save, t]);

  // Locked is said in words too (as in the navigation), not only by the icon.
  const pdfName = canPdf ? t('savePdf') : `${t('savePdf')} (${tLocked('badge')})`;
  const pdfButtonContent = pdfBusy ? (
    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
  ) : canPdf ? (
    <FileText className="h-4 w-4" aria-hidden="true" />
  ) : (
    <Lock className="h-4 w-4" aria-hidden="true" />
  );

  const GRID_COLORS = GRID_LINE_COLORS.map((c) => c.value);

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

  const rotateButtons = activeImage && (
    <SegmentedRow
      label={t('rotate.label')}
      options={[
        { label: t('rotate.left'), content: <><RotateCcw className="h-4 w-4" aria-hidden="true" /> 90°</>, onClick: () => rotate(-90) },
        { label: t('rotate.half'), content: '180°', onClick: () => rotate(180) },
        { label: t('rotate.right'), content: <><RotateCw className="h-4 w-4" aria-hidden="true" /> 90°</>, onClick: () => rotate(90) },
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

  const counts = cellCounts(gs);
  const sizes = {
    columns: `${gs.columns}`,
    rows: `${gs.rows}`,
    width: `${gs.canvasWidth}`,
    height: `${gs.canvasHeight}`,
    unit: gs.unit,
    size: `${gs.cellSize}`,
    across: `${counts.across}`,
    down: `${counts.down}`,
  };
  const squares = gs.cellMode === 'square';

  return (
    <div className="relative flex-1 flex flex-col min-h-0">
      <ToolHeader
        tool="grid"
        task={activeImage ? (squares ? t('task.withSquares', sizes) : t('task.withImage', sizes)) : t('task.empty')}
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
                <>
                  <GridPresets gs={gs} update={update} />
                  {squares && <CellSizeField gs={gs} update={update} />}
                </>
              ) : (
                <div className="max-h-[36vh] overflow-y-auto space-y-3 pe-1">
                  <GridControls gs={gs} update={update} activeImage={activeImage} colors={GRID_COLORS} />
                </div>
              )}
              {fitButtons}
              {rotateButtons}
              <div className="flex gap-2">
                <button
                  onClick={handleExport}
                  data-onboarding="grid-export"
                  className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-primary text-[15px] font-semibold text-primary-foreground active:opacity-90"
                >
                  <Download className="h-5 w-5" /> {t('saveImage')}
                </button>
                <button
                  onClick={handleExportBlank}
                  aria-label={t('saveBlank')}
                  className="flex h-12 shrink-0 items-center justify-center rounded-xl border border-border bg-secondary/40 px-3 text-sm font-semibold text-foreground active:bg-secondary"
                >
                  {t('saveBlankShort')}
                </button>
                {pdfOffered && (
                  <button
                    onClick={handleExportPdf}
                    disabled={pdfBusy}
                    aria-label={pdfName}
                    aria-busy={pdfBusy}
                    className="flex h-12 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-border bg-secondary/40 px-3 text-sm font-semibold text-foreground active:bg-secondary disabled:opacity-60"
                  >
                    {pdfButtonContent} {t('savePdfShort')}
                  </button>
                )}
              </div>
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
              {squares && <div className="mt-2"><CellSizeField gs={gs} update={update} /></div>}
            </div>
            {fitButtons}
            {rotateButtons}
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
              {squares ? t('summarySquares', sizes) : t('summary', sizes)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* No border: the bar keeps its height, so the grid on screen keeps its size. */}
            <button
              onClick={handleExportBlank}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/80 active:scale-95 transition-transform"
            >
              {t('saveBlank')}
            </button>
            {pdfOffered && (
              <button
                onClick={handleExportPdf}
                disabled={pdfBusy}
                aria-label={pdfName}
                aria-busy={pdfBusy}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/80 active:scale-95 transition-transform disabled:opacity-60"
              >
                {pdfButtonContent}
                {t('savePdf')}
              </button>
            )}
            <button
              onClick={handleExport}
              data-onboarding="grid-export"
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-primary text-primary-foreground rounded-lg hover:opacity-90 active:scale-95 transition-transform"
            >
              <Download className="w-4 h-4" />
              {t('saveImage')}
            </button>
          </div>
        </div>
      )}

      <canvas ref={exportCanvasRef} className="hidden" />
    </div>
  );
}

/** The line colours, each with the name screen readers say (gridTool.controls.colors). */
const GRID_LINE_COLORS: { value: string; name: keyof typeof gridEn.controls.colors }[] = [
  { value: '#ffffff', name: 'white' },
  { value: '#f59e0b', name: 'amber' },
  { value: '#ef4444', name: 'red' },
  { value: '#3b82f6', name: 'blue' },
  { value: '#10b981', name: 'green' },
  { value: '#8b5cf6', name: 'violet' },
];

// ─── Presets ──────────────────────────────────────────
// Each note is a message key (gridTool.presets.notes).
const GRID_PRESETS: { n: number; note: keyof typeof gridEn.presets.notes }[] = [
  { n: 3, note: 'simple' },
  { n: 4, note: 'recommended' },
  { n: 8, note: 'detailed' },
];

function GridPresets({ gs, update }: { gs: GridSettings; update: (p: Partial<GridSettings>) => void }) {
  const t = useTranslations('gridTool.presets');
  const squares = gs.cellMode === 'square';
  const option = (active: boolean) =>
    `flex flex-col items-center gap-1 rounded-xl border py-2 transition-colors ${
      active ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-secondary/40 text-foreground hover:border-primary/40'
    }`;
  return (
    <div className="grid grid-cols-4 gap-2 md:grid-cols-2" role="radiogroup" aria-label={t('label')}>
      {GRID_PRESETS.map(({ n, note: noteKey }) => {
        const active = !squares && gs.columns === n && gs.rows === n;
        const note = t(`notes.${noteKey}`);
        return (
          <button key={n} role="radio" aria-checked={active} aria-label={t('option', { n: `${n}`, note })}
            onClick={() => update({ columns: n, rows: n, cellMode: 'divisions' })}
            className={option(active)}>
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
      {/* Square cells: physically square, of a size in the canvas unit (partial ones at the right and bottom edges). */}
      <button role="radio" aria-checked={squares} aria-label={t('squaresOption', { size: `${gs.cellSize}`, unit: gs.unit })}
        onClick={() => update({ cellMode: 'square' })}
        className={option(squares)}>
        <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
          <rect x="2" y="2" width="20" height="20" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M8 2V22M14 2V22M20 2V22M2 8H22M2 14H22M2 20H22" stroke="currentColor" strokeWidth="1" />
        </svg>
        <span className="text-sm font-semibold leading-none" dir="ltr">{gs.cellSize} {gs.unit}</span>
        <span className={`text-[10px] leading-none ${squares ? 'text-primary' : 'text-muted-foreground'}`}>{t('squares')}</span>
      </button>
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

// One-shot actions laid out like a segmented control (Fit / Fill / Center, the rotations).
// `content` replaces the visible text (an icon); `label` stays the accessible name.
function SegmentedRow({ label, options }: { label: string; options: { label: string; content?: React.ReactNode; onClick: () => void }[] }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex flex-1 gap-1.5">
        {options.map(o => (
          <button key={o.label} onClick={o.onClick} aria-label={o.content ? o.label : undefined} title={o.content ? o.label : undefined}
            className="flex min-h-[40px] flex-1 items-center justify-center gap-1 rounded-lg border border-border bg-secondary/40 text-sm font-medium text-foreground active:bg-secondary hover:bg-secondary">
            {o.content ?? o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * A number typed freely and applied on Enter or leaving the field (so typing
 * "150" never passes through 1 %), within `min`–`max`.
 */
function NumberField({ value, min, max, step, onCommit, label, className }: {
  value: number; min: number; max: number; step: number; onCommit: (v: number) => void; label: string; className?: string;
}) {
  const [text, setText] = useState(`${value}`);
  useEffect(() => setText(`${value}`), [value]);
  const commit = () => {
    const v = Number(text.replace(',', '.'));
    if (text.trim() === '' || !Number.isFinite(v)) {
      setText(`${value}`);
      return;
    }
    const clamped = Math.max(min, Math.min(max, v));
    if (clamped === value) setText(`${value}`);
    onCommit(clamped);
  };
  return (
    <input
      type="number"
      inputMode="decimal"
      dir="ltr"
      min={min}
      max={max}
      step={step}
      value={text}
      aria-label={label}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
      className={`rounded border border-border bg-secondary px-2 py-1.5 text-base text-foreground focus:outline-none focus:ring-1 focus:ring-primary md:text-sm ${className ?? ''}`}
    />
  );
}

const iconButton = 'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary/40 text-foreground hover:bg-secondary active:bg-secondary';

// ─── Square cells: the side, typed or by steps ─────────
function CellSizeField({ gs, update }: { gs: GridSettings; update: (p: Partial<GridSettings>) => void }) {
  const t = useTranslations('gridTool.controls');
  const { min, step } = cellLimits(gs.unit);
  const max = Math.max(gs.canvasWidth, gs.canvasHeight);
  const set = (v: number) => update({ cellSize: round(Math.max(min, Math.min(max, v)), 2) });
  const counts = cellCounts(gs);
  return (
    <div>
      <div className="flex items-center gap-2" dir="ltr">
        <span className="me-auto text-xs font-medium text-muted-foreground" dir="auto">{t('cellSize')}</span>
        <button type="button" onClick={() => set(gs.cellSize - step)} aria-label={t('cellSmaller')} className={iconButton}>
          <Minus className="h-4 w-4" aria-hidden="true" />
        </button>
        <NumberField value={gs.cellSize} min={min} max={max} step={0.1} onCommit={set} label={t('cellSizeValue', { unit: gs.unit })} className="w-16 text-center" />
        <span className="text-xs text-muted-foreground">{gs.unit}</span>
        <button type="button" onClick={() => set(gs.cellSize + step)} aria-label={t('cellLarger')} className={iconButton}>
          <Plus className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {t('cellCount', { across: `${counts.across}`, down: `${counts.down}` })}
        {counts.partial ? ` ${t('cellPartial')}` : ''}
      </p>
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
  const squares = gs.cellMode === 'square';
  const nudgeStep = `${NUDGE_STEP} ${gs.unit}`;
  const nudge = (dx: number, dy: number) =>
    update({ imageOffsetX: round(gs.imageOffsetX + dx * NUDGE_STEP, 6), imageOffsetY: round(gs.imageOffsetY + dy * NUDGE_STEP, 6) });
  const zoomPercent = Math.round(gs.imageScale * 100);
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
              aria-label={t('width')}
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
              aria-label={t('height')}
              onChange={(e) => update({ canvasHeight: Math.max(1, Number(e.target.value)) })}
              className="w-full px-2 py-1.5 text-sm bg-secondary border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <span className="text-[10px] text-muted-foreground">{t('height')}</span>
          </div>
          <select
            value={gs.unit}
            aria-label={t('unit')}
            onChange={(e) => update({ unit: e.target.value as 'cm' | 'in' })}
            className="px-2 py-1.5 text-sm bg-secondary border border-border rounded text-foreground mt-[-14px]"
          >
            <option value="cm">cm</option>
            <option value="in">in</option>
          </select>
        </div>
      </div>

      {/* Common presets: ratios, and A4 exactly (21 × 29.7 cm) */}
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
          {[
            { label: t('a4Portrait'), w: A4_CM.short, h: A4_CM.long },
            { label: t('a4Landscape'), w: A4_CM.long, h: A4_CM.short },
          ].map(p => {
            const active = gs.unit === 'cm' && gs.canvasWidth === p.w && gs.canvasHeight === p.h;
            return (
              <button
                key={p.label}
                aria-pressed={active}
                onClick={() => update({ canvasWidth: p.w, canvasHeight: p.h, unit: 'cm' })}
                className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                  active ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Grid divisions, or square cells */}
      <div data-onboarding="grid-divisions">
        <label className="text-xs text-muted-foreground font-medium uppercase tracking-wider block mb-1.5">
          {t('divisions')}
        </label>
        <div className="mb-2">
          <SegmentedTabs<'divisions' | 'square'> value={gs.cellMode} onChange={(cellMode) => update({ cellMode })}
            options={[{ value: 'divisions', label: t('modeDivisions') }, { value: 'square', label: t('modeSquares') }]} />
        </div>
        {squares ? (
          <CellSizeField gs={gs} update={update} />
        ) : (
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="text-[10px] text-muted-foreground">{t('columns', { count: `${gs.columns}` })}</label>
              <input
                type="range"
                dir="ltr"
                min={1}
                max={16}
                value={gs.columns}
                aria-label={t('columns', { count: `${gs.columns}` })}
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
                aria-label={t('rows', { count: `${gs.rows}` })}
                onChange={(e) => update({ rows: Number(e.target.value) })}
                className="w-full accent-primary"
              />
            </div>
          </div>
        )}
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
              aria-label={t(`colors.${GRID_LINE_COLORS.find((x) => x.value === c)?.name ?? 'white'}`)}
              aria-pressed={gs.lineColor === c}
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
              aria-label={t('opacity', { value: `${Math.round(gs.lineOpacity * 100)}` })}
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
              aria-label={t('thickness', { value: `${gs.lineWidth}` })}
              onChange={(e) => update({ lineWidth: Number(e.target.value) })}
              className="w-full accent-primary"
            />
          </div>
        </div>
      </div>

      {/* Image scale: by steps of 1 %, by the slider, or typed; and moved by exact steps */}
      {activeImage && (
        <div>
          <label className="text-xs text-muted-foreground font-medium uppercase tracking-wider block mb-1.5">
            {t('imageScale')}
          </label>
          {/* Buttons, slider and value, as one left-to-right control. */}
          <div className="flex items-center gap-1.5" dir="ltr">
            <button type="button" onClick={() => update({ imageScale: clampZoom(round(gs.imageScale - ZOOM_STEP, 4)) })} aria-label={t('zoomOut')} className={iconButton}>
              <Minus className="h-4 w-4" aria-hidden="true" />
            </button>
            <input
              type="range"
              min={ZOOM_MIN * 100}
              max={ZOOM_MAX * 100}
              value={zoomPercent}
              aria-label={t('imageScale')}
              onChange={(e) => update({ imageScale: Number(e.target.value) / 100 })}
              className="min-w-0 flex-1 accent-primary"
            />
            <button type="button" onClick={() => update({ imageScale: clampZoom(round(gs.imageScale + ZOOM_STEP, 4)) })} aria-label={t('zoomIn')} className={iconButton}>
              <Plus className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <div className="mt-1.5 flex items-center gap-1.5" dir="ltr">
            <NumberField value={zoomPercent} min={ZOOM_MIN * 100} max={ZOOM_MAX * 100} step={1} onCommit={(v) => update({ imageScale: Math.round(v) / 100 })} label={t('zoomValue')} className="w-20 text-center" />
            <span className="text-xs text-muted-foreground">%</span>
          </div>
          <div className="mt-3">
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t('move', { step: nudgeStep })}</p>
            {/* Directions on screen: left to right whatever the language. */}
            <div className="flex items-center gap-1.5" dir="ltr">
              <button type="button" onClick={() => nudge(-1, 0)} aria-label={t('moveLeft', { step: nudgeStep })} className={iconButton}><ArrowLeft className="h-4 w-4" aria-hidden="true" /></button>
              <button type="button" onClick={() => nudge(0, -1)} aria-label={t('moveUp', { step: nudgeStep })} className={iconButton}><ArrowUp className="h-4 w-4" aria-hidden="true" /></button>
              <button type="button" onClick={() => nudge(0, 1)} aria-label={t('moveDown', { step: nudgeStep })} className={iconButton}><ArrowDown className="h-4 w-4" aria-hidden="true" /></button>
              <button type="button" onClick={() => nudge(1, 0)} aria-label={t('moveRight', { step: nudgeStep })} className={iconButton}><ArrowRight className="h-4 w-4" aria-hidden="true" /></button>
            </div>
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
