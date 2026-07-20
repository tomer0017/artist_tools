import { test, expect } from '@playwright/test';
import zlib from 'node:zlib';

const SHOTS =
  '/private/tmp/claude-501/-Users-tomercohen-Downloads-Art-Studio-Companion/79b68966-60c8-421f-9325-8bccc54a0a49/scratchpad';

// ── Minimal PNG encoder (avoids a fixture dependency) ────────────────────────
function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function makePng(w: number, h: number, rgb: [number, number, number]): Buffer {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  const raw = Buffer.alloc(h * (w * 3 + 1));
  let p = 0;
  for (let y = 0; y < h; y++) {
    raw[p++] = 0; // filter none
    for (let x = 0; x < w; x++) {
      raw[p++] = rgb[0];
      raw[p++] = rgb[1];
      raw[p++] = rgb[2];
    }
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const artwork = { name: 'artwork.png', mimeType: 'image/png', buffer: makePng(200, 160, [200, 120, 90]) };
const reference = { name: 'reference.png', mimeType: 'image/png', buffer: makePng(200, 160, [90, 120, 200]) };

test('Compare Art: full workflow incl. GIF export', async ({ page }) => {
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  page.on('console', (m) => console.log('CONSOLE.' + m.type() + ':', m.text()));
  await page.goto('/artist_tools/');

  // Existing workspaces still present.
  await expect(page.getByRole('button', { name: 'Measure' })).toBeVisible();

  // Open Compare workspace.
  await page.getByRole('button', { name: 'Compare' }).click();
  await expect(page.getByText('Compare proportions, values, and colors')).toBeVisible();

  // Add artwork → the crop screen opens first; confirm it.
  const [artChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Choose' }).first().click(),
  ]);
  await artChooser.setFiles(artwork);
  await expect(page.getByRole('button', { name: 'Confirm crop' })).toBeEnabled();
  await page.screenshot({ path: `${SHOTS}/01-crop-screen.png` });
  // Exercise a crop preset (Square) before confirming.
  await page.getByRole('button', { name: 'Square', exact: true }).click();
  await page.screenshot({ path: `${SHOTS}/02-crop-square.png` });
  await page.getByRole('button', { name: 'Confirm crop' }).click();

  // Add reference → crop screen again; confirm.
  const [refChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Choose' }).first().click(),
  ]);
  await refChooser.setFiles(reference);
  await expect(page.getByRole('button', { name: 'Confirm crop' })).toBeEnabled();
  await page.getByRole('button', { name: 'Confirm crop' }).click();

  // The comparison canvas + bottom bar should now be visible.
  await expect(page.getByRole('button', { name: 'Export' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Align' })).toBeVisible();

  // Task 3: Overlay mode shows an always-visible opacity slider + one-tap GIF.
  await expect(page.getByRole('slider', { name: 'Reference opacity' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/03-overlay-quickbar.png` });
  const [quickGif] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    page.getByRole('button', { name: 'Create Opacity GIF' }).click(),
  ]);
  {
    const stream = await quickGif.createReadStream();
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c as Buffer);
    const bytes = Buffer.concat(chunks);
    expect(bytes.subarray(0, 3).toString('ascii')).toBe('GIF');
    expect(bytes.length).toBeGreaterThan(100);
  }

  // Task 2: 2-point align opens a guided prompt (magnifier interaction).
  await page.getByRole('button', { name: 'Align' }).click();
  await page.getByRole('button', { name: '2-point align' }).click();
  await expect(page.getByText('Tap point A on your ARTWORK')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/04-two-point-align.png` });
  await page.getByRole('button', { name: 'Cancel alignment' }).click();

  // Switch modes.
  await page.getByRole('button', { name: 'Mode' }).click();
  await page.getByRole('button', { name: 'Difference' }).click();
  await page.getByRole('button', { name: 'Close' }).click();

  // Nudge the reference (precision) — proves alignment controls work.
  await page.getByRole('button', { name: 'Align' }).click();
  await page.getByRole('button', { name: 'Move right' }).click();
  await page.getByRole('button', { name: 'Move right' }).click();
  await page.getByRole('button', { name: 'Close' }).click();

  // Export a still comparison (download).
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Comparison', exact: true })).toBeVisible();
  const stillPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Comparison', exact: true }).click();
  const stillDownload = await stillPromise;
  expect(stillDownload.suggestedFilename()).toContain('compare-comparison');

  // Export an animated GIF — the headline deliverable.
  const [gifDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    page.getByRole('button', { name: 'Export GIF' }).click(),
  ]);
  const filename = gifDownload.suggestedFilename();
  expect(filename).toContain('.gif');
  const stream = await gifDownload.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  const gifBytes = Buffer.concat(chunks);
  // Valid GIF header + non-trivial size.
  expect(gifBytes.subarray(0, 3).toString('ascii')).toBe('GIF');
  expect(gifBytes.length).toBeGreaterThan(100);

  // Mobile-viewport evidence of the difference view + bottom bar.
  await page.getByRole('button', { name: 'Close' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${SHOTS}/05-mobile-difference.png` });
});
