// `next build` writes a self-contained server to .next/standalone but leaves out
// the static files (they are meant for a CDN). Copy them in, so the standalone
// server — exactly what is deployed — can serve the whole site on its own.
import { cpSync, rmSync } from 'node:fs';

const OUT = '.next/standalone';

for (const [from, to] of [
  ['public', `${OUT}/public`],
  ['.next/static', `${OUT}/.next/static`],
]) {
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
}
