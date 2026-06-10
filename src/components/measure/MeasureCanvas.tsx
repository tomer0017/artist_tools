import { useRef, useState, useCallback, useEffect } from 'react';
import { useProject } from '@/hooks/useProjectStore';
import { useIsTouchOrMobile } from '@/hooks/use-touch-or-mobile';
import { type Point, type MeasurementLine, type SampledColor, genId, distanceBetween, angleBetween, midpoint } from '@/types/project';
import { X, Check } from 'lucide-react';

interface Props {
  containerRef: React.RefObject<HTMLDivElement | null>;
}

export default function MeasureCanvas({ containerRef }: Props) {
  const {
    image, calibration, setCalibration, measurements, addMeasurement,
    updateMeasurement, selectedLineId, setSelectedLineId,
    mode, setMode, lineColor, showMeasurements,
    layers, activeLayerId, zoom, setZoom, panOffset, setPanOffset,
    addSampledColor,
    isImageLoading, imageLoadError, setImageLoaded, setImageLoadError, clearImageLoadError, setImage,
  } = useProject();

  const isMobile = useIsTouchOrMobile();

  const [hoveredColor, setHoveredColor] = useState<string | null>(null);
  const [hoveredPos, setHoveredPos] = useState<{ x: number; y: number } | null>(null);
  const eyedropperCanvasRef = useRef<HTMLCanvasElement>(null);
  const eyedropperReady = useRef(false);

  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [calPoints, setCalPoints] = useState<Point[]>([]);
  const [pendingPoint, setPendingPoint] = useState<Point | null>(null);
  const [mousePos, setMousePos] = useState<Point | null>(null);
  const [calDraftReady, setCalDraftReady] = useState(false);
  const [calInputVisible, setCalInputVisible] = useState(false);
  const [calSize, setCalSize] = useState('');
  const [calUnit, setCalUnit] = useState('cm');
  const [dragging, setDragging] = useState<{ lineId: string; endpoint: 'start' | 'end' } | null>(null);
  const [panning, setPanning] = useState(false);
  const [panStart, setPanStart] = useState<Point>({ x: 0, y: 0 });
  const [shiftHeld, setShiftHeld] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const prevModeRef = useRef(mode);
  const fitZoomRef = useRef(1);

  const svgRef = useRef<SVGSVGElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // Track whether we're in an "active drawing" state on mobile
  const isActiveDrawing = mode === 'calibrate' || mode === 'measure';
  const isDrawingInProgress = (mode === 'calibrate' && calPoints.length > 0) || (mode === 'measure' && pendingPoint !== null);

  // Prepare offscreen canvas for eyedropper
  const prepareEyedropper = useCallback(() => {
    if (!imgRef.current || eyedropperReady.current) return;
    const canvas = eyedropperCanvasRef.current;
    if (!canvas) return;
    const img = imgRef.current;
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(img, 0, 0);
    eyedropperReady.current = true;
  }, []);

  const sampleColorAt = useCallback((imgX: number, imgY: number): { hex: string; rgb: { r: number; g: number; b: number } } | null => {
    const canvas = eyedropperCanvasRef.current;
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const px = Math.max(0, Math.min(canvas.width - 1, Math.floor(imgX)));
    const py = Math.max(0, Math.min(canvas.height - 1, Math.floor(imgY)));
    const pixel = ctx.getImageData(px, py, 1, 1).data;
    const hex = `#${pixel[0].toString(16).padStart(2, '0')}${pixel[1].toString(16).padStart(2, '0')}${pixel[2].toString(16).padStart(2, '0')}`;
    return { hex, rgb: { r: pixel[0], g: pixel[1], b: pixel[2] } };
  }, []);

  // Load image dimensions
  const onImgLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setImgSize({ w: img.naturalWidth, h: img.naturalHeight });
    eyedropperReady.current = false;
    if (containerRef.current) {
      const cw = containerRef.current.clientWidth;
      const ch = containerRef.current.clientHeight;
      const scale = Math.min(cw / img.naturalWidth, ch / img.naturalHeight) * (isMobile ? 0.96 : 0.92);
      fitZoomRef.current = scale;
      setZoom(scale);
      setPanOffset({
        x: (cw - img.naturalWidth * scale) / 2,
        y: (ch - img.naturalHeight * scale) / 2,
      });
    }
    setImageLoaded();
  }, [containerRef, isMobile, setZoom, setPanOffset, setImageLoaded]);

  // Convert screen coords to image coords
  const screenToImage = useCallback((clientX: number, clientY: number): Point => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    return {
      x: (clientX - rect.left - panOffset.x) / zoom,
      y: (clientY - rect.top - panOffset.y) / zoom,
    };
  }, [containerRef, zoom, panOffset]);

  // Lock to H/V with shift
  const constrainPoint = useCallback((from: Point, to: Point): Point => {
    if (!shiftHeld) return to;
    const dx = Math.abs(to.x - from.x);
    const dy = Math.abs(to.y - from.y);
    return dx > dy ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
  }, [shiftHeld]);

  // Keyboard - spacebar pan + existing shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShiftHeld(true);
      if (e.key === ' ' && !spaceHeld && mode !== 'pan') {
        e.preventDefault();
        setSpaceHeld(true);
        prevModeRef.current = mode;
        setMode('pan');
      }
      if (e.key === 'Escape') {
        setPendingPoint(null);
        setCalPoints([]);
        setCalDraftReady(false);
        setCalInputVisible(false);
        setDragging(null);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShiftHeld(false);
      if (e.key === ' ') {
        setSpaceHeld(false);
        setMode(prevModeRef.current);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [mode, spaceHeld, setMode]);

  // Wheel zoom
  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.92 : 1.08;
    const minZoom = Math.max(0.05, fitZoomRef.current * 0.6);
    const newZoom = Math.max(minZoom, Math.min(10, zoom * factor));
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const imgX = (mx - panOffset.x) / zoom;
    const imgY = (my - panOffset.y) / zoom;
    setPanOffset({
      x: mx - imgX * newZoom,
      y: my - imgY * newZoom,
    });
    setZoom(newZoom);
  }, [zoom, panOffset, containerRef, setZoom, setPanOffset]);

  // Click handler
  const handleCanvasClick = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (panning || dragging) return;
    if (calDraftReady || calInputVisible) return;
    if (mode === 'pan') return; // pan mode doesn't place points
    const clientX = 'touches' in e ? e.changedTouches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? e.changedTouches[0].clientY : (e as React.MouseEvent).clientY;
    const pt = screenToImage(clientX, clientY);

    if (mode === 'calibrate') {
      if (calPoints.length === 0) {
        setCalPoints([pt]);
      } else if (calPoints.length === 1) {
        const final = constrainPoint(calPoints[0], pt);
        setCalPoints([calPoints[0], final]);
        setCalDraftReady(true);
      }
      return;
    }

    if (mode === 'measure') {
      if (!pendingPoint) {
        setPendingPoint(pt);
      } else {
        const final = constrainPoint(pendingPoint, pt);
        const line: MeasurementLine = {
          id: genId(),
          start: pendingPoint,
          end: final,
          label: '',
          color: lineColor,
          layerId: activeLayerId,
          visible: true,
        };
        addMeasurement(line);
        setPendingPoint(null);
      }
      return;
    }

    if (mode === 'eyedropper') {
      prepareEyedropper();
      const color = sampleColorAt(pt.x, pt.y);
      if (color) {
        addSampledColor({
          id: genId(),
          hex: color.hex,
          rgb: color.rgb,
          createdAt: Date.now(),
        });
      }
      return;
    }

    if (mode === 'select') {
      setSelectedLineId(null);
    }
  }, [mode, calPoints, pendingPoint, lineColor, activeLayerId, panning, dragging, screenToImage, constrainPoint, addMeasurement, setSelectedLineId, prepareEyedropper, sampleColorAt, addSampledColor]);

  // Mouse move
  const handleMouseMove = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;

    if (panning) {
      setPanOffset({
        x: panOffset.x + clientX - panStart.x,
        y: panOffset.y + clientY - panStart.y,
      });
      setPanStart({ x: clientX, y: clientY });
      return;
    }

    if (dragging) {
      const pt = screenToImage(clientX, clientY);
      updateMeasurement(dragging.lineId, { [dragging.endpoint]: pt });
      return;
    }

    const imgPt = screenToImage(clientX, clientY);
    setMousePos(imgPt);

    // Eyedropper hover preview
    if (mode === 'eyedropper') {
      prepareEyedropper();
      const color = sampleColorAt(imgPt.x, imgPt.y);
      if (color && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setHoveredColor(color.hex);
        setHoveredPos({ x: clientX - rect.left, y: clientY - rect.top });
      }
    } else {
      setHoveredColor(null);
      setHoveredPos(null);
    }
  }, [panning, dragging, panOffset, panStart, screenToImage, setPanOffset, updateMeasurement, mode, prepareEyedropper, sampleColorAt, containerRef]);

  const canFreePan = mode === 'pan' || (zoom > fitZoomRef.current + 0.02 && mode !== 'calibrate' && mode !== 'measure');

  // Pan start - middle mouse, alt+click, or pan mode/zoomed left click
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && e.altKey) || (e.button === 0 && canFreePan)) {
      e.preventDefault();
      setPanning(true);
      setPanStart({ x: e.clientX, y: e.clientY });
    }
  }, [canFreePan]);

  const handleMouseUp = useCallback(() => {
    setPanning(false);
    setDragging(null);
  }, []);

  // Touch handling
  const touchStartRef = useRef<{ touches: { clientX: number; clientY: number }[]; initialPan: Point; initialZoom: number } | null>(null);
  const panTouchRef = useRef<{ startX: number; startY: number; initialPan: Point } | null>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      panTouchRef.current = null;
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      touchStartRef.current = {
        touches: [e.touches[0], e.touches[1]],
        initialPan: { ...panOffset },
        initialZoom: zoom,
      };
      const imgPoint = {
        x: (midX - rect.left - panOffset.x) / zoom,
        y: (midY - rect.top - panOffset.y) / zoom,
      };
      (touchStartRef.current as typeof touchStartRef.current & { imagePoint?: Point }).imagePoint = imgPoint;
    } else if (e.touches.length === 1 && canFreePan) {
      e.preventDefault();
      panTouchRef.current = {
        startX: e.touches[0].clientX,
        startY: e.touches[0].clientY,
        initialPan: { ...panOffset },
      };
    }
  }, [canFreePan, containerRef, panOffset, zoom]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && touchStartRef.current) {
      e.preventDefault();
      const t = touchStartRef.current;
      const d0 = Math.hypot(t.touches[1].clientX - t.touches[0].clientX, t.touches[1].clientY - t.touches[0].clientY);
      const d1 = Math.hypot(e.touches[1].clientX - e.touches[0].clientX, e.touches[1].clientY - e.touches[0].clientY);
      const scale = d1 / d0;
      const minZoom = Math.max(0.05, fitZoomRef.current * 0.6);
      const newZoom = Math.max(minZoom, Math.min(10, t.initialZoom * scale));
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const midX1 = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const midY1 = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const imagePoint = (t as typeof t & { imagePoint?: Point }).imagePoint;
      if (!imagePoint) return;
      setPanOffset({
        x: midX1 - rect.left - imagePoint.x * newZoom,
        y: midY1 - rect.top - imagePoint.y * newZoom,
      });
      setZoom(newZoom);
      return;
    }
    // Single-finger pan in pan mode / when zoomed in
    if (e.touches.length === 1 && panTouchRef.current) {
      e.preventDefault();
      const t = panTouchRef.current;
      setPanOffset({
        x: t.initialPan.x + (e.touches[0].clientX - t.startX),
        y: t.initialPan.y + (e.touches[0].clientY - t.startY),
      });
      return;
    }
    handleMouseMove(e);
  }, [containerRef, handleMouseMove, setPanOffset, setZoom]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (e.touches.length < 2) touchStartRef.current = null;
    if (panTouchRef.current) {
      panTouchRef.current = null;
      return; // Don't trigger click after pan
    }
    if (e.changedTouches.length === 1 && !touchStartRef.current) {
      handleCanvasClick(e);
    }
    setDragging(null);
  }, [handleCanvasClick]);

  // Confirm calibration
  const confirmCalibration = useCallback(() => {
    const size = parseFloat(calSize);
    if (isNaN(size) || size <= 0 || calPoints.length < 2) return;
    setCalibration({
      start: calPoints[0],
      end: calPoints[1],
      realWorldSize: size,
      unit: calUnit,
    });
    setCalPoints([]);
    setCalInputVisible(false);
    setCalSize('');
    setMode('measure');
  }, [calSize, calUnit, calPoints, setCalibration, setMode]);

  const cancelCalibration = useCallback(() => {
    setCalPoints([]);
    setCalDraftReady(false);
    setCalInputVisible(false);
    setCalSize('');
  }, []);

  const confirmCalDraft = useCallback(() => {
    setCalDraftReady(false);
    setCalInputVisible(true);
  }, []);

  const cancelPending = useCallback(() => {
    setPendingPoint(null);
  }, []);

  // Calculate real-world size for a line
  const getRealSize = useCallback((line: MeasurementLine): string => {
    if (!calibration) return '—';
    const calDist = distanceBetween(calibration.start, calibration.end);
    if (calDist === 0) return '—';
    const scale = calibration.realWorldSize / calDist;
    const dist = distanceBetween(line.start, line.end);
    return (dist * scale).toFixed(1) + ' ' + calibration.unit;
  }, [calibration]);

  // Line endpoint drag
  const startDrag = useCallback((lineId: string, endpoint: 'start' | 'end', e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    setDragging({ lineId, endpoint });
    setSelectedLineId(lineId);
  }, [setSelectedLineId]);

  // Click line to select
  const selectLine = useCallback((lineId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedLineId(lineId);
    setMode('select');
  }, [setSelectedLineId, setMode]);

  if (!image) return null;

  // Get visible layer IDs
  const visibleLayerIds = new Set(layers.filter(l => l.visible).map(l => l.id));
  const visibleLines = showMeasurements ? measurements.filter(m => m.visible && visibleLayerIds.has(m.layerId)) : [];

  // Render in-progress elements
  const renderPending = () => {
    const elements: React.ReactNode[] = [];

    if (mode === 'calibrate' && calPoints.length === 1 && mousePos) {
      const end = constrainPoint(calPoints[0], mousePos);
      elements.push(
        <line key="cal-preview" x1={calPoints[0].x} y1={calPoints[0].y} x2={end.x} y2={end.y}
          stroke="#ffffff" strokeWidth={2 / zoom} strokeDasharray={`${6 / zoom}`} opacity={0.7} />
      );
      elements.push(
        <circle key="cal-p0" cx={calPoints[0].x} cy={calPoints[0].y} r={5 / zoom} fill="#ffffff" />
      );
    }

    if (calPoints.length === 2) {
      elements.push(
        <line key="cal-line" x1={calPoints[0].x} y1={calPoints[0].y} x2={calPoints[1].x} y2={calPoints[1].y}
          stroke="#ffffff" strokeWidth={2 / zoom} strokeDasharray={`${6 / zoom}`} />
      );
      calPoints.forEach((p, i) =>
        elements.push(<circle key={`cal-p${i}`} cx={p.x} cy={p.y} r={5 / zoom} fill="#ffffff" />)
      );
    }

    if (calibration) {
      elements.push(
        <line key="calibration" x1={calibration.start.x} y1={calibration.start.y}
          x2={calibration.end.x} y2={calibration.end.y}
          stroke="#ffffff" strokeWidth={1.5 / zoom} strokeDasharray={`${4 / zoom}`} opacity={0.5} />
      );
      const mid = midpoint(calibration.start, calibration.end);
      if (showMeasurements) {
        elements.push(
          <text key="cal-label" x={mid.x} y={mid.y - 8 / zoom} textAnchor="middle"
            fill="#ffffff" fontSize={11 / zoom} opacity={0.6}>
            REF: {calibration.realWorldSize} {calibration.unit}
          </text>
        );
      }
    }

    if (mode === 'measure' && pendingPoint && mousePos) {
      const end = constrainPoint(pendingPoint, mousePos);
      elements.push(
        <line key="measure-preview" x1={pendingPoint.x} y1={pendingPoint.y} x2={end.x} y2={end.y}
          stroke={lineColor} strokeWidth={2 / zoom} strokeDasharray={`${5 / zoom}`} opacity={0.8} />
      );
      elements.push(
        <circle key="measure-p0" cx={pendingPoint.x} cy={pendingPoint.y} r={4 / zoom} fill={lineColor} />
      );
    }

    return elements;
  };

  const fontSize = Math.max(10, 12 / zoom);
  const endpointR = Math.max(3, 5 / zoom);

  const cursorClass = mode === 'pan' ? 'cursor-grab' : mode === 'eyedropper' ? 'cursor-crosshair' : 'cursor-crosshair';

  return (
    <div
      ref={containerRef}
      className={`relative flex-1 overflow-hidden canvas-area select-none ${cursorClass} ${panning ? '!cursor-grabbing' : ''}`}
      onWheel={onWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onClick={handleCanvasClick}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{ touchAction: 'none' }}
    >
      <div
        style={{
          transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
          position: 'absolute',
          top: 0,
          left: 0,
        }}
      >
        <img
          ref={imgRef}
          src={image}
          alt="Reference"
          onLoad={onImgLoad}
          onError={() => setImageLoadError('Failed to load image. Please try again.')}
          className="block max-w-none"
          draggable={false}
          style={{ imageRendering: 'auto' }}
        />
        <svg
          ref={svgRef}
          width={imgSize.w}
          height={imgSize.h}
          viewBox={`0 0 ${imgSize.w} ${imgSize.h}`}
          className="absolute top-0 left-0"
          style={{ pointerEvents: 'none' }}
        >
          <g style={{ pointerEvents: 'all' }}>
            {visibleLines.map(line => {
              const mid = midpoint(line.start, line.end);
              const angle = angleBetween(line.start, line.end);
              const isSelected = line.id === selectedLineId;
              return (
                <g key={line.id} onClick={(e) => selectLine(line.id, e)} style={{ cursor: 'pointer' }}>
                  <line
                    x1={line.start.x} y1={line.start.y} x2={line.end.x} y2={line.end.y}
                    stroke={line.color} strokeWidth={(isSelected ? 3 : 2) / zoom}
                    opacity={isSelected ? 1 : 0.85}
                  />
                  <circle cx={line.start.x} cy={line.start.y} r={endpointR}
                    fill={line.color} stroke={isSelected ? '#fff' : 'none'} strokeWidth={1 / zoom}
                    style={{ cursor: 'grab', pointerEvents: 'all' }}
                    onMouseDown={(e) => startDrag(line.id, 'start', e)}
                    onTouchStart={(e) => startDrag(line.id, 'start', e)}
                  />
                  <circle cx={line.end.x} cy={line.end.y} r={endpointR}
                    fill={line.color} stroke={isSelected ? '#fff' : 'none'} strokeWidth={1 / zoom}
                    style={{ cursor: 'grab', pointerEvents: 'all' }}
                    onMouseDown={(e) => startDrag(line.id, 'end', e)}
                    onTouchStart={(e) => startDrag(line.id, 'end', e)}
                  />
                  {showMeasurements && (
                    <text x={mid.x} y={mid.y - 8 / zoom} textAnchor="middle"
                      fill={line.color} fontSize={fontSize} fontWeight={500}
                      style={{ pointerEvents: 'none', userSelect: 'none' }}>
                      {line.label || getRealSize(line)}
                    </text>
                  )}
                </g>
              );
            })}
            {renderPending()}
          </g>
        </svg>
      </div>

      {/* Calibration draft confirmation — confirm line placement before entering size */}
      {calDraftReady && !calInputVisible && (
        <div className={`absolute z-10 ${isMobile ? 'bottom-0 inset-x-0' : 'bottom-3 left-1/2 -translate-x-1/2'}`}
          onClick={(e) => e.stopPropagation()}>
          <div className={`flex items-center gap-3 ${isMobile ? 'bg-card border-t border-border px-4 py-3' : 'bg-card border border-border rounded-lg px-4 py-3 shadow-xl'}`}>
            <span className="text-xs text-muted-foreground">Reference line placed.</span>
            <button onClick={confirmCalDraft}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded font-medium hover:opacity-90 active:scale-95 transition-transform">
              <Check className="w-4 h-4" />
              Confirm
            </button>
            <button onClick={cancelCalibration}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-secondary text-muted-foreground rounded hover:text-foreground active:scale-95 transition-transform">
              <X className="w-4 h-4" />
              Redraw
            </button>
          </div>
        </div>
      )}

      {/* Calibration size input — only after confirming draft */}
      {calInputVisible && (
        isMobile ? (
          <div className="absolute bottom-0 inset-x-0 z-10 bg-card border-t border-border px-3 py-3 animate-slide-up"
            onClick={(e) => e.stopPropagation()}>
            <p className="text-xs text-muted-foreground mb-2">Enter real-world size:</p>
            <div className="flex items-center gap-2">
              <input
                type="number"
                inputMode="decimal"
                value={calSize}
                onChange={(e) => setCalSize(e.target.value)}
                placeholder="e.g. 50"
                className="flex-1 min-w-0 px-3 py-2 text-sm bg-secondary border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                onKeyDown={(e) => e.key === 'Enter' && confirmCalibration()}
              />
              <select value={calUnit} onChange={(e) => setCalUnit(e.target.value)}
                className="px-2 py-2 text-sm bg-secondary border border-border rounded text-foreground">
                <option value="cm">cm</option>
                <option value="in">in</option>
                <option value="mm">mm</option>
                <option value="px">px</option>
              </select>
              <button onClick={confirmCalibration}
                className="p-2 bg-primary text-primary-foreground rounded hover:opacity-90 active:scale-95 transition-transform">
                <Check className="w-5 h-5" />
              </button>
              <button onClick={cancelCalibration}
                className="p-2 bg-secondary text-muted-foreground rounded hover:text-foreground active:scale-95 transition-transform">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        ) : (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 bg-card border border-border rounded-lg p-4 shadow-xl animate-slide-up"
            onClick={(e) => e.stopPropagation()}>
            <p className="text-xs text-muted-foreground mb-2">Enter the real-world size of this reference line:</p>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={calSize}
                onChange={(e) => setCalSize(e.target.value)}
                placeholder="e.g. 50"
                className="w-24 px-2 py-1.5 text-sm bg-secondary border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && confirmCalibration()}
              />
              <select value={calUnit} onChange={(e) => setCalUnit(e.target.value)}
                className="px-2 py-1.5 text-sm bg-secondary border border-border rounded text-foreground">
                <option value="cm">cm</option>
                <option value="in">in</option>
                <option value="mm">mm</option>
                <option value="px">px</option>
              </select>
              <button onClick={confirmCalibration}
                className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded font-medium hover:opacity-90">
                Set
              </button>
              <button onClick={cancelCalibration}
                className="px-3 py-1.5 text-sm bg-secondary text-muted-foreground rounded hover:text-foreground">
                Cancel
              </button>
            </div>
          </div>
        )
      )}

      {/* Eyedropper hover preview */}
      {mode === 'eyedropper' && hoveredColor && hoveredPos && (
        <div className="absolute pointer-events-none z-20" style={{ left: hoveredPos.x + 16, top: hoveredPos.y - 40 }}>
          <div className="flex items-center gap-1.5 bg-card border border-border rounded px-2 py-1 shadow-lg">
            <div className="w-5 h-5 rounded-sm border border-border/50" style={{ backgroundColor: hoveredColor }} />
            <span className="text-xs font-mono text-foreground">{hoveredColor}</span>
          </div>
        </div>
      )}

      {/* Mobile floating action bar during active drawing */}
      {isMobile && isActiveDrawing && !calInputVisible && !calDraftReady && (
        <div className="absolute bottom-3 inset-x-3 z-10 flex items-center justify-between bg-card/95 border border-border rounded-lg px-3 py-2 shadow-lg backdrop-blur-sm">
          <span className="text-xs text-muted-foreground">
            {mode === 'calibrate' && (calPoints.length === 0 ? 'Tap 2 points for reference' : calPoints.length === 1 ? 'Tap second point' : '')}
            {mode === 'measure' && (pendingPoint ? 'Tap to complete' : 'Tap to start')}
          </span>
          <button
            onClick={() => {
              cancelCalibration();
              cancelPending();
              setMode('select');
            }}
            className="flex items-center gap-1 px-3 py-1.5 text-xs bg-secondary text-muted-foreground rounded hover:text-foreground"
          >
            <X className="w-3.5 h-3.5" />
            Cancel
          </button>
        </div>
      )}

      {/* Mode indicator (desktop / non-drawing states) */}
      {!(isMobile && isActiveDrawing) && !calInputVisible && !calDraftReady && (
        <div className="absolute bottom-3 left-3 text-xs text-muted-foreground bg-card/80 px-2 py-1 rounded">
          {mode === 'calibrate' && (calPoints.length === 0 ? 'Click two points to set reference line' : calPoints.length === 1 ? 'Click second point' : '')}
          {mode === 'measure' && (pendingPoint ? 'Click to complete measurement' : 'Click to start measuring')}
          {mode === 'eyedropper' && 'Click to sample a color'}
          {mode === 'select' && 'Click a line to select, drag endpoints to adjust'}
          {mode === 'pan' && 'Drag to pan the view'}
          {mode === 'idle' && 'Upload an image to begin'}
        </div>
      )}

      {/* Loading overlay */}
      {isImageLoading && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="w-10 h-10 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
          <p className="mt-3 text-sm font-medium text-foreground">Loading image...</p>
        </div>
      )}

      {/* Error overlay */}
      {imageLoadError && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-background/90 backdrop-blur-sm">
          <p className="text-sm text-destructive font-medium mb-2">Failed to load image</p>
          <p className="text-xs text-muted-foreground mb-4 text-center px-6">{imageLoadError}</p>
          <button onClick={() => { clearImageLoadError(); setImage(null); }}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium">
            Try again
          </button>
        </div>
      )}

      <canvas ref={eyedropperCanvasRef} className="hidden" />
    </div>
  );
}
