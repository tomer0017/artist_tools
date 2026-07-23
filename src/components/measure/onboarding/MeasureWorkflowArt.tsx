import { useId } from 'react';

/**
 * The hero illustration for the Measure onboarding. It tells the entire
 * workflow with no words needed:
 *
 *   ① tap one end of something you know  →  ② tap the other end
 *   →  a reference line appears  →  its real size is entered ("80 cm")
 *   →  every other line on the artwork now reads a true real-world size.
 *
 * It is a single, self-contained SVG (no binary assets, crisp at any size) and
 * uses the theme's `--primary` token so it stays on-brand in the app. When
 * `animate` is on it plays as a gentle looping storyboard; the loop is disabled
 * automatically for users who prefer reduced motion.
 */
export default function MeasureWorkflowArt({
  animate = true,
  className = '',
}: {
  animate?: boolean;
  className?: string;
}) {
  // Scope the keyframes to this instance so multiple copies never collide.
  const uid = useId().replace(/[:]/g, '');
  const cls = (name: string) => `${name}-${uid}`;

  return (
    <div className={`relative overflow-hidden rounded-2xl border border-border bg-black/25 ${className}`}>
      <svg viewBox="0 0 360 264" className="block w-full" role="img"
        aria-label="Tap two points across something whose real size you know — such as the canvas width — to draw a reference line, enter its real length, and every measurement on the artwork becomes real-world accurate.">
        {animate && (
          <style>{`
            @keyframes ${cls('dotA')} { 0%,4%{r:0;opacity:0} 10%,92%{r:7;opacity:1} 100%{r:7;opacity:0} }
            @keyframes ${cls('dotB')} { 0%,20%{r:0;opacity:0} 26%,92%{r:7;opacity:1} 100%{r:7;opacity:0} }
            @keyframes ${cls('draw')} { 0%,30%{stroke-dashoffset:100} 48%,92%{stroke-dashoffset:0} 100%{stroke-dashoffset:0;opacity:0} }
            @keyframes ${cls('tag')}  { 0%,52%{opacity:0} 60%,92%{opacity:1} 100%{opacity:0} }
            @keyframes ${cls('res')}  { 0%,70%{opacity:0} 80%,92%{opacity:1} 100%{opacity:0} }
            .${cls('dotA')}{animation:${cls('dotA')} 6s ease-in-out infinite}
            .${cls('dotB')}{animation:${cls('dotB')} 6s ease-in-out infinite}
            .${cls('draw')}{stroke-dasharray:100;animation:${cls('draw')} 6s ease-in-out infinite}
            .${cls('tag')}{animation:${cls('tag')} 6s ease-in-out infinite}
            .${cls('res')}{animation:${cls('res')} 6s ease-in-out infinite}
            @media (prefers-reduced-motion: reduce){
              .${cls('dotA')},.${cls('dotB')},.${cls('draw')},.${cls('tag')},.${cls('res')}{animation:none}
              .${cls('draw')}{stroke-dashoffset:0}
            }
          `}</style>
        )}

        <defs>
          <linearGradient id={`${uid}-wall`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#3d3d40" />
            <stop offset="1" stopColor="#28282b" />
          </linearGradient>
          <linearGradient id={`${uid}-sky`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#9cbcd0" />
            <stop offset="1" stopColor="#dbe2e6" />
          </linearGradient>
          <clipPath id={`${uid}-pic`}><rect x="118" y="86" width="150" height="104" rx="2" /></clipPath>
        </defs>

        {/* Wall + soft gallery light */}
        <rect x="0" y="0" width="360" height="264" fill={`url(#${uid}-wall)`} />
        <ellipse cx="120" cy="150" rx="210" ry="170" fill="#ffffff" opacity="0.05" />

        {/* Framed painting (drop shadow, frame, picture) */}
        <rect x="112" y="82" width="164" height="118" rx="6" fill="#000000" opacity="0.38" />
        <rect x="106" y="74" width="164" height="118" rx="6" fill="#6b4626" />
        <rect x="112" y="80" width="152" height="106" rx="3" fill="#8a5c33" />
        <rect x="118" y="86" width="140" height="94" fill="#233038" />
        <g clipPath={`url(#${uid}-pic)`}>
          <rect x="118" y="86" width="140" height="58" fill={`url(#${uid}-sky)`} />
          <rect x="118" y="150" width="140" height="30" fill="#415b64" />
          {/* Mountains + snow caps */}
          <polygon points="118,152 156,104 194,152" fill="#7c8a92" />
          <polygon points="142,152 146,110 156,104 170,124 160,152" fill="#65727a" />
          <polygon points="168,152 214,92 260,152" fill="#8b98a0" />
          <polygon points="204,110 214,92 226,114 216,118 208,116" fill="#eef2f4" />
          <polygon points="149,116 156,104 165,120 157,123" fill="#eef2f4" />
          {/* Treeline + water sheen */}
          <polygon points="180,152 187,134 194,152" fill="#2f4b3a" />
          <polygon points="190,152 197,130 204,152" fill="#274332" />
          <polygon points="236,152 243,132 250,152" fill="#2f4b3a" />
          <rect x="118" y="150" width="140" height="30" fill="#000000" opacity="0.08" />
          <rect x="182" y="150" width="5" height="26" fill="#eef2f4" opacity="0.16" />
        </g>

        {/* ── The reference line: the point of the whole picture ──────────────
            Drawn across the KNOWN width of the canvas. */}
        <line className={animate ? cls('draw') : undefined} pathLength={100}
          x1="118" y1="134" x2="258" y2="134"
          stroke="hsl(var(--primary))" strokeWidth="4" strokeLinecap="round" />

        {/* Real-size tag on the reference line */}
        <g className={animate ? cls('tag') : undefined}>
          <rect x="160" y="112" width="56" height="22" rx="11" fill="hsl(var(--primary))" />
          <text x="188" y="127" textAnchor="middle" fontSize="13" fontWeight="700"
            fill="hsl(var(--primary-foreground))">80 cm</text>
        </g>

        {/* Two tap points at the ends of the reference line */}
        <g>
          <circle className={animate ? cls('dotA') : undefined} cx="118" cy="134" r={animate ? 0 : 7}
            fill="#1b1b1d" stroke="hsl(var(--primary))" strokeWidth="4" />
          <circle className={animate ? cls('dotB') : undefined} cx="258" cy="134" r={animate ? 0 : 7}
            fill="#1b1b1d" stroke="hsl(var(--primary))" strokeWidth="4" />
        </g>

        {/* ── The payoff: a second line now reads a true size automatically ── */}
        <g className={animate ? cls('res') : undefined}>
          <line x1="214" y1="92" x2="214" y2="150" stroke="hsl(var(--foreground))" strokeWidth="2.5"
            strokeLinecap="round" opacity="0.9" />
          <circle cx="214" cy="92" r="3.6" fill="hsl(var(--foreground))" />
          <circle cx="214" cy="150" r="3.6" fill="hsl(var(--foreground))" />
          <g>
            <rect x="224" y="108" width="46" height="20" rx="10" fill="hsl(var(--foreground))" />
            <text x="247" y="122" textAnchor="middle" fontSize="12" fontWeight="700"
              fill="hsl(var(--background))">33 cm</text>
          </g>
        </g>

        {/* Numbered flow captions — support the picture, never carry it */}
        <g fontSize="12.5" fontWeight="600" fill="hsl(var(--foreground))">
          <text x="16" y="40">Tap one end…</text>
          <text x="344" y="40" textAnchor="end">…then the other</text>
        </g>
        <g fill="none" stroke="hsl(var(--primary))" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M40 50 C 38 84, 66 108, 112 128" />
          <polyline points="104,120 113,130 116,117" />
          <path d="M320 50 C 322 84, 296 110, 262 128" />
          <polyline points="256,117 261,130 270,121" />
        </g>
        <text x="180" y="236" textAnchor="middle" fontSize="12.5" fontWeight="600" fill="hsl(var(--muted-foreground))">
          Enter its real size once — every line then measures true.
        </text>
      </svg>
    </div>
  );
}
