// A QR code drawn as SVG from its module rows ("0101…"), with the quiet zone
// scanners need. Dark on white whatever the theme, so phones can read it.

export function QrCode({ rows, label, size = 192 }: { rows: string[]; label: string; size?: number }) {
  const n = rows.length;
  const quiet = 4;
  const path = rows
    .flatMap((row, y) => [...row].map((cell, x) => (cell === '1' ? `M${x + quiet} ${y + quiet}h1v1h-1z` : '')))
    .join('');
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${n + 2 * quiet} ${n + 2 * quiet}`} width={size} height={size} shapeRendering="crispEdges" className="rounded-lg">
      <rect width="100%" height="100%" fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}
