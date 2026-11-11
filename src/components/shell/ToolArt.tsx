import { useTranslations } from 'use-intl';
import { useId } from 'react';
import type { TabId } from '@/types/project';

// ─── Tool illustrations ───────────────────────────────────────────────────────
// One portrait subject drawn in every treatment the app produces — photo,
// posterized color, grayscale values, line sketch — so the Home cards show the
// *outcome* of each tool rather than an icon. Pure SVG: no bundled photos,
// crisp at any size, and every card reads as part of one family.
//
// Coordinate space: the portrait lives in a 100 × 120 box, head centred at
// (50, 50). Each card picks its own crop through the viewBox.

type Treatment = 'photo' | 'flat' | 'values' | 'sketch';

interface Pal {
  bg0: string; bg1: string;
  skin0: string; skin1: string; skin2: string;
  shade: string; light: string;
  hair0: string; hair1: string;
  shirt: string; lip: string; brow: string; iris: string; white: string;
}

const PALETTES: Record<Exclude<Treatment, 'sketch'>, Pal> = {
  photo: {
    bg0: '#3b4048', bg1: '#141619',
    skin0: '#f3cdb0', skin1: '#d89d78', skin2: '#9b6447',
    shade: '#7b4630', light: '#fbe2cd',
    hair0: '#e4e1dc', hair1: '#8c8781',
    shirt: '#1b1d22', lip: '#b0645a', brow: '#6f655c', iris: '#4b3a2b', white: '#efe6dc',
  },
  flat: {
    bg0: '#2d343c', bg1: '#2d343c',
    skin0: '#e3a881', skin1: '#e3a881', skin2: '#e3a881',
    shade: '#a3613f', light: '#f6cfae',
    hair0: '#bdb7ae', hair1: '#7e7871',
    shirt: '#23262b', lip: '#a6564b', brow: '#5d544c', iris: '#3d3027', white: '#e9ddd0',
  },
  values: {
    bg0: '#3a3a3a', bg1: '#3a3a3a',
    skin0: '#a9a9a9', skin1: '#a9a9a9', skin2: '#a9a9a9',
    shade: '#5f5f5f', light: '#dadada',
    hair0: '#c4c4c4', hair1: '#7d7d7d',
    shirt: '#1f1f1f', lip: '#6c6c6c', brow: '#4a4a4a', iris: '#2e2e2e', white: '#e2e2e2',
  },
};

const FACE = 'M31 46C31 30 40 24 50 24C60 24 69 30 69 46C69 58 66 68 60 74C56 78 53 79 50 79C47 79 44 78 40 74C34 68 31 58 31 46Z';
const HAIR = 'M29.5 47C27 30 36 16.5 50 16.5C64 16.5 73.5 28 70.5 47C69 39 66.5 34 62 31.5C56 29 46 29.5 39 31.5C34.5 33.5 31.5 39 29.5 47Z';
const NECK = 'M42.5 72L42.5 88C46 91.5 54 91.5 57.5 88L57.5 72Z';
const SHIRT = 'M2 121C5 101 21 92.5 41 88.5C45 93 55 93 59 88.5C79 92.5 95 101 98 121Z';
const SHADE = 'M59.5 29.5C67.5 35 70.5 51 66.5 63.5C63.5 72 57.5 78 50 79C56 72 60.5 62 60.5 50C60.5 42 59.5 35 59.5 29.5Z';
const EYE_L = 'M37 47.2Q41.4 44.2 46 47Q41.4 49.6 37 47.2Z';
const EYE_R = 'M54 47Q58.6 44.2 63 47.2Q58.6 49.6 54 47Z';
const LIP_TOP = 'M43.5 66.8Q47 65 50 66.2Q53 65 56.5 66.8Q50 68 43.5 66.8Z';
const LIP_BOTTOM = 'M44.2 67.3Q50 71.2 55.8 67.3Q50 68.7 44.2 67.3Z';

