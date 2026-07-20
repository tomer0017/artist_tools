import { test, expect } from '@playwright/test';
import zlib from 'node:zlib';

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

  // Add artwork.
  const chooseButtons = page.getByRole('button', { name: 'Choose' });
  const [artChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    chooseButtons.first().click(),
  ]);
  await artChooser.setFiles(artwork);

  // Add reference.
  const [refChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Choose' }).first().click(),
  ]);
  await refChooser.setFiles(reference);

  // The comparison canvas + bottom bar should now be visible.
  await expect(page.getByRole('button', { name: 'Export' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Align' })).toBeVisible();

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
});
