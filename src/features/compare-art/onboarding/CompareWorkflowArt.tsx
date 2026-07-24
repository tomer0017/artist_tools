import { useId } from 'react';

/**
 * Animated, wordless storyboards for the two Compare Art workflows. Each scene
 * loops gently and is disabled under prefers-reduced-motion. Pure inline SVG on
 * theme tokens — no assets, crisp at any size.
 *
 *  • 'overlay' — Workflow A: the painting sits over the reference, its opacity
 *    fades so differences show through, then the two blink (why a GIF exists).
 *  • 'align'   — Workflow B: tap matching points on each image and they snap
 *    into alignment automatically (why Smart Align exists).
 */
export default function CompareWorkflowArt({
  scene,
  className = '',
}: {
  scene: 'overlay' | 'align';
  className?: string;
}) {
  const raw = useId().replace(/[:]/g, '');
  const u = (n: string) => `${n}-${raw}`;

  // A tiny portrait so "the same subject, slightly off" reads instantly.
  const face = (cx: number, cy: number, tint: string, off = 0) => (
    <g stroke={tint} strokeWidth="2.4" fill="none" strokeLinecap="round">
      <circle cx={cx + off} cy={cy - 6} r="7" />
      <path d={`M${cx - 10 + off} ${cy + 14} Q${cx + off} ${cy + 4} ${cx + 10 + off} ${cy + 14}`} />
    </g>
  );

  if (scene === 'overlay') {
    return (
      <div className={`overflow-hidden rounded-xl border border-border bg-black/25 ${className}`}>
        <svg viewBox="0 0 220 130" className="block w-full" role="img"
          aria-label="Your painting sits over the reference; fading its opacity reveals where they differ, and blinking between them makes mistakes obvious — the reason to export a GIF.">
          <style>{`
            @keyframes ${u('fade')} { 0%,15%{opacity:.9} 45%{opacity:.25} 70%,100%{opacity:.9} }
            @keyframes ${u('spot')} { 0%,45%{opacity:0} 55%,80%{opacity:1} 100%{opacity:0} }
            @keyframes ${u('blinkA')} { 0%,49%{opacity:1} 50%,100%{opacity:0} }
            .${u('paint')}{animation:${u('fade')} 5s ease-in-out infinite}
            .${u('spot')}{animation:${u('spot')} 5s ease-in-out infinite}
            @media (prefers-reduced-motion: reduce){ .${u('paint')},.${u('spot')}{animation:none} .${u('paint')}{opacity:.5} }
          `}</style>

          {/* Reference frame (blue) */}
          <rect x="16" y="20" width="120" height="90" rx="8" fill="#1f2937" stroke="#3b82f6" strokeWidth="2" />
          {face(76, 60, '#8fb4e6')}
          <text x="16" y="14" fontSize="9" fontWeight="700" fill="#8fb4e6">Reference</text>

          {/* Painting overlaid, slightly offset, opacity fading (amber) */}
          <g className={u('paint')}>
            <rect x="24" y="24" width="120" height="90" rx="8" fill="#2a2420" stroke="hsl(var(--primary))" strokeWidth="2" />
            {face(84, 64, 'hsl(var(--primary))', 0)}
          </g>

          {/* The difference, revealed when faded */}
          <g className={u('spot')}>
            <circle cx="92" cy="58" r="13" fill="none" stroke="hsl(var(--primary))" strokeWidth="2" strokeDasharray="3 3" />
          </g>

          {/* Opacity slider hint */}
          <g transform="translate(16,120)">
            <rect x="0" y="-3" width="120" height="4" rx="2" fill="#3f3f46" />
            <circle className={u('paint')} cx="60" cy="-1" r="5" fill="hsl(var(--primary))" />
          </g>

          {/* GIF blink chip (right) */}
          <g transform="translate(158,34)">
            <rect x="0" y="0" width="46" height="62" rx="8" fill="#18181b" stroke="#3f3f46" />
            <g transform="translate(23,26)">
              <rect className={u('blinkA')} x="-14" y="-14" width="28" height="28" rx="4" fill="#3b82f6" style={{ animation: `${u('blinkA')} 1s steps(1) infinite` }} />
              <rect x="-14" y="-14" width="28" height="28" rx="4" fill="none" stroke="#52525b" />
              <text x="0" y="30" textAnchor="middle" fontSize="8.5" fontWeight="700" fill="hsl(var(--foreground))">GIF</text>
            </g>
          </g>
        </svg>
      </div>
    );
  }

  // scene === 'align'
  return (
    <div className={`overflow-hidden rounded-xl border border-border bg-black/25 ${className}`}>
      <svg viewBox="0 0 220 130" className="block w-full" role="img"
        aria-label="Tap the same two matching points on your painting and on the reference; the images then align automatically.">
        <style>{`
          @keyframes ${u('t1')} { 0%,6%{opacity:0;r:0} 12%,26%{opacity:1;r:7} 34%,100%{opacity:1;r:4} }
          @keyframes ${u('t2')} { 0%,30%{opacity:0;r:0} 36%,50%{opacity:1;r:7} 58%,100%{opacity:1;r:4} }
          @keyframes ${u('snap')} { 0%,62%{transform:translate(0,0) rotate(0deg);opacity:.95} 78%,100%{transform:translate(74px,0) rotate(0deg);opacity:.5} }
          @keyframes ${u('done')} { 0%,74%{opacity:0} 84%,100%{opacity:1} }
          .${u('t1')}{animation:${u('t1')} 6s ease-in-out infinite}
          .${u('t2')}{animation:${u('t2')} 6s ease-in-out infinite}
          .${u('snap')}{animation:${u('snap')} 6s ease-in-out infinite;transform-box:fill-box}
          .${u('done')}{animation:${u('done')} 6s ease-in-out infinite}
          @media (prefers-reduced-motion: reduce){
            .${u('t1')},.${u('t2')},.${u('done')}{animation:none;opacity:1}
            .${u('snap')}{animation:none;transform:none;opacity:.6}
          }
        `}</style>

        {/* Painting (left) with two tap points */}
        <text x="14" y="14" fontSize="9" fontWeight="700" fill="hsl(var(--primary))">Painting</text>
        <g className={u('snap')}>
          <rect x="14" y="20" width="88" height="92" rx="8" fill="#2a2420" stroke="hsl(var(--primary))" strokeWidth="2" />
          {face(58, 60, 'hsl(var(--primary))')}
          <circle className={u('t1')} cx="52" cy="52" r="0" fill="#fff" stroke="hsl(var(--primary))" strokeWidth="2.5" />
          <circle className={u('t2')} cx="66" cy="52" r="0" fill="#fff" stroke="hsl(var(--primary))" strokeWidth="2.5" />
        </g>

        {/* Reference (right) with the matching points */}
        <text x="206" y="14" textAnchor="end" fontSize="9" fontWeight="700" fill="#8fb4e6">Reference</text>
        <rect x="118" y="20" width="88" height="92" rx="8" fill="#1f2937" stroke="#3b82f6" strokeWidth="2" />
        {face(162, 60, '#8fb4e6')}
        <circle className={u('t1')} cx="156" cy="52" r="0" fill="#fff" stroke="#3b82f6" strokeWidth="2.5" />
        <circle className={u('t2')} cx="170" cy="52" r="0" fill="#fff" stroke="#3b82f6" strokeWidth="2.5" />

        {/* Aligned confirmation */}
        <g className={u('done')}>
          <circle cx="162" cy="66" r="16" fill="hsl(var(--primary))" opacity="0.15" />
          <path d="M155 66 l5 5 l9 -11" fill="none" stroke="hsl(var(--primary))" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </svg>
    </div>
  );
}