function Portrait({ treatment, uid }: { treatment: Treatment; uid: string }) {
  if (treatment === 'sketch') return <SketchPortrait />;
  const p = PALETTES[treatment];
  const smooth = treatment === 'photo';
  const skin = smooth ? `url(#${uid}-skin)` : p.skin1;
  const hair = smooth ? `url(#${uid}-hair)` : p.hair0;
  return (
    <g>
      {smooth && (
        <defs>
          <radialGradient id={`${uid}-bg`} cx="50%" cy="35%" r="75%">
            <stop offset="0%" stopColor={p.bg0} />
            <stop offset="100%" stopColor={p.bg1} />
          </radialGradient>
          <radialGradient id={`${uid}-skin`} cx="38%" cy="34%" r="72%">
            <stop offset="0%" stopColor={p.skin0} />
            <stop offset="55%" stopColor={p.skin1} />
            <stop offset="100%" stopColor={p.skin2} />
          </radialGradient>
          <linearGradient id={`${uid}-hair`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={p.hair0} />
            <stop offset="100%" stopColor={p.hair1} />
          </linearGradient>
        </defs>
      )}
      <rect x="-120" y="-40" width="340" height="200" fill={smooth ? `url(#${uid}-bg)` : p.bg0} />
      <path d={SHIRT} fill={p.shirt} />
      <path d="M41 88.5L50 101L59 88.5" fill="none" stroke={p.white} strokeOpacity={0.55} strokeWidth="1.2" />
      <path d={NECK} fill={smooth ? p.skin2 : p.shade} />
      <ellipse cx="31" cy="51" rx="3" ry="6" fill={smooth ? p.skin1 : p.skin1} />
      <ellipse cx="69" cy="51" rx="3" ry="6" fill={p.shade} />
      <path d={FACE} fill={skin} />
      <path d={SHADE} fill={p.shade} opacity={smooth ? 0.5 : 1} />
      {/* Planes catching the light: forehead, cheekbone, bridge of the nose */}
      <ellipse cx="44" cy="37" rx="8" ry="4.5" fill={p.light} opacity={smooth ? 0.45 : 1} />
      <ellipse cx="40.5" cy="56" rx="4.5" ry="3" fill={p.light} opacity={smooth ? 0.4 : 1} />
      <path d={HAIR} fill={hair} />
      {!smooth && <path d="M62 31.5C66.5 34 69 39 70.5 47C72 37 69 27 62 22Z" fill={p.hair1} />}
      <path d="M37 42.2Q42 39.4 47 41.2" fill="none" stroke={p.brow} strokeWidth="1.7" strokeLinecap="round" />
      <path d="M53 41.2Q58 39.4 63 42.2" fill="none" stroke={p.brow} strokeWidth="1.7" strokeLinecap="round" />
      <path d={EYE_L} fill={p.white} />
      <path d={EYE_R} fill={p.white} />
      <circle cx="41.5" cy="47" r="1.75" fill={p.iris} />
      <circle cx="58.5" cy="47" r="1.75" fill={p.iris} />
      <path d="M37 47.2Q41.4 44.2 46 47" fill="none" stroke={p.brow} strokeWidth="0.7" />
      <path d="M54 47Q58.6 44.2 63 47.2" fill="none" stroke={p.brow} strokeWidth="0.7" />
      <path d="M50.5 47C51 53 53 57.5 54.5 59.8C52.6 61.6 48.6 61.6 46.4 60.1" fill="none" stroke={p.shade} strokeWidth="1" strokeLinecap="round" />
      <path d="M51 49C52 54 54.5 58 54.5 59.8C53 58.5 51.5 57 51 49Z" fill={p.shade} opacity={smooth ? 0.35 : 0.9} />
      <path d={LIP_TOP} fill={p.lip} />
      <path d={LIP_BOTTOM} fill={p.lip} opacity="0.85" />
      <path d="M44 74Q50 77.5 56 74" fill="none" stroke={p.shade} strokeOpacity="0.4" strokeWidth="1" />
    </g>
  );
}

// Line drawing on warm paper — the "Sketch" outcome and the artist's pencil
// study in Compare.
function SketchPortrait() {
  const ink = '#2a2622';
  const s = { fill: 'none', stroke: ink, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <g>
      <rect x="-120" y="-40" width="340" height="200" fill="#efe9de" />
      <path d={SHIRT} {...s} strokeWidth="0.9" />
      <path d="M41 88.5L50 101L59 88.5" {...s} strokeWidth="0.8" />
      <path d="M42.5 73L42.5 88M57.5 73L57.5 88" {...s} strokeWidth="0.8" />
      <path d={FACE} {...s} strokeWidth="1" />
      <path d={HAIR} {...s} strokeWidth="0.9" />
      {/* Hair strands + hatching on the shadow side */}
      <path d="M36 25Q44 20 54 21M40 27Q50 23 60 25M33 34Q37 27 46 25M63 25Q68 30 69.5 40" {...s} strokeWidth="0.5" />
      <path d="M61 50L66 46M60.5 55L66.5 50M60 60L65.5 55M58.5 65L64 60M56 70L62 65" {...s} strokeWidth="0.45" opacity="0.7" />
      <ellipse cx="31" cy="51" rx="3" ry="6" {...s} strokeWidth="0.8" />
      <ellipse cx="69" cy="51" rx="3" ry="6" {...s} strokeWidth="0.8" />
      <path d="M37 42.2Q42 39.4 47 41.2M53 41.2Q58 39.4 63 42.2" {...s} strokeWidth="1.2" />
      <path d={EYE_L} {...s} strokeWidth="0.8" />
      <path d={EYE_R} {...s} strokeWidth="0.8" />
      <circle cx="41.5" cy="47" r="1.5" fill={ink} />
      <circle cx="58.5" cy="47" r="1.5" fill={ink} />
      <path d="M50.5 47C51 53 53 57.5 54.5 59.8C52.6 61.6 48.6 61.6 46.4 60.1" {...s} strokeWidth="0.8" />
      <path d={LIP_TOP} {...s} strokeWidth="0.7" />
      <path d="M44.2 67.3Q50 71.2 55.8 67.3" {...s} strokeWidth="0.7" />
    </g>
  );
}

function Art({ viewBox, label, children, className = '' }: {
  viewBox: string; label: string; children: React.ReactNode; className?: string;
}) {
  return (
    <svg viewBox={viewBox} role="img" aria-label={label} preserveAspectRatio="xMidYMid slice"
      className={`block h-full w-full ${className}`}>
      {children}
    </svg>
  );
}

/** A single portrait in one treatment — used for mode previews. */
export function PortraitArt({ treatment, viewBox = '20 14 60 64', label }: {
  treatment: Treatment; viewBox?: string; label?: string;
}) {
  const uid = useId().replace(/:/g, '');
  return (
    <Art viewBox={viewBox} label={label ?? `${treatment} portrait example`}>
      <Portrait treatment={treatment} uid={uid} />
    </Art>
  );
}

// Measurement label pill — mirrors the purple measurement chrome in Measure.
function Pill({ x, y, text }: { x: number; y: number; text: string }) {
  const w = text.length * 2.9 + 4;
  return (
    <g>
      <rect x={x - w / 2} y={y - 3.6} width={w} height="7.2" rx="2" fill="#24163f" stroke="#a78bfa" strokeWidth="0.5" />
      <text x={x} y={y + 1.9} textAnchor="middle" fontSize="5" fontWeight="600" fill="#fff"
        fontFamily="Inter, system-ui, sans-serif">{text}</text>
    </g>
  );
}

function MeasureArt({ uid }: { uid: string }) {
  const t = useTranslations('toolsCommon.art');
  const line = { stroke: '#8b5cf6', strokeWidth: 0.9, strokeLinecap: 'round' as const };
  return (
    <Art viewBox="-8 8 116 87" label={t('measure')}>
      <Portrait treatment="photo" uid={uid} />
      <line x1="50" y1="17" x2="50" y2="79" {...line} strokeDasharray="2 1.4" />
      <line x1="37" y1="47" x2="63" y2="47" {...line} />
      <line x1="44" y1="61" x2="56" y2="61" {...line} />
      {[[50, 17], [50, 79], [37, 47], [63, 47], [44, 61], [56, 61]].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="1.3" fill="#c4b5fd" stroke="#4c1d95" strokeWidth="0.4" />
      ))}
      <Pill x={73} y={39} text="4.2 cm" />
      <Pill x={30} y={30} text="12.1 cm" />
      <Pill x={65} y={67} text="3.6 cm" />
    </Art>
  );
}

