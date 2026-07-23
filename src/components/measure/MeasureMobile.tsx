import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, Undo2, Redo2, MoreVertical, Hand, MousePointer, Plus, Layers as LayersIcon,
  Ruler, X, Check, Eye, EyeOff, Trash2, Download, FileJson, FilePlus,
  Maximize, Lightbulb, Frame, RectangleHorizontal,
} from 'lucide-react';
import { useProject } from '@/hooks/useProjectStore';
import { useOnboarding, hasSeenOnboarding, markOnboardingSeen } from '@/onboarding';
import { useSaveMedia } from '@/components/common/SaveMedia';
import ImageUploader from '@/components/common/ImageUploader';
import {
  type Point, type MeasurementLine, genId, distanceBetween, realWorldLength, LINE_COLORS,
} from '@/types/project';

type Tool = 'pan' | 'edit' | 'add' | 'cal';

const ENDPOINT_HIT_PX = 32; // touch hit radius in screen px
const LINE_HIT_PX = 18;

// First-time "Set Measurement Scale" tutorial. Persisted through the shared
// onboarding storage (same prefix/reset path) so it shows once and is cleared
// whenever onboarding is reset — without replacing the general onboarding tour.
const SCALE_INTRO_ID = 'measure-scale-intro';

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
    layers, activeLayerId, setActiveLayerId, toggleLayerVisibility, addLayer, deleteLayer,
    lineColor, setLineColor, showMeasurements, toggleMeasurements,
    zoom, setZoom, panOffset, setPanOffset,
    undo, redo, newProject, clearAllLines, exportProjectJSON,
    setImage, setMode,
    isImageLoading, imageLoadError, setImageLoaded, setImageLoadError, clearImageLoadError, beginImageUpload,
  } = useProject();

  // Only used to avoid stacking the scale tutorial on top of the general
  // onboarding tour — this tutorial does not replace that system.
  const { isOpen: onboardingOpen } = useOnboarding();

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

  // Inline "add layer" input state for the Layers sheet
  const [addingLayer, setAddingLayer] = useState(false);
  const [newLayerName, setNewLayerName] = useState('');
  const commitNewLayer = () => {
    if (newLayerName.trim()) addLayer(newLayerName);
    setNewLayerName('');
    setAddingLayer(false);
  };

  // Add mode (measure) draft + calibration draft
  const [pendingPoint, setPendingPoint] = useState<Point | null>(null);
  const [calPoints, setCalPoints] = useState<Point[]>([]);
  const [calDraftReady, setCalDraftReady] = useState(false);
  const [calInputVisible, setCalInputVisible] = useState(false);
  const [calSize, setCalSize] = useState('');
  const [calUnit, setCalUnit] = useState('cm');

  // Sheets — the high-frequency actions (color, delete, pan, labels, reference
  // access) now live directly on the canvas, so only the genuinely list-based
  // panels remain as sheets.
  type SheetId = null | 'layers' | 'reference' | 'more';
  const [sheet, setSheet] = useState<SheetId>(null);

  // Floating default-line-color picker popover (opened from the color swatch
  // in the floating action column).
  const [colorPickerOpen, setColorPickerOpen] = useState(false);

  // Guided "Set Measurement Scale" flow:
  //  - scaleIntroVisible: the illustrated first-time tutorial shown *before*
  //    drawing, so the user understands why they draw one calibration line.
  //  - scaleSuccessVisible: the transient "✓ scale configured" confirmation.
  const [scaleIntroVisible, setScaleIntroVisible] = useState(false);
  const [scaleSuccessVisible, setScaleSuccessVisible] = useState(false);
  const [dontShowScaleIntro, setDontShowScaleIntro] = useState(true);

  // Height of the visible viewport above the soft keyboard, tracked only while
  // the reference-length dialog is open so it can stay vertically centered in
  // the space above the keyboard instead of being pinned to the screen edge.
  const [kbViewport, setKbViewport] = useState<{ top: number; height: number } | null>(null);

  // Drag state
  const [drag, setDrag] = useState<
    | { kind: 'endpoint'; lineId: string; endpoint: 'start' | 'end'; screen: Point; img: Point }
    | { kind: 'line'; lineId: string; startImg: Point; origStart: Point; origEnd: Point }
    | { kind: 'pan'; startScreen: Point; startPan: Point }
    | { kind: 'pinch'; startDist: number; startZoom: number; anchorImg: Point }
    | null
  >(null);

  // Image export goes through the shared Save-to-Photos flow.
  const { save } = useSaveMedia();

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
    try {
      ctx.drawImage(imgRef.current, 0, 0);
      offscreenRef.current = c;
      offscreenReady.current = true;
    } catch (error) {
      console.error('[MeasureMobile] Failed to prepare offscreen canvas (magnifier):', error);
    }
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
    // Only consider visible & in visible layers. Every visible line stays
    // selectable and editable regardless of the Eye (presentation) state.
    const visLayerIds = new Set(layers.filter(l => l.visible).map(l => l.id));
    const candidates = measurements.filter(m => m.visible && visLayerIds.has(m.layerId));
    // Selected line gets priority so its endpoints are easiest to grab.
    const ordered = [...candidates].sort((a, b) => (a.id === selectedLineId ? -1 : b.id === selectedLineId ? 1 : 0));
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
  }, [measurements, layers, selectedLineId, zoom, panOffset]);

  // ---------- Canvas UI guard (Task 2) ----------
  // Floating controls live inside the same element that owns the canvas touch
  // handlers, so their touch events bubble up and would otherwise be treated as
  // canvas taps (e.g. picking a color would drop a measurement point). Any
  // floating control marked with `data-canvas-ui` fully consumes the touch:
  // the canvas handlers bail out when the gesture started on such an element.
  const isCanvasUiTouch = useCallback((e: React.TouchEvent) => {
    const target = e.target as HTMLElement | null;
    return !!target?.closest?.('[data-canvas-ui]');
  }, []);

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
    try {
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
    } catch (error) {
      console.error('[MeasureMobile] Failed to render magnifier:', error);
    }
  }, [prepareOffscreen]);

  // ---------- Touch handling ----------
  const lastTapRef = useRef<{ x: number; y: number; t: number } | null>(null);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (calInputVisible) return;
    if (isCanvasUiTouch(e)) return; // touch began on a floating control — ignore
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
  }, [tool, calInputVisible, panOffset, zoom, screenToImage, hitTest, drawMagnifier, measurements, setSelectedLineId, isCanvasUiTouch]);

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
    // Touch began on a floating control (Task 2): consume it, never draw.
    if (isCanvasUiTouch(e)) { setDrag(null); return; }
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
      // Tap a line to select it; tap empty canvas to deselect.
      setSelectedLineId(hit ? hit.lineId : null);
    }
  }, [drag, tool, calPoints, pendingPoint, lineColor, activeLayerId, addMeasurement, screenToImage, hitTest, isCanvasUiTouch, setSelectedLineId]);

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
    setCalPoints([]); setCalInputVisible(false); setCalSize('');
    // Guided workflow: once the scale is defined, drop the user straight into
    // Add mode so they can start placing measurement lines immediately.
    setTool('add'); setPendingPoint(null);
    restorePreCalView();
    // Task 3 · Step 4 — confirm success in plain language, then auto-dismiss.
    setScaleSuccessVisible(true);
    window.setTimeout(() => setScaleSuccessVisible(false), 2600);
  };

  // Open the illustrated scale tutorial (explains what/why *before* drawing).
  const startScaleSetup = () => {
    setSheet(null);
    setCalPoints([]);
    setCalDraftReady(false);
    setCalInputVisible(false);
    setScaleIntroVisible(true);
  };
  // Dismiss the tutorial. Honors "Don't show this again" (persisted), and
  // optionally drops the user straight into drawing the calibration line.
  const closeScaleIntro = useCallback((beginDrawing: boolean) => {
    if (dontShowScaleIntro) markOnboardingSeen(SCALE_INTRO_ID);
    setScaleIntroVisible(false);
    if (beginDrawing) {
      setTool('cal');
      setCalPoints([]);
      setCalDraftReady(false);
    }
  }, [dontShowScaleIntro]);

  // First-time trigger: the very first time the user is on the Measure tool with
  // an image but no measurement scale, auto-open the tutorial — once, ever
  // (unless onboarding is reset). Never stacks on the general onboarding tour.
  const scaleIntroAutoShownRef = useRef(false);
  useEffect(() => {
    if (scaleIntroAutoShownRef.current) return;
    if (!image || calibration || onboardingOpen) return;
    if (hasSeenOnboarding(SCALE_INTRO_ID)) return;
    scaleIntroAutoShownRef.current = true;
    setScaleIntroVisible(true);
  }, [image, calibration, onboardingOpen]);

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
  const getRealSize = useCallback(
    (line: MeasurementLine) => realWorldLength(line, calibration),
    [calibration],
  );

  // Delete the currently selected line directly from the canvas (floating
  // action column). deleteMeasurement already clears the selection.
  const deleteSelected = useCallback(() => {
    if (!selectedLineId) return;
    deleteMeasurement(selectedLineId);
  }, [selectedLineId, deleteMeasurement]);

  // Toggle the Pan navigation tool from the floating action column. Pan is not
  // a creation mode — it just enables pan/zoom — so tapping it again returns to
  // the previous Edit mode.
  const togglePan = useCallback(() => {
    setTool(t => (t === 'pan' ? 'edit' : 'pan'));
    setPendingPoint(null);
  }, []);

  // Track the viewport above the soft keyboard while the reference-length
  // dialog is open, so the dialog can be centered in the available space
  // (Task 8 — never pinned to the top/bottom edge when the keyboard opens).
  useEffect(() => {
    if (!calInputVisible || typeof window === 'undefined') { setKbViewport(null); return; }
    const vv = window.visualViewport;
    const update = () => {
      if (vv) setKbViewport({ top: vv.offsetTop, height: vv.height });
      else setKbViewport({ top: 0, height: window.innerHeight });
    };
    update();
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    return () => {
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
    };
  }, [calInputVisible]);

  // ---------- Export PNG ----------
  const triggerDownload = useCallback((blob: Blob, filename: string) => {
    try {
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
    } catch (error) {
      console.error('[MeasureMobile] Failed to trigger file download:', error);
    }
  }, []);

  const exportPNG = useCallback(() => {
    if (!image) return;
    setSheet(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
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
        save({ blob, filename: 'studio-companion-export.png', mime: 'image/png', title: 'Save image' });
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
      } catch (error) {
        console.error('[MeasureMobile] Failed to render annotated PNG export:', error);
      }
    };
    img.onerror = (e) => {
      console.error('[MeasureMobile] Failed to load image for PNG export:', e);
    };
    img.src = image;
  }, [image, measurements, layers, getRealSize, save]);

  const exportJSON = useCallback(() => {
    setSheet(null);
    try {
      const blob = new Blob([exportProjectJSON()], { type: 'application/json' });
      triggerDownload(blob, 'studio-companion-project.json');
    } catch (error) {
      console.error('[MeasureMobile] Failed to export project JSON:', error);
    }
  }, [exportProjectJSON, triggerDownload]);

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

  // The whole reference-setup step (drawing the line, confirming the draft, and
  // typing the real-world length) runs while `tool === 'cal'`. During this
  // guided step we strip the interface down to only the controls that matter,
  // so a first-time painter is never distracted by unrelated tools.
  const referenceMode = tool === 'cal';
  // The narrowest step: keyboard is open to type the length. Only the numeric
  // input, unit selector, Set and Cancel remain — everything else is hidden.
  const enteringLength = calInputVisible;
  const canCancelReference = calibration != null || calPoints.length > 0 || calDraftReady || calInputVisible;

  return (
    <div className="relative flex-1 flex flex-col min-h-0 bg-[hsl(var(--canvas-bg))]">
      {/* Top bar — replaced by a focused reference header during the guided
          reference-setup step. */}
      {referenceMode ? (
        <div className="shrink-0 z-30 flex items-center justify-between px-3 h-12 border-b border-border bg-card/95 backdrop-blur-sm">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Ruler className="w-4 h-4 text-primary" />
            {enteringLength ? 'Enter real-world length' : 'Set measurement scale'}
          </div>
          {canCancelReference && (
            <button onClick={cancelCal}
              className="h-10 px-3 flex items-center gap-1.5 rounded-md text-sm text-muted-foreground active:bg-secondary" aria-label="Cancel scale setup">
              <X className="w-4 h-4" /> Cancel
            </button>
          )}
        </div>
      ) : (
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
      )}

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
            {/* Lines — the Eye button drives the whole presentation (Task 1).
                Eye open: full-opacity lines + labels. Eye closed: lines fade so
                the artwork reads clearly, yet stay editable/selectable. The
                selected line always stays full-opacity so it's easy to edit. */}
            {renderedLines.map(line => {
              const isSelected = line.id === selectedLineId;
              const faded = !showMeasurements && !isSelected;
              return (
                <g key={line.id} opacity={faded ? 0.3 : 1}>
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
            {/* Labels — shown only when the Eye is open (Task 1). When closed,
                every label is hidden so the focus is purely on the artwork; the
                selected line's size is still readable in the on-canvas pill. */}
            {(() => {
              if (!showMeasurements) return null;
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
                const lx = line.start.x + (dx / len) * along + px * perp;
                const ly = line.start.y + (dy / len) * along + py * perp;
                return { line, lx, ly };
              });
              // Sort so selected renders last (on top)
              items.sort((a, b) => (a.line.id === selectedLineId ? 1 : b.line.id === selectedLineId ? -1 : 0));
              return items.map(({ line, lx, ly }) => {
                const isSelected = line.id === selectedLineId;
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
                    fill={line.color} fontSize={fontSize} fontWeight={isSelected ? 700 : 500}
                    style={{ paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.7)', strokeWidth: (isSelected ? 3.5 : 2.5) / zoom }}>
                    {text}
                  </text>
                );
              });
            })()}
          </svg>
        </div>

        {/* Tool indicator — hidden while typing the reference length so the
            canvas stays clean and focused on that single step. */}
        {!enteringLength && (
          <div data-canvas-ui className="absolute top-2 left-2 max-w-[70%] px-2 py-1 text-[11px] rounded bg-card/80 text-muted-foreground backdrop-blur-sm">
            {tool === 'pan' && 'Pan / Zoom'}
            {tool === 'edit' && (selectedLine ? 'Editing selected' : 'Tap a line to edit')}
            {tool === 'add' && (pendingPoint ? 'Tap to set the end point' : 'Tap to set the start point')}
            {tool === 'cal' && (calPoints.length === 0 ? 'Draw a line over something whose real size you know'
              : calPoints.length === 1 ? 'Tap the second point'
              : 'Check the line, then confirm below')}
          </div>
        )}

        {/* Floating action column — the professional "on-canvas" workspace.
            Nearly every high-frequency action lives here so the artist never
            has to open a bottom sheet. Hidden while typing the reference length
            so that step stays fully focused. */}
        {!enteringLength && (
        <div data-canvas-ui className="absolute top-2 right-2 z-20 flex flex-col gap-2">
          {/* Fullscreen / fit-to-view */}
          <ColBtn onClick={fitImage} label="Fit to screen">
            <Maximize className="w-4 h-4" />
          </ColBtn>

          {/* The rest of the column is measurement-editing chrome; during the
              guided reference-setup step we hide it to keep things calm. */}
          {!referenceMode && (
            <>
              {/* Presentation mode (Task 1) — the single Eye button. Open =
                  working with measurements (labels + full-opacity lines).
                  Closed = focusing on the artwork (labels hidden, lines faded).
                  Editing is unaffected in both states. */}
              <ColBtn onClick={toggleMeasurements} active={showMeasurements}
                label={showMeasurements ? 'Focus on artwork (hide measurements)' : 'Show measurements'}>
                {showMeasurements ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
              </ColBtn>

              {/* Default line color for the next line drawn (Task 2) */}
              <button onClick={() => setColorPickerOpen(v => !v)} aria-label="Default line color"
                className="h-10 w-10 rounded-full bg-card/90 border border-border flex items-center justify-center shadow active:scale-95">
                <span className="w-5 h-5 rounded-md border-2 border-white shadow-inner" style={{ backgroundColor: lineColor }} />
              </button>

              {/* Delete the selected line (Task 3) — only while editing one */}
              {tool === 'edit' && selectedLine && (
                <ColBtn onClick={deleteSelected} label="Delete selected line" danger>
                  <Trash2 className="w-4 h-4" />
                </ColBtn>
              )}

              {/* Pan / zoom navigation (Task 4) */}
              <ColBtn onClick={togglePan} active={tool === 'pan'} label="Pan and zoom">
                <Hand className="w-4 h-4" />
              </ColBtn>

              {/* Measurement scale — no scale yet → launch the guided setup;
                  otherwise open the scale panel to review/replace it. */}
              <ColBtn onClick={() => (calibration ? setSheet('reference') : startScaleSetup())} highlight={!calibration}
                label={calibration ? 'Edit measurement scale' : 'Set measurement scale'}>
                <Ruler className="w-4 h-4" />
              </ColBtn>
            </>
          )}
        </div>
        )}

        {/* Default-line-color picker popover (Task 2) — a compact floating
            panel anchored beside the color swatch, not a bottom sheet. */}
        {colorPickerOpen && !enteringLength && !referenceMode && (
          <div data-canvas-ui>
            <div className="absolute inset-0 z-20" onClick={() => setColorPickerOpen(false)} />
            <div className="absolute top-2 right-14 z-30 w-[184px] p-2.5 rounded-2xl bg-card border border-border shadow-2xl">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground px-1 pb-2">Default line color</div>
              <div className="grid grid-cols-4 gap-2">
                {LINE_COLORS.map(c => (
                  <button key={c} onClick={() => { setLineColor(c); setColorPickerOpen(false); }}
                    aria-label={`Use line color ${c}`}
                    className={`h-9 w-9 rounded-lg border-2 transition-all ${lineColor === c ? 'border-foreground scale-105' : 'border-border/40'}`}
                    style={{ backgroundColor: c }} />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Magnifier */}
        {drag?.kind === 'endpoint' && (
          <div className="pointer-events-none absolute z-20"
            style={{ left: Math.max(8, Math.min((containerRef.current?.clientWidth ?? 300) - 128, drag.screen.x - 60)),
                     top: Math.max(8, drag.screen.y - 160) }}>
            <canvas ref={magCanvasRef} className="rounded-full shadow-2xl" style={{ width: 120, height: 120 }} />
          </div>
        )}

        {/* Calibration draft (Task 3 · Step 3) — explains what happens next in
            plain language instead of a generic "Confirm reference". */}
        {calDraftReady && !calInputVisible && (
          <div data-canvas-ui className="absolute bottom-4 inset-x-3 z-30 flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-3 shadow-xl">
            <span className="flex-1 text-xs text-foreground">Great! Next, enter the real length of this line.</span>
            <button onClick={confirmCalDraft} className="flex items-center gap-1.5 h-10 px-3 text-sm bg-primary text-primary-foreground rounded-md font-medium">
              <Check className="w-4 h-4" /> Continue
            </button>
            <button onClick={cancelCal} aria-label="Cancel" className="h-10 w-10 flex items-center justify-center bg-secondary text-muted-foreground rounded-md">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        {/* Reference-length entry (Task 8) — a focused, centered modal dialog.
            It stays fully assembled and is vertically centered in the viewport
            *above* the soft keyboard (tracked via visualViewport) instead of
            being pinned to a screen edge. */}
        {calInputVisible && (
          <div
            data-canvas-ui
            className="fixed inset-x-0 z-[60] flex items-center justify-center px-6"
            style={{
              top: kbViewport?.top ?? 0,
              height: kbViewport?.height ?? undefined,
              bottom: kbViewport ? undefined : 0,
            }}
          >
            <div className="absolute inset-0 bg-black/60" onClick={cancelCal} />
            <div className="relative w-full max-w-sm bg-card border border-border rounded-2xl shadow-2xl p-4 space-y-3 animate-slide-up">
              <div className="text-center space-y-1">
                <div className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground">
                  <Ruler className="w-4 h-4 text-primary" /> Real-world length
                </div>
                <p className="text-xs text-muted-foreground">How long is the line you just drew? For example, if it spans your canvas width, enter <span className="text-foreground font-medium">80&nbsp;cm</span>.</p>
              </div>
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
              </div>
              <div className="flex items-center gap-2">
                <button onClick={cancelCal} className="flex-1 h-11 bg-secondary text-muted-foreground rounded-md font-medium">Cancel</button>
                <button onClick={confirmCal} className="flex-1 h-11 bg-primary text-primary-foreground rounded-md font-medium">Set</button>
              </div>
            </div>
          </div>
        )}

        {/* Add mode cancel */}
        {tool === 'add' && pendingPoint && (
          <button data-canvas-ui onClick={() => setPendingPoint(null)}
            className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20 h-10 px-4 text-xs bg-card border border-border rounded-full text-muted-foreground shadow">
            Cancel point
          </button>
        )}

        {/* On-canvas selected-line editor — shows the measurement and lets the
            artist label the line directly on the artwork, replacing the old
            "Selected" bottom sheet. Delete lives in the floating column. */}
        {tool === 'edit' && selectedLine && !enteringLength && (
          <InlineLabelEditor key={selectedLine.id} line={selectedLine} getRealSize={getRealSize}
            onChange={(u) => updateMeasurement(selectedLine.id, u)} />
        )}

        {/* Loading overlay */}
        {isImageLoading && (
          <div data-canvas-ui className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm">
            <div className="w-10 h-10 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
            <p className="mt-3 text-sm font-medium text-foreground">Loading image...</p>
          </div>
        )}

        {/* Error overlay */}
        {imageLoadError && (
          <div data-canvas-ui className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-background/90 backdrop-blur-sm">
            <p className="text-sm text-destructive font-medium mb-2">Failed to load image</p>
            <p className="text-xs text-muted-foreground mb-4 text-center px-6">{imageLoadError}</p>
            <button onClick={() => { clearImageLoadError(); setImage(null); }}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium">
              Try again
            </button>
          </div>
        )}
      </div>

      {/* Bottom action bar — fully hidden during the guided reference-setup
          step so only reference controls are visible. */}
      {!referenceMode && (
      <div className="shrink-0 z-30 border-t border-border bg-card/95 backdrop-blur-sm">
        {/* Primary toolbar — Layers (Task 5) now sits alongside the creation
            modes. Pan moved to the floating action column (Task 4); Selected /
            Precision were removed entirely (Task 6). */}
        <div className="flex items-center gap-1 px-2 pt-2">
          <ModeToggle onClick={() => setSheet('layers')} icon={<LayersIcon className="w-4 h-4" />} label="Layers" />
          <ModeToggle active={tool === 'edit'} onClick={() => setTool('edit')} icon={<MousePointer className="w-4 h-4" />} label="Edit" />
          <ModeToggle active={tool === 'add'} onClick={() => { if (!calibration) { startScaleSetup(); return; } setTool('add'); setPendingPoint(null); }}
            icon={<Plus className="w-4 h-4" />} label="Add" />
        </div>
        {/* Primary Save Image */}
        <div className="px-2 pt-2 pb-2">
          <button onClick={exportPNG}
            className="w-full h-12 rounded-md bg-primary text-primary-foreground font-medium text-sm flex items-center justify-center gap-2 active:opacity-80">
            <Download className="w-5 h-5" />
            Save Image
          </button>
        </div>
      </div>
      )}

      {/* Bottom sheets */}
      {sheet && (
        <Sheet onClose={() => setSheet(null)} title={
          sheet === 'layers' ? 'Layers'
          : sheet === 'reference' ? 'Measurement scale'
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
                    {layers.length > 1 && (
                      <button onClick={(e) => { e.stopPropagation(); deleteLayer(layer.id); }}
                        className="h-10 w-10 flex items-center justify-center text-muted-foreground" aria-label="Delete layer">
                        <Trash2 className="w-5 h-5" />
                      </button>
                    )}
                  </div>
                );
              })}
              {addingLayer ? (
                <div className="flex items-center gap-2 px-3 py-2">
                  <input value={newLayerName} onChange={e => setNewLayerName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitNewLayer(); } }}
                    placeholder="Layer name"
                    autoFocus
                    /* font-size: 16px prevents iOS Safari from auto-zooming on focus */
                    style={{ fontSize: '16px' }}
                    className="flex-1 min-w-0 h-11 px-3 bg-secondary border border-border rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
                  <button onClick={commitNewLayer} className="h-11 px-4 bg-primary text-primary-foreground rounded-md font-medium">Add</button>
                  <button onClick={() => { setNewLayerName(''); setAddingLayer(false); }}
                    className="h-11 w-11 flex items-center justify-center bg-secondary text-muted-foreground rounded-md"><X className="w-4 h-4" /></button>
                </div>
              ) : (
                <button onClick={() => { setNewLayerName(''); setAddingLayer(true); }}
                  className="flex items-center gap-3 px-3 py-3 rounded-md min-h-[52px] w-full text-sm text-foreground active:bg-secondary/60">
                  <Plus className="w-5 h-5" /> Add layer
                </button>
              )}
            </div>
          )}

          {sheet === 'reference' && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">Your measurement scale converts distances on the artwork into real-world sizes.</p>
              {calibration ? (
                <div className="rounded-md border border-border p-3 bg-secondary/30">
                  <div className="text-xs text-muted-foreground">Current scale</div>
                  <div className="text-lg font-semibold text-foreground">{calibration.realWorldSize} {calibration.unit}</div>
                  <div className="text-xs text-muted-foreground">across the reference line you drew</div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No scale set yet. Measurements show real-world sizes only once a scale is defined.</p>
              )}
              <button onClick={startScaleSetup}
                className="w-full h-12 rounded-md bg-primary text-primary-foreground font-medium">
                {calibration ? 'Set a new scale' : 'Set measurement scale'}
              </button>
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

      {/* First-time scale tutorial — an illustration-led explainer shown before
          the user is ever asked to draw. The picture carries the explanation;
          the copy only supports it. Auto-shows once, then remembers. */}
      {scaleIntroVisible && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center px-5 py-6">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => closeScaleIntro(false)} />
          <div className="relative w-full max-w-sm max-h-full overflow-y-auto bg-card border border-border rounded-3xl shadow-2xl animate-slide-up">
            <div className="p-5 sm:p-6 space-y-5">
              {/* Header */}
              <div className="text-center space-y-2">
                <div className="mx-auto h-11 w-11 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
                  <Ruler className="w-6 h-6" />
                </div>
                <h3 className="text-xl font-bold text-foreground">Set Measurement Scale</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  To measure anything accurately, we first need one real-world distance.
                </p>
              </div>

              {/* Illustration — the primary explanation */}
              <ScaleTutorialArt />

              {/* Supporting hint */}
              <div className="rounded-2xl border border-border bg-secondary/30 p-3.5">
                <div className="flex items-start gap-2.5">
                  <Lightbulb className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                  <div className="space-y-2.5">
                    <p className="text-sm text-foreground">Choose something whose real size you already know, like:</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-2">
                      <ScaleHintChip icon={<RectangleHorizontal className="w-4 h-4" />} label="Canvas size" />
                      <ScaleHintChip icon={<Frame className="w-4 h-4" />} label="Picture frame" />
                      <ScaleHintChip icon={<Ruler className="w-4 h-4" />} label="Ruler" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between gap-3 pt-1">
                <button onClick={() => setDontShowScaleIntro(v => !v)}
                  className="flex items-center gap-2 text-sm text-muted-foreground active:text-foreground"
                  aria-pressed={dontShowScaleIntro}>
                  <span className={`h-5 w-5 rounded-md border flex items-center justify-center transition-colors ${dontShowScaleIntro ? 'bg-primary border-primary text-primary-foreground' : 'border-border'}`}>
                    {dontShowScaleIntro && <Check className="w-3.5 h-3.5" />}
                  </span>
                  Don't show again
                </button>
                <button onClick={() => closeScaleIntro(true)}
                  className="h-12 px-7 rounded-xl bg-primary text-primary-foreground font-semibold active:opacity-80">
                  Got it
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Task 3 · Step 4 — transient success confirmation after the scale is set. */}
      {scaleSuccessVisible && (
        <div className="fixed inset-x-0 top-16 z-[70] flex justify-center px-6 pointer-events-none">
          <div className="flex items-start gap-2.5 max-w-sm bg-card border border-border rounded-xl shadow-2xl px-4 py-3 animate-slide-up">
            <Check className="w-5 h-5 text-primary shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-semibold text-foreground">Measurement scale configured</div>
              <div className="text-xs text-muted-foreground">All measurements now use this scale.</div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// ---------------- Small subcomponents ----------------

function ModeToggle({ active, onClick, icon, label }: { active?: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button onClick={onClick}
      className={`flex-1 h-11 rounded-md flex items-center justify-center gap-1.5 text-sm font-medium transition-colors ${active ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground active:bg-secondary/80'}`}>
      {icon}<span>{label}</span>
    </button>
  );
}

// Round button used throughout the floating action column. `active` = the
// tool/toggle is currently on; `highlight` = draws attention (e.g. no scale set
// yet); `danger` = destructive (delete).
function ColBtn({ onClick, active, highlight, danger, label, children }:
  { onClick: () => void; active?: boolean; highlight?: boolean; danger?: boolean; label: string; children: React.ReactNode }) {
  const tone = active
    ? 'bg-primary text-primary-foreground'
    : danger
      ? 'bg-card/90 text-destructive'
      : highlight
        ? 'bg-card/90 text-primary'
        : 'bg-card/90 text-foreground';
  return (
    <button onClick={onClick} aria-label={label} aria-pressed={active}
      className={`h-10 w-10 rounded-full border border-border flex items-center justify-center shadow active:scale-95 transition-colors ${tone}`}>
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

// A single "known-size object" suggestion chip for the scale tutorial hint.
function ScaleHintChip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
      <span className="text-primary">{icon}</span>{label}
    </span>
  );
}

// Illustration for the first-time scale tutorial: a framed painting on a wall
// with two tap points and the dashed calibration line drawn between them. Pure
// SVG so it stays crisp at any size and ships no image assets. Annotation uses
// the theme's primary/foreground tokens so it adapts to light & dark.
function ScaleTutorialArt() {
  return (
    <div className="rounded-2xl overflow-hidden border border-border bg-black/20">
      <svg viewBox="0 0 320 240" className="w-full block" role="img"
        aria-label="Draw a line between two points across an object whose real size you know, such as the picture frame.">
        <defs>
          <linearGradient id="stw-wall" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#3d3d40" />
            <stop offset="1" stopColor="#28282b" />
          </linearGradient>
          <linearGradient id="stw-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#93b3c8" />
            <stop offset="1" stopColor="#d2dade" />
          </linearGradient>
          <clipPath id="stw-pic"><rect x="100" y="98" width="112" height="76" /></clipPath>
        </defs>

        {/* Wall + soft light wash from the upper-left */}
        <rect x="0" y="0" width="320" height="240" fill="url(#stw-wall)" />
        <ellipse cx="86" cy="150" rx="170" ry="140" fill="#ffffff" opacity="0.05" />

        {/* Framed painting (drop shadow, wooden frame, picture) */}
        <rect x="92" y="93" width="140" height="100" rx="5" fill="#000000" opacity="0.4" />
        <rect x="86" y="86" width="140" height="100" rx="5" fill="#6b4626" />
        <rect x="92" y="92" width="128" height="88" rx="3" fill="#8a5c33" />
        <rect x="100" y="98" width="112" height="76" fill="#233038" />
        <g clipPath="url(#stw-pic)">
          <rect x="100" y="98" width="112" height="46" fill="url(#stw-sky)" />
          <rect x="100" y="150" width="112" height="24" fill="#415b64" />
          {/* Mountains + snow caps */}
          <polygon points="100,152 130,116 160,152" fill="#7c8a92" />
          <polygon points="120,152 122,120 130,116 140,130 132,152" fill="#65727a" />
          <polygon points="138,152 176,104 214,152" fill="#8b98a0" />
          <polygon points="168,120 176,104 186,122 178,126 172,124" fill="#eef2f4" />
          <polygon points="124,124 130,116 137,127 131,130" fill="#eef2f4" />
          {/* Treeline + reflection hint */}
          <polygon points="150,152 156,138 162,152" fill="#2f4b3a" />
          <polygon points="158,152 164,134 170,152" fill="#274332" />
          <polygon points="196,152 202,136 208,152" fill="#2f4b3a" />
          <rect x="100" y="150" width="112" height="24" fill="#000000" opacity="0.08" />
          <rect x="150" y="150" width="4" height="20" fill="#eef2f4" opacity="0.18" />
        </g>

        {/* Calibration overlay — the point of the whole illustration */}
        <line x1="70" y1="138" x2="250" y2="138" stroke="hsl(var(--primary))" strokeWidth="3"
          strokeDasharray="7 8" strokeLinecap="round" />
        {[70, 250].map(cx => (
          <g key={cx}>
            <circle cx={cx} cy="138" r="9.5" fill="#1b1b1d" stroke="hsl(var(--primary))" strokeWidth="4" />
            <circle cx={cx} cy="138" r="3.4" fill="#ffffff" />
          </g>
        ))}

        {/* Guidance labels + arrows */}
        <text x="12" y="36" fontSize="12" fontWeight="600" fill="hsl(var(--foreground))">1. Tap the first point</text>
        <text x="308" y="36" fontSize="12" fontWeight="600" textAnchor="end" fill="hsl(var(--foreground))">2. Tap the second point</text>
        <g fill="none" stroke="hsl(var(--primary))" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M56 46 C 54 82, 62 104, 70 124" />
          <polyline points="63,115 70,126 77,116" />
          <path d="M264 46 C 266 82, 258 104, 250 124" />
          <polyline points="243,116 250,126 257,115" />
        </g>
      </svg>
    </div>
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

// Compact on-canvas editor for the selected line. Floats at the bottom-center
// of the artwork so the artist can read the measurement and label the line
// without opening any menu. Delete is handled by the floating action column.
function InlineLabelEditor({ line, getRealSize, onChange }:
  { line: MeasurementLine; getRealSize: (l: MeasurementLine) => string; onChange: (u: Partial<MeasurementLine>) => void }) {
  const [label, setLabel] = useState(line.label);
  // `key={line.id}` on the mount site keeps this in sync when selection changes.
  return (
    <div data-canvas-ui className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 max-w-[calc(100%-6rem)] bg-card/95 border border-border rounded-full pl-3 pr-2 py-1.5 shadow-lg backdrop-blur-sm">
      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: line.color }} />
      <span className="text-sm font-semibold text-foreground whitespace-nowrap">{getRealSize(line)}</span>
      <span className="w-px self-stretch bg-border" />
      <input value={label}
        onChange={e => { setLabel(e.target.value); onChange({ label: e.target.value }); }}
        placeholder="Add label"
        /* font-size: 16px prevents iOS Safari from auto-zooming on focus */
        style={{ fontSize: '16px' }}
        className="w-28 min-w-0 h-8 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none" />
    </div>
  );
}