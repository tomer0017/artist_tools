import { useId } from 'react';
import type { PreviewFrame, PreviewVariant } from './onboardingTypes';

// ─── Code-driven demo art ─────────────────────────────────────────────────────
// Every preview is a lit sphere on a ground plane — the canonical value-study
// subject — rendered in the treatment the tool produces. It is pure SVG so it
// needs no bundled images, stays razor-sharp at any size, and instantly
// communicates the outcome (form, light, shadow) before any control is shown.
//
// Two calm palettes: a warm one for "Color" studies and a neutral one for
// "Values". They echo the app's amber theme without importing brand tokens.

const WARM = {
  bgTop: '#31414a',
  bg: '#233038',
  ground: '#1a232a',
  cast: '#12181c',
  highlight: '#fcefd6',
  light: '#f0c48c',
  mid: '#d99a5c',
  shadow: '#a5673c',
  dark: '#6d4325',
  reflect: '#8a5636',
};

const GRAY = {
  bgTop: '#5a544c',
  bg: '#453f39',
  ground: '#332f2a',
  cast: '#201d1a',
  highlight: '#efe9df',
  light: '#c9c2b6',
  mid: '#9a9388',
  shadow: '#6a655c',
  dark: '#403c37',
  reflect: '#585349',
};

type Pal = typeof WARM;

// The stepped, offset ellipses that read as a posterized value study: base mid,
// a dark shadow mass swinging in from the lower-right, then light and highlight
// planes pushed toward the upper-left light source, lifted by a reflected-light
// sliver along the shadow rim.
function PosterSphere({ pal, clipId }: { pal: Pal; clipId: string }) {
  return (
    <>
      <clipPath id={clipId}>
        <circle cx="47" cy="42" r="27" />
      </clipPath>
      <circle cx="47" cy="42" r="27" fill={pal.mid} />
      <g clipPath={`url(#${clipId})`}>
        <ellipse cx="64" cy="55" rx="26" ry="26" fill={pal.dark} />
        <ellipse cx="60" cy="64" rx="15" ry="15" fill={pal.reflect} />
        <ellipse cx="40" cy="33" rx="18" ry="18" fill={pal.light} />
        <ellipse cx="34" cy="27" rx="8" ry="8" fill={pal.highlight} />
      </g>
    </>
  );
}

function Background({ pal }: { pal: Pal }) {
  return (
    <>
      <rect x="0" y="0" width="100" height="72" fill={pal.bgTop} />
      <rect x="0" y="62" width="100" height="38" fill={pal.ground} />
      <ellipse cx="52" cy="72" rx="30" ry="5" fill={pal.cast} opacity="0.55" />
    </>
  );
}

// The smooth, un-posterized reference render.
function PhotoSphere({ gradId }: { gradId: string }) {
  return (
    <>
      <radialGradient id={gradId} cx="34%" cy="28%" r="78%">
        <stop offset="0%" stopColor={WARM.highlight} />
        <stop offset="32%" stopColor={WARM.light} />
        <stop offset="60%" stopColor={WARM.mid} />
        <stop offset="82%" stopColor={WARM.shadow} />
        <stop offset="100%" stopColor={WARM.dark} />
      </radialGradient>
      <circle cx="47" cy="42" r="27" fill={`url(#${gradId})`} />
      <ellipse cx="60" cy="64" rx="13" ry="13" fill={WARM.reflect} opacity="0.5" clipPath="none" />
    </>
  );
}

function Svg({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      className="h-full w-full"
      role="img"
      aria-label={`${label} example`}
      preserveAspectRatio="xMidYMid slice"
    >
      {children}
    </svg>
  );
}

/**
 * A single demo visual filling its container. Falls back to an image when the
 * frame provides one, so curated before/after assets can be dropped in later
 * without changing any component.
 */