function StudyArt({ uid }: { uid: string }) {
  const t = useTranslations('toolsCommon.art');
  const treatments: Treatment[] = ['photo', 'flat', 'values', 'sketch'];
  return (
    <svg viewBox="0 0 160 120" role="img" aria-label={t('value')}
      preserveAspectRatio="xMidYMid slice" className="block h-full w-full">
      {treatments.map((t, i) => (
        <svg key={t} x={i * 40} y="0" width="40" height="120" viewBox="27 12 46 104" preserveAspectRatio="xMidYMid slice">
          <Portrait treatment={t} uid={`${uid}-${t}`} />
        </svg>
      ))}
      {[40, 80, 120].map((x) => (
        <line key={x} x1={x} y1="0" x2={x} y2="120" stroke="#0b0c0e" strokeWidth="1.2" />
      ))}
    </svg>
  );
}

function ColorArt() {
  const t = useTranslations('toolsCommon.art');
  // A 24-step hue ring around a dark palette, with three primaries squeezed out.
  const segs = 24;
  const cx = 80, cy = 104, r0 = 50, r1 = 82;
  const arc = (i: number) => {
    const a0 = Math.PI + (i / segs) * Math.PI * 2;
    const a1 = Math.PI + ((i + 1.04) / segs) * Math.PI * 2;
    const p = (r: number, a: number) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
    return `M${p(r0, a0)}L${p(r1, a0)}A${r1} ${r1} 0 0 1 ${p(r1, a1)}L${p(r0, a1)}A${r0} ${r0} 0 0 0 ${p(r0, a0)}Z`;
  };
  const blob = (x: number, y: number, fill: string, hi: string) => (
    <g>
      <path d={`M${x - 11} ${y + 5}C${x - 13} ${y - 4} ${x - 4} ${y - 10} ${x + 3} ${y - 8}C${x + 11} ${y - 6} ${x + 13} ${y + 3} ${x + 7} ${y + 7}C${x + 1} ${y + 10} ${x - 9} ${y + 10} ${x - 11} ${y + 5}Z`} fill={fill} />
      <ellipse cx={x - 2} cy={y - 3} rx="4" ry="2" fill={hi} opacity="0.65" />
    </g>
  );
  return (
    <svg viewBox="0 0 160 120" role="img" aria-label={t('color')} preserveAspectRatio="xMidYMid slice" className="block h-full w-full">
      <rect width="160" height="120" fill="#1a1714" />
      {Array.from({ length: segs }, (_, i) => (
        <path key={i} d={arc(i)} fill={`hsl(${(i / segs) * 360 + 180}, 78%, 55%)`} />
      ))}
      <ellipse cx="80" cy="112" rx="58" ry="26" fill="#2b2622" />
      {blob(58, 104, '#e1b51a', '#fff4b0')}
      {blob(84, 96, '#c3202b', '#ffb3b3')}
      {blob(108, 108, '#1f47b8', '#a9c1ff')}
    </svg>
  );
}

