import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useLocale, useTranslations } from 'use-intl';
import ToolHeader from '@/components/shell/ToolHeader';
import { useProject } from '@/hooks/useProjectStore';
import { Pipette, Copy, Check, Plus, Flame, Snowflake, Droplet, Ban } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { dirOf } from '@/i18n/config';
import type { colorEn } from '@/i18n/messages/tools/color';
import { hexToHsv, hsvToHex, isValidHex } from './colorMath';
import { harmoniesOf, hueOnWheel, type HarmonyId } from './harmonies';
import ColorWheel, { type WheelMarker } from './ColorWheel';
import HarmonyCards, { tagText } from './HarmonyCards';
import { useCopyHex } from './useCopyHex';

type ColorMessages = typeof colorEn;
type ColorT = ReturnType<typeof useTranslations<'colorTool'>>;

// ─── Recipe data ──────────────────────────────────────
// Names, notes and group titles are messages (colorTool.recipes / .groups).
// A paint is a plain colour word, translated (`paint`, colorTool.paints), or a
// pigment name that matches the tube label and stays as written (`name`).
type Paint = { paint: keyof ColorMessages['paints'] } | { name: string };
type Ingredient = Paint & { color: string; pct: number };
type Recipe = { id: keyof ColorMessages['recipes']; result: string; ingredients: Ingredient[] };

const paintName = (p: Paint, t: ColorT) => ('paint' in p ? t(`paints.${p.paint}`) : p.name);

