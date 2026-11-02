import { test, expect } from '@playwright/test';
import zlib from 'node:zlib';

// Evidence screenshots land in this test's own output folder.
const shot = (name: string) => test.info().outputPath(name);

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

test('Compare Art: Images → Align → Compare → Save, incl. GIF and still export', async ({ page }) => {
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  await page.goto('/artist_tools/#/compare');

  // Step 1 — Images. Two clearly-labelled slots; Continue waits for both.
  await expect(page.getByRole('heading', { name: 'Compare & Correct' })).toBeVisible();
  await expect(page.getByText('Your Artwork')).toBeVisible();
  const cont = page.getByRole('button', { name: /Continue to Align/ });
  await expect(cont).toBeDisabled();

  // Add artwork → the crop screen opens first; exercise a preset, confirm.
  const [artChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Choose' }).first().click(),
  ]);
  await artChooser.setFiles(artwork);
  await expect(page.getByRole('button', { name: 'Confirm crop' })).toBeEnabled();
  await page.getByRole('button', { name: 'Square', exact: true }).click();
  await page.screenshot({ path: shot('01-crop-square.png') });
  await page.getByRole('button', { name: 'Confirm crop' }).click();

  // Add reference → crop → confirm.
  const [refChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Choose' }).first().click(),
  ]);
  await refChooser.setFiles(reference);
  await page.getByRole('button', { name: 'Confirm crop' }).click();

  await expect(cont).toBeEnabled();
  await cont.click();

  // Step 2 — Align: Smart Align recommended, Manual as the alternative.
  await expect(page.getByText('Align the images')).toBeVisible();
  await page.getByRole('button', { name: /Smart Align/ }).click();
  await expect(page.getByText('Smart Align · point 1 of 4')).toBeVisible();
  await page.screenshot({ path: shot('02-smart-align.png') });
  await page.getByRole('button', { name: 'Cancel alignment' }).click();

  // Manual: nudge precisely, then Done moves on to Compare.
  await page.getByRole('button', { name: /Manual Align/ }).click();
  await page.getByRole('button', { name: 'Move right' }).click();
  await page.getByRole('button', { name: 'Move right' }).click();
  await page.getByRole('button', { name: 'Done' }).click();

  // Step 3 — Compare: Artwork / 50-50 / Reference, opacity, grid, more views.
  const slider = page.getByRole('slider', { name: 'Reference opacity' });
  await expect(slider).toBeVisible();
  await page.getByRole('button', { name: 'Reference', exact: true }).click();
  await expect(slider).toHaveValue('100');
  await page.getByRole('button', { name: 'Artwork', exact: true }).click();
  await expect(slider).toHaveValue('0');
  await page.getByRole('button', { name: '50 / 50' }).click();
  await expect(slider).toHaveValue('50');
  await page.getByRole('switch', { name: /Grid/ }).click();
  await expect(page.getByRole('switch', { name: /Grid 3×3/ })).toHaveAttribute('aria-checked', 'true');
  await page.screenshot({ path: shot('03-compare.png') });

  // Advanced views are preserved behind "More views".
  await page.getByRole('button', { name: 'More views' }).click();
  await page.getByRole('button', { name: 'Difference' }).click();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByText(/bright areas differ most/)).toBeVisible();
  await page.getByRole('button', { name: '50 / 50' }).click();

  // Step 4 — Save: one-tap comparison GIF is the primary action.
  await page.getByRole('button', { name: /Next: Save/ }).click();
  await page.getByRole('button', { name: 'Create & Save GIF' }).click();
  await expect(page.getByRole('button', { name: 'Save GIF', exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByAltText('GIF preview')).toBeVisible();
  const [quickGif] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Save GIF', exact: true }).click(),
  ]);
  {
    const stream = await quickGif.createReadStream();
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c as Buffer);
    const bytes = Buffer.concat(chunks);
    expect(bytes.subarray(0, 3).toString('ascii')).toBe('GIF');
    expect(bytes.length).toBeGreaterThan(100);
  }

  // Still export + the full export options remain available.
  await page.getByRole('button', { name: /Save still image/ }).click();
  await page.getByRole('button', { name: 'Save comparison' }).click();
  await expect(page.getByRole('button', { name: 'Save Image', exact: true })).toBeVisible({ timeout: 15_000 });
  const stillPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save Image', exact: true }).click();
  expect((await stillPromise).suggestedFilename()).toContain('compare-comparison');

  await page.getByRole('button', { name: 'Create GIF', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save GIF', exact: true })).toBeVisible({ timeout: 30_000 });
  const [gifDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Save GIF', exact: true }).click(),
  ]);
  expect(gifDownload.suggestedFilename()).toContain('.gif');

  // The stepper lets the painter go back to any earlier step.
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: /Align/ }).first().click();
  await expect(page.getByText('Align the images')).toBeVisible();
});
