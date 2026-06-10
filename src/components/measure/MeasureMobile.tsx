import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, Undo2, Redo2, MoreVertical, Hand, MousePointer, Plus, Layers as LayersIcon,
  Ruler, Crosshair, X, Check, Eye, EyeOff, Trash2, Download, FileJson, FilePlus,
  ChevronUp, ArrowUp, ArrowDown, ArrowLeft as ArrLeft, ArrowRight, Focus, Maximize,
  Share2, ImageDown,
} from 'lucide-react';
import { useProject } from '@/hooks/useProjectStore';
import ImageUploader from '@/components/common/ImageUploader';
import {
  type Point, type MeasurementLine, genId, distanceBetween,
} from '@/types/project';

type Tool = 'pan' | 'edit' | 'add' | 'cal';

const ENDPOINT_HIT_PX = 32; // touch hit radius in screen px
const LINE_HIT_PX = 18;

function distToSegment(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return distanceBetween(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return distanceBetween(p, { x: a.x + t * dx, y: a.y + t * dy });
}

export default function MeasureMobile() {
  const {
    image, calibration, setCalibration,
    measurements, addMeasurement, updateMeasurement, deleteMeasurement,
    selectedLineId, setSelectedLineId,
    layers, activeLayerId, setActiveLayerId, toggleLayerVisibility,
    lineColor, showMeasurements, toggleMeasurements,
    zoom, setZoom, panOffset, setPanOffset,
    undo, redo, newProject, clearAllLines, exportProjectJSON,
    setImage, setMode,
    isImageLoading, imageLoadError, setImageLoaded, setImageLoadError, clearImageLoadError, beginImageUpload,
  } = useProject();

  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const magCanvasRef = useRef<HTMLCanvasElement>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const offscreenReady = useRef(false);
  const fitZoomRef = useRef(1);
  const calInputRef = useRef<HTMLInputElement>(null);
  // Snapshot of zoom/pan taken right before opening the reference input,
  // so we can restore the user's fitted view after the keyboard closes
  // (the iOS visual viewport collapses the container and would otherwise
  // make fitImage compute a tiny scale).
  const preCalViewRef = useRef<{ zoom: number; pan: Point } | null>(null);

  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [tool, setTool] = useState<Tool>(calibration ? 'edit' : 'cal');
  const [focusSelected, setFocusSelected] = useState(true);

  // Add mode (measure) draft + calibration draft
  const [pendingPoint, setPendingPoint] = useState<Point | null>(null);
  const [calPoints, setCalPoints] = useState<Point[]>([]);
  const [calDraftReady, setCalDraftReady] = useState(false);
  const [calInputVisible, setCalInputVisible] = useState(false);
  const [calSize, setCalSize] = useState('');
  const [calUnit, setCalUnit] = useState('cm');

  // Sheets
  type SheetId = null | 'layers' | 'selected' | 'reference' | 'more' | 'precision';
  const [sheet, setSheet] = useState<SheetId>(null);

  // Drag state
  const [drag, setDrag] = useState<
    | { kind: 'endpoint'; lineId: string; endpoint: 'start' | 'end'; screen: Point; img: Point }
    | { kind: 'line'; lineId: string; startImg: Point; origStart: Point; origEnd: Point }
    | { kind: 'pan'; startScreen: Point; startPan: Point }
    | { kind: 'pinch'; startDist: number; startZoom: number; anchorImg: Point }
    | null
  >(null);

  const [precisionEndpoint, setPrecisionEndpoint] = useState<'start' | 'end'>('start');
  const [precisionStep, setPrecisionStep] = useState(1);

  // Export PNG preview modal (mobile-friendly UX)
  const [exportPreview, setExportPreview] = useState<{ dataUrl: string; blob: Blob; filename: string } | null>(null);
  const [shareState, setShareState] = useState<'idle' | 'sharing' | 'unsupported' | 'error'>('idle');

  useEffect(() => {
    return () => {
      // dataUrl-based preview needs no revocation
    };
  }, [exportPreview]);

  const selectedLine = measurements.find(m => m.id === selectedLineId) || null;

  // Map mobile tool -> store mode (for existing logic / external listeners)
  useEffect(() => {
    if (tool === 'pan') setMode('pan');
    else if (tool === 'add') setMode('measure');
    else if (tool === 'cal') setMode('calibrate');
    else setMode('select');
  }, [tool, setMode]);

  // Auto move to edit mode after calibration is set
  useEffect(() => {
    if (calibration && tool === 'cal' && !calInputVisible && !calDraftReady) {
      setTool('edit');
    }
  }, [calibration]); // eslint-disable-line

  // ---------- Image fit / offscreen ----------
  const fitImage = useCallback(() => {
    if (!containerRef.current || !imgRef.current?.naturalWidth) return;
    const cw = containerRef.current.clientWidth;
    const ch = containerRef.current.clientHeight;
    const iw = imgRef.current.naturalWidth;
    const ih = imgRef.current.naturalHeight;
    const scale = Math.min(cw / iw, ch / ih) * 0.95;
    fitZoomRef.current = scale;
    setZoom(scale);
    setPanOffset({ x: (cw - iw * scale) / 2, y: (ch - ih * scale) / 2 });
  }, [setZoom, setPanOffset]);

  const onImgLoad = useCallback(() => {
    if (!imgRef.current) return;
    setImgSize({ w: imgRef.current.naturalWidth, h: imgRef.current.naturalHeight });
    offscreenReady.current = false;
    fitImage();
    setImageLoaded();
  }, [fitImage, setImageLoaded]);

  const prepareOffscreen = useCallback(() => {
    if (offscreenReady.current || !imgRef.current) return;
    const c = document.createElement('canvas');
    c.width = imgRef.current.naturalWidth;
    c.height = imgRef.current.naturalHeight;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(imgRef.current, 0, 0);
    offscreenRef.current = c;
    offscreenReady.current = true;
  }, []);

  // ---------- Coord helpers ----------
  const screenToImage = useCallback((clientX: number, clientY: number): Point => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const r = containerRef.current.getBoundingClientRect();
    return { x: (clientX - r.left - panOffset.x) / zoom, y: (clientY - r.top - panOffset.y) / zoom };
  }, [panOffset, zoom]);

  // ---------- Hit-testing ----------
  const hitTest = useCallback((clientX: number, clientY: number) => {
    if (!containerRef.current) return null;
    const r = containerRef.current.getBoundingClientRect();
    const sx = clientX - r.left, sy = clientY - r.top;
    // Only consider visible & in visible layers
    const visLayerIds = new Set(layers.filter(l => l.visible).map(l => l.id));
    const candidates = measurements.filter(m => m.visible && visLayerIds.has(m.layerId));
    // In focus mode, only the selected line is touchable
    const list = focusSelected && selectedLineId
      ? candidates.filter(m => m.id === selectedLineId)
      : candidates;
    // Endpoints first (selected line gets priority)
    const ordered = [...list].sort((a, b) => (a.id === selectedLineId ? -1 : b.id === selectedLineId ? 1 : 0));
    for (const m of ordered) {
      const a = { x: m.start.x * zoom + panOffset.x, y: m.start.y * zoom + panOffset.y };
      const b = { x: m.end.x * zoom + panOffset.x, y: m.end.y * zoom + panOffset.y };
      if (Math.hypot(sx - a.x, sy - a.y) <= ENDPOINT_HIT_PX) return { type: 'endpoint' as const, lineId: m.id, endpoint: 'start' as const };
      if (Math.hypot(sx - b.x, sy - b.y) <= ENDPOINT_HIT_PX) return { type: 'endpoint' as const, lineId: m.id, endpoint: 'end' as const };
    }
    for (const m of ordered) {
      const a = { x: m.start.x * zoom + panOffset.x, y: m.start.y * zoom + panOffset.y };
      const b = { x: m.end.x * zoom + panOffset.x, y: m.end.y * zoom + panOffset.y };
      if (distToSegment({ x: sx, y: sy }, a, b) <= LINE_HIT_PX) return { type: 'line' as const, lineId: m.id };
    }
    return null;
  }, [measurements, layers, focusSelected, selectedLineId, zoom, panOffset]);

  // ---------- Magnifier ----------
  const drawMagnifier = useCallback((imgX: number, imgY: number) => {
    prepareOffscreen();
    const off = offscreenRef.current;
    const dst = magCanvasRef.current;
    if (!off || !dst) return;
    const size = 120;
    const srcSize = 50; // px of source image
    const ctx = dst.getContext('2d');
    if (!ctx) return;
    dst.width = size; dst.height = size;
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, size, size);
    ctx.imageSmoothingEnabled = false;
    const sx = Math.max(0, Math.min(off.width - srcSize, imgX - srcSize / 2));
    const sy = Math.max(0, Math.min(off.height - srcSize, imgY - srcSize / 2));
    ctx.drawImage(off, sx, sy, srcSize, srcSize, 0, 0, size, size);
    // crosshair
    ctx.strokeStyle = '#ff3b30';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(size / 2, 0); ctx.lineTo(size / 2, size);
    ctx.moveTo(0, size / 2); ctx.lineTo(size, size / 2);
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
    ctx.stroke();
  }, [prepareOffscreen]);

  // ---------- Touch handling ----------
  const lastTapRef = useRef<{ x: number; y: number; t: number } | null>(null);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (calInputVisible) return;
    if (e.touches.length === 2) {
      e.preventDefault();
      const t0 = e.touches[0], t1 = e.touches[1];
      const mid = { x: (t0.clientX + t1.clientX) / 2, y: (t0.clientY + t1.clientY) / 2 };
      const d = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      setDrag({ kind: 'pinch', startDist: d, startZoom: zoom, anchorImg: screenToImage(mid.x, mid.y) });
      return;
    }
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    lastTapRef.current = { x: t.clientX, y: t.clientY, t: Date.now() };

    if (tool === 'pan') {
      setDrag({ kind: 'pan', startScreen: { x: t.clientX, y: t.clientY }, startPan: { ...panOffset } });
      return;
    }
    if (tool === 'edit') {
      const hit = hitTest(t.clientX, t.clientY);
      if (hit?.type === 'endpoint') {
        setSelectedLineId(hit.lineId);
        const line = measurements.find(m => m.id === hit.lineId);
        if (line) {
          const img = hit.endpoint === 'start' ? line.start : line.end;
          setDrag({ kind: 'endpoint', lineId: hit.lineId, endpoint: hit.endpoint, screen: { x: t.clientX, y: t.clientY }, img });
          drawMagnifier(img.x, img.y);
        }
        return;
      }
      if (hit?.type === 'line') {
        setSelectedLineId(hit.lineId);
        const line = measurements.find(m => m.id === hit.lineId)!;
        setDrag({ kind: 'line', lineId: hit.lineId, startImg: screenToImage(t.clientX, t.clientY), origStart: line.start, origEnd: line.end });
        return;
      }
    }
  }, [tool, calInputVisible, panOffset, zoom, screenToImage, hitTest, drawMagnifier, measurements, setSelectedLineId]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!drag) return;
    if (drag.kind === 'pinch' && e.touches.length === 2) {
      e.preventDefault();
      const t0 = e.touches[0], t1 = e.touches[1];
      const d = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      const minZoom = Math.max(0.05, fitZoomRef.current * 0.5);
      const newZoom = Math.max(minZoom, Math.min(10, drag.startZoom * (d / drag.startDist)));
      if (!containerRef.current) return;
      const r = containerRef.current.getBoundingClientRect();
      const mid = { x: (t0.clientX + t1.clientX) / 2 - r.left, y: (t0.clientY + t1.clientY) / 2 - r.top };
      setPanOffset({ x: mid.x - drag.anchorImg.x * newZoom, y: mid.y - drag.anchorImg.y * newZoom });
      setZoom(newZoom);
      return;
    }
    if (e.touches.length !== 1) return;
    e.preventDefault();
    const t = e.touches[0];
    if (drag.kind === 'pan') {
      setPanOffset({ x: drag.startPan.x + (t.clientX - drag.startScreen.x), y: drag.startPan.y + (t.clientY - drag.startScreen.y) });
      return;
    }
    if (drag.kind === 'endpoint') {
      const img = screenToImage(t.clientX, t.clientY);
      updateMeasurement(drag.lineId, { [drag.endpoint]: img });
      drawMagnifier(img.x, img.y);
      setDrag({ ...drag, screen: { x: t.clientX, y: t.clientY }, img });
      return;
    }
    if (drag.kind === 'line') {
      const cur = screenToImage(t.clientX, t.clientY);
      const dx = cur.x - drag.startImg.x;
      const dy = cur.y - drag.startImg.y;
      updateMeasurement(drag.lineId, {
        start: { x: drag.origStart.x + dx, y: drag.origStart.y + dy },
        end: { x: drag.origEnd.x + dx, y: drag.origEnd.y + dy },
      });
    }
  }, [drag, screenToImage, updateMeasurement, drawMagnifier, setPanOffset, setZoom]);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    const wasDrag = drag;
    setDrag(null);

    // Distinguish tap vs drag
    const tap = lastTapRef.current;
    if (!tap || e.changedTouches.length === 0) return;
    const ct = e.changedTouches[0];
    const moved = Math.hypot(ct.clientX - tap.x, ct.clientY - tap.y) > 8;
    const elapsed = Date.now() - tap.t;
    if (moved || elapsed > 500) return;
    if (wasDrag && (wasDrag.kind === 'pinch' || wasDrag.kind === 'pan')) return;

    const pt = screenToImage(ct.clientX, ct.clientY);

    if (tool === 'cal') {
      if (calPoints.length === 0) setCalPoints([pt]);
      else if (calPoints.length === 1) { setCalPoints([calPoints[0], pt]); setCalDraftReady(true); }
      return;
    }
    if (tool === 'add') {
      if (!pendingPoint) { setPendingPoint(pt); return; }
      const line: MeasurementLine = {
        id: genId(), start: pendingPoint, end: pt,
        label: '', color: lineColor, layerId: activeLayerId, visible: true,
      };
      addMeasurement(line);
      setPendingPoint(null);
      setSelectedLineId(line.id);
      // Keep "Add" tool active so the user can immediately measure again.
      // Do NOT auto-open the Selected Line sheet — it interrupts the flow.
      return;
    }
    if (tool === 'edit') {
      const hit = hitTest(ct.clientX, ct.clientY);
      if (hit) setSelectedLineId(hit.lineId);
      else if (!focusSelected) setSelectedLineId(null);
    }
  }, [drag, tool, calPoints, pendingPoint, lineColor, activeLayerId, addMeasurement, screenToImage, hitTest, focusSelected, setSelectedLineId]);

  // ---------- Calibration confirm ----------
  // Dismiss any active soft keyboard, then refit the canvas once the iOS
  // visual viewport has settled. Without this, the layout can stay scrolled
  // into the bottom controls after the reference input closes.
  const dismissKeyboardAndRefit = useCallback(() => {
    const ae = document.activeElement as HTMLElement | null;
    if (ae && typeof ae.blur === 'function') ae.blur();
    // Reset any page-level scroll the keyboard may have caused on iOS.
    if (typeof window !== 'undefined') {
      window.scrollTo(0, 0);
      // Two RAFs + a short timeout to wait for visualViewport to update.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          fitImage();
        });
      });
      window.setTimeout(() => {
        window.scrollTo(0, 0);
        fitImage();
      }, 250);
    }
  }, [fitImage]);

  // Restore the pre-calibration zoom/pan after the keyboard closes,
  // instead of recomputing a fit (which uses a possibly-collapsed
  // visualViewport-affected container height on iOS).
  const restorePreCalView = useCallback(() => {
    const ae = document.activeElement as HTMLElement | null;
    if (ae && typeof ae.blur === 'function') ae.blur();
    if (typeof window !== 'undefined') window.scrollTo(0, 0);
    const apply = () => {
      const saved = preCalViewRef.current;
      if (saved) {
        setZoom(saved.zoom);
        setPanOffset(saved.pan);
      } else {
        fitImage();
      }
    };
    requestAnimationFrame(() => requestAnimationFrame(apply));
    window.setTimeout(() => {
      apply();
      preCalViewRef.current = null;
    }, 300);
  }, [fitImage, setZoom, setPanOffset]);

  const confirmCalDraft = () => {
    // Snapshot view BEFORE the input opens so we can restore it after Set.
    preCalViewRef.current = { zoom, pan: { ...panOffset } };
    setCalDraftReady(false);
    setCalInputVisible(true);
    // Delay focus until the panel layout is stable so the keyboard does
    // not open over a still-animating overlay (input would be hidden).
    window.setTimeout(() => {
      calInputRef.current?.focus();
    }, 350);
  };
  const cancelCal = () => {
    setCalPoints([]); setCalDraftReady(false); setCalInputVisible(false); setCalSize('');
    restorePreCalView();
  };
  const confirmCal = () => {
    const size = parseFloat(calSize);
    if (isNaN(size) || size <= 0 || calPoints.length < 2) return;
    setCalibration({ start: calPoints[0], end: calPoints[1], realWorldSize: size, unit: calUnit });
    setCalPoints([]); setCalInputVisible(false); setCalSize(''); setTool('edit');
    restorePreCalView();
  };

  // Recalculate canvas bounds on iOS visual viewport changes (keyboard show/hide,
  // orientation, dynamic browser chrome). Does not change zoom/pan unless needed.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let pending = false;
    const onVV = () => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        // Only refit if the image is loaded and not in the middle of a drag.
        if (imgRef.current?.naturalWidth && !drag) {
          // Keep current zoom/pan stable; only re-center if the container shrank
          // dramatically (e.g. keyboard just closed and we have lots of empty space).
          const cw = containerRef.current?.clientWidth ?? 0;
          const ch = containerRef.current?.clientHeight ?? 0;
          const iw = imgRef.current.naturalWidth * zoom;
          const ih = imgRef.current.naturalHeight * zoom;
          // If image now sits entirely off-screen, refit.
          if (panOffset.x + iw < 0 || panOffset.y + ih < 0 || panOffset.x > cw || panOffset.y > ch) {
            fitImage();
          }
        }
      });
    };
    const vv = window.visualViewport;
    vv?.addEventListener('resize', onVV);
    vv?.addEventListener('scroll', onVV);
    window.addEventListener('orientationchange', onVV);
    return () => {
      vv?.removeEventListener('resize', onVV);
      vv?.removeEventListener('scroll', onVV);
      window.removeEventListener('orientationchange', onVV);
    };
  }, [fitImage, drag, zoom, panOffset.x, panOffset.y]);

  // ---------- Real-world size ----------
  const getRealSize = useCallback((line: MeasurementLine) => {
    if (!calibration) return '—';
    const cd = distanceBetween(calibration.start, calibration.end);
    if (cd === 0) return '—';
    return (distanceBetween(line.start, line.end) * (calibration.realWorldSize / cd)).toFixed(1) + ' ' + calibration.unit;
  }, [calibration]);

  // ---------- Precision nudge ----------
  const nudge = (dx: number, dy: number) => {
    if (!selectedLine) return;
    const step = precisionStep / zoom; // step is in screen px equivalent to keep feel consistent
    const pt = precisionEndpoint === 'start' ? selectedLine.start : selectedLine.end;
    const next = { x: pt.x + dx * step, y: pt.y + dy * step };
    updateMeasurement(selectedLine.id, { [precisionEndpoint]: next });
  };

  // ---------- Export PNG ----------
  const triggerDownload = useCallback((blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.target = '_blank'; // iOS Safari: opens in new tab if download attr is ignored
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
  }, []);

  const exportPNG = useCallback(() => {
    if (!image) return;
    setSheet(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);

      // Respect layer + line visibility
      const visLayerIds = new Set(layers.filter(l => l.visible).map(l => l.id));
      const visibleLines = measurements.filter(m => m.visible && visLayerIds.has(m.layerId));

      // Scale stroke/font with image size so exports look right on any resolution
      const refSize = Math.max(c.width, c.height);
      const strokeW = Math.max(2, refSize * 0.002);
      const fontPx = Math.max(14, Math.round(refSize * 0.018));
      const endpointR = Math.max(3, refSize * 0.0035);

      ctx.lineCap = 'round';
      visibleLines.forEach(line => {
        ctx.beginPath();
        ctx.moveTo(line.start.x, line.start.y);
        ctx.lineTo(line.end.x, line.end.y);
        ctx.strokeStyle = line.color;
        ctx.lineWidth = strokeW;
        ctx.stroke();
        // Endpoint dots
        ctx.fillStyle = line.color;
        [line.start, line.end].forEach(p => {
          ctx.beginPath();
          ctx.arc(p.x, p.y, endpointR, 0, Math.PI * 2);
          ctx.fill();
        });
      });

      // Labels near each line's start, offset perpendicular (matches mobile canvas behavior)
      ctx.font = `600 ${fontPx}px sans-serif`;
      ctx.textBaseline = 'middle';
      visibleLines.forEach(line => {
        const text = line.label ? `${line.label} · ${getRealSize(line)}` : getRealSize(line);
        const dx = line.end.x - line.start.x;
        const dy = line.end.y - line.start.y;
        const len = Math.hypot(dx, dy) || 1;
        // Perpendicular unit vector (rotated 90deg)
        const px = -dy / len;
        const py = dx / len;
        const offset = fontPx * 1.1;
        const ax = line.start.x + px * offset;
        const ay = line.start.y + py * offset;
        ctx.textAlign = (ax < line.start.x) ? 'right' : 'left';
        const padX = fontPx * 0.4;
        const padY = fontPx * 0.3;
        const metrics = ctx.measureText(text);
        const tw = metrics.width;
        const th = fontPx;
        const bx = ctx.textAlign === 'right' ? ax - tw - padX : ax - padX;
        const by = ay - th / 2 - padY;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(bx, by, tw + padX * 2, th + padY * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(text, ax, ay);
      });

      const finish = (blob: Blob | null) => {
        if (!blob) return;
        const filename = 'studio-companion-export.png';
        // Use a data URL (not a blob: URL) for the <img> so iOS Safari's
        // long-press "Save Image" works without "No Internet Connection".
        const dataUrl = c.toDataURL('image/png');
        setShareState('idle');
        setExportPreview({ dataUrl, blob, filename });
      };
      if (c.toBlob) c.toBlob(finish, 'image/png');
      else {
        // Fallback for very old browsers
        const dataUrl = c.toDataURL('image/png');
        const bin = atob(dataUrl.split(',')[1]);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        finish(new Blob([arr], { type: 'image/png' }));
      }
    };
    img.onerror = () => { /* swallow; nothing to export */ };
    img.src = image;
  }, [image, measurements, layers, getRealSize, triggerDownload]);

  const exportJSON = useCallback(() => {
    setSheet(null);
    const blob = new Blob([exportProjectJSON()], { type: 'application/json' });
    triggerDownload(blob, 'studio-companion-project.json');
  }, [exportProjectJSON, triggerDownload]);

  // ---------- Export preview actions ----------
  const closeExportPreview = useCallback(() => {
    setExportPreview(null);
    setShareState('idle');
  }, []);

  const shareExport = useCallback(async () => {
    if (!exportPreview) return;
    try {
      const file = new File([exportPreview.blob], exportPreview.filename, { type: 'image/png' });
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.share && nav.canShare && nav.canShare({ files: [file] })) {
        setShareState('sharing');
        await nav.share({ files: [file], title: 'Studio Companion export' });
        setShareState('idle');
        return;
      }
      // Fallback: open the image in a new tab so the user can long-press → Save Image.
      const w = window.open();
      if (w) {
        w.document.title = exportPreview.filename;
        w.document.body.style.margin = '0';
        w.document.body.style.background = '#000';
        const img = w.document.createElement('img');
        img.src = exportPreview.dataUrl;
        img.style.width = '100%';
        img.style.height = 'auto';
        img.style.display = 'block';
        w.document.body.appendChild(img);
        setShareState('idle');
      } else {
        setShareState('unsupported');
      }
    } catch (err) {
      // User cancellation is fine; only flag real errors
      const name = (err as Error)?.name;
      setShareState(name === 'AbortError' ? 'idle' : 'error');
    }
  }, [exportPreview]);

  const downloadExport = useCallback(() => {
    if (!exportPreview) return;
    triggerDownload(exportPreview.blob, exportPreview.filename);
  }, [exportPreview, triggerDownload]);

  // ---------- Render ----------
  if (!image) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 canvas-area">
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
            <div className="flex flex-col items-center gap-3 p-10">
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

  const visibleLayerIds = new Set(layers.filter(l => l.visible).map(l => l.id));
  const renderedLines = measurements.filter(m => m.visible && visibleLayerIds.has(m.layerId));

  return (
    <div className="relative flex-1 flex flex-col min-h-0 bg-[hsl(var(--canvas-bg))]">
      {/* Top bar */}
      <div className="shrink-0 z-30 flex items-center justify-between px-2 h-12 border-b border-border bg-card/95 backdrop-blur-sm">
        <button onClick={() => { if (confirm('Start a new project?')) newProject(); }}
          className="h-11 w-11 flex items-center justify-center rounded-md text-muted-foreground active:bg-secondary" aria-label="New project">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2 text-sm font-medium">
          <Ruler className="w-4 h-4 text-primary" /> Measure
        </div>
        <div className="flex items-center">
          <button onClick={undo} className="h-11 w-11 flex items-center justify-center rounded-md text-muted-foreground active:bg-secondary" aria-label="Undo">
            <Undo2 className="w-5 h-5" />
          </button>
          <button onClick={redo} className="h-11 w-11 flex items-center justify-center rounded-md text-muted-foreground active:bg-secondary" aria-label="Redo">
            <Redo2 className="w-5 h-5" />
          </button>
          <button onClick={() => setSheet('more')} className="h-11 w-11 flex items-center justify-center rounded-md text-muted-foreground active:bg-secondary" aria-label="More">
            <MoreVertical className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        className="relative flex-1 overflow-hidden select-none"
        style={{ touchAction: 'none' }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div style={{ transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`, transformOrigin: '0 0', position: 'absolute', top: 0, left: 0 }}>
          <img ref={imgRef} src={image} alt="Reference" onLoad={onImgLoad} onError={() => setImageLoadError('Failed to load image. Please try again.')} draggable={false} className="block max-w-none" />
          <svg width={imgSize.w} height={imgSize.h} viewBox={`0 0 ${imgSize.w} ${imgSize.h}`} className="absolute top-0 left-0 pointer-events-none">
            {/* Calibration line */}
            {calibration && (
              <line x1={calibration.start.x} y1={calibration.start.y} x2={calibration.end.x} y2={calibration.end.y}
                stroke="#ffffff" strokeWidth={1.5 / zoom} strokeDasharray={`${4 / zoom}`} opacity={0.5} />
            )}
            {/* Cal draft */}
            {tool === 'cal' && calPoints.length >= 1 && (
              <>
                <circle cx={calPoints[0].x} cy={calPoints[0].y} r={6 / zoom} fill="#fff" />
                {calPoints[1] && (
                  <>
                    <line x1={calPoints[0].x} y1={calPoints[0].y} x2={calPoints[1].x} y2={calPoints[1].y}
                      stroke="#fff" strokeWidth={2 / zoom} strokeDasharray={`${6 / zoom}`} />
                    <circle cx={calPoints[1].x} cy={calPoints[1].y} r={6 / zoom} fill="#fff" />
                  </>
                )}
              </>
            )}
            {/* Measure pending */}
            {tool === 'add' && pendingPoint && (
              <circle cx={pendingPoint.x} cy={pendingPoint.y} r={6 / zoom} fill={lineColor} />
            )}
            {/* Lines */}
            {renderedLines.map(line => {
              const isSelected = line.id === selectedLineId;
              const dim = focusSelected && selectedLineId && !isSelected;
              return (
                <g key={line.id} opacity={dim ? 0.25 : 1}>
                  <line x1={line.start.x} y1={line.start.y} x2={line.end.x} y2={line.end.y}
                    stroke={line.color} strokeWidth={(isSelected ? 3.5 : 2) / zoom} />
                  {isSelected && (
                    <>
                      <circle cx={line.start.x} cy={line.start.y} r={9 / zoom} fill={line.color} stroke="#fff" strokeWidth={2 / zoom} />
                      <circle cx={line.end.x} cy={line.end.y} r={9 / zoom} fill={line.color} stroke="#fff" strokeWidth={2 / zoom} />
                    </>
                  )}
                </g>
              );
            })}
            {/* Labels — anchored near each line's start, with anti-overlap offset */}
            {(() => {
              if (!showMeasurements && !selectedLineId) return null;
              // Compute desired anchor for each visible line (near start, offset perpendicular to the line)
              const anchorOffsetPx = 14; // screen px from start point
              const placed: { x: number; y: number; h: number }[] = [];
              const items = renderedLines.map(line => {
                const dx = line.end.x - line.start.x;
                const dy = line.end.y - line.start.y;
                const len = Math.hypot(dx, dy) || 1;
                // perpendicular unit vector (rotated -90deg → upper-left side of line)
                const px = -dy / len;
                const py = dx / len;
                // Push label slightly along the line (away from start) and perpendicular
                const along = 8 / zoom;
                const perp = anchorOffsetPx / zoom;
                let lx = line.start.x + (dx / len) * along + px * perp;
                let ly = line.start.y + (dy / len) * along + py * perp;
                return { line, lx, ly };
              });
              // Sort so selected renders last (on top)
              items.sort((a, b) => (a.line.id === selectedLineId ? 1 : b.line.id === selectedLineId ? -1 : 0));
              return items.map(({ line, lx, ly }) => {
                const isSelected = line.id === selectedLineId;
                const dim = focusSelected && selectedLineId && !isSelected;
                if (!isSelected && !showMeasurements) return null;
                if (!isSelected && focusSelected && selectedLineId) return null;
                const fontSize = (isSelected ? 15 : 11) / zoom;
                const lineH = fontSize * 1.2;
                // Anti-overlap: nudge down if too close to an already placed label
                const minDx = 60 / zoom;
                const minDy = lineH;
                let tries = 0;
                while (tries < 8 && placed.some(p => Math.abs(p.x - lx) < minDx && Math.abs(p.y - ly) < minDy)) {
                  ly += lineH;
                  tries++;
                }
                placed.push({ x: lx, y: ly, h: lineH });
                const text = line.label ? `${line.label} · ${getRealSize(line)}` : getRealSize(line);
                return (
                  <text key={`lbl-${line.id}`} x={lx} y={ly} textAnchor="start"
                    opacity={dim ? 0.35 : 1}
                    fill={line.color} fontSize={fontSize} fontWeight={isSelected ? 700 : 500}
                    style={{ paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.7)', strokeWidth: (isSelected ? 3.5 : 2.5) / zoom }}>
                    {text}
                  </text>
                );
              });
            })()}
          </svg>
        </div>

        {/* Tool indicator */}
        <div className="absolute top-2 left-2 px-2 py-1 text-[11px] rounded bg-card/80 text-muted-foreground backdrop-blur-sm">
          {tool === 'pan' && 'Pan / Zoom'}
          {tool === 'edit' && (selectedLine ? 'Editing selected' : 'Tap a line to edit')}
          {tool === 'add' && (pendingPoint ? 'Tap to set end point' : 'Tap to set start point')}
          {tool === 'cal' && (calPoints.length === 0 ? 'Tap 2 points for reference' : calPoints.length === 1 ? 'Tap second point' : 'Confirm reference')}
        </div>

        {/* Fit + focus toggles */}
        <div className="absolute top-2 right-2 flex flex-col gap-2">
          <button onClick={fitImage} aria-label="Fit"
            className="h-10 w-10 rounded-full bg-card/90 border border-border text-foreground flex items-center justify-center shadow active:scale-95">
            <Maximize className="w-4 h-4" />
          </button>
          <button onClick={() => setFocusSelected(v => !v)} aria-label="Focus selected"
            className={`h-10 w-10 rounded-full border border-border flex items-center justify-center shadow active:scale-95 ${focusSelected ? 'bg-primary text-primary-foreground' : 'bg-card/90 text-foreground'}`}>
            <Focus className="w-4 h-4" />
          </button>
        </div>

        {/* Magnifier */}
        {drag?.kind === 'endpoint' && (
          <div className="pointer-events-none absolute z-20"
            style={{ left: Math.max(8, Math.min((containerRef.current?.clientWidth ?? 300) - 128, drag.screen.x - 60)),
                     top: Math.max(8, drag.screen.y - 160) }}>
            <canvas ref={magCanvasRef} className="rounded-full shadow-2xl" style={{ width: 120, height: 120 }} />
          </div>
        )}

        {/* Calibration draft / input */}
        {calDraftReady && !calInputVisible && (
          <div className="absolute bottom-20 inset-x-3 z-30 flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-3 shadow-xl">
            <span className="flex-1 text-xs text-muted-foreground">Reference line placed.</span>
            <button onClick={confirmCalDraft} className="flex items-center gap-1.5 h-10 px-3 text-sm bg-primary text-primary-foreground rounded-md font-medium">
              <Check className="w-4 h-4" /> Confirm
            </button>
            <button onClick={cancelCal} className="h-10 w-10 flex items-center justify-center bg-secondary text-muted-foreground rounded-md">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        {calInputVisible && (
          <div className="absolute bottom-0 inset-x-0 z-40 bg-card border-t border-border p-3 space-y-2 pb-[env(safe-area-inset-bottom)]">
            <p className="text-xs text-muted-foreground">Enter real-world size of the reference line:</p>
            <div className="flex items-center gap-2">
              <input ref={calInputRef} type="number" inputMode="decimal" value={calSize} onChange={e => setCalSize(e.target.value)}
                placeholder="e.g. 50"
                /* font-size: 16px prevents iOS Safari from auto-zooming on focus */
                style={{ fontSize: '16px' }}
                className="flex-1 min-w-0 h-11 px-3 bg-secondary border border-border rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); confirmCal(); } }} />
              <select value={calUnit} onChange={e => setCalUnit(e.target.value)}
                style={{ fontSize: '16px' }}
                className="h-11 px-2 bg-secondary border border-border rounded-md text-foreground">
                <option value="cm">cm</option><option value="in">in</option><option value="mm">mm</option>
              </select>
              <button onClick={confirmCal} className="h-11 px-4 bg-primary text-primary-foreground rounded-md font-medium">Set</button>
              <button onClick={cancelCal} className="h-11 w-11 flex items-center justify-center bg-secondary text-muted-foreground rounded-md"><X className="w-4 h-4" /></button>
            </div>
          </div>
        )}

        {/* Add mode cancel */}
        {tool === 'add' && pendingPoint && (
          <button onClick={() => setPendingPoint(null)}
            className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20 h-10 px-4 text-xs bg-card border border-border rounded-full text-muted-foreground shadow">
            Cancel point
          </button>
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
      </div>

      {/* Bottom action bar */}
      <div className="shrink-0 z-30 border-t border-border bg-card/95 backdrop-blur-sm">
        {/* Mode toggle row */}
        <div className="flex items-center gap-1 px-2 pt-2">
          <ModeToggle active={tool === 'pan'} onClick={() => setTool('pan')} icon={<Hand className="w-4 h-4" />} label="Pan" />
          <ModeToggle active={tool === 'edit'} onClick={() => setTool('edit')} icon={<MousePointer className="w-4 h-4" />} label="Edit" />
          <ModeToggle active={tool === 'add'} onClick={() => { if (!calibration) { setSheet('reference'); return; } setTool('add'); setPendingPoint(null); }}
            icon={<Plus className="w-4 h-4" />} label="Add" />
        </div>
        {/* Secondary actions */}
        <div className="grid grid-cols-4 gap-1 p-2">
          <ActionBtn onClick={() => setSheet('layers')} icon={<LayersIcon className="w-5 h-5" />} label="Layers" />
          <ActionBtn onClick={() => setSheet('reference')} icon={<Crosshair className="w-5 h-5" />} label={calibration ? 'Reference' : 'Set ref.'} highlight={!calibration} />
          <ActionBtn onClick={() => selectedLine ? setSheet('precision') : null} icon={<Ruler className="w-5 h-5" />} label="Precision" disabled={!selectedLine} />
          <ActionBtn onClick={() => setSheet('selected')} icon={<ChevronUp className="w-5 h-5" />} label={selectedLine ? 'Selected' : 'Lines'} />
        </div>
        {/* Primary Export PNG */}
        <div className="px-2 pb-2">
          <button onClick={exportPNG}
            className="w-full h-12 rounded-md bg-primary text-primary-foreground font-medium text-sm flex items-center justify-center gap-2 active:opacity-80">
            <Download className="w-5 h-5" />
            Export PNG
          </button>
        </div>
      </div>

      {/* Bottom sheets */}
      {sheet && (
        <Sheet onClose={() => setSheet(null)} title={
          sheet === 'layers' ? 'Layers'
          : sheet === 'selected' ? (selectedLine ? 'Selected line' : 'Lines')
          : sheet === 'reference' ? 'Reference measurement'
          : sheet === 'precision' ? 'Precision controls'
          : 'More'
        }>
          {sheet === 'layers' && (
            <div className="space-y-1">
              {layers.map(layer => {
                const count = measurements.filter(m => m.layerId === layer.id).length;
                const active = activeLayerId === layer.id;
                return (
                  <div key={layer.id}
                    onClick={() => setActiveLayerId(layer.id)}
                    className={`flex items-center gap-3 px-3 py-3 rounded-md min-h-[52px] ${active ? 'bg-secondary' : 'active:bg-secondary/60'}`}>
                    <button onClick={(e) => { e.stopPropagation(); toggleLayerVisibility(layer.id); }}
                      className="h-10 w-10 flex items-center justify-center text-muted-foreground" aria-label="Toggle visibility">
                      {layer.visible ? <Eye className="w-5 h-5" /> : <EyeOff className="w-5 h-5" />}
                    </button>
                    <span className="w-4 h-4 rounded-full" style={{ backgroundColor: layer.color }} />
                    <span className="flex-1 text-sm text-foreground">{layer.name}</span>
                    <span className="text-xs text-muted-foreground">{count}</span>
                  </div>
                );
              })}
            </div>
          )}

          {sheet === 'selected' && (
            <div className="space-y-3">
              {selectedLine ? (
                <SelectedLineEditor line={selectedLine} getRealSize={getRealSize}
                  onChange={(u) => updateMeasurement(selectedLine.id, u)}
                  onDelete={() => { deleteMeasurement(selectedLine.id); setSheet(null); }} />
              ) : (
                <p className="text-xs text-muted-foreground">No line selected. Tap a line on the canvas.</p>
              )}
              <div className="border-t border-border pt-3 space-y-1 max-h-[40vh] overflow-y-auto">
                <div className="text-xs uppercase tracking-wider text-muted-foreground px-1 pb-1">All lines ({measurements.length})</div>
                {measurements.map(line => {
                  const sel = line.id === selectedLineId;
                  return (
                    <div key={line.id}
                      onClick={() => setSelectedLineId(line.id)}
                      className={`flex items-center gap-3 px-3 py-3 rounded-md min-h-[48px] ${sel ? 'bg-secondary' : 'active:bg-secondary/60'}`}>
                      <span className="w-3 h-3 rounded-full" style={{ backgroundColor: line.color }} />
                      <span className="flex-1 text-sm text-foreground truncate">{line.label || getRealSize(line)}</span>
                      <button onClick={(e) => { e.stopPropagation(); updateMeasurement(line.id, { visible: !line.visible }); }}
                        className="h-9 w-9 flex items-center justify-center text-muted-foreground" aria-label="Hide line">
                        {line.visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); deleteMeasurement(line.id); }}
                        className="h-9 w-9 flex items-center justify-center text-muted-foreground" aria-label="Delete line">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {sheet === 'reference' && (
            <div className="space-y-3">
              {calibration ? (
                <div className="rounded-md border border-border p-3 bg-secondary/30">
                  <div className="text-xs text-muted-foreground">Current reference</div>
                  <div className="text-lg font-semibold text-foreground">{calibration.realWorldSize} {calibration.unit}</div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No reference set. You need a reference line before measurements show real-world sizes.</p>
              )}
              <button onClick={() => { setTool('cal'); setCalPoints([]); setCalDraftReady(false); setSheet(null); }}
                className="w-full h-12 rounded-md bg-primary text-primary-foreground font-medium">
                {calibration ? 'Replace reference' : 'Draw reference line'}
              </button>
              <p className="text-xs text-muted-foreground">Tap two points on the canvas, then enter the real-world size in cm or inches.</p>
            </div>
          )}

          {sheet === 'precision' && selectedLine && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Endpoint</span>
                <div className="flex bg-secondary rounded-md p-0.5">
                  {(['start', 'end'] as const).map(k => (
                    <button key={k} onClick={() => setPrecisionEndpoint(k)}
                      className={`h-9 px-3 text-xs rounded ${precisionEndpoint === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>
                      {k === 'start' ? 'Start' : 'End'}
                    </button>
                  ))}
                </div>
                <span className="ml-auto text-xs text-muted-foreground">Step</span>
                <div className="flex bg-secondary rounded-md p-0.5">
                  {[1, 5, 10].map(s => (
                    <button key={s} onClick={() => setPrecisionStep(s)}
                      className={`h-9 px-2 text-xs rounded ${precisionStep === s ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>
                      {s}px
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 max-w-[260px] mx-auto">
                <div />
                <NudgeBtn onClick={() => nudge(0, -1)}><ArrowUp className="w-5 h-5" /></NudgeBtn>
                <div />
                <NudgeBtn onClick={() => nudge(-1, 0)}><ArrLeft className="w-5 h-5" /></NudgeBtn>
                <div className="h-14 flex items-center justify-center text-xs text-muted-foreground">{getRealSize(selectedLine)}</div>
                <NudgeBtn onClick={() => nudge(1, 0)}><ArrowRight className="w-5 h-5" /></NudgeBtn>
                <div />
                <NudgeBtn onClick={() => nudge(0, 1)}><ArrowDown className="w-5 h-5" /></NudgeBtn>
                <div />
              </div>
            </div>
          )}

          {sheet === 'more' && (
            <div className="space-y-1">
              <SheetItem onClick={() => { toggleMeasurements(); }} icon={showMeasurements ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />} label={showMeasurements ? 'Hide measurements' : 'Show measurements'} />
              <SheetItem onClick={() => { if (confirm('Clear all lines?')) clearAllLines(); }} icon={<Trash2 className="w-5 h-5" />} label="Clear all lines" danger />
              <SheetItem onClick={() => { if (confirm('Start a new project?')) newProject(); }} icon={<FilePlus className="w-5 h-5" />} label="New project" danger />
              <div className="pt-2 pb-1 px-3">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Advanced</div>
              </div>
              <SheetItem onClick={exportJSON} icon={<FileJson className="w-5 h-5" />} label="Export project data (JSON)" />
            </div>
          )}
        </Sheet>
      )}

      {exportPreview && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-black/90 backdrop-blur-sm animate-in fade-in">
          <div className="shrink-0 flex items-center justify-between px-2 h-12 border-b border-white/10">
            <button onClick={closeExportPreview} className="h-11 w-11 flex items-center justify-center text-white/80 active:bg-white/10 rounded-md" aria-label="Close preview">
              <X className="w-5 h-5" />
            </button>
            <div className="text-sm font-medium text-white">Export preview</div>
            <div className="w-11" />
          </div>
          <div className="flex-1 min-h-0 overflow-auto flex items-center justify-center p-3">
            <img
              src={exportPreview.dataUrl}
              alt="Export preview — long-press to save on iPhone"
              className="max-w-full max-h-full object-contain rounded-md shadow-2xl select-none"
              style={{ WebkitTouchCallout: 'default' } as React.CSSProperties}
              draggable={false}
            />
          </div>
          <div className="shrink-0 px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t border-white/10 bg-black/40 space-y-2">
            {shareState === 'unsupported' && (
              <p className="text-[11px] text-white/70 text-center">
                Sharing isn't supported here. Long-press the image above to save it, or use Download.
              </p>
            )}
            {shareState === 'error' && (
              <p className="text-[11px] text-destructive text-center">Couldn't open the share sheet. Try Download.</p>
            )}
            <div className="grid grid-cols-3 gap-2">
              <button onClick={shareExport}
                className="h-12 rounded-md bg-primary text-primary-foreground font-medium text-sm flex flex-col items-center justify-center gap-0.5 active:opacity-80">
                <Share2 className="w-5 h-5" />
                <span className="text-[11px]">Share</span>
              </button>
              <button onClick={shareExport}
                className="h-12 rounded-md bg-white/10 text-white font-medium text-sm flex flex-col items-center justify-center gap-0.5 active:bg-white/20">
                <ImageDown className="w-5 h-5" />
                <span className="text-[11px]">Save Image</span>
              </button>
              <button onClick={downloadExport}
                className="h-12 rounded-md bg-white/10 text-white font-medium text-sm flex flex-col items-center justify-center gap-0.5 active:bg-white/20">
                <Download className="w-5 h-5" />
                <span className="text-[11px]">Download</span>
              </button>
            </div>
            <p className="text-[10px] text-white/50 text-center">
              On iPhone, tap Save Image to use the share sheet → "Save Image" to add it to Photos.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- Small subcomponents ----------------

function ModeToggle({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button onClick={onClick}
      className={`flex-1 h-11 rounded-md flex items-center justify-center gap-1.5 text-sm font-medium transition-colors ${active ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground active:bg-secondary/80'}`}>
      {icon}<span>{label}</span>
    </button>
  );
}

function ActionBtn({ onClick, icon, label, disabled, highlight }: { onClick: () => void; icon: React.ReactNode; label: string; disabled?: boolean; highlight?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`h-14 rounded-md flex flex-col items-center justify-center gap-0.5 text-[11px] ${disabled ? 'opacity-40' : 'active:bg-secondary'} ${highlight ? 'text-primary' : 'text-foreground'}`}>
      {icon}<span>{label}</span>
    </button>
  );
}

function NudgeBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="h-14 rounded-md bg-secondary text-foreground flex items-center justify-center active:bg-secondary/70">
      {children}
    </button>
  );
}

function SheetItem({ onClick, icon, label, danger }: { onClick: () => void; icon: React.ReactNode; label: string; danger?: boolean }) {
  return (
    <button onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-3 rounded-md min-h-[48px] text-sm active:bg-secondary ${danger ? 'text-destructive' : 'text-foreground'}`}>
      {icon}<span>{label}</span>
    </button>
  );
}

function Sheet({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 bg-card rounded-t-2xl border-t border-border shadow-2xl max-h-[80vh] flex flex-col animate-slide-up">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <button onClick={onClose} className="h-10 w-10 flex items-center justify-center text-muted-foreground" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="overflow-y-auto p-3 flex-1">{children}</div>
      </div>
    </div>
  );
}

function SelectedLineEditor({ line, getRealSize, onChange, onDelete }:
  { line: MeasurementLine; getRealSize: (l: MeasurementLine) => string; onChange: (u: Partial<MeasurementLine>) => void; onDelete: () => void }) {
  const [label, setLabel] = useState(line.label);
  const [labelOpen, setLabelOpen] = useState(!!line.label);
  useEffect(() => { setLabel(line.label); setLabelOpen(!!line.label); }, [line.id, line.label]);
  return (
    <div className="rounded-md border border-border p-3 space-y-3 bg-secondary/30">
      <div className="flex items-center gap-3">
        <span className="w-4 h-4 rounded-full" style={{ backgroundColor: line.color }} />
        <div className="flex-1">
          <div className="text-xs text-muted-foreground">Measurement</div>
          <div className="text-base font-semibold text-foreground">{getRealSize(line)}</div>
        </div>
        <button onClick={onDelete} className="h-10 w-10 flex items-center justify-center text-destructive" aria-label="Delete">
          <Trash2 className="w-5 h-5" />
        </button>
      </div>
      {labelOpen ? (
        <label className="block">
          <span className="text-xs text-muted-foreground">Label</span>
          <input autoFocus value={label} onChange={e => setLabel(e.target.value)} onBlur={() => onChange({ label })}
            placeholder="e.g. eye width"
            className="mt-1 w-full h-11 px-3 text-sm bg-background border border-border rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
        </label>
      ) : (
        <button onClick={() => setLabelOpen(true)}
          className="text-xs text-muted-foreground active:text-foreground inline-flex items-center gap-1">
          + Add label
        </button>
      )}
      <button onClick={() => onChange({ visible: !line.visible })}
        className="w-full h-10 rounded-md bg-secondary text-muted-foreground text-sm">
        {line.visible ? 'Hide line' : 'Show line'}
      </button>
    </div>
  );
}