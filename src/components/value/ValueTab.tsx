import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslations } from 'use-intl';
import { useProject } from '@/hooks/useProjectStore';
import { useIsMobile } from '@/hooks/use-mobile';
import ImageUploader from '@/components/common/ImageUploader';
import {
  Sun, Moon, Eye, Palette as PaletteIcon, Brush, Layers,
  SlidersHorizontal, X, Maximize2, Minimize2, Download,
  Contrast, PencilLine, RotateCcw, Loader2, Lock,
} from 'lucide-react';
import { useSaveMedia } from '@/components/common/SaveMedia';
import { fromLearn } from '@/lib/learn/source';
import { dataUrlToBlob } from '@/lib/saveMedia';
import type { SketchView } from '@/lib/sketch/protocol';
import { activeControls, resolveSketch } from '@/lib/sketch/settings';
import {
  DEFAULT_SKETCH_OUTLINE, DEFAULT_SKETCH_PENCIL,
  type SketchOutlineSettings, type SketchPencilSettings, type SketchStyleId,
} from '@/types/project';
import { useSketchDrawing } from './useSketchDrawing';
import { useAccount, useHasFeature } from '@/components/shell/account';
import PrepareWorksheets from '@/components/worksheets/PrepareWorksheets';
import { useLearnHandoff } from '@/hooks/useLearnHandoff';
import {
  brightnessLabel, dominantName, preBlur, processingSize, studyValues,
  type DominantSwatch, type Focus, type Mode, type ValueGroup,
} from '@/lib/values/posterize';
import Slider from '@/components/common/Slider';
import ToolHeader from '@/components/shell/ToolHeader';
import ToolEmptyState from '@/components/shell/ToolEmptyState';
import { PortraitArt } from '@/components/shell/ToolArt';

type PaletteView = 'dominant' | 'value' | 'mix';

