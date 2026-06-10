import { useRef, useCallback, useEffect, useState } from 'react';
import { useProject } from '@/hooks/useProjectStore';
import { useIsTouchOrMobile } from '@/hooks/use-touch-or-mobile';
import ImageUploader from '@/components/common/ImageUploader';
import MeasureCanvas from './MeasureCanvas';
import MeasureToolbar from './MeasureToolbar';
import MeasurePanel from './MeasurePanel';
import MeasureMobile from './MeasureMobile';
import { Maximize, SlidersHorizontal, X } from 'lucide-react';

export default function MeasureTab() {
  const { image, setImage, setZoom, setPanOffset, sampledColors, removeSampledColor, clearSampledColors, setActiveTab, mode, isImageLoading, imageLoadError, clearImageLoadError, beginImageUpload, setImageLoadError } = useProject();
  const containerRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsTouchOrMobile();
  const [showMobileControls, setShowMobileControls] = useState(false);

  // On mobile, hide chrome when actively drawing/calibrating
  const isActiveDrawing = isMobile && (mode === 'calibrate' || mode === 'measure');

  useEffect(() => {
    if (isActiveDrawing) {
      setShowMobileControls(false);
    }
  }, [isActiveDrawing]);

  const resetView = useCallback(() => {
    if (!containerRef.current) return;
    const img = containerRef.current.querySelector('img') as HTMLImageElement | null;
    if (!img?.naturalWidth || !img?.naturalHeight) return;

    const cw = containerRef.current.clientWidth;
    const ch = containerRef.current.clientHeight;
    const padding = isMobile ? 0.96 : 0.92;
    const scale = Math.min(cw / img.naturalWidth, ch / img.naturalHeight) * padding;

    setZoom(scale);
    setPanOffset({
      x: (cw - img.naturalWidth * scale) / 2,
      y: (ch - img.naturalHeight * scale) / 2,
    });
  }, [isMobile, setZoom, setPanOffset]);

  const handleUseInColorTab = (hex: string) => {
    sessionStorage.setItem('use-color-in-tab', hex);
    setActiveTab('color');
  };

  const paletteStrip = sampledColors.length > 0 && (
    <div className="flex items-center gap-2 px-3 py-2 border-t border-border toolbar-surface overflow-x-auto shrink-0">
      <span className="text-xs text-muted-foreground whitespace-nowrap">Palette:</span>
      <div className="flex items-center gap-1.5 flex-1 overflow-x-auto">
        {sampledColors.map(c => (
          <div key={c.id} className="group relative flex flex-col items-center shrink-0">
            <div className="w-8 h-8 rounded border border-border/50 cursor-pointer transition-transform hover:scale-110"
              style={{ backgroundColor: c.hex }}
              title={`${c.hex} — click to use in Color tab`}
              onClick={() => handleUseInColorTab(c.hex)}
            />
            <span className="text-[9px] font-mono text-muted-foreground mt-0.5">{c.hex}</span>
            <button
              onClick={(e) => { e.stopPropagation(); removeSampledColor(c.id); }}
              className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              title="Remove"
            >
              <X className="w-2.5 h-2.5" />
            </button>
          </div>
        ))}
      </div>
      <button onClick={clearSampledColors}
        className="text-xs text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap px-2 py-1 rounded hover:bg-secondary">
        Clear all
      </button>
    </div>
  );

  if (!image) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 canvas-area">
        <div className="w-full max-w-md">
          {imageLoadError ? (
            <div className="flex flex-col items-center gap-3 p-6 text-center">
              <p className="text-sm text-destructive font-medium">{imageLoadError}</p>
              <button onClick={() => { clearImageLoadError(); setImage(null); }}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium">
                Try again
              </button>
            </div>
          ) : isImageLoading ? (
            <div className="flex flex-col items-center gap-3 p-12">
              <div className="w-10 h-10 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
              <p className="text-sm font-medium text-foreground">Loading image…</p>
              <p className="text-xs text-muted-foreground">Preparing canvas</p>
            </div>
          ) : (
            <ImageUploader
              onImageLoad={setImage}
              disabled={isImageLoading}
              onUploadStart={beginImageUpload}
              onUploadError={(msg) => setImageLoadError(msg)}
            />
          )}
        </div>
      </div>
    );
  }

  // Dedicated mobile-first experience — keeps desktop untouched.
  if (isMobile) {
    return <MeasureMobile />;
  }

  return (
    <div className="relative flex-1 flex flex-col min-h-0">
      <div className="flex-1 flex flex-col lg:flex-row min-h-0">
        {/* Toolbar — hide on mobile during active drawing */}
        {!isMobile && !isActiveDrawing && <MeasureToolbar onResetView={resetView} />}

        {/* Canvas */}
        <MeasureCanvas containerRef={containerRef} />

        {/* Right panel — hide on mobile during active drawing */}
        {!isMobile && !isActiveDrawing && <MeasurePanel />}
      </div>

      {!isMobile && !isActiveDrawing && paletteStrip}

      {isMobile && !isActiveDrawing && (
        <>
          <div className="absolute top-3 inset-x-3 z-20 flex items-center justify-between pointer-events-none">
            <button
              onClick={() => setShowMobileControls(v => !v)}
              className="pointer-events-auto flex items-center gap-2 rounded-full border border-border bg-card/95 px-3 py-2 text-xs font-medium text-foreground shadow-lg backdrop-blur-sm active:scale-95 transition-transform"
            >
              <SlidersHorizontal className="w-4 h-4" />
              {showMobileControls ? 'Hide tools' : 'Tools'}
            </button>

            <button
              onClick={resetView}
              className="pointer-events-auto flex items-center gap-2 rounded-full border border-border bg-card/95 px-3 py-2 text-xs font-medium text-foreground shadow-lg backdrop-blur-sm active:scale-95 transition-transform"
            >
              <Maximize className="w-4 h-4" />
              Fit
            </button>
          </div>

          {showMobileControls && (
            <div className="absolute inset-x-0 bottom-0 z-30 max-h-[62vh] overflow-hidden rounded-t-2xl border-t border-border bg-card/98 shadow-2xl backdrop-blur-sm">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">Measure tools</p>
                  <p className="text-[11px] text-muted-foreground">Keep the canvas clear, open tools only when needed.</p>
                </div>
                <button
                  onClick={() => setShowMobileControls(false)}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-muted-foreground active:scale-95 transition-transform"
                  title="Close tools"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="max-h-[calc(62vh-72px)] overflow-y-auto pb-4">
                <MeasureToolbar onResetView={resetView} mobile />
                {paletteStrip}
                <MeasurePanel />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