const RECIPES: { group: keyof ColorMessages['groups']; items: Recipe[] }[] = [
  {
    group: 'greens',
    items: [
      { id: 'grassGreen', result: '#4A8C2A', ingredients: [
        { color: '#F5C542', paint: 'yellow', pct: 60 },
        { color: '#2A5FAA', paint: 'blue', pct: 35 },
        { color: '#F5F0E8', paint: 'white', pct: 5 },
      ] },
      { id: 'oliveGreen', result: '#6B7038', ingredients: [
        { color: '#F5C542', paint: 'yellow', pct: 50 },
        { color: '#2A5FAA', paint: 'blue', pct: 25 },
        { color: '#5A3020', name: 'Burnt Umber', pct: 25 },
      ] },
      { id: 'forestGreen', result: '#1F4A24', ingredients: [
        { color: '#2A5FAA', paint: 'blue', pct: 40 },
        { color: '#F5C542', paint: 'yellow', pct: 35 },
        { color: '#5A3020', name: 'Burnt Umber', pct: 25 },
      ] },
      { id: 'limeGreen', result: '#9ECF3A', ingredients: [
        { color: '#F5C542', paint: 'yellow', pct: 75 },
        { color: '#2A5FAA', paint: 'blue', pct: 15 },
        { color: '#F5F0E8', paint: 'white', pct: 10 },
      ] },
      { id: 'turquoise', result: '#3FB8B0', ingredients: [
        { color: '#2A5FAA', paint: 'blue', pct: 55 },
        { color: '#F5F0E8', paint: 'white', pct: 25 },
        { color: '#F5C542', paint: 'yellow', pct: 20 },
      ] },
    ],
  },
  {
    group: 'purples',
    items: [
      { id: 'basicPurple', result: '#6A3280', ingredients: [
        { color: '#2A5FAA', paint: 'blue', pct: 55 },
        { color: '#CD3232', paint: 'red', pct: 35 },
        { color: '#F5F0E8', paint: 'white', pct: 10 },
      ] },
      { id: 'lavender', result: '#B89EC4', ingredients: [
        { color: '#F5F0E8', paint: 'white', pct: 50 },
        { color: '#2A5FAA', paint: 'blue', pct: 30 },
        { color: '#CD3232', paint: 'red', pct: 20 },
      ] },
      { id: 'deepPurple', result: '#3A1A5A', ingredients: [
        { color: '#2A5FAA', paint: 'blue', pct: 60 },
        { color: '#CD3232', paint: 'red', pct: 30 },
        { color: '#1A1A1A', paint: 'black', pct: 10 },
      ] },
      { id: 'magenta', result: '#C42A80', ingredients: [
        { color: '#CD3232', paint: 'red', pct: 55 },
        { color: '#2A5FAA', paint: 'blue', pct: 35 },
        { color: '#F5F0E8', paint: 'white', pct: 10 },
      ] },
    ],
  },
  {
    group: 'oranges',
    items: [
      { id: 'orange', result: '#E8781A', ingredients: [
        { color: '#F5C542', paint: 'yellow', pct: 55 },
        { color: '#CD3232', paint: 'red', pct: 40 },
        { color: '#F5F0E8', paint: 'white', pct: 5 },
      ] },
      { id: 'peach', result: '#F2B890', ingredients: [
        { color: '#F5F0E8', paint: 'white', pct: 55 },
        { color: '#F5C542', paint: 'yellow', pct: 30 },
        { color: '#CD3232', paint: 'red', pct: 15 },
      ] },
      { id: 'terracotta', result: '#B25A3E', ingredients: [
        { color: '#CD3232', paint: 'red', pct: 50 },
        { color: '#F5C542', paint: 'yellow', pct: 30 },
        { color: '#5A3020', name: 'Burnt Umber', pct: 20 },
      ] },
    ],
  },
  {
    group: 'pinks',
    items: [
      { id: 'pink', result: '#F28CA4', ingredients: [
        { color: '#F5F0E8', paint: 'white', pct: 60 },
        { color: '#CD3232', paint: 'red', pct: 30 },
        { color: '#2A5FAA', paint: 'blue', pct: 10 },
      ] },
      { id: 'salmon', result: '#F28C78', ingredients: [
        { color: '#F5F0E8', paint: 'white', pct: 50 },
        { color: '#CD3232', paint: 'red', pct: 30 },
        { color: '#F5C542', paint: 'yellow', pct: 20 },
      ] },
      { id: 'rose', result: '#D44A6A', ingredients: [
        { color: '#CD3232', paint: 'red', pct: 55 },
        { color: '#F5F0E8', paint: 'white', pct: 30 },
        { color: '#2A5FAA', paint: 'blue', pct: 15 },
      ] },
    ],
  },
  {
    group: 'browns',
    items: [
      { id: 'basicBrown', result: '#7A5A3A', ingredients: [
        { color: '#5A3020', name: 'Burnt Umber', pct: 50 },
        { color: '#F5C542', paint: 'yellow', pct: 25 },
        { color: '#CD3232', paint: 'red', pct: 25 },
      ] },
      { id: 'warmBrown', result: '#8C5A2A', ingredients: [
        { color: '#5A3020', name: 'Burnt Umber', pct: 50 },
        { color: '#F5C542', paint: 'yellow', pct: 30 },
        { color: '#CD3232', paint: 'red', pct: 20 },
      ] },
      { id: 'darkBrown', result: '#3A2A1A', ingredients: [
        { color: '#5A3020', name: 'Burnt Umber', pct: 60 },
        { color: '#1A1A1A', paint: 'black', pct: 30 },
        { color: '#2A5FAA', paint: 'blue', pct: 10 },
      ] },
      { id: 'reddishBrown', result: '#7A3A2A', ingredients: [
        { color: '#5A3020', name: 'Burnt Umber', pct: 50 },
        { color: '#CD3232', paint: 'red', pct: 35 },
        { color: '#F5C542', paint: 'yellow', pct: 15 },
      ] },
    ],
  },
  {
    group: 'neutrals',
    items: [
      { id: 'warmGray', result: '#8C8276', ingredients: [
        { color: '#F5F0E8', paint: 'white', pct: 55 },
        { color: '#5A3020', name: 'Burnt Umber', pct: 30 },
        { color: '#F5C542', paint: 'yellow', pct: 15 },
      ] },
      { id: 'coolGray', result: '#7A8290', ingredients: [
        { color: '#F5F0E8', paint: 'white', pct: 55 },
        { color: '#2A5FAA', paint: 'blue', pct: 30 },
        { color: '#5A3020', name: 'Burnt Umber', pct: 15 },
      ] },
      { id: 'cream', result: '#F2E6C8', ingredients: [
        { color: '#F5F0E8', paint: 'white', pct: 75 },
        { color: '#F5C542', paint: 'yellow', pct: 20 },
        { color: '#CD3232', paint: 'red', pct: 5 },
      ] },
      { id: 'beige', result: '#D8C29A', ingredients: [
        { color: '#F5F0E8', paint: 'white', pct: 60 },
        { color: '#F5C542', paint: 'yellow', pct: 25 },
        { color: '#5A3020', name: 'Burnt Umber', pct: 15 },
      ] },
    ],
  },
];

