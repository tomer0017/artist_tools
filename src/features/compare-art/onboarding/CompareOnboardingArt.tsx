import { useId } from 'react';
import { Image as ImageIcon, Crosshair, Grid3X3, Hand } from 'lucide-react';

/**
 * Building blocks for the Compare Art onboarding. Everything is self-contained
 * inline SVG on theme tokens (no assets), so the story reads at any size and in
 * both themes. The onboarding tells two complete WORKFLOWS as numbered
 * comic-strips — a painter should follow each without reading the captions.
 */

// ─── Scene primitives (tiny recognizable pictures) ───────────────────────────

// A simple landscape "painting" — the running example for manual overlay.
function Landscape({ dim = false }: { dim?: boolean }) {
  return (
    <g opacity={dim ? 0.5 : 1}>
      <rect x="0" y="0" width="100" height="76" fill="#243b47" />
      <circle cx="74" cy="20" r="8" fill="#e8b45a" />
      <polygon points="0,76 30,34 56,76" fill="#3f5a4a" />
      <polygon points="34,76 66,26 98,76" fill="#4d6b58" />
      <polygon points="52,52 66,26 80,52" fill="#e9eef0" opacity="0.85" />
      <rect x="0" y="60" width="100" height="16" fill="#2f4d57" />
      <rect x="0" y="60" width="100" height="16" fill="#000" opacity="0.12" />
    </g>
  );
}

// A line-drawn face — the painter's own artwork (warm toned paper).
function FacePainting() {
  return (
    <g>
      <rect x="0" y="0" width="100" height="76" fill="#3a322c" />
      <g stroke="#d8b48a" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M32 20 q18 -12 36 0 q6 22 -2 36 q-16 14 -32 0 q-8 -14 -2 -36" />
        <path d="M30 24 q20 -16 40 0" />
        <path d="M40 38 q4 -3 8 0" />
        <path d="M54 38 q4 -3 8 0" />
        <path d="M50 42 l0 8 l-3 3" />
        <path d="M44 58 q7 4 14 0" />
      </g>
    </g>
  );
}

// A marble bust — the reference (cool grey).
function StatueReference() {
  return (
    <g>
      <rect x="0" y="0" width="100" height="76" fill="#474b50" />
      <path d="M34 76 q-4 -20 6 -30 q-6 -18 10 -24 q16 6 10 24 q10 10 6 30 Z" fill="#c7ccd1" />
      <path d="M50 22 q11 4 8 20 q-2 12 -8 14 q-6 -2 -8 -14 q-3 -16 8 -20 Z" fill="#d8dde1" />
      <g stroke="#9aa0a6" strokeWidth="1.5" fill="none" strokeLinecap="round">
        <path d="M43 40 q3 -2 6 0" />
        <path d="M52 40 q3 -2 6 0" />
        <path d="M50 44 l0 6" />
        <path d="M46 55 q4 2 8 0" />
      </g>
    </g>
  );
}

// The GIF blink "output" — a small stack of frames badged GIF.
function GifStack({ tint = 'hsl(var(--primary))' }: { tint?: string }) {
  return (
    <g>
      <rect x="26" y="16" width="48" height="46" rx="6" fill="#111114" stroke={tint} opacity="0.5" />
      <rect x="22" y="12" width="48" height="46" rx="6" fill="#18181b" stroke={tint} opacity="0.75" />
      <rect x="18" y="8" width="48" height="46" rx="6" fill="#1e1e22" stroke={tint} strokeWidth="1.5" />
      <text x="42" y="37" textAnchor="middle" fontSize="15" fontWeight="800" fill={tint}>GIF</text>
    </g>
  );
}

// ─── Frame wrapper: numbered caption + a fixed-ratio picture ──────────────────

function Frame({ n, caption, children }: { n: number; caption: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-secondary text-[9px] font-bold text-foreground">{n}</span>
        <span className="truncate text-[10px] font-medium leading-tight text-muted-foreground">{caption}</span>
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-black/30">
        <svg viewBox="0 0 100 76" className="block w-full" aria-hidden="true">{children}</svg>
      </div>
    </div>
  );
}