export default function ValueTab() {
  const { image, valueSettings, setValueSettings, activeTab, gridImage, gridSettings, imageLearnItem, gridImageLearnItem } = useProject();
  const { save } = useSaveMedia();
  const t = useTranslations('studyTool');
  const tw = useTranslations('worksheets');
  const tLocked = useTranslations('studio.locked');
  const [localImage, setLocalImageRaw] = useState<string | null>(null);
  // Which Learn item Study's own photo came from, if it was handed over (ADR-0018).
  const [localLearnItem, setLocalLearnItem] = useState<string | null>(null);
  // A photo loaded here (an upload) is the person's own: it carries no Learn item.
  const setLocalImage = useCallback((dataUrl: string) => {
    setLocalImageRaw(dataUrl);
    setLocalLearnItem(null);
  }, []);
  // A Learn reference handed over by "Open in Study & Simplify" (src/components/learn/handoff.tsx):
  // Study's own photo for this visit; the shared photo is left as it is.
  useLearnHandoff('value', (handoff) => {
    setLocalImageRaw(handoff.image);
    setLocalLearnItem(handoff.learnItem);
  });
  const [processedUrl, setProcessedUrl] = useState<string | null>(null);
  const [groups, setGroups] = useState<ValueGroup[]>([]);
  const [dominant, setDominant] = useState<DominantSwatch[]>([]);
  const [paletteView, setPaletteView] = useState<PaletteView>('dominant');
  const [isolatedIdx, setIsolatedIdx] = useState<number | null>(null);
  const [showMobileControls, setShowMobileControls] = useState(false);
  // 'overlay' (Sketch only): the drawing's lines in red over the photo.
  const [mobileView, setMobileView] = useState<'processed' | 'original' | 'palette' | 'overlay'>('processed');
  const [compareSlider, setCompareSlider] = useState(50);
  const [showCompare, setShowCompare] = useState(false);
  const [compareMode, setCompareMode] = useState<'slider' | 'side' | 'overlay'>('slider');
  const [fullscreen, setFullscreen] = useState(false);
  const [savingSketch, setSavingSketch] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isMobile = useIsMobile();

  const activeImage = localImage || image;
  // Saves made from a Learn reference name its item: the server refuses them once it is no longer open.
  const learnItem = localImage ? localLearnItem : imageLearnItem;

  // Prepare Worksheets (M3): offered as in Create a Grid (in no plan until the owner publishes it).
  // The canvas, grid and framing are Create a Grid's; a photo other than Create a Grid's is
  // fitted to that canvas.
  const canWorksheets = useHasFeature('export.worksheets');
  const offer = useAccount()?.account.offer;
  const worksheetsOffered = canWorksheets || offer?.free.includes('export.worksheets') === true || offer?.pro.includes('export.worksheets') === true;
  const worksheetsName = canWorksheets ? tw('open') : `${tw('open')} (${tLocked('badge')})`;
  const [worksheetsOpen, setWorksheetsOpen] = useState(false);
  const worksheetsFitted = activeImage !== gridImage;
  const worksheetSettings = useMemo(
    () => (worksheetsFitted ? { ...gridSettings, rotation: 0 as const, imageScale: 1, imageOffsetX: 0, imageOffsetY: 0 } : gridSettings),
    [gridSettings, worksheetsFitted],
  );

  // Migrate legacy fields into the unified mode/levels model on first load
  const mode: Mode = (valueSettings.mode as Mode) || (valueSettings.grayscale ? 'grayscale' : 'color');
  const levels: number = valueSettings.levels ?? (valueSettings.posterize > 0 ? valueSettings.posterize : 9);
  const focus: Focus = (valueSettings.focus as Focus) || 'none';
  const contrast = valueSettings.contrast;
  const brightness = valueSettings.brightness;

  // Sketch: two styles, each with its own controls (src/lib/sketch). Older
  // projects' trace settings are left in place and ignored.
  const sketch = resolveSketch(valueSettings);
  const sketchControls = activeControls(sketch);
  // Worksheets draw Clean Outline with its settings here, whichever style is on screen.
  const worksheetOutline = activeControls({ ...sketch, style: 'outline' });
  const setSketchStyle = (style: SketchStyleId) => setValueSettings({ sketchStyle: style });
  const setSketchControl = (key: 'lineWeight' | 'detail' | 'shading', value: number) => {
    if (sketch.style === 'pencil') setValueSettings({ sketchPencil: { ...sketch.pencil, [key]: value } as SketchPencilSettings });
    else setValueSettings({ sketchOutline: { ...sketch.outline, [key]: value } as SketchOutlineSettings });
  };
  const resetSketch = () => {
    if (sketch.style === 'pencil') setValueSettings({ sketchPencil: { ...DEFAULT_SKETCH_PENCIL } });
    else setValueSettings({ sketchOutline: { ...DEFAULT_SKETCH_OUTLINE } });
  };
  const sketchAtDefaults = sketch.style === 'pencil'
    ? sketch.pencil.lineWeight === 50 && sketch.pencil.detail === 50 && sketch.pencil.shading === 50
    : sketch.outline.lineWeight === 50 && sketch.outline.detail === 50;
  // The red overlay is a comparison: on desktop one of the Compare options,
  // on the phone one of the views under the image.
  const sketchOverlay = mode === 'sketch' && (isMobile ? mobileView === 'overlay' : showCompare && compareMode === 'overlay');
  const sketchView: SketchView = sketchOverlay ? 'overlay' : 'drawing';
  const drawing = useSketchDrawing({
    // Study stays mounted (hidden) while another tool is open; Sketch only
    // works, and holds memory, while it is the one on screen.
    enabled: mode === 'sketch' && !!activeImage && activeTab === 'value',
    image: activeImage,
    style: sketch.style,
    controls: sketchControls,
    view: sketchView,
  });

  const updateMode = (m: Mode) => {
    // The red overlay belongs to Sketch: leaving it turns that comparison off.
    if (m !== 'sketch' && compareMode === 'overlay') {
      setShowCompare(false);
      setCompareMode('slider');
    }
    if (m !== 'sketch' && mobileView === 'overlay') setMobileView('processed');
    setValueSettings({ mode: m, grayscale: m === 'grayscale' });
  };
  const updateLevels = (l: number) => setValueSettings({ levels: l, posterize: l });
  const updateFocus = (f: Focus) => setValueSettings({ focus: f });

  const processImage = useCallback(() => {
    if (!activeImage || !canvasRef.current) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onerror = (e) => {
      console.error('[ValueTab] Failed to load image for processing:', e);
    };
    img.onload = () => {
      try {
      const canvas = canvasRef.current!;
      // Cap dimensions for performance
      const { w, h } = processingSize(img.naturalWidth, img.naturalHeight);
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;

      // Pre-blur reduces noisy speckle so palette quantization yields clean masses.
      // In Sketch this pass only feeds the value palette (the drawing itself
      // comes from the sketch worker), so it keeps its old, unblurred input.
      const blur = preBlur(mode, focus);
      // NOTE: iOS Safari historically ignores ctx.filter for contrast()/brightness(),
      // so applying them via CSS filter silently no-ops on iPhone. Apply them
      // manually below to guarantee identical behavior across desktop and mobile.
      ctx.filter = blur ? `blur(${blur}px)` : 'none';
      ctx.drawImage(img, 0, 0, w, h);
      ctx.filter = 'none';

      const imageData = ctx.getImageData(0, 0, w, h);
      // The Values algorithm (src/lib/values/posterize.ts, moved here unchanged):
      // the study is written into the pixels; the palettes come back.
      const study = studyValues(imageData.data, w, h, { mode, levels, focus, contrast, brightness, isolatedIdx });
      setDominant(study.dominant);
      if (study.rendered) {
      ctx.putImageData(imageData, 0, 0);
      setProcessedUrl(canvas.toDataURL('image/jpeg', 0.9));
      }
      setGroups(study.groups);
      } catch (error) {
        console.error('[ValueTab] Failed to process image (canvas pipeline):', error);
      }
    };
    img.src = activeImage;
  }, [activeImage, mode, levels, focus, contrast, brightness, isolatedIdx]);

  // Coalesce the burst of events a slider drag produces into one pass. The
  // delay is short enough to still feel like the image updates as you drag.
  useEffect(() => {
    const id = window.setTimeout(processImage, 60);
    return () => window.clearTimeout(id);
  }, [processImage]);

  const dominantWarmth = useMemo(() => {
    if (!groups.length) return 'neutral';
    const counts = { warm: 0, cool: 0, neutral: 0 };
    groups.forEach(g => { counts[g.warmth] += g.pct; });
    return (Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]) as 'warm' | 'cool' | 'neutral';
  }, [groups]);

  const saveDataUrl = (dataUrl: string, name: string, mime: string) => {
    dataUrlToBlob(dataUrl)
      .then((blob) => save({ blob, filename: name, mime, title: t('save.imageTitle'), tool: 'value', ...fromLearn(learnItem) }))
      .catch((error) => console.error('[ValueTab] Failed to prepare image for saving:', error));
  };

  // Sketch drawings are saved as PNG (line art; JPEG would ring along every
  // line), at the largest size the device's limits allow: Clean Outline is
  // drawn from its vector paths, Pencil Study is recomputed at that size.
  const exportSketchPng = async () => {
    if (savingSketch) return;
    setSavingSketch(true);
    try {
      const result = await drawing.savePng();
      if (!result) return;
      const filename = sketch.style === 'pencil' ? 'pencil-study.png' : 'clean-outline.png';
      await save({ blob: result.blob, filename, mime: 'image/png', title: t('save.imageTitle'), tool: 'value', ...fromLearn(learnItem) });
    } catch (error) {
      console.error('[ValueTab] Failed to export the sketch:', error);
    } finally {
      setSavingSketch(false);
    }
  };

  const exportProcessed = () => {
    if (mode === 'sketch') {
      void exportSketchPng();
      return;
    }
    if (!processedUrl) return;
    saveDataUrl(processedUrl, 'value-study.jpg', 'image/jpeg');
  };

  // Clean Outline only: real vector shapes traced from the drawing on screen
  // (no raster inside), opening at the photo's own size.
  const exportSketchSvg = async () => {
    if (savingSketch || sketch.style !== 'outline') return;
    setSavingSketch(true);
    try {
      const blob = await drawing.saveSvg();
      if (blob) await save({ blob, filename: 'clean-outline.svg', mime: 'image/svg+xml', title: t('save.svgTitle'), tool: 'value', ...fromLearn(learnItem) });
    } catch (error) {
      console.error('[ValueTab] Failed to export sketch SVG:', error);
    } finally {
      setSavingSketch(false);
    }
  };

  const exportPalette = () => {
    if (!groups.length) return;
    try {
    const w = 1200, swatchH = 220, labelH = 80;
    const c = document.createElement('canvas');
    c.width = w; c.height = swatchH + labelH;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#15151a';
    ctx.fillRect(0, 0, c.width, c.height);
    const sw = w / groups.length;
    groups.forEach((g, i) => {
      ctx.fillStyle = g.hex;
      ctx.fillRect(i * sw, 0, sw, swatchH);
      ctx.fillStyle = '#e8e6df';
      ctx.font = 'bold 18px Inter, sans-serif';
      ctx.fillText(g.hex.toUpperCase(), i * sw + 14, swatchH + 28);
      ctx.fillStyle = '#a0a0a8';
      ctx.font = '13px Inter, sans-serif';
      ctx.fillText(`${g.pct.toFixed(1)}% • ${brightnessLabel(g.hsl.l)}`, i * sw + 14, swatchH + 50);
    });
    saveDataUrl(c.toDataURL('image/png'), 'value-palette.png', 'image/png');
    } catch (error) {
      console.error('[ValueTab] Failed to export value palette:', error);
    }
  };

  const exportStudySheet = async () => {
    if (!activeImage || !groups.length) return;
    // In Sketch the sheet shows the drawing (never the red overlay).
    const sketchUrl = mode === 'sketch' ? await drawing.drawingUrl().catch(() => null) : null;
    const procUrl = mode === 'sketch' ? sketchUrl : processedUrl;
    if (!procUrl) return;
    try {
    const W = 1600, pad = 40, gap = 24, headerH = 60, stripH = 60, paletteH = 110, domH = 150;
    const orig = new Image(); const proc = new Image();
    orig.crossOrigin = 'anonymous'; proc.crossOrigin = 'anonymous';
    await Promise.all([
      new Promise<void>((res, rej) => { orig.onload = () => res(); orig.onerror = () => rej(new Error('original image failed to load')); orig.src = activeImage; }),
      new Promise<void>((res, rej) => { proc.onload = () => res(); proc.onerror = () => rej(new Error('processed image failed to load')); proc.src = procUrl; }),
    ]);
    const imgAreaW = (W - pad * 2 - gap) / 2;
    const ratio = orig.naturalHeight / orig.naturalWidth;
    const imgH = imgAreaW * ratio;
    const H = headerH + imgH + gap + stripH + gap + paletteH + gap + domH + pad * 2;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#15151a'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#e8e6df';
    ctx.font = 'bold 22px Inter, sans-serif';
    ctx.fillText('Value Study', pad, pad + 24);
    ctx.fillStyle = '#888';
    ctx.font = '13px Inter, sans-serif';
    // English, like everything drawn into exported files.
    const studyName = mode === 'sketch' ? (sketch.style === 'pencil' ? 'Pencil Study' : 'Clean Outline') : mode;
    ctx.fillText(`${studyName} • ${levels} values • dominant ${dominantWarmth}`, pad, pad + 44);
    const yImg = pad + headerH;
    ctx.drawImage(orig, pad, yImg, imgAreaW, imgH);
    ctx.drawImage(proc, pad + imgAreaW + gap, yImg, imgAreaW, imgH);
    // Strip
    const yStrip = yImg + imgH + gap;
    let x = pad;
    const usable = W - pad * 2;
    groups.forEach(g => {
      const w2 = Math.max(8, (g.pct / 100) * usable);
      ctx.fillStyle = g.hex; ctx.fillRect(x, yStrip, w2, stripH);
      x += w2;
    });
    // Value palette rows
    const yPal = yStrip + stripH + gap;
    ctx.fillStyle = '#e8e6df';
    ctx.font = 'bold 12px Inter, sans-serif';
    ctx.fillText('VALUE PALETTE', pad, yPal - 8);
    const sw = (W - pad * 2) / groups.length;
    groups.forEach((g, i) => {
      ctx.fillStyle = g.hex;
      ctx.fillRect(pad + i * sw, yPal, sw - 6, 50);
      ctx.fillStyle = '#e8e6df';
      ctx.font = 'bold 13px Inter, sans-serif';
      ctx.fillText(g.hex.toUpperCase(), pad + i * sw + 6, yPal + 72);
      ctx.fillStyle = '#888';
      ctx.font = '11px Inter, sans-serif';
      ctx.fillText(`${g.pct.toFixed(1)}% • ${brightnessLabel(g.hsl.l)}`, pad + i * sw + 6, yPal + 90);
    });
    // Dominant palette rows
    const yDom = yPal + paletteH + gap;
    ctx.fillStyle = '#e8e6df';
    ctx.font = 'bold 12px Inter, sans-serif';
    ctx.fillText('DOMINANT COLORS', pad, yDom - 8);
    const dn = Math.max(1, dominant.length);
    const dsw = (W - pad * 2) / dn;
    dominant.forEach((d, i) => {
      ctx.fillStyle = d.hex;
      ctx.fillRect(pad + i * dsw, yDom, dsw - 6, 70);
      ctx.fillStyle = '#e8e6df';
      ctx.font = 'bold 12px Inter, sans-serif';
      ctx.fillText(d.label, pad + i * dsw + 6, yDom + 92);
      ctx.fillStyle = '#888';
      ctx.font = '11px Inter, sans-serif';
      ctx.fillText(`${d.hex.toUpperCase()} • ${d.pct.toFixed(1)}%`, pad + i * dsw + 6, yDom + 110);
      ctx.font = 'italic 10px Inter, sans-serif';
      ctx.fillText(d.paintHint.slice(0, 38), pad + i * dsw + 6, yDom + 128);
    });
    saveDataUrl(c.toDataURL('image/png'), 'value-study-sheet.png', 'image/png');
    } catch (error) {
      console.error('[ValueTab] Failed to export value study sheet:', error);
    } finally {
      if (sketchUrl) URL.revokeObjectURL(sketchUrl);
    }
  };

  if (!activeImage) {
    return (
      <div className="flex flex-1 flex-col min-h-0">
        <ToolHeader tool="value" task={t('empty.task')} />
        <ToolEmptyState
          tool="value"
          heading={t('empty.heading')}
          steps={[
            t('empty.step1'),
            t('empty.step2'),
            t('empty.step3'),
          ]}
          note={t('empty.note')}
        >
          <ImageUploader primary label={t('empty.upload')} onImageLoad={setLocalImage} />
        </ToolEmptyState>
      </div>
    );
  }

  // === Reusable subcomponents ===

  // The three study modes answer three different questions:
  //   Color  → which colors should I mix?
  //   Values → where are the lights and shadows?
  //   Sketch → where should I draw?
  // Painter is treated as a color-rendering variant, so it highlights "Color".
  const studyModes = ([
    { id: 'color' as Mode, label: t('modes.color.label'), icon: <PaletteIcon className="w-3.5 h-3.5" /> },
    { id: 'grayscale' as Mode, label: t('modes.grayscale.label'), icon: <Contrast className="w-3.5 h-3.5" /> },
    { id: 'sketch' as Mode, label: t('modes.sketch.label'), icon: <PencilLine className="w-3.5 h-3.5" /> },
  ]);
  const studyModeActive = (id: Mode) =>
    id === 'color' ? (mode === 'color' || mode === 'painter') : mode === id;
  // The three studies as picture cards, always visible above the image, so
  // the difference between them is clear *before* choosing — no guessing from
  // an icon. `layout="column"` stacks them in the desktop sidebar.
  const STUDY_MODE_INFO: Record<string, { caption: string; treatment: 'flat' | 'values' | 'sketch'; task: string; example: string }> = {
    color: { caption: t('modes.color.caption'), treatment: 'flat', task: t('modes.color.task'), example: t('modes.color.example') },
    grayscale: { caption: t('modes.grayscale.caption'), treatment: 'values', task: t('modes.grayscale.task'), example: t('modes.grayscale.example') },
    sketch: { caption: t('modes.sketch.caption'), treatment: 'sketch', task: t('modes.sketch.task'), example: t('modes.sketch.example') },
  };
  const studyTask = STUDY_MODE_INFO[mode === 'painter' ? 'color' : mode]?.task;
  const StudyModeCards = ({ layout }: { layout: 'row' | 'column' }) => (
    <div data-onboarding="value-modes" role="radiogroup" aria-label={t('modes.group')}
      className={layout === 'row' ? 'grid grid-cols-3 gap-2' : 'flex flex-col gap-1.5'}>
      {studyModes.map(m => {
        const info = STUDY_MODE_INFO[m.id];
        const active = studyModeActive(m.id);
        return (
          <button key={m.id} role="radio" aria-checked={active}
            onClick={() => updateMode(m.id === 'color' && mode === 'painter' ? 'painter' : m.id)}
            className={`flex min-w-0 items-center gap-1.5 rounded-xl border p-1.5 text-start md:gap-2 transition-colors ${
              active ? 'border-primary bg-primary/10' : 'border-border bg-card hover:border-primary/40'
            }`}>
            <span className="h-9 w-9 shrink-0 overflow-hidden rounded-lg md:h-10 md:w-10">
              <PortraitArt treatment={info.treatment} viewBox="30 26 40 40" label={info.example} />
            </span>
            <span className="min-w-0">
              <span className={`block truncate text-[13px] font-semibold leading-tight ${active ? 'text-primary' : 'text-foreground'}`}>{m.label}</span>
              <span className="block text-[10px] leading-tight text-muted-foreground md:text-[11px]">{info.caption}</span>
            </span>
          </button>
        );
      })}
    </div>
  );

  // Painter stays inside the sheet — it's an advanced rendering variant, not
  // switched frequently while painting. Toggling flips between color and painter.
  const PainterToggle = (
    <button onClick={() => updateMode(mode === 'painter' ? 'color' : 'painter')}
      className={`w-full flex items-center justify-center gap-1.5 py-2 rounded-md text-[11px] font-medium transition-colors ${
        mode === 'painter' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
      }`}>
      <Brush className="w-3.5 h-3.5" />
      {mode === 'painter' ? t('controls.painterOn') : t('controls.painterOff')}
    </button>
  );

  const LevelButtons = (
    <div data-onboarding="value-levels">
      <div className="flex gap-1">
        {[3, 5, 7, 9, 11, 13].map(l => (
          <button key={l} onClick={() => updateLevels(l)}
            title={l === 9 ? t('levels.recommended') : undefined}
            className={`relative flex-1 py-1.5 rounded text-xs font-medium transition-colors ${
              levels === l
                ? 'bg-primary text-primary-foreground'
                : l === 9
                  ? 'bg-secondary text-secondary-foreground ring-1 ring-primary/50 hover:bg-secondary/80'
                  : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
            }`}>
            {l}
            {l === 9 && (
              <span className="absolute -top-1 -end-1 h-1.5 w-1.5 rounded-full bg-primary" />
            )}
          </button>
        ))}
      </div>
      <p className="text-[9px] text-muted-foreground mt-1">
        {t('levels.hint')}
      </p>
    </div>
  );

  const FocusButtons = (
    <div className="grid grid-cols-2 gap-1.5">
      {([
        { id: 'none' as Focus, label: t('focus.none'), icon: <Eye className="w-3 h-3" /> },
        { id: 'shadow' as Focus, label: t('focus.shadow'), icon: <Moon className="w-3 h-3" /> },
        { id: 'highlight' as Focus, label: t('focus.highlight'), icon: <Sun className="w-3 h-3" /> },
        { id: 'squint' as Focus, label: t('focus.squint'), icon: <Layers className="w-3 h-3" /> },
      ]).map(f => (
        <button key={f.id} onClick={() => updateFocus(f.id)}
          className={`flex items-center justify-center gap-1.5 py-1.5 rounded text-[11px] font-medium transition-colors ${
            focus === f.id ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
          }`}>
          {f.icon}{f.label}
        </button>
      ))}
    </div>
  );

  // Words, not numbers: five bands over 0–100, the middle one holding the
  // default of 50.
  const bandLabel = (v: number, bands: string[]) =>
    bands[Math.min(bands.length - 1, Math.floor((v / 100) * bands.length))];
  const weightLabel = bandLabel(sketchControls.lineWeight, [
    t('sketch.lineWeight.finest'), t('sketch.lineWeight.fine'), t('sketch.lineWeight.medium'),
    t('sketch.lineWeight.bold'), t('sketch.lineWeight.heavy'),
  ]);
  const detailLabel = bandLabel(sketchControls.detail, [
    t('sketch.detail.essential'), t('sketch.detail.simple'), t('sketch.detail.balanced'),
    t('sketch.detail.detailed'), t('sketch.detail.everything'),
  ]);
  const shadingLabel = bandLabel(sketchControls.shading, [
    t('sketch.shading.whisper'), t('sketch.shading.light'), t('sketch.shading.medium'),
    t('sketch.shading.deep'), t('sketch.shading.deepest'),
  ]);
  const sketchStyleName = sketch.style === 'pencil' ? t('sketch.pencil') : t('sketch.outline');

  // Names shown on screen follow the studio's language; the exported palette
  // and study sheet keep the English ones (brightnessLabel, dominantLabel).
  const brightnessName = (l: number) => t(`brightness.${brightnessLabel(l)}`);
  const warmthName = (warmth: 'warm' | 'cool' | 'neutral') => t(`warmth.${warmth}`);
  const colorName = (d: DominantSwatch) => {
    const name = dominantName(d.family, d.valueBand, d.hsl);
    if ('named' in name) return t(`colors.${name.named}`);
    let label = t(`colors.hue.${name.hue}`);
    if (name.muted) label = t('colors.muted', { color: label });
    if (name.tone) label = t(`colors.${name.tone}`, { color: label });
    return label;
  };

  // The sketch worker coalesces renders, so the picture follows the finger
  // without queueing up work.
  const sketchSlider = (key: 'lineWeight' | 'detail' | 'shading', label: string, readout: string, hint: string) => (
    <Slider
      label={label}
      value={sketchControls[key]}
      min={0}
      max={100}
      readout={readout}
      // The phone keeps the image large: hints only where there is room.
      hint={isMobile ? undefined : hint}
      onChange={(v) => setSketchControl(key, v)}
    />
  );

  const SketchStylePicker = (
    <div role="radiogroup" aria-label={t('sketch.styles')} data-testid="sketch-styles"
      className="flex min-w-0 flex-1 rounded-lg bg-secondary/60 p-0.5">
      {(['outline', 'pencil'] as const).map((s) => (
        <button key={s} role="radio" aria-checked={sketch.style === s} onClick={() => setSketchStyle(s)}
          className={`min-h-[40px] min-w-0 flex-1 truncate rounded-md px-2 text-xs font-semibold transition-colors ${
            sketch.style === s ? 'bg-card text-foreground shadow' : 'text-muted-foreground hover:text-foreground'
          }`}>
          {s === 'outline' ? t('sketch.outline') : t('sketch.pencil')}
        </button>
      ))}
    </div>
  );

  const SketchReset = (
    <button onClick={resetSketch} disabled={sketchAtDefaults}
      aria-label={t('sketch.resetLabel', { style: sketchStyleName })}
      className="flex min-h-[40px] shrink-0 items-center gap-1 rounded-lg px-2.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-40 disabled:hover:bg-transparent">
      <RotateCcw className="h-3.5 w-3.5" />{t('sketch.reset')}
    </button>
  );

  // Inline controls that live *permanently below the image* — the sliders a
  // painter reaches for constantly while studying, so they never require
  // opening a menu. Context-aware: Color / Values expose Contrast + Brightness
  // (visibility), while Sketch swaps in a single painter-facing "Sketch detail"
  // control that speaks to the artistic result rather than edge thresholds.
  const InlineImageControls = (
    <div data-onboarding="value-inline" className="w-full px-3 py-2 border-t border-border toolbar-surface shrink-0">
      {mode === 'sketch' ? (
        // The style and its controls stay under the image: they are what a
        // drawing is steered with, so they never hide behind a panel.
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            {SketchStylePicker}
            {SketchReset}
          </div>
          <div className={`grid grid-cols-2 gap-x-4 sm:gap-x-6 ${sketch.style === 'pencil' ? 'sm:grid-cols-3' : ''}`}>
            {sketchSlider('lineWeight', t('sketch.lineWeight.label'), weightLabel, t('sketch.lineWeight.hint'))}
            {sketchSlider('detail', t('sketch.detail.label'), detailLabel, t('sketch.detail.hint'))}
            {sketch.style === 'pencil' && (
              <div className="col-span-2 sm:col-span-1">
                {sketchSlider('shading', t('sketch.shading.label'), shadingLabel, t('sketch.shading.hint'))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5 sm:flex-row sm:gap-6">
          <div className="flex-1 min-w-0">
            <Slider label={t('controls.contrast')} value={contrast} min={50} max={200} readout={`${contrast}%`}
              onChange={(v) => setValueSettings({ contrast: v })} />
          </div>
          <div className="flex-1 min-w-0">
            <Slider label={t('controls.brightness')} value={brightness} min={50} max={200} readout={`${brightness}%`}
              onChange={(v) => setValueSettings({ brightness: v })} />
          </div>
        </div>
      )}
    </div>
  );

  // Only expose controls meaningful for the active study mode:
  //   • Painter is a color-rendering variant → shown only in the Color family.
  //   • Focus (shadows / lights / squint) has no effect on the Sketch pass →
  //     hidden in Sketch so the sheet never offers a dead control.
  //   • Contrast / Brightness (or Sketch detail) live inline below the image,
  //     not in this sheet.
  const isColorFamily = mode === 'color' || mode === 'painter';
  const isSketch = mode === 'sketch';
  const openWorksheets = () => {
    setShowMobileControls(false);
    setWorksheetsOpen(true);
  };
  const worksheetsSheet = worksheetsOpen && activeImage ? (
    <PrepareWorksheets
      from="value"
      image={activeImage}
      settings={worksheetSettings}
      fitted={worksheetsFitted}
      outline={worksheetOutline}
      learnItem={learnItem ?? (worksheetsFitted ? null : gridImageLearnItem)}
      onClose={() => setWorksheetsOpen(false)}
    />
  ) : null;

  const ControlsBlock = (
    <div className="space-y-4">
      <div>
        {isColorFamily && (
          <>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1.5">{t('controls.colorRendering')}</p>
            {PainterToggle}
          </>
        )}
        {isSketch && (
          <p className="text-[11px] leading-snug text-muted-foreground">
            {sketch.style === 'pencil' ? t('sketch.aboutPencil') : t('sketch.aboutOutline')}
          </p>
        )}
      </div>
      {!isSketch && (
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1.5">{t('levels.title')}</p>
          {LevelButtons}
        </div>
      )}
      {!isSketch && (
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1.5">{t('focus.title')}</p>
          {FocusButtons}
        </div>
      )}
      <div>
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1.5">{t('compare.title')}</p>
        {/* Sketch adds Overlay (its lines in red over the photo); the phone
            offers it among the views under the image instead. */}
        <div className={isSketch && !isMobile ? 'grid grid-cols-2 gap-1.5' : 'flex gap-1.5'}>
          <button onClick={() => { setShowCompare(true); setCompareMode('slider'); }}
            className={`flex-1 py-1.5 rounded text-[11px] font-medium transition-colors ${
              showCompare && compareMode === 'slider' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'
            }`}>{t('compare.slider')}</button>
          <button onClick={() => { setShowCompare(true); setCompareMode('side'); }}
            className={`flex-1 py-1.5 rounded text-[11px] font-medium transition-colors ${
              showCompare && compareMode === 'side' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'
            }`}>{t('compare.side')}</button>
          {isSketch && !isMobile && (
            <button onClick={() => { setShowCompare(true); setCompareMode('overlay'); }}
              className={`flex-1 py-1.5 rounded text-[11px] font-medium transition-colors ${
                showCompare && compareMode === 'overlay' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'
              }`}>{t('compare.overlay')}</button>
          )}
          <button onClick={() => setShowCompare(false)}
            className={`flex-1 py-1.5 rounded text-[11px] font-medium transition-colors ${
              !showCompare ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'
            }`}>{t('compare.off')}</button>
        </div>
      </div>
      <div data-onboarding="value-save">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1.5">{t('save.title')}</p>
        <div className="grid grid-cols-1 gap-1.5">
          <button onClick={exportProcessed} disabled={isSketch && (savingSketch || !drawing.working)}
            className="flex items-center justify-center gap-1.5 py-1.5 rounded text-[11px] font-medium bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors disabled:opacity-50">
            <Download className="w-3 h-3" />{isSketch ? t('save.drawing') : t('save.processed')}
          </button>
          {isSketch && sketch.style === 'outline' && (
            <button onClick={exportSketchSvg} disabled={savingSketch || !drawing.working}
              className="flex items-center justify-center gap-1.5 py-1.5 rounded text-[11px] font-medium bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors disabled:opacity-50">
              <Download className="w-3 h-3" />{t('save.svg')}
            </button>
          )}
          <button onClick={exportPalette}
            className="flex items-center justify-center gap-1.5 py-1.5 rounded text-[11px] font-medium bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors">
            <Download className="w-3 h-3" />{t('save.palette')}
          </button>
          <button onClick={exportStudySheet}
            className="flex items-center justify-center gap-1.5 py-1.5 rounded text-[11px] font-medium bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors">
            <Download className="w-3 h-3" />{t('save.sheet')}
          </button>
          {isMobile && worksheetsOffered && activeImage && (
            <button onClick={openWorksheets} aria-label={worksheetsName}
              className="flex min-h-[44px] items-center justify-center gap-1.5 rounded text-sm font-medium bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors">
              {canWorksheets ? <Layers className="h-4 w-4" aria-hidden="true" /> : <Lock className="h-4 w-4" aria-hidden="true" />}{tw('open')}
            </button>
          )}
        </div>
      </div>
      <div className="pt-2 border-t border-border">
        <ImageUploader onImageLoad={setLocalImage} compact />
      </div>
    </div>
  );

  // Both strips are value scales, dark → light from left to right in every
  // language, so they (and their tooltips) stay left to right.
  const DistributionStrip = (
    <div dir="ltr" className="flex w-full h-10 rounded-md overflow-hidden border border-border bg-secondary/40">
      {groups.map(g => (
        <button
          key={g.index}
          onClick={() => setIsolatedIdx(isolatedIdx === g.index ? null : g.index)}
          style={{ flexBasis: `${Math.max(g.pct, 1.5)}%`, backgroundColor: g.hex }}
          className={`relative group transition-all ${isolatedIdx === g.index ? 'ring-2 ring-primary z-10' : ''}`}
          title={t('palette.groupTitle', { brightness: brightnessName(g.hsl.l), pct: g.pct.toFixed(1), hex: g.hex })}
        >
          <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold opacity-0 group-hover:opacity-100"
            style={{ color: g.hsl.l > 50 ? '#000' : '#fff' }}>
            {g.pct.toFixed(0)}%
          </span>
        </button>
      ))}
    </div>
  );

  const PaletteRows = (
    <div className="divide-y divide-border/60 rounded-md border border-border bg-card/40">
      {groups.map(g => (
        <button key={g.index}
          onClick={() => setIsolatedIdx(isolatedIdx === g.index ? null : g.index)}
          className={`w-full flex items-center gap-2 px-2 py-1.5 text-start transition-colors hover:bg-secondary/40 ${
            isolatedIdx === g.index ? 'bg-primary/10' : ''
          }`}>
          <span className="w-7 h-7 rounded shrink-0 border border-border/70" style={{ backgroundColor: g.hex }} />
          {/* Colour codes and the (English) paint names stay left to right;
              on right-to-left pages they still sit next to the swatch. */}
          <span dir="ltr" className="text-[10px] font-mono text-foreground w-16 shrink-0 rtl:text-right">{g.hex.toUpperCase()}</span>
          <span className="text-[10px] text-muted-foreground w-20 shrink-0 capitalize">V{g.index + 1} · {brightnessName(g.hsl.l)}</span>
          <span className="text-[10px] text-muted-foreground w-12 shrink-0 tabular-nums">{g.pct.toFixed(1)}%</span>
          <span className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 ${
            g.warmth === 'warm' ? 'bg-orange-500/20 text-orange-300'
            : g.warmth === 'cool' ? 'bg-blue-500/20 text-blue-300'
            : 'bg-secondary text-muted-foreground'
          }`}>{warmthName(g.warmth)}</span>
          <span dir="ltr" className="text-[10px] text-muted-foreground/80 italic truncate flex-1 hidden sm:block rtl:text-right">{g.paintHint}</span>
        </button>
      ))}
    </div>
  );

  const DominantRows = (
    <div className="divide-y divide-border/60 rounded-md border border-border bg-card/40">
      {dominant.map(d => (
        <div key={d.key}
          className="w-full flex items-center gap-2 px-2 py-1.5 text-start">
          <span className="w-7 h-7 rounded shrink-0 border border-border/70" style={{ backgroundColor: d.hex }} />
          <span dir="ltr" className="text-[10px] font-mono text-foreground w-16 shrink-0 rtl:text-right">{d.hex.toUpperCase()}</span>
          <span className="text-[10px] text-foreground w-24 shrink-0 capitalize truncate">{colorName(d)}</span>
          <span className="text-[10px] text-muted-foreground w-12 shrink-0 tabular-nums">{d.pct.toFixed(1)}%</span>
          <span className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 ${
            d.warmth === 'warm' ? 'bg-orange-500/20 text-orange-300'
            : d.warmth === 'cool' ? 'bg-blue-500/20 text-blue-300'
            : 'bg-secondary text-muted-foreground'
          }`}>{warmthName(d.warmth)}</span>
          <span dir="ltr" className="text-[10px] text-muted-foreground/80 italic truncate flex-1 hidden sm:block rtl:text-right">{d.paintHint}</span>
        </div>
      ))}
      {dominant.length === 0 && (
        <div className="px-3 py-4 text-[11px] text-muted-foreground text-center">{t('palette.analyzing')}</div>
      )}
    </div>
  );

  const MixRows = (
    <div className="space-y-1.5">
      {dominant.map(d => (
        <div key={d.key} className="flex items-center gap-2 rounded-md border border-border bg-card/40 px-2 py-2">
          <span className="w-9 h-9 rounded shrink-0 border border-border/70" style={{ backgroundColor: d.hex }} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium capitalize">{colorName(d)}</span>
              <span className="text-[10px] text-muted-foreground tabular-nums">{d.pct.toFixed(1)}%</span>
            </div>
            <p dir="ltr" className="text-[10px] text-muted-foreground italic truncate rtl:text-right">{d.paintHint}</p>
          </div>
        </div>
      ))}
    </div>
  );

  const PaletteTabs = (
    <div className="inline-flex rounded-md border border-border bg-secondary/30 p-0.5 text-[10px] font-medium">
      {([
        { id: 'dominant' as PaletteView, label: t('palette.dominant') },
        { id: 'value' as PaletteView, label: t('palette.value') },
        { id: 'mix' as PaletteView, label: t('palette.mix') },
      ]).map(tab => (
        <button key={tab.id} onClick={() => setPaletteView(tab.id)}
          className={`px-2.5 py-1 rounded transition-colors ${
            paletteView === tab.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
          }`}>{tab.label}</button>
      ))}
    </div>
  );

  const ActivePaletteContent = paletteView === 'value' ? PaletteRows
    : paletteView === 'mix' ? MixRows : DominantRows;

  const DominantStrip = (
    <div dir="ltr" className="flex w-full h-10 rounded-md overflow-hidden border border-border bg-secondary/40">
      {dominant.map(d => (
        <div key={d.key}
          style={{ flexBasis: `${Math.max(d.pct, 2)}%`, backgroundColor: d.hex }}
          title={t('palette.colorTitle', { name: colorName(d), pct: d.pct.toFixed(1), hex: d.hex })}
        />
      ))}
    </div>
  );

  // Replacing the source is a frequent, fundamental action — it belongs on the
  // image, not in an overflow menu. Uses the shared ImageUploader flow (its
  // compact variant is an icon button), so there is exactly one upload
  // implementation in the app.
  // (Sketch drops its drawing of the previous photo by itself, the moment the
  // photo changes; see useSketchDrawing.)
  const replaceImage = (dataUrl: string) => setLocalImage(dataUrl);
  const ReplaceImageButton = (
    <div className="flex items-center justify-center min-h-[44px] min-w-[44px] rounded-full
                    bg-card/90 backdrop-blur-sm border border-border shadow-lg"
      title={t('image.replace')}>
      <ImageUploader onImageLoad={replaceImage} compact />
    </div>
  );

  const maxImgH = fullscreen ? 'max-h-[88vh]' : 'max-h-full';
  // In Sketch the image on screen comes from the sketch worker.
  const shownUrl = isSketch ? drawing.url : processedUrl;
  // Describes what is actually on screen: while a new style or view is being
  // drawn, the previous image (and its description) stays until it arrives.
  const shownAlt = !isSketch ? t('image.processed')
    : drawing.shown?.view === 'overlay' ? t('sketch.altOverlay')
      : drawing.shown?.style === 'pencil' ? t('sketch.altPencil') : t('sketch.altOutline');
  // While the first drawing of a photo is computed, the photo stands in,
  // faded, so the frame does not jump or sit empty.
  const SketchPlaceholder = isSketch && !drawing.url && !drawing.failed && activeImage ? (
    <img src={activeImage} alt="" aria-hidden className={`max-w-full ${maxImgH} object-contain rounded opacity-25`} />
  ) : null;
  // Progress and errors, announced politely to screen readers.
  const SketchStatus = isSketch ? (
    <div role="status" aria-live="polite" className="pointer-events-none absolute inset-x-0 top-2 z-20 flex justify-center px-14">
      {drawing.failed ? (
        <div className="pointer-events-auto flex max-w-sm flex-col items-center gap-2 rounded-xl border border-border bg-card/95 px-4 py-3 text-center shadow-lg backdrop-blur-sm">
          <p className="text-xs text-foreground">{t('sketch.failed')}</p>
          <button onClick={drawing.retry}
            className="min-h-[40px] rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground">{t('sketch.retry')}</button>
        </div>
      ) : drawing.busy || savingSketch ? (
        <span className="flex items-center gap-1.5 rounded-full border border-border bg-card/90 px-3 py-1.5 text-[11px] font-medium text-foreground shadow backdrop-blur-sm">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          {savingSketch ? t('sketch.saving') : t('sketch.drawing')}
        </span>
      ) : null}
    </div>
  ) : null;
  // The before/after views stay left to right in every language: original on
  // the left, and the slider's divider is positioned from the left edge.
  const ProcessedImage = (
    <div className={`relative w-full h-full flex items-center justify-center ${fullscreen ? 'p-1' : 'p-3'}`}>
      {SketchStatus}
      {showCompare && shownUrl && compareMode === 'side' ? (
        <div dir="ltr" className="flex gap-3 w-full h-full items-center justify-center">
          <div className="flex-1 h-full flex flex-col items-center justify-center min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{t('image.original')}</p>
            <img src={activeImage} alt={t('image.original')} className={`max-w-full ${maxImgH} object-contain rounded shadow-xl`} />
          </div>
          <div className="flex-1 h-full flex flex-col items-center justify-center min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{t('image.processed')}</p>
            <img src={shownUrl} alt={shownAlt} className={`max-w-full ${maxImgH} object-contain rounded shadow-xl`} />
          </div>
        </div>
      ) : showCompare && shownUrl && compareMode === 'slider' ? (
        <div dir="ltr" className="relative inline-block max-w-full max-h-full select-none">
          <img src={activeImage} alt={t('image.original')} className={`block max-w-full ${maxImgH} object-contain rounded`} />
          <div className="absolute inset-0 overflow-hidden rounded" style={{ clipPath: `inset(0 0 0 ${compareSlider}%)` }}>
            <img src={shownUrl} alt={shownAlt} className={`block max-w-full ${maxImgH} object-contain rounded`} />
          </div>
          <div className="absolute top-0 bottom-0 w-px bg-primary/80 pointer-events-none" style={{ left: `${compareSlider}%` }} />
          <input type="range" min={0} max={100} value={compareSlider}
            onChange={(e) => setCompareSlider(Number(e.target.value))}
            className="absolute inset-x-4 bottom-3 accent-primary" />
        </div>
      ) : shownUrl ? (
        <img src={shownUrl} alt={isSketch ? shownAlt : t('image.alt')}
          className={`max-w-full ${maxImgH} object-contain rounded shadow-xl`} />
      ) : (
        SketchPlaceholder
      )}
      <div className="absolute top-2 end-2 z-20 flex items-center gap-2">
        {ReplaceImageButton}
        <button onClick={() => setFullscreen(v => !v)}
          className="btn-tool bg-card/90 backdrop-blur-sm border border-border min-h-[44px] min-w-[44px]"
          title={fullscreen ? t('image.exitFullscreen') : t('image.fullscreen')}>
          {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );

  // === Mobile layout ===
  if (isMobile) {
    // A colour palette has nothing to say about a drawing, so Sketch drops the
    // whole palette surface (the strip, the tab and the analysis pane) and
    // offers the red overlay in its place. Overlay exists only in Sketch.
    const mobilePane = isSketch
      ? (mobileView === 'palette' ? 'processed' : mobileView)
      : (mobileView === 'overlay' ? 'processed' : mobileView);
    return (
      <div className="relative flex-1 flex flex-col min-h-0 canvas-area">
        <ToolHeader tool="value" task={studyTask} />
        <div className="shrink-0 border-b border-border toolbar-surface px-2 py-2">
          <StudyModeCards layout="row" />
        </div>
        <div className="relative flex-1 min-h-0 overflow-hidden flex items-center justify-center">
          {mobilePane !== 'palette' && (
            <div className="absolute top-2 end-2 z-20">{ReplaceImageButton}</div>
          )}
          {isSketch && mobilePane !== 'original' && SketchStatus}
          {mobilePane === 'original' && <img src={activeImage} alt={t('image.original')} className="max-h-full max-w-full object-contain" />}
          {(mobilePane === 'processed' || mobilePane === 'overlay') && (shownUrl
            ? <img src={shownUrl} alt={shownAlt} className="max-h-full max-w-full object-contain" />
            : SketchPlaceholder)}
          {mobilePane === 'palette' && (
            <div className="w-full h-full overflow-y-auto p-3 space-y-3">
              <div className="flex items-center justify-between">
                {PaletteTabs}
                <span className={`text-[9px] px-2 py-0.5 rounded-full ${
                  dominantWarmth === 'warm' ? 'bg-orange-500/20 text-orange-300'
                  : dominantWarmth === 'cool' ? 'bg-blue-500/20 text-blue-300'
                  : 'bg-secondary text-muted-foreground'
                }`}>{warmthName(dominantWarmth)}</span>
              </div>
              {paletteView === 'value' ? DistributionStrip : DominantStrip}
              {ActivePaletteContent}
            </div>
          )}
        </div>

        {/* Always-accessible controls directly below the image (context-aware) */}
        {mobilePane !== 'palette' && InlineImageControls}

        {/* Value distribution strip — meaningless for a black-and-white trace. */}
        {!isSketch && mobilePane !== 'palette' && groups.length > 0 && (
          <div className="px-3 py-2 border-t border-border toolbar-surface">
            {DistributionStrip}
          </div>
        )}

        {/* View switch, settings and the one primary action. */}
        <div className="flex shrink-0 items-center gap-2 border-t border-border toolbar-surface px-2 py-2">
          <div className="flex min-w-0 flex-1 rounded-lg bg-secondary/60 p-0.5" role="group" aria-label={t('view.group')}>
            {(isSketch ? (['original', 'processed', 'overlay'] as const) : (['original', 'processed', 'palette'] as const)).map(v => (
              <button key={v} onClick={() => setMobileView(v)} aria-pressed={mobilePane === v}
                className={`min-h-[40px] min-w-0 flex-1 truncate rounded-md px-1 text-xs font-medium transition-colors ${
                  mobilePane === v ? 'bg-card text-foreground shadow' : 'text-muted-foreground'
                }`}>{v === 'processed' ? t('view.study') : v === 'original' ? t('view.original') : v === 'overlay' ? t('view.overlay') : t('view.palette')}</button>
            ))}
          </div>
          <button onClick={() => setShowMobileControls(true)}
            className="flex h-11 shrink-0 items-center gap-1.5 rounded-lg bg-secondary px-3 text-xs font-medium text-foreground">
            <SlidersHorizontal className="h-4 w-4" /> {t('controls.adjust')}
          </button>
          <button onClick={exportProcessed} data-onboarding="value-save" disabled={isSketch && (savingSketch || !drawing.working)}
            className="flex h-11 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-semibold text-primary-foreground disabled:opacity-60">
            {isSketch && savingSketch ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" />} {t('save.button')}
          </button>
        </div>

        {showMobileControls && (
          <div className="absolute inset-x-0 bottom-0 z-30 max-h-[75vh] overflow-y-auto rounded-t-2xl border-t border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3 sticky top-0 bg-card">
              <p className="text-sm font-semibold">{t('controls.adjustTitle')}</p>
              <button onClick={() => setShowMobileControls(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-muted-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4">{ControlsBlock}</div>
          </div>
        )}

        {worksheetsSheet}
        <canvas ref={canvasRef} className="hidden" />
      </div>
    );
  }

  // === Desktop layout ===
  return (
    <div className="flex-1 flex flex-col min-h-0">
    <ToolHeader tool="value" task={studyTask} actions={
      <>
      {worksheetsOffered && (
        <button onClick={openWorksheets} aria-label={worksheetsName}
          className="me-1 flex h-9 items-center gap-1.5 rounded-lg bg-secondary px-3 text-sm font-medium text-secondary-foreground hover:bg-secondary/80">
          {canWorksheets ? <Layers className="h-4 w-4" aria-hidden="true" /> : <Lock className="h-4 w-4" aria-hidden="true" />} {tw('open')}
        </button>
      )}
      <button onClick={exportProcessed} disabled={isSketch && (savingSketch || !drawing.working)}
        className="me-1 flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60">
        {isSketch && savingSketch ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" />} {t('save.study')}
      </button>
      </>
    } />
    <div className="flex-1 flex min-h-0">
      {/* Side controls (left, or right in right-to-left languages): the three studies first, settings below. */}
      <aside className="w-64 panel-surface border-e border-border p-4 overflow-y-auto shrink-0 space-y-4">
        <div>
          <h2 className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">{t('modes.choose')}</h2>
          <StudyModeCards layout="column" />
        </div>
        {ControlsBlock}
      </aside>

      {/* Center: image dominates. In Sketch it takes the palette's space too. */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className={`${isSketch ? 'flex-1' : 'flex-[7]'} canvas-area flex items-center justify-center min-h-0 overflow-hidden`}>
          {ProcessedImage}
        </div>

        {/* Always-accessible visibility controls, permanently below the image */}
        {InlineImageControls}

        {/* Compact palette analysis — fixed footprint, internal scroll. A
            black-and-white trace has no palette to analyse, so Sketch drops the
            whole pane rather than leaving an empty shelf under the image. */}
        {!isSketch && (
        <div className="flex-[3] min-h-[180px] max-h-[34vh] border-t border-border panel-surface px-3 py-2 flex flex-col gap-2 overflow-hidden">
          <div className="flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              {PaletteTabs}
              <span className={`text-[9px] px-2 py-0.5 rounded-full ${
                dominantWarmth === 'warm' ? 'bg-orange-500/20 text-orange-300'
                : dominantWarmth === 'cool' ? 'bg-blue-500/20 text-blue-300'
                : 'bg-secondary text-muted-foreground'
              }`}>{warmthName(dominantWarmth)}</span>
            </div>
            {isolatedIdx !== null && (
              <button onClick={() => setIsolatedIdx(null)}
                className="text-[10px] text-primary hover:underline">{t('palette.clearIsolation')}</button>
            )}
          </div>
          <div className="shrink-0">{paletteView === 'value' ? DistributionStrip : DominantStrip}</div>
          <div className="flex-1 overflow-y-auto">{ActivePaletteContent}</div>
        </div>
        )}
      </div>

      {worksheetsSheet}
      <canvas ref={canvasRef} className="hidden" />
    </div>
    </div>
  );
}