function RecipeCard({ r, onPick }: { r: Recipe; onPick: (hex: string) => void }) {
  const t = useTranslations('colorTool');
  return (
    <div className="bg-card border border-border rounded-lg p-3 space-y-2.5">
      <div className="flex items-center gap-3">
        <div
          className="w-12 h-12 rounded-md border border-border/60 cursor-pointer hover:scale-105 transition-transform shrink-0"
          style={{ backgroundColor: r.result }}
          onClick={() => onPick(r.result)}
          title={r.result}
        />
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground truncate">{t(`recipes.${r.id}.name`)}</div>
          <div className="text-[10px] text-muted-foreground font-mono"><span dir="ltr">{r.result.toUpperCase()}</span></div>
        </div>
      </div>
      <div className="space-y-1">
        {r.ingredients.map((ing, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <div className="w-4 h-4 rounded-sm border border-border/60 shrink-0" style={{ backgroundColor: ing.color }} />
            <span className="text-muted-foreground tabular-nums w-9 shrink-0">{ing.pct}%</span>
            <span className="text-foreground truncate">{paintName(ing, t)}</span>
          </div>
        ))}
      </div>
      {/* Every recipe has a note. */}
      <p className="text-[11px] text-muted-foreground leading-snug">{t(`recipes.${r.id}.note`)}</p>
    </div>
  );
}

// ─── Skin tones ───────────────────────────────────────
// Card names and mix labels are messages (colorTool.skin).
type SkinMix = { label: keyof ColorMessages['skin']['mixes']; result: string; ingredients: (Paint & { color: string })[] };
type SkinCard = { id: keyof ColorMessages['skin']['cards']; base: SkinMix; shadow: SkinMix; highlight: SkinMix };

const SKIN_CARDS: SkinCard[] = [
  {
    id: 'light',
    base: {
      label: 'base', result: '#F2D2B0',
      ingredients: [
        { color: '#F5F0E8', paint: 'white' },
        { color: '#C89A3A', name: 'Yellow Ochre' },
        { color: '#D03A28', name: 'Cadmium Red' },
      ],
    },
    shadow: {
      label: 'shadow', result: '#A06A48',
      ingredients: [{ color: '#9A4A24', name: 'Burnt Sienna' }],
    },
    highlight: {
      label: 'highlight', result: '#FCEEDB',
      ingredients: [{ color: '#F5F0E8', paint: 'white' }],
    },
  },
  {
    id: 'medium',
    base: {
      label: 'base', result: '#C6905E',
      ingredients: [
        { color: '#9A4A24', name: 'Burnt Sienna' },
        { color: '#C89A3A', name: 'Yellow Ochre' },
        { color: '#F5F0E8', paint: 'white' },
      ],
    },
    shadow: {
      label: 'shadow', result: '#6E4226',
      ingredients: [
        { color: '#5A3020', name: 'Burnt Umber' },
        { color: '#9A4A24', name: 'Burnt Sienna' },
      ],
    },
    highlight: {
      label: 'highlight', result: '#E8C49A',
      ingredients: [
        { color: '#F5F0E8', paint: 'white' },
        { color: '#C89A3A', name: 'Yellow Ochre' },
      ],
    },
  },
  {
    id: 'dark',
    base: {
      label: 'base', result: '#5A3A22',
      ingredients: [
        { color: '#5A3020', name: 'Burnt Umber' },
        { color: '#9A4A24', name: 'Burnt Sienna' },
        { color: '#C89A3A', name: 'Yellow Ochre' },
      ],
    },
    shadow: {
      label: 'shadow', result: '#2E1A10',
      ingredients: [
        { color: '#5A3020', name: 'Burnt Umber' },
        { color: '#2A5FAA', name: 'Ultramarine' },
      ],
    },
    highlight: {
      label: 'highlight', result: '#8B5A36',
      ingredients: [
        { color: '#9A4A24', name: 'Burnt Sienna' },
        { color: '#C89A3A', name: 'Yellow Ochre' },
      ],
    },
  },
];