// A tap target ring used across the Smart Align frames.
function TapDot({ x, y, tint }: { x: number; y: number; tint: string }) {
  return (
    <g>
      <circle cx={x} cy={y} r="11" fill="none" stroke={tint} strokeWidth="1.5" opacity="0.5" />
      <circle cx={x} cy={y} r="6.5" fill="none" stroke={tint} strokeWidth="2.5" />
      <circle cx={x} cy={y} r="2" fill={tint} />
    </g>
  );
}

const AMBER = 'hsl(var(--primary))';
const BLUE = '#3b82f6';

// ─── The 5-step flow ribbon (Load → Align → Compare → Grid → Export GIF) ──────

export function FlowRibbon() {
  const steps = [
    { icon: <ImageIcon className="h-5 w-5" />, title: 'Load', sub: 'Add both images', tone: 'text-foreground' },
    { icon: <Crosshair className="h-5 w-5" />, title: 'Align', sub: 'Choose a method', tone: 'text-primary' },
    { icon: <CompareGlyph />, title: 'Compare', sub: 'Spot the difference', tone: 'text-foreground' },
    { icon: <Grid3X3 className="h-5 w-5" />, title: 'Grid', sub: 'Optional guide', tone: 'text-muted-foreground' },
    { icon: <GifGlyph />, title: 'Export GIF', sub: 'See it blink', tone: 'text-foreground' },
  ];
  return (
    <div className="rounded-2xl border border-border bg-secondary/25 px-2 py-3">
      <div className="flex items-start justify-between gap-0.5">
        {steps.map((s, i) => (
          <div key={s.title} className="flex flex-1 items-start justify-center">
            <div className="flex min-w-0 flex-col items-center gap-1 text-center">
              <div className={s.tone}>{s.icon}</div>
              <div className="text-[10px] font-bold leading-tight text-foreground sm:text-xs">
                <span className="text-muted-foreground">{i + 1}.</span> {s.title}
              </div>
              <div className="text-[9px] leading-tight text-muted-foreground">{s.sub}</div>
            </div>
            {i < steps.length - 1 && <div className="mt-1.5 px-0.5 text-muted-foreground/50">→</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function CompareGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <circle cx="9" cy="12" r="6.5" fill="none" stroke={AMBER} strokeWidth="1.8" />
      <circle cx="15" cy="12" r="6.5" fill="none" stroke={BLUE} strokeWidth="1.8" />
    </svg>
  );
}
function GifGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <text x="12" y="15.5" textAnchor="middle" fontSize="7.5" fontWeight="800" fill="currentColor">GIF</text>
    </svg>
  );
}

// ─── Workflow A: manual overlay comic-strip ──────────────────────────────────

export function WorkflowA() {
  const uid = useId().replace(/[:]/g, '');
  return (
    <div className="grid grid-cols-3 gap-2">
      <Frame n={1} caption="Load"><Landscape /></Frame>
      <Frame n={2} caption="Drag over reference">
        <g transform="translate(6,6) scale(0.88)"><Landscape dim /></g>
        <g transform="translate(-4,-4) scale(0.9)"><Landscape /></g>
        <g transform="translate(52,40)">
          <path d="M4 0 L4 15 L8 11 L11 17 L14 15 L11 9 L16 9 Z" fill="#fff" stroke="#111" strokeWidth="1" />
        </g>
      </Frame>
      <Frame n={3} caption="Fade opacity">
        <Landscape dim />
        <g opacity="0.5"><Landscape /></g>
        <g transform="translate(0,66)">
          <rect x="10" y="2" width="80" height="4" rx="2" fill="#52525b" />
          <rect x="10" y="2" width="42" height="4" rx="2" fill={AMBER} />
          <circle cx="52" cy="4" r="5" fill={AMBER} />
        </g>
      </Frame>
      <Frame n={4} caption="Mistakes appear">
        <Landscape />
        <circle cx="70" cy="22" r="10" fill="none" stroke="#ef4444" strokeWidth="2" strokeDasharray="3 3" />
        <circle cx="34" cy="50" r="9" fill="none" stroke="#ef4444" strokeWidth="2" strokeDasharray="3 3" />
      </Frame>
      <Frame n={5} caption="Export GIF"><GifStack /></Frame>
      <div className="flex min-w-0 flex-col justify-center">
        <p className="text-[10px] leading-snug text-muted-foreground">
          <style>{`@keyframes ${uid}b{0%,49%{opacity:1}50%,100%{opacity:0}}@media(prefers-reduced-motion:reduce){.${uid}b{animation:none}}`}</style>
          Lower the opacity to see what’s off. A GIF makes it{' '}
          <span className={`${uid}b font-semibold text-foreground`} style={{ animation: `${uid}b 0.9s steps(1) infinite` }}>jump out</span>.
        </p>
      </div>
    </div>
  );
}

// ─── Workflow B: Smart Align comic-strip ─────────────────────────────────────

export function WorkflowB() {
  return (
    <div className="grid grid-cols-3 gap-2">
      <Frame n={1} caption="Tap an eye — painting">
        <FacePainting /><TapDot x={44} y={38} tint={AMBER} />
      </Frame>
      <Frame n={2} caption="Same eye — reference">
        <StatueReference /><TapDot x={47} y={40} tint={BLUE} />
      </Frame>
      <Frame n={3} caption="Other eye — painting">
        <FacePainting /><TapDot x={58} y={38} tint={AMBER} />
      </Frame>
      <Frame n={4} caption="Other eye — reference">
        <StatueReference /><TapDot x={55} y={40} tint={BLUE} />
      </Frame>
      <Frame n={5} caption="It snaps into place">
        <clipPath id="halfL"><rect x="0" y="0" width="50" height="76" /></clipPath>
        <clipPath id="halfR"><rect x="50" y="0" width="50" height="76" /></clipPath>
        <g clipPath="url(#halfL)"><FacePainting /></g>
        <g clipPath="url(#halfR)"><StatueReference /></g>
        <line x1="50" y1="0" x2="50" y2="76" stroke={AMBER} strokeWidth="1.5" strokeDasharray="3 3" />
        <path d="M84 10 l2 5 l5 2 l-5 2 l-2 5 l-2 -5 l-5 -2 l5 -2 Z" fill={AMBER} />
      </Frame>
      <Frame n={6} caption="Export GIF"><GifStack tint={BLUE} /></Frame>
      <div className="col-span-3">
        <p className="text-[10px] leading-snug text-muted-foreground">
          Tap two matching points on each image. They line up perfectly — instantly.
        </p>
      </div>
    </div>
  );
}

// ─── "Why export a GIF?" — a real blink between painting and reference ────────

export function WhyGifBlink() {
  const uid = useId().replace(/[:]/g, '');
  return (
    <div className="flex items-center gap-3">
      <div className="grow">
        <div className="mb-1 flex items-center gap-1.5">
          <Hand className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-bold text-foreground">Why export a GIF?</span>
        </div>
        <p className="text-[11px] leading-snug text-muted-foreground">
          It blinks between your painting and the reference — mistakes that hide in a still image
          become obvious in the flicker.
        </p>
      </div>
      {/* One frame that actually blinks painting ↔ reference. */}
      <div className="relative h-16 w-20 shrink-0 overflow-hidden rounded-lg border border-border bg-black/30">
        <style>{`
          @keyframes ${uid}f{0%,45%{opacity:1}55%,100%{opacity:0}}
          .${uid}f{animation:${uid}f 1.4s steps(1) infinite}
          @media(prefers-reduced-motion:reduce){.${uid}f{animation:none}}
        `}</style>
        <svg viewBox="0 0 100 76" className="absolute inset-0 h-full w-full"><StatueReference /></svg>
        <svg viewBox="0 0 100 76" className={`absolute inset-0 h-full w-full ${uid}f`}><FacePainting /></svg>
      </div>
    </div>
  );
}
