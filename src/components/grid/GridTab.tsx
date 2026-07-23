import { useRef, useState, useCallback, useEffect } from 'react';
import { useProject } from '@/hooks/useProjectStore';
import { useIsMobile } from '@/hooks/use-mobile';
import ImageUploader from '@/components/common/ImageUploader';
import { Download, Settings, X, ChevronDown, ChevronUp } from 'lucide-react';
import type { GridSettings } from '@/types/project';
import { useSaveMedia } from '@/components/common/SaveMedia';
import { canvasToBlob } from '@/lib/saveMedia';

export default function GridTab() {
  const { image, gridSettings, setGridSettings } = useProject();
  const { save } = useSaveMedia();
  const [localImage, setLocalImage] = useState<string | null>(null);
  const [showControls, setShowControls] = useState(() => !image);
  const [imageNaturalSize, setImageNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const isMobile = useIsMobile();

  const activeImage = localImage || image;
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
    if (isMobile) setShowControls(false);
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initOX: gs.imageOffsetX,
      initOY: gs.imageOffsetY,
    };
  }, [activeImage, gs.imageOffsetX, gs.imageOffsetY, isMobile]);

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
    if (isMobile) setShowControls(false);
    if (e.touches.length === 2) {
      const d = Math.hypot(
        e.touches[1].clientX - e.touches[0].clientX,
        e.touches[1].clientY - e.touches[0].clientY,
      );
      pinchRef.current = { initDist: d, initScale: gs.imageScale };
    }
  }, [gs.imageScale, isMobile]);

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
          .then((blob) => save({ blob, filename, mime: 'image/png', title: 'Save grid' }))
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
  }, [activeImage, aspect, getFitScale, gs, save]);

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

  return (
    <div className="relative flex-1 flex flex-col min-h-0">
      {isMobile ? (
        <>
          <div
            ref={containerRef}
            data-onboarding="grid-canvas"
            className="relative flex-1 canvas-area flex items-center justify-center p-2 min-h-0"
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

            <div className="absolute top-3 inset-x-3 z-10 flex items-center justify-between pointer-events-none">
              <button
                onClick={() => setShowControls(v => !v)}
                className="pointer-events-auto flex items-center gap-2 rounded-full border border-border bg-card/95 px-3 py-2 text-xs font-medium text-foreground shadow-lg backdrop-blur-sm active:scale-95 transition-transform"
              >
                <Settings className="w-4 h-4" />
                {showControls ? 'Hide controls' : 'Grid controls'}
              </button>

              {activeImage && (
                <button
                  onClick={handleExport}
                  data-onboarding="grid-export"
                  className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card/95 text-foreground shadow-lg backdrop-blur-sm active:scale-95 transition-transform"
                  title="Save image"
                >
                  <Download className="w-4 h-4" />
                </button>
              )}
            </div>

            {activeImage && (
              <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-card/95 px-1.5 py-1.5 shadow-lg backdrop-blur-sm">
                <button
                  onClick={fitImage}
                  className="rounded-full px-3 py-2 text-xs font-medium text-foreground active:scale-95 transition-transform hover:bg-secondary"
                >
                  Fit
                </button>
                <button
                  onClick={fillCanvas}
                  className="rounded-full px-3 py-2 text-xs font-medium text-foreground active:scale-95 transition-transform hover:bg-secondary"
                >
                  Fill
                </button>
                <button
                  onClick={resetImagePosition}
                  className="rounded-full px-3 py-2 text-xs font-medium text-foreground active:scale-95 transition-transform hover:bg-secondary"
                >
                  Center
                </button>
              </div>
            )}
          </div>

          {showControls && (
            <div className="absolute inset-x-0 bottom-0 z-20 max-h-[62vh] overflow-hidden rounded-t-2xl border-t border-border bg-card/98 shadow-2xl backdrop-blur-sm">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">Grid controls</p>
                  <p className="text-[11px] text-muted-foreground">Set canvas ratio, fit the image, then export.</p>
                </div>
                <button
                  onClick={() => setShowControls(false)}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-muted-foreground active:scale-95 transition-transform"
                  title="Close controls"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="max-h-[calc(62vh-72px)] overflow-y-auto px-3 py-3 space-y-3">
                {activeImage && (
                  <div className="grid grid-cols-3 gap-2">
                    <button onClick={fitImage} className="rounded-lg bg-secondary px-3 py-2 text-xs font-medium text-foreground active:scale-95 transition-transform">Fit image</button>
                    <button onClick={fillCanvas} className="rounded-lg bg-secondary px-3 py-2 text-xs font-medium text-foreground active:scale-95 transition-transform">Fill canvas</button>
                    <button onClick={resetImagePosition} className="rounded-lg bg-secondary px-3 py-2 text-xs font-medium text-foreground active:scale-95 transition-transform">Reset position</button>
                  </div>
                )}

                <GridControls gs={gs} update={update} activeImage={activeImage} setLocalImage={setLocalImage} colors={GRID_COLORS} />
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-1 min-h-0">
          {/* Desktop sidebar */}
          <div className="w-60 panel-surface border-r border-border p-3 space-y-4 overflow-y-auto shrink-0">
            {activeImage && (
              <div className="grid grid-cols-3 gap-2">
                <button onClick={fitImage} className="rounded-lg bg-secondary px-2 py-2 text-[11px] font-medium text-foreground hover:bg-secondary/80">Fit image</button>
                <button onClick={fillCanvas} className="rounded-lg bg-secondary px-2 py-2 text-[11px] font-medium text-foreground hover:bg-secondary/80">Fill canvas</button>
                <button onClick={resetImagePosition} className="rounded-lg bg-secondary px-2 py-2 text-[11px] font-medium text-foreground hover:bg-secondary/80">Reset position</button>
              </div>
            )}
            <GridControls gs={gs} update={update} activeImage={activeImage} setLocalImage={setLocalImage} colors={GRID_COLORS} />
          </div>

          {/* Desktop canvas */}
          <div
            ref={containerRef}
            data-onboarding="grid-canvas"
            className="flex-1 canvas-area flex items-center justify-center p-4 min-h-0"
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

      {/* Export bar */}
      {!isMobile && (
        <div className="flex items-center justify-between px-3 py-2 toolbar-surface border-t border-border shrink-0">
          <span className="text-[11px] text-muted-foreground">
            {gs.canvasWidth}×{gs.canvasHeight} {gs.unit} · {gs.columns}×{gs.rows} grid
          </span>
          <button
            onClick={handleExport}
            data-onboarding="grid-export"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded hover:opacity-90 active:scale-95 transition-transform"
          >
            <Download className="w-3.5 h-3.5" />
            Save Image
          </button>
        </div>
      )}

      <canvas ref={exportCanvasRef} className="hidden" />
    </div>
  );
}

// ─── Grid Controls Sub-component ──────────────────────
function GridControls({
  gs,
  update,
  activeImage,
  setLocalImage,
  colors,
}: {
  gs: GridSettings;
  update: (p: Partial<GridSettings>) => void;
  activeImage: string | null;
  setLocalImage: (img: string) => void;
  colors: string[];
}) {
  return (
    <>
      {/* Canvas dimensions */}
      <div data-onboarding="grid-size">
        <label className="text-xs text-muted-foreground font-medium uppercase tracking-wider block mb-1.5">
          Canvas Size
        </label>
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <input
              type="number"
              inputMode="decimal"
              value={gs.canvasWidth}
              onChange={(e) => update({ canvasWidth: Math.max(1, Number(e.target.value)) })}
              className="w-full px-2 py-1.5 text-sm bg-secondary border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <span className="text-[10px] text-muted-foreground">Width</span>
          </div>
          <span className="text-muted-foreground text-sm mt-[-14px]">×</span>
          <div className="flex-1">
            <input
              type="number"
              inputMode="decimal"
              value={gs.canvasHeight}
              onChange={(e) => update({ canvasHeight: Math.max(1, Number(e.target.value)) })}
              className="w-full px-2 py-1.5 text-sm bg-secondary border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <span className="text-[10px] text-muted-foreground">Height</span>
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
        <label className="text-xs text-muted-foreground font-medium block mb-1.5">Quick Ratios</label>
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
          Grid Divisions
        </label>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <label className="text-[10px] text-muted-foreground">Cols: {gs.columns}</label>
            <input
              type="range"
              min={1}
              max={16}
              value={gs.columns}
              onChange={(e) => update({ columns: Number(e.target.value) })}
              className="w-full accent-primary"
            />
          </div>
          <div className="flex-1">
            <label className="text-[10px] text-muted-foreground">Rows: {gs.rows}</label>
            <input
              type="range"
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
          Line Style
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
            <label className="text-[10px] text-muted-foreground">Opacity: {Math.round(gs.lineOpacity * 100)}%</label>
            <input
              type="range"
              min={10}
              max={100}
              value={Math.round(gs.lineOpacity * 100)}
              onChange={(e) => update({ lineOpacity: Number(e.target.value) / 100 })}
              className="w-full accent-primary"
            />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">Thickness: {gs.lineWidth}px</label>
            <input
              type="range"
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
            Image Scale
          </label>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={25}
              max={500}
              value={Math.round(gs.imageScale * 100)}
              onChange={(e) => update({ imageScale: Number(e.target.value) / 100 })}
              className="flex-1 accent-primary"
            />
            <span className="text-xs text-muted-foreground w-10 text-right">{Math.round(gs.imageScale * 100)}%</span>
          </div>
          <button
            onClick={() => update({ imageOffsetX: 0, imageOffsetY: 0 })}
            className="text-[10px] text-muted-foreground hover:text-foreground mt-1"
          >
            Center image
          </button>
        </div>
      )}

      {/* Image upload */}
      <div>
        <label className="text-xs text-muted-foreground font-medium uppercase tracking-wider block mb-1.5">
          {activeImage ? 'Replace Image' : 'Add Image'}
        </label>
        <ImageUploader onImageLoad={setLocalImage} compact />
        {!activeImage && (
          <span className="text-[10px] text-muted-foreground ml-2">Upload or use Measure image</span>
        )}
      </div>
    </>
  );
}