function GridArt({ uid }: { uid: string }) {
  const t = useTranslations('toolsCommon.art');
  const lines = [];
  for (let i = 1; i < 4; i++) {
    lines.push(<line key={`v${i}`} x1={22 + i * 14} y1="26.5" x2={22 + i * 14} y2="68.5" />);
    lines.push(<line key={`h${i}`} x1="22" y1={26.5 + i * 10.5} x2="78" y2={26.5 + i * 10.5} />);
  }
  return (
    <Art viewBox="22 26.5 56 42" label={t('grid')}>
      <Portrait treatment="photo" uid={uid} />
      <g stroke="#ffffff" strokeOpacity="0.85" strokeWidth="0.35">{lines}</g>
    </Art>
  );
}

function CompareArt({ uid }: { uid: string }) {
  const t = useTranslations('toolsCommon.art');
  return (
    <Art viewBox="14 14 72 54" label={t('compare')}>
      <defs>
        <clipPath id={`${uid}-left`}><rect x="-50" y="-50" width="100" height="250" /></clipPath>
        <clipPath id={`${uid}-right`}><rect x="50" y="-50" width="150" height="250" /></clipPath>
      </defs>
      <g clipPath={`url(#${uid}-left)`}><Portrait treatment="sketch" uid={`${uid}-s`} /></g>
      <g clipPath={`url(#${uid}-right)`}><Portrait treatment="photo" uid={`${uid}-p`} /></g>
      <line x1="50" y1="0" x2="50" y2="120" stroke="#fff" strokeWidth="0.6" />
      <circle cx="50" cy="44" r="4.2" fill="#111" stroke="#fff" strokeWidth="0.6" />
      <path d="M48.6 42.4L47 44L48.6 45.6M51.4 42.4L53 44L51.4 45.6" fill="none" stroke="#fff" strokeWidth="0.6" strokeLinecap="round" />
    </Art>
  );
}

/** The illustration for a tool's Home card / empty state. */
export function ToolArt({ tool }: { tool: TabId }) {
  const uid = useId().replace(/:/g, '');
  switch (tool) {
    case 'measure': return <MeasureArt uid={uid} />;
    case 'value': return <StudyArt uid={uid} />;
    case 'color': return <ColorArt />;
    case 'grid': return <GridArt uid={uid} />;
    case 'compare': return <CompareArt uid={uid} />;
  }
}