export function PreviewArt({ variant, src, label }: PreviewFrame) {
  const uid = useId().replace(/:/g, '');

  if (src) {
    return <img src={src} alt={`${label} example`} className="h-full w-full object-cover" />;
  }

  const v: PreviewVariant = variant ?? 'original';

  if (v === 'wheel') {
    // The color wheel mirrors ColorTab's own wheel so the tool is recognizable.
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#233038]">
        <div
          className="relative rounded-full"
          style={{
            width: '74%',
            aspectRatio: '1 / 1',
            background:
              'conic-gradient(from 0deg, #ef4444, #f59e0b, #eab308, #22c55e, #06b6d4, #3b82f6, #8b5cf6, #ec4899, #ef4444)',
          }}
        >
          <div className="absolute inset-[26%] rounded-full bg-[#233038]" />
          <div className="absolute left-1/2 top-[4%] h-[10%] w-[10%] -translate-x-1/2 rounded-full border-2 border-white bg-[#f59e0b] shadow" />
        </div>
      </div>
    );
  }

  if (v === 'values') {
    return (
      <Svg label={label}>
        <Background pal={GRAY} />
        <PosterSphere pal={GRAY} clipId={`${uid}-c`} />
      </Svg>
    );
  }

  if (v === 'color') {
    return (
      <Svg label={label}>
        <Background pal={WARM} />
        <PosterSphere pal={WARM} clipId={`${uid}-c`} />
      </Svg>
    );
  }

  if (v === 'sketch') {
    const stroke = '#40382f';
    return (
      <Svg label={label}>
        <rect x="0" y="0" width="100" height="100" fill="#f4f1e9" />
        <line x1="0" y1="70" x2="100" y2="70" stroke={stroke} strokeWidth="1" opacity="0.5" />
        <circle cx="47" cy="42" r="27" fill="none" stroke={stroke} strokeWidth="1.6" />
        {/* terminator + core-shadow contour */}
        <path d="M30 54 Q47 66 66 46" fill="none" stroke={stroke} strokeWidth="1.1" opacity="0.75" />
        <ellipse cx="34" cy="27" rx="7" ry="7" fill="none" stroke={stroke} strokeWidth="1" opacity="0.6" />
        <ellipse cx="52" cy="72" rx="30" ry="5" fill="none" stroke={stroke} strokeWidth="1" opacity="0.4" />
      </Svg>
    );
  }

  if (v === 'grid') {
    const lines = [];
    for (let i = 1; i < 4; i++) lines.push(<line key={`v${i}`} x1={i * 25} y1="0" x2={i * 25} y2="100" />);
    for (let i = 1; i < 5; i++) lines.push(<line key={`h${i}`} x1="0" y1={i * 20} x2="100" y2={i * 20} />);
    return (
      <Svg label={label}>
        <Background pal={WARM} />
        <PhotoSphere gradId={`${uid}-g`} />
        <g stroke="#f5f0e8" strokeWidth="0.8" opacity="0.6">{lines}</g>
        <rect x="0.6" y="0.6" width="98.8" height="98.8" fill="none" stroke="#f5f0e8" strokeWidth="1.2" opacity="0.8" />
      </Svg>
    );
  }

  if (v === 'measure') {
    const amber = '#f59e0b';
    return (
      <Svg label={label}>
        <Background pal={WARM} />
        <PhotoSphere gradId={`${uid}-g`} />
        <g stroke={amber} strokeWidth="1.2" fill={amber}>
          <line x1="20" y1="15" x2="74" y2="15" />
          <circle cx="20" cy="15" r="2.2" />
          <circle cx="74" cy="15" r="2.2" />
          <line x1="20" y1="69" x2="47" y2="15" strokeDasharray="3 2" strokeWidth="1" />
          <circle cx="20" cy="69" r="2.2" />
        </g>
        <line x1="47" y1="6" x2="47" y2="94" stroke={amber} strokeWidth="0.7" strokeDasharray="2 3" opacity="0.7" />
      </Svg>
    );
  }

  if (v === 'compare') {
    // Reference (dashed amber) sits slightly off the solid painting — the exact
    // misalignment the tool exists to reveal and fix.
    return (
      <Svg label={label}>
        <Background pal={WARM} />
        <PhotoSphere gradId={`${uid}-g`} />
        <g opacity="0.9">
          <circle cx="53" cy="37" r="27" fill="none" stroke="#f59e0b" strokeWidth="1.4" strokeDasharray="4 2.5" />
          <ellipse cx="58" cy="67" rx="30" ry="5" fill="none" stroke="#f59e0b" strokeWidth="0.8" strokeDasharray="3 2" opacity="0.6" />
        </g>
      </Svg>
    );
  }

  // 'original'
  return (
    <Svg label={label}>
      <Background pal={WARM} />
      <PhotoSphere gradId={`${uid}-g`} />
    </Svg>
  );
}

/** A preview frame: the demo visual in a rounded panel with its label. */
export function PreviewFrameCard({ frame }: { frame: PreviewFrame }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="aspect-square w-full overflow-hidden rounded-xl border border-border bg-canvas shadow-md">
        <PreviewArt {...frame} />
      </div>
      <span className="text-[11px] font-medium text-muted-foreground">{frame.label}</span>
    </div>
  );
}
