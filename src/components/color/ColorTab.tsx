import { useState, useCallback, useRef, useEffect } from 'react';
import { useProject } from '@/hooks/useProjectStore';
import { Pipette, Copy, Plus, ArrowRight, Flame, Snowflake, Droplet, Ban } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

// ─── Color math ───────────────────────────────────────
function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  s /= 100; v /= 100;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}
function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  const s = max === 0 ? 0 : (d / max) * 100;
  const v = max * 100;
  return [Math.round(h), Math.round(s), Math.round(v)];
}
function hsvToHex(h: number, s: number, v: number): string {
  const [r, g, b] = hsvToRgb(h, s, v);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}
function hexToHsv(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return rgbToHsv(r, g, b);
}
function isValidHex(hex: string): boolean { return /^#[0-9a-fA-F]{6}$/.test(hex); }

function shiftHue(hex: string, deg: number): string {
  const [h, s, v] = hexToHsv(hex);
  return hsvToHex((h + deg + 360) % 360, s, v);
}
function warmer(hex: string): string {
  // pull hue toward 40° (warm yellow-orange) and slightly boost saturation
  const [h, s, v] = hexToHsv(hex);
  const target = 40;
  const diff = ((target - h + 540) % 360) - 180;
  const newH = (h + diff * 0.35 + 360) % 360;
  return hsvToHex(newH, Math.min(100, s + 6), v);
}
function cooler(hex: string): string {
  const [h, s, v] = hexToHsv(hex);
  const target = 220;
  const diff = ((target - h + 540) % 360) - 180;
  const newH = (h + diff * 0.35 + 360) % 360;
  return hsvToHex(newH, Math.min(100, s + 6), v);
}

// ─── Interactive Color Wheel ──────────────────────────
function ColorWheel({
  hue, sat, val, onHueChange, onSVChange,
}: {
  hue: number; sat: number; val: number;
  onHueChange: (h: number) => void;
  onSVChange: (s: number, v: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svRef = useRef<HTMLDivElement>(null);
  const draggingRing = useRef(false);
  const draggingSV = useRef(false);

  const getHueFromPointer = (clientX: number, clientY: number) => {
    const el = containerRef.current; if (!el) return null;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let angle = Math.atan2(clientY - cy, clientX - cx) * (180 / Math.PI) + 90;
    if (angle < 0) angle += 360;
    return angle % 360;
  };
  const getSVFromPointer = (clientX: number, clientY: number) => {
    const el = svRef.current; if (!el) return null;
    const rect = el.getBoundingClientRect();
    const s = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    const v = Math.max(0, Math.min(100, (1 - (clientY - rect.top) / rect.height) * 100));
    return [Math.round(s), Math.round(v)] as [number, number];
  };

  const onRingDown = (e: React.PointerEvent) => {
    const el = containerRef.current; if (!el) return;
    const rect = el.getBoundingClientRect();
    const dx = e.clientX - rect.left - rect.width / 2;
    const dy = e.clientY - rect.top - rect.height / 2;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const outerR = rect.width / 2;
    const innerR = outerR * 0.68;
    if (dist >= innerR && dist <= outerR) {
      draggingRing.current = true;
      el.setPointerCapture(e.pointerId);
      const a = getHueFromPointer(e.clientX, e.clientY);
      if (a !== null) onHueChange(Math.round(a));
    }
  };
  const onRingMove = (e: React.PointerEvent) => {
    if (!draggingRing.current) return;
    const a = getHueFromPointer(e.clientX, e.clientY);
    if (a !== null) onHueChange(Math.round(a));
  };
  const onSVDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    draggingSV.current = true;
    svRef.current?.setPointerCapture(e.pointerId);
    const sv = getSVFromPointer(e.clientX, e.clientY);
    if (sv) onSVChange(sv[0], sv[1]);
  };
  const onSVMove = (e: React.PointerEvent) => {
    if (!draggingSV.current) return;
    const sv = getSVFromPointer(e.clientX, e.clientY);
    if (sv) onSVChange(sv[0], sv[1]);
  };

  const ringR = 110;
  const hueRad = ((hue - 90) * Math.PI) / 180;
  const hx = Math.cos(hueRad) * ringR;
  const hy = Math.sin(hueRad) * ringR;
  const pureHueHex = hsvToHex(hue, 100, 100);

  return (
    <div
      ref={containerRef}
      className="relative w-64 h-64 mx-auto cursor-crosshair touch-none select-none"
      onPointerDown={onRingDown}
      onPointerMove={onRingMove}
      onPointerUp={() => { draggingRing.current = false; }}
      onPointerCancel={() => { draggingRing.current = false; }}
    >
      <div
        className="w-full h-full rounded-full"
        style={{
          background:
            'conic-gradient(from 0deg, hsl(0,100%,50%), hsl(60,100%,50%), hsl(120,100%,50%), hsl(180,100%,50%), hsl(240,100%,50%), hsl(300,100%,50%), hsl(360,100%,50%))',
        }}
      >
        <div className="absolute inset-[16%] rounded-full bg-card" />
      </div>
      <div
        ref={svRef}
        className="absolute rounded-sm overflow-hidden cursor-crosshair"
        style={{ top: '26%', left: '26%', right: '26%', bottom: '26%' }}
        onPointerDown={onSVDown}
        onPointerMove={onSVMove}
        onPointerUp={() => { draggingSV.current = false; }}
        onPointerCancel={() => { draggingSV.current = false; }}
      >
        <div className="absolute inset-0" style={{ backgroundColor: pureHueHex }} />
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to right, #fff, transparent)' }} />
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, #000, transparent)' }} />
        <div
          className="absolute w-3.5 h-3.5 rounded-full border-2 pointer-events-none"
          style={{
            left: `${sat}%`, top: `${100 - val}%`,
            transform: 'translate(-50%, -50%)',
            borderColor: val > 50 ? '#1a1a1a' : '#f5f0e8',
            boxShadow: '0 0 2px rgba(0,0,0,0.5)',
          }}
        />
      </div>
      <div
        className="absolute w-5 h-5 rounded-full border-2 border-foreground shadow-lg pointer-events-none"
        style={{
          backgroundColor: pureHueHex,
          left: `calc(50% + ${hx}px - 10px)`,
          top: `calc(50% + ${hy}px - 10px)`,
        }}
      />
    </div>
  );
}

// ─── Swatch helpers ───────────────────────────────────
function Swatch({ color, label, size = 'md', onClick }: {
  color: string; label?: string; size?: 'sm' | 'md' | 'lg'; onClick?: () => void;
}) {
  const dim = size === 'lg' ? 'w-12 h-12' : size === 'sm' ? 'w-7 h-7' : 'w-9 h-9';
  return (
    <div className="flex flex-col items-center gap-1" onClick={onClick}>
      <div
        className={`${dim} rounded-md border border-border/60 ${onClick ? 'cursor-pointer hover:scale-105 transition-transform' : ''}`}
        style={{ backgroundColor: color }}
        title={color}
      />
      {label && <span className="text-[10px] text-muted-foreground leading-none text-center max-w-[64px]">{label}</span>}
    </div>
  );
}

function HarmonyBlock({ label, colors, onSelect }: {
  label: string; colors: { hex: string; tag?: string }[]; onSelect: (hex: string) => void;
}) {
  return (
    <div className="bg-card border border-border rounded-lg p-3">
      <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">{label}</div>
      <div className="flex items-center gap-2 flex-wrap">
        {colors.map((c, i) => (
          <Swatch key={i} color={c.hex} label={c.tag || c.hex.toUpperCase()} onClick={() => onSelect(c.hex)} />
        ))}
      </div>
    </div>
  );
}

// ─── Recipe data ──────────────────────────────────────
type Ingredient = { color: string; name: string; pct: number };
type Recipe = { name: string; result: string; ingredients: Ingredient[]; note?: string };

const RECIPES: { group: string; items: Recipe[] }[] = [
  {
    group: 'Greens',
    items: [
      { name: 'Grass Green', result: '#4A8C2A', ingredients: [
        { color: '#F5C542', name: 'Yellow', pct: 60 },
        { color: '#2A5FAA', name: 'Blue', pct: 35 },
        { color: '#F5F0E8', name: 'White', pct: 5 },
      ], note: 'Bright natural green. Add more yellow for spring grass.' },
      { name: 'Olive Green', result: '#6B7038', ingredients: [
        { color: '#F5C542', name: 'Yellow', pct: 50 },
        { color: '#2A5FAA', name: 'Blue', pct: 25 },
        { color: '#5A3020', name: 'Burnt Umber', pct: 25 },
      ], note: 'Natural foliage green. Add more yellow for sunlight.' },
      { name: 'Forest Green', result: '#1F4A24', ingredients: [
        { color: '#2A5FAA', name: 'Blue', pct: 40 },
        { color: '#F5C542', name: 'Yellow', pct: 35 },
        { color: '#5A3020', name: 'Burnt Umber', pct: 25 },
      ], note: 'Deep shadow green. Strong and cool.' },
      { name: 'Lime Green', result: '#9ECF3A', ingredients: [
        { color: '#F5C542', name: 'Yellow', pct: 75 },
        { color: '#2A5FAA', name: 'Blue', pct: 15 },
        { color: '#F5F0E8', name: 'White', pct: 10 },
      ], note: 'Bright, fresh. Keep the blue amount small.' },
      { name: 'Turquoise', result: '#3FB8B0', ingredients: [
        { color: '#2A5FAA', name: 'Blue', pct: 55 },
        { color: '#F5F0E8', name: 'White', pct: 25 },
        { color: '#F5C542', name: 'Yellow', pct: 20 },
      ], note: 'Tropical blue-green. Start with blue, add white.' },
    ],
  },
  {
    group: 'Purples',
    items: [
      { name: 'Basic Purple', result: '#6A3280', ingredients: [
        { color: '#2A5FAA', name: 'Blue', pct: 55 },
        { color: '#CD3232', name: 'Red', pct: 35 },
        { color: '#F5F0E8', name: 'White', pct: 10 },
      ], note: 'Standard purple. More blue for cooler, more red for warmer.' },
      { name: 'Lavender', result: '#B89EC4', ingredients: [
        { color: '#F5F0E8', name: 'White', pct: 50 },
        { color: '#2A5FAA', name: 'Blue', pct: 30 },
        { color: '#CD3232', name: 'Red', pct: 20 },
      ], note: 'Soft pastel purple. Heavy on the white.' },
      { name: 'Deep Purple', result: '#3A1A5A', ingredients: [
        { color: '#2A5FAA', name: 'Blue', pct: 60 },
        { color: '#CD3232', name: 'Red', pct: 30 },
        { color: '#1A1A1A', name: 'Black', pct: 10 },
      ], note: 'Rich and dark. Use black sparingly.' },
      { name: 'Magenta', result: '#C42A80', ingredients: [
        { color: '#CD3232', name: 'Red', pct: 55 },
        { color: '#2A5FAA', name: 'Blue', pct: 35 },
        { color: '#F5F0E8', name: 'White', pct: 10 },
      ], note: 'Vivid pink-purple. Leans red.' },
    ],
  },
  {
    group: 'Oranges',
    items: [
      { name: 'Orange', result: '#E8781A', ingredients: [
        { color: '#F5C542', name: 'Yellow', pct: 55 },
        { color: '#CD3232', name: 'Red', pct: 40 },
        { color: '#F5F0E8', name: 'White', pct: 5 },
      ], note: 'Bold basic orange. More red for rust, more yellow for golden.' },
      { name: 'Peach', result: '#F2B890', ingredients: [
        { color: '#F5F0E8', name: 'White', pct: 55 },
        { color: '#F5C542', name: 'Yellow', pct: 30 },
        { color: '#CD3232', name: 'Red', pct: 15 },
      ], note: 'Soft and warm. Great for skin highlights or fruit.' },
      { name: 'Terracotta', result: '#B25A3E', ingredients: [
        { color: '#CD3232', name: 'Red', pct: 50 },
        { color: '#F5C542', name: 'Yellow', pct: 30 },
        { color: '#5A3020', name: 'Burnt Umber', pct: 20 },
      ], note: 'Warm clay tone. Earthy and grounded.' },
    ],
  },
  {
    group: 'Pinks',
    items: [
      { name: 'Pink', result: '#F28CA4', ingredients: [
        { color: '#F5F0E8', name: 'White', pct: 60 },
        { color: '#CD3232', name: 'Red', pct: 30 },
        { color: '#2A5FAA', name: 'Blue', pct: 10 },
      ], note: 'Classic pink. A touch of blue keeps it from going orange.' },
      { name: 'Salmon', result: '#F28C78', ingredients: [
        { color: '#F5F0E8', name: 'White', pct: 50 },
        { color: '#CD3232', name: 'Red', pct: 30 },
        { color: '#F5C542', name: 'Yellow', pct: 20 },
      ], note: 'Warm coral pink. More yellow moves it toward peach.' },
      { name: 'Rose', result: '#D44A6A', ingredients: [
        { color: '#CD3232', name: 'Red', pct: 55 },
        { color: '#F5F0E8', name: 'White', pct: 30 },
        { color: '#2A5FAA', name: 'Blue', pct: 15 },
      ], note: 'Deeper pink. Less white, more red and blue.' },
    ],
  },
  {
    group: 'Browns',
    items: [
      { name: 'Basic Brown', result: '#7A5A3A', ingredients: [
        { color: '#5A3020', name: 'Burnt Umber', pct: 50 },
        { color: '#F5C542', name: 'Yellow', pct: 25 },
        { color: '#CD3232', name: 'Red', pct: 25 },
      ], note: 'All-purpose brown. Balanced warm mix.' },
      { name: 'Warm Brown', result: '#8C5A2A', ingredients: [
        { color: '#5A3020', name: 'Burnt Umber', pct: 50 },
        { color: '#F5C542', name: 'Yellow', pct: 30 },
        { color: '#CD3232', name: 'Red', pct: 20 },
      ], note: 'Golden brown. More yellow for warmth.' },
      { name: 'Dark Brown', result: '#3A2A1A', ingredients: [
        { color: '#5A3020', name: 'Burnt Umber', pct: 60 },
        { color: '#1A1A1A', name: 'Black', pct: 30 },
        { color: '#2A5FAA', name: 'Blue', pct: 10 },
      ], note: 'Near-black brown. Use blue instead of plain black for depth.' },
      { name: 'Reddish Brown', result: '#7A3A2A', ingredients: [
        { color: '#5A3020', name: 'Burnt Umber', pct: 50 },
        { color: '#CD3232', name: 'Red', pct: 35 },
        { color: '#F5C542', name: 'Yellow', pct: 15 },
      ], note: 'Brick-like tone. Heavy on the red.' },
    ],
  },
  {
    group: 'Neutrals',
    items: [
      { name: 'Warm Gray', result: '#8C8276', ingredients: [
        { color: '#F5F0E8', name: 'White', pct: 55 },
        { color: '#5A3020', name: 'Burnt Umber', pct: 30 },
        { color: '#F5C542', name: 'Yellow', pct: 15 },
      ], note: 'Soft golden gray. Warm and receding.' },
      { name: 'Cool Gray', result: '#7A8290', ingredients: [
        { color: '#F5F0E8', name: 'White', pct: 55 },
        { color: '#2A5FAA', name: 'Blue', pct: 30 },
        { color: '#5A3020', name: 'Burnt Umber', pct: 15 },
      ], note: 'Atmospheric blue-gray. Good for distance.' },
      { name: 'Cream', result: '#F2E6C8', ingredients: [
        { color: '#F5F0E8', name: 'White', pct: 75 },
        { color: '#F5C542', name: 'Yellow', pct: 20 },
        { color: '#CD3232', name: 'Red', pct: 5 },
      ], note: 'Soft off-white. Great for warm highlights.' },
      { name: 'Beige', result: '#D8C29A', ingredients: [
        { color: '#F5F0E8', name: 'White', pct: 60 },
        { color: '#F5C542', name: 'Yellow', pct: 25 },
        { color: '#5A3020', name: 'Burnt Umber', pct: 15 },
      ], note: 'Classic warm neutral. Light and earthy.' },
    ],
  },
];

function RecipeCard({ r, onPick }: { r: Recipe; onPick: (hex: string) => void }) {
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
          <div className="text-sm font-semibold text-foreground truncate">{r.name}</div>
          <div className="text-[10px] text-muted-foreground font-mono">{r.result.toUpperCase()}</div>
        </div>
      </div>
      <div className="space-y-1">
        {r.ingredients.map((ing, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <div className="w-4 h-4 rounded-sm border border-border/60 shrink-0" style={{ backgroundColor: ing.color }} />
            <span className="text-muted-foreground tabular-nums w-9 shrink-0">{ing.pct}%</span>
            <span className="text-foreground truncate">{ing.name}</span>
          </div>
        ))}
      </div>
      {r.note && <p className="text-[11px] text-muted-foreground leading-snug">{r.note}</p>}
    </div>
  );
}

// ─── Skin tones ───────────────────────────────────────
type SkinMix = { label: string; result: string; ingredients: { color: string; name: string }[] };
type SkinCard = { name: string; base: SkinMix; shadow: SkinMix; highlight: SkinMix };

const SKIN_CARDS: SkinCard[] = [
  {
    name: 'Light Skin',
    base: {
      label: 'Base', result: '#F2D2B0',
      ingredients: [
        { color: '#F5F0E8', name: 'White' },
        { color: '#C89A3A', name: 'Yellow Ochre' },
        { color: '#D03A28', name: 'Cadmium Red' },
      ],
    },
    shadow: {
      label: 'Shadow', result: '#A06A48',
      ingredients: [{ color: '#9A4A24', name: 'Burnt Sienna' }],
    },
    highlight: {
      label: 'Highlight', result: '#FCEEDB',
      ingredients: [{ color: '#F5F0E8', name: 'White' }],
    },
  },
  {
    name: 'Medium Skin',
    base: {
      label: 'Base', result: '#C6905E',
      ingredients: [
        { color: '#9A4A24', name: 'Burnt Sienna' },
        { color: '#C89A3A', name: 'Yellow Ochre' },
        { color: '#F5F0E8', name: 'White' },
      ],
    },
    shadow: {
      label: 'Shadow', result: '#6E4226',
      ingredients: [
        { color: '#5A3020', name: 'Burnt Umber' },
        { color: '#9A4A24', name: 'Burnt Sienna' },
      ],
    },
    highlight: {
      label: 'Highlight', result: '#E8C49A',
      ingredients: [
        { color: '#F5F0E8', name: 'White' },
        { color: '#C89A3A', name: 'Yellow Ochre' },
      ],
    },
  },
  {
    name: 'Dark Skin',
    base: {
      label: 'Base', result: '#5A3A22',
      ingredients: [
        { color: '#5A3020', name: 'Burnt Umber' },
        { color: '#9A4A24', name: 'Burnt Sienna' },
        { color: '#C89A3A', name: 'Yellow Ochre' },
      ],
    },
    shadow: {
      label: 'Shadow', result: '#2E1A10',
      ingredients: [
        { color: '#5A3020', name: 'Burnt Umber' },
        { color: '#2A5FAA', name: 'Ultramarine' },
      ],
    },
    highlight: {
      label: 'Highlight', result: '#8B5A36',
      ingredients: [
        { color: '#9A4A24', name: 'Burnt Sienna' },
        { color: '#C89A3A', name: 'Yellow Ochre' },
      ],
    },
  },
];

function SkinMixRow({ m, onPick }: { m: SkinMix; onPick: (hex: string) => void }) {
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
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{m.label}</div>
          <div className="text-[10px] font-mono text-muted-foreground">{m.result.toUpperCase()}</div>
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap pl-1">
        {m.ingredients.map((ing, i) => (
          <div key={i} className="flex items-center gap-1.5">
            {i > 0 && <Plus className="w-2.5 h-2.5 text-muted-foreground" />}
            <div className="flex items-center gap-1">
              <div className="w-4 h-4 rounded-sm border border-border/60" style={{ backgroundColor: ing.color }} />
              <span className="text-[11px] text-foreground">{ing.name}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Painter Cheat Sheet ─────────────────────────────
function PainterCheatSheet() {
  const items = [
    { icon: Flame, title: 'Warm a color', tip: 'Add Yellow Ochre', color: '#C89A3A' },
    { icon: Snowflake, title: 'Cool a color', tip: 'Add Blue', color: '#2A5FAA' },
    { icon: Droplet, title: 'Mute a color', tip: 'Add a touch of its complement', color: '#8C7A6B' },
    { icon: Ban, title: 'Never darken with Black alone', tip: 'Use the complement or Burnt Umber', color: '#5A3020' },
  ];
  return (
    <section>
      <h3 className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-2">Painter Cheat Sheet</h3>
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

// ─── Main ────────────────────────────────────────────
export default function ColorTab() {
  const { image } = useProject();
  const [hue, setHue] = useState(() => hexToHsv('#D4827A')[0]);
  const [sat, setSat] = useState(() => hexToHsv('#D4827A')[1]);
  const [val, setVal] = useState(() => hexToHsv('#D4827A')[2]);
  const [selectedHex, setSelectedHex] = useState('#D4827A');
  const [hexInput, setHexInput] = useState('#D4827A');
  const [picking, setPicking] = useState(false);
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

  const compHex = shiftHue(selectedHex, 180);
  const split1 = shiftHue(selectedHex, 150);
  const split2 = shiftHue(selectedHex, 210);
  const ana1 = shiftHue(selectedHex, -30);
  const ana2 = shiftHue(selectedHex, 30);
  const tri1 = shiftHue(selectedHex, 120);
  const tri2 = shiftHue(selectedHex, 240);
  const warmHex = warmer(selectedHex);
  const coolHex = cooler(selectedHex);

  const copyHex = (hex: string) => {
    navigator.clipboard?.writeText(hex).catch((error) => {
      console.warn('[ColorTab] Clipboard copy failed:', error);
    });
  };

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

  return (
    <div className="flex-1 min-h-0 overflow-y-auto canvas-area">
      <div className="max-w-4xl mx-auto p-4 space-y-5">
        <Tabs defaultValue="wheel" className="w-full">
          <TabsList data-onboarding="color-tabs" className="grid w-full grid-cols-3">
            <TabsTrigger value="wheel">Color Wheel</TabsTrigger>
            <TabsTrigger value="recipes">Mixing Recipes</TabsTrigger>
            <TabsTrigger value="skin">Skin Tones</TabsTrigger>
          </TabsList>

          {/* ── Color Wheel ── */}
          <TabsContent value="wheel" className="space-y-4 mt-4">
            <div className="bg-card border border-border rounded-lg p-4">
              <div data-onboarding="color-wheel">
                <ColorWheel hue={hue} sat={sat} val={val} onHueChange={onHueChange} onSVChange={onSVChange} />
              </div>

              {/* Selected color */}
              <div className="mt-4 flex items-center gap-3">
                <div
                  className="w-14 h-14 rounded-lg border border-border shrink-0"
                  style={{ backgroundColor: selectedHex }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Selected</div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={hexInput}
                      onChange={(e) => {
                        setHexInput(e.target.value);
                        if (isValidHex(e.target.value)) applyHex(e.target.value);
                      }}
                      onBlur={() => { if (!isValidHex(hexInput)) setHexInput(selectedHex); }}
                      className="flex-1 px-2 py-1.5 text-sm font-mono bg-secondary border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-primary uppercase"
                    />
                    <button onClick={() => copyHex(selectedHex)} className="btn-tool p-1.5" title="Copy HEX">
                      <Copy className="w-3.5 h-3.5" />
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
                  {picking ? 'Tap on image below ↓' : 'Pick from image'}
                </button>
              )}
              {image && picking && (
                <div className="mt-3">
                  <img
                    ref={pickImgRef}
                    src={image}
                    alt="Pick color"
                    className="max-w-full max-h-[40vh] object-contain rounded cursor-crosshair border border-border mx-auto"
                    onClick={handlePickClick}
                  />
                </div>
              )}
            </div>

            {/* Harmonies */}
            <div data-onboarding="color-harmony" className="grid gap-3 sm:grid-cols-2">
              <HarmonyBlock
                label="Complementary"
                colors={[{ hex: selectedHex, tag: 'Base' }, { hex: compHex, tag: 'Comp' }]}
                onSelect={applyHex}
              />
              <HarmonyBlock
                label="Split Complementary"
                colors={[
                  { hex: selectedHex, tag: 'Base' },
                  { hex: split1, tag: 'Split A' },
                  { hex: split2, tag: 'Split B' },
                ]}
                onSelect={applyHex}
              />
              <HarmonyBlock
                label="Analogous"
                colors={[
                  { hex: ana1, tag: '−30°' },
                  { hex: selectedHex, tag: 'Base' },
                  { hex: ana2, tag: '+30°' },
                ]}
                onSelect={applyHex}
              />
              <HarmonyBlock
                label="Triadic"
                colors={[
                  { hex: selectedHex, tag: 'Base' },
                  { hex: tri1, tag: 'Tri A' },
                  { hex: tri2, tag: 'Tri B' },
                ]}
                onSelect={applyHex}
              />
              <HarmonyBlock
                label="Warm Version"
                colors={[{ hex: selectedHex, tag: 'Base' }, { hex: warmHex, tag: 'Warmer' }]}
                onSelect={applyHex}
              />
              <HarmonyBlock
                label="Cool Version"
                colors={[{ hex: selectedHex, tag: 'Base' }, { hex: coolHex, tag: 'Cooler' }]}
                onSelect={applyHex}
              />
            </div>

            <PainterCheatSheet />
          </TabsContent>

          {/* ── Mixing Recipes ── */}
          <TabsContent value="recipes" className="space-y-5 mt-4">
            {RECIPES.map((group) => (
              <section key={group.group}>
                <h3 className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-2">{group.group}</h3>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {group.items.map((r) => (
                    <RecipeCard key={r.name} r={r} onPick={applyHex} />
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
                <div key={card.name} className="bg-card border border-border rounded-lg p-4 space-y-3">
                  <div className="flex items-center gap-3 pb-2 border-b border-border">
                    <div
                      className="w-10 h-10 rounded-md border border-border/60 cursor-pointer hover:scale-105 transition-transform"
                      style={{ backgroundColor: card.base.result }}
                      onClick={() => applyHex(card.base.result)}
                    />
                    <h4 className="text-sm font-semibold text-foreground">{card.name}</h4>
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

        <canvas ref={pickCanvasRef} className="hidden" />
      </div>
    </div>
  );
}