/** Painterly eye for the Home hero. Decorative. */
export function HeroEyeArt({ className = '' }: { className?: string }) {
  const uid = useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 220 140" aria-hidden="true" preserveAspectRatio="xMidYMid slice" className={className}>
      <defs>
        <filter id={`${uid}-brush`} x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.035 0.12" numOctaves="2" seed="7" />
          <feDisplacementMap in="SourceGraphic" scale="9" />
        </filter>
        <radialGradient id={`${uid}-iris`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#2f4a43" />
          <stop offset="45%" stopColor="#6f7f52" />
          <stop offset="78%" stopColor="#8a5a2b" />
          <stop offset="100%" stopColor="#2a1a10" />
        </radialGradient>
        <linearGradient id={`${uid}-white`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#c9b6a3" />
          <stop offset="100%" stopColor="#f3e8dc" />
        </linearGradient>
      </defs>
      <g filter={`url(#${uid}-brush)`}>
        <rect width="220" height="140" fill="#5a2e1a" />
        <path d="M-10 30C40 10 120 0 230 20L230 -10L-10 -10Z" fill="#2d3f57" />
        <path d="M-10 40C50 22 140 18 230 36L230 20C140 4 50 6 -10 26Z" fill="#c86a32" />
        <path d="M-10 52C60 38 150 36 230 52L230 40C150 26 60 26 -10 42Z" fill="#e3a05e" opacity="0.9" />
        <path d="M-10 112C70 100 150 104 230 122L230 150L-10 150Z" fill="#7a3d22" />
        <path d="M-10 104C70 92 160 94 230 110L230 124C150 106 70 104 -10 118Z" fill="#d9874a" opacity="0.85" />
        <path d="M150 20C180 30 210 60 230 70L230 100C200 80 175 55 150 40Z" fill="#3c5674" opacity="0.7" />
        <path d="M-10 60C10 70 20 90 10 120L-10 120Z" fill="#2b3446" opacity="0.8" />
      </g>
      {/* The eye itself stays crisp — the focal point. */}
      <path d="M48 76Q110 30 176 72Q112 104 48 76Z" fill={`url(#${uid}-white)`} />
      <clipPath id={`${uid}-eye`}><path d="M48 76Q110 30 176 72Q112 104 48 76Z" /></clipPath>
      <g clipPath={`url(#${uid}-eye)`}>
        <circle cx="112" cy="70" r="25" fill={`url(#${uid}-iris)`} />
        {Array.from({ length: 28 }, (_, i) => {
          const a = (i / 28) * Math.PI * 2;
          return (
            <line key={i} x1={112 + Math.cos(a) * 11} y1={70 + Math.sin(a) * 11}
              x2={112 + Math.cos(a) * 23} y2={70 + Math.sin(a) * 23}
              stroke={i % 2 ? '#c9a46a' : '#1f2f2a'} strokeOpacity="0.35" strokeWidth="0.8" />
          );
        })}
        <circle cx="112" cy="70" r="10" fill="#0b0b0c" />
        <path d="M48 76Q110 30 176 72L176 58Q110 22 48 64Z" fill="#000" opacity="0.28" />
      </g>
      <ellipse cx="104" cy="62" rx="5" ry="3.5" fill="#fff" opacity="0.92" />
      <path d="M44 74Q110 26 180 70" fill="none" stroke="#1d0f08" strokeWidth="3.4" strokeLinecap="round" />
      <path d="M40 60Q110 6 186 52" fill="none" stroke="#3a1c0f" strokeWidth="2" strokeOpacity="0.7" strokeLinecap="round" />
      <path d="M50 78Q112 104 172 74" fill="none" stroke="#6a341b" strokeWidth="1.6" strokeOpacity="0.8" />
      {Array.from({ length: 13 }, (_, i) => {
        const t = 0.12 + (i / 12) * 0.76;
        const x = (1 - t) * (1 - t) * 44 + 2 * (1 - t) * t * 110 + t * t * 180;
        const y = (1 - t) * (1 - t) * 74 + 2 * (1 - t) * t * 26 + t * t * 70;
        const lean = (t - 0.35) * 10;
        return <path key={i} d={`M${x} ${y}q${lean - 2} -7 ${lean + 2} -11`} fill="none" stroke="#120804" strokeWidth="1.3" strokeLinecap="round" />;
      })}
    </svg>
  );
}