function SkinMixRow({ m, onPick }: { m: SkinMix; onPick: (hex: string) => void }) {
  const t = useTranslations('colorTool');
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <div
          className="w-9 h-9 rounded-md border border-border/60 cursor-pointer hover:scale-105 transition-transform shrink-0"
          style={{ backgroundColor: m.result }}
          onClick={() => onPick(m.result)}
          title={m.result}
        />
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{t(`skin.mixes.${m.label}`)}</div>
          <div className="text-[10px] font-mono text-muted-foreground"><span dir="ltr">{m.result.toUpperCase()}</span></div>
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap ps-1">
        {m.ingredients.map((ing, i) => (
          <div key={i} className="flex items-center gap-1.5">
            {i > 0 && <Plus className="w-2.5 h-2.5 text-muted-foreground" />}
            <div className="flex items-center gap-1">
              <div className="w-4 h-4 rounded-sm border border-border/60" style={{ backgroundColor: ing.color }} />
              <span className="text-[11px] text-foreground">{paintName(ing, t)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Painter Cheat Sheet ─────────────────────────────
function PainterCheatSheet() {
  const t = useTranslations('colorTool.cheatSheet');
  const items = [
    { icon: Flame, title: t('warm.title'), tip: t('warm.tip'), color: '#C89A3A' },
    { icon: Snowflake, title: t('cool.title'), tip: t('cool.tip'), color: '#2A5FAA' },
    { icon: Droplet, title: t('mute.title'), tip: t('mute.tip'), color: '#8C7A6B' },
    { icon: Ban, title: t('darken.title'), tip: t('darken.tip'), color: '#5A3020' },
  ];
  return (
    <section>
      <h3 className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-2">{t('title')}</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        {items.map(({ icon: Icon, title, tip, color }) => (
          <div key={title} className="flex items-center gap-3 bg-card border border-border rounded-lg p-3">
            <div className="w-9 h-9 rounded-md shrink-0 flex items-center justify-center" style={{ backgroundColor: color }}>
              <Icon className="w-4 h-4 text-white drop-shadow" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-foreground">{title}</div>
              <div className="text-[11px] text-muted-foreground leading-snug">{tip}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Sections ────────────────────────────────────────
// Each section says what it is *for* — shown under the tool title. Their tab
// names and purposes are messages (colorTool.sections.<id>). The wheel and the
// harmonies share one section, so every harmony is in view while a colour is
// being chosen.
type ColorSection = 'wheel' | 'recipes' | 'skin';
const COLOR_SECTIONS: ColorSection[] = ['wheel', 'recipes', 'skin'];

// ─── Main ────────────────────────────────────────────
export default function ColorTab() {
  const t = useTranslations('colorTool');
  const locale = useLocale();
  const { image } = useProject();
  const [hue, setHue] = useState(() => hexToHsv('#D4827A')[0]);
  const [sat, setSat] = useState(() => hexToHsv('#D4827A')[1]);
  const [val, setVal] = useState(() => hexToHsv('#D4827A')[2]);
  const [selectedHex, setSelectedHex] = useState('#D4827A');
  const [hexInput, setHexInput] = useState('#D4827A');
  const [picking, setPicking] = useState(false);
  const [section, setSection] = useState<ColorSection>('wheel');
  // The harmony shown on the wheel, if any. It belongs to the tool, not to a
  // card, so it survives a visit to Mixing or Skin Tones.
  const [shownHarmony, setShownHarmony] = useState<HarmonyId | null>(null);
  const { copied, copy } = useCopyHex();
  const pickCanvasRef = useRef<HTMLCanvasElement>(null);
  const pickImgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    try {
      const fromSampler = sessionStorage.getItem('use-color-in-tab');
      if (fromSampler && isValidHex(fromSampler)) {
        applyHex(fromSampler);
        sessionStorage.removeItem('use-color-in-tab');
      }
    } catch (error) {
      console.warn('[ColorTab] Failed to read handed-off color from sessionStorage:', error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyHex = useCallback((hex: string) => {
    if (!isValidHex(hex)) return;
    const [h2, s2, v2] = hexToHsv(hex);
    setHue(h2); setSat(s2); setVal(v2);
    setSelectedHex(hex);
    setHexInput(hex);
  }, []);

  const onHueChange = useCallback((h2: number) => {
    setHue(h2);
    const hex = hsvToHex(h2, sat, val);
    setSelectedHex(hex); setHexInput(hex);
  }, [sat, val]);
  const onSVChange = useCallback((s2: number, v2: number) => {
    setSat(s2); setVal(v2);
    const hex = hsvToHex(hue, s2, v2);
    setSelectedHex(hex); setHexInput(hex);
  }, [hue]);

  // Derived from the selected colour on every change: nothing to keep in sync.
  const harmonies = useMemo(() => harmoniesOf(selectedHex), [selectedHex]);
  const shown = harmonies.find((h) => h.id === shownHarmony) ?? null;
  const markers: WheelMarker[] = (shown?.colors ?? []).flatMap((c) => {
    const at = hueOnWheel(c.hex);
    if (c.base || at === null) return [];
    return [{ hex: c.hex, hue: at, label: t('wheel.useAsBase', { name: tagText(c, t), hex: c.hex.toUpperCase() }) }];
  });
  const caption = !shown
    ? t('wheel.idle')
    : markers.length > 0
      ? t('wheel.shown', { name: t(`harmonies.${shown.id}`) })
      : t('wheel.gray', { name: t(`harmonies.${shown.id}`) });

  const toggleHarmony = useCallback((id: HarmonyId) => {
    setShownHarmony((current) => (current === id ? null : id));
  }, []);

  const handlePickClick = useCallback((e: React.MouseEvent<HTMLImageElement>) => {
    if (!picking || !pickCanvasRef.current) return;
    try {
      const img = e.currentTarget;
      const rect = img.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * img.naturalWidth;
      const y = ((e.clientY - rect.top) / rect.height) * img.naturalHeight;
      const canvas = pickCanvasRef.current;
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const p = ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
      const hex = `#${p[0].toString(16).padStart(2, '0')}${p[1].toString(16).padStart(2, '0')}${p[2].toString(16).padStart(2, '0')}`;
      applyHex(hex);
      setPicking(false);
    } catch (error) {
      // getImageData throws on a CORS-tainted canvas; sampling silently fails otherwise.
      console.error('[ColorTab] Failed to sample color from image (eyedropper):', error);
    }
  }, [picking, applyHex]);

  const selectedCopied = copied?.key === 'selected' ? copied : null;

  return (
    <div className="flex flex-1 flex-col min-h-0">
    <ToolHeader tool="color" task={t(`sections.${section}.purpose`)} />
    <div className="flex-1 min-h-0 overflow-y-auto canvas-area">
      <div className="max-w-4xl mx-auto p-3 md:p-4 space-y-5">
        {/* Radix Tabs sets `dir` on its root (left to right unless told): the page's direction. */}
        <Tabs dir={dirOf(locale)} value={section} onValueChange={(v) => setSection(v as ColorSection)} className="w-full">
          <TabsList data-onboarding="color-tabs" className="grid h-auto w-full grid-cols-3 p-1">
            {COLOR_SECTIONS.map((c) => (
              <TabsTrigger key={c} value={c} className="min-h-[40px] whitespace-normal px-1 text-xs leading-tight md:text-sm">
                {t(`sections.${c}.label`)}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* ── Wheel & Harmonies ──
              Phones: the wheel, then the harmonies two by two. From tablet
              width: the wheel beside the harmonies, and a photo being sampled
              across the full width below them. */}
          <TabsContent value="wheel" className="mt-4 space-y-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-[18.5rem_minmax(0,1fr)] md:items-start">
              <section aria-label={t('wheel.title')} className="bg-card border border-border rounded-lg p-3 sm:p-4">
                <div data-onboarding="color-wheel">
                  <ColorWheel
                    hue={hue} sat={sat} val={val}
                    onHueChange={onHueChange} onSVChange={onSVChange}
                    markers={markers} onMarkerSelect={applyHex}
                  />
                </div>
                {/* Two lines kept free, so the controls below never jump as the text changes. */}
                <p aria-live="polite" className="mt-2 min-h-[30px] text-center text-[11px] leading-[15px] text-muted-foreground">
                  {caption}
                </p>

                {/* Selected color */}
                <div className="mt-2 flex items-center gap-3">
                  <div
                    className="w-14 h-14 rounded-lg border border-border shrink-0"
                    style={{ backgroundColor: selectedHex }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">{t('selected.label')}</div>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        dir="ltr"
                        aria-label={t('selected.hex')}
                        value={hexInput}
                        onChange={(e) => {
                          setHexInput(e.target.value);
                          if (isValidHex(e.target.value)) applyHex(e.target.value);
                        }}
                        onBlur={() => { if (!isValidHex(hexInput)) setHexInput(selectedHex); }}
                        className="min-w-0 flex-1 px-2 py-1.5 text-sm font-mono bg-secondary border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-primary uppercase"
                      />
                      <button
                        type="button"
                        onClick={() => copy(selectedHex, 'selected')}
                        className="btn-tool p-1.5"
                        title={t('selected.copy')}
                        aria-label={t('selected.copy')}
                      >
                        {selectedCopied?.ok
                          ? <Check className="w-3.5 h-3.5 text-primary" strokeWidth={3} />
                          : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Pick from image */}
                {image && (
                  <button
                    data-onboarding="color-pick"
                    onClick={() => setPicking(!picking)}
                    className={`mt-3 flex items-center gap-2 px-3 py-2 rounded text-xs font-medium transition-colors w-full justify-center ${
                      picking ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                    }`}
                  >
                    <Pipette className="w-3.5 h-3.5" />
                    {picking ? t('pick.active') : t('pick.start')}
                  </button>
                )}
              </section>

              {/* Sampled by pointer coordinates: left to right in every language. */}
              {image && picking && (
                <div className="bg-card border border-border rounded-lg p-3 md:col-span-2 md:row-start-2" dir="ltr">
                  <img
                    ref={pickImgRef}
                    src={image}
                    alt={t('pick.alt')}
                    className="max-w-full max-h-[40vh] object-contain rounded cursor-crosshair border border-border mx-auto"
                    onClick={handlePickClick}
                  />
                </div>
              )}

              <section aria-labelledby="color-harmonies-title" className="min-w-0 md:col-start-2 md:row-start-1">
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-0.5">
                  <h2 id="color-harmonies-title" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {t('harmoniesTitle')}
                  </h2>
                  <p className="text-[11px] text-muted-foreground">{t('copy.hint')}</p>
                </div>
                <HarmonyCards
                  harmonies={harmonies}
                  active={shownHarmony}
                  onToggle={toggleHarmony}
                  copied={copied}
                  onCopy={copy}
                />
              </section>
            </div>

            <PainterCheatSheet />
          </TabsContent>

          {/* ── Mixing Recipes ── */}
          <TabsContent value="recipes" className="space-y-5 mt-4">
            {RECIPES.map((group) => (
              <section key={group.group}>
                <h3 className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-2">{t(`groups.${group.group}`)}</h3>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {group.items.map((r) => (
                    <RecipeCard key={r.id} r={r} onPick={applyHex} />
                  ))}
                </div>
              </section>
            ))}
            <PainterCheatSheet />
          </TabsContent>

          {/* ── Skin Tones ── */}
          <TabsContent value="skin" className="space-y-4 mt-4">
            <div className="grid gap-3 md:grid-cols-3">
              {SKIN_CARDS.map((card) => (
                <div key={card.id} className="bg-card border border-border rounded-lg p-4 space-y-3">
                  <div className="flex items-center gap-3 pb-2 border-b border-border">
                    <div
                      className="w-10 h-10 rounded-md border border-border/60 cursor-pointer hover:scale-105 transition-transform"
                      style={{ backgroundColor: card.base.result }}
                      onClick={() => applyHex(card.base.result)}
                    />
                    <h4 className="text-sm font-semibold text-foreground">{t(`skin.cards.${card.id}`)}</h4>
                  </div>
                  <SkinMixRow m={card.base} onPick={applyHex} />
                  <SkinMixRow m={card.shadow} onPick={applyHex} />
                  <SkinMixRow m={card.highlight} onPick={applyHex} />
                </div>
              ))}
            </div>
            <PainterCheatSheet />
          </TabsContent>
        </Tabs>

        {/* Read out after a copy: which colour, and whether it worked. */}
        <p role="status" className="sr-only">
          {copied ? t(copied.ok ? 'copy.done' : 'copy.failed', { hex: copied.hex.toUpperCase() }) : ''}
        </p>

        <canvas ref={pickCanvasRef} className="hidden" />
      </div>
    </div>
    </div>
  );
}
