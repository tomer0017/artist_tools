import { test, expect, type Page } from '@playwright/test';
import zlib from 'node:zlib';

// Home / Tool Hub, global navigation and the UX regressions the redesign must
// not reintroduce.

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
// A two-tone image so the canvas has something to draw.
function makePng(w: number, h: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc(h * (w * 3 + 1));
  let p = 0;
  for (let y = 0; y < h; y++) {
    raw[p++] = 0;
    for (let x = 0; x < w; x++) {
      const light = x < w / 2;
      raw[p++] = light ? 220 : 60;
      raw[p++] = light ? 170 : 80;
      raw[p++] = light ? 140 : 120;
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const photo = { name: 'reference.png', mimeType: 'image/png', buffer: makePng(300, 400) };

async function upload(page: Page, buttonName: string | RegExp) {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: buttonName }).first().click(),
  ]);
  await chooser.setFiles(photo);
}

const TOOLS = [
  { card: 'Measure & Plan', nav: 'Measure', hash: '#/measure' },
  { card: 'Study & Simplify', nav: 'Study', hash: '#/study' },
  { card: 'Color & Mixing', nav: 'Color', hash: '#/color' },
  { card: 'Create a Grid', nav: 'Grid', hash: '#/grid' },
  { card: 'Compare & Correct', nav: 'Compare', hash: '#/compare' },
];

test.describe('desktop', () => {
  test('Home explains all five tools and every card opens its tool', async ({ page }) => {
    await page.goto('/artist_tools/');
    await expect(page.getByRole('heading', { name: /Your All-in-One/ })).toBeVisible();
    for (const t of TOOLS) {
      const card = page.getByRole('link', { name: new RegExp(`^${t.card}:`) });
      await expect(card).toBeVisible();
      // Each card shows an illustration, not just an icon.
      await expect(card.getByRole('img').first()).toBeVisible();
    }
    for (const t of TOOLS) {
      await page.goto('/artist_tools/');
      await page.getByRole('link', { name: new RegExp(`^${t.card}:`) }).click();
      await expect(page).toHaveURL(new RegExp(`${t.hash}$`));
      await expect(page.getByRole('heading', { name: t.card })).toBeVisible();
    }
  });

  test('top navigation switches tools directly, marks the active one, and Back works', async ({ page }) => {
    await page.goto('/artist_tools/#/grid');
    const nav = page.getByRole('navigation', { name: 'Tools' });
    await expect(nav.getByRole('link', { name: 'Grid' })).toHaveAttribute('aria-current', 'page');
    await nav.getByRole('link', { name: 'Study' }).click();
    await expect(page.getByRole('heading', { name: 'Study & Simplify' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Study' })).toHaveAttribute('aria-current', 'page');
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Create a Grid' })).toBeVisible();
    await nav.getByRole('link', { name: 'Home' }).click();
    await expect(page.getByRole('heading', { name: /Your All-in-One/ })).toBeVisible();
  });

  test('unknown tool URLs fall back to Home', async ({ page }) => {
    await page.goto('/artist_tools/#/nope');
    await expect(page.getByRole('heading', { name: /Your All-in-One/ })).toBeVisible();
  });

  test('switching tools keeps Compare and Study work in memory', async ({ page }) => {
    await page.goto('/artist_tools/#/compare');
    for (let i = 0; i < 2; i++) {
      await upload(page, 'Choose');
      await page.getByRole('button', { name: 'Confirm crop' }).click();
    }
    await page.getByRole('button', { name: /Continue to Align/ }).click();
    await page.getByRole('button', { name: /Skip to Compare/ }).click();
    await page.getByRole('button', { name: 'Reference', exact: true }).click();

    await page.goto('/artist_tools/#/study');
    await upload(page, 'Upload reference photo');
    await expect(page.getByRole('radio', { name: /Values/ })).toBeVisible();

    await page.getByRole('navigation', { name: 'Tools' }).getByRole('link', { name: 'Compare' }).click();
    // Same step, same opacity choice — nothing was thrown away.
    await expect(page.getByRole('slider', { name: 'Reference opacity' })).toHaveValue('100');

    await page.getByRole('navigation', { name: 'Tools' }).getByRole('link', { name: 'Study' }).click();
    await expect(page.getByRole('radio', { name: /Values/ })).toBeVisible();
  });
});

test.describe('mobile', () => {
  test.use({ viewport: { width: 375, height: 740 }, hasTouch: true, isMobile: true });

  test('bottom navigation shows six labelled destinations and fits the screen', async ({ page }) => {
    await page.goto('/artist_tools/');
    const nav = page.getByRole('navigation', { name: 'Tools' });
    for (const label of ['Home', 'Measure', 'Study', 'Grid', 'Compare', 'Color']) {
      await expect(nav.getByRole('link', { name: label })).toBeVisible();
    }
    await expect(nav.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    await nav.getByRole('link', { name: 'Grid' }).click();
    await expect(page.getByRole('heading', { name: 'Create a Grid' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Grid' })).toHaveAttribute('aria-current', 'page');
  });

  test('Measure: tapping the "Tap to start" coach does not create a point (regression)', async ({ page }) => {
    await page.goto('/artist_tools/#/measure');
    await upload(page, 'Upload reference photo');
    const coach = page.getByRole('button', { name: 'Tap to start' });
    await expect(coach).toBeVisible();
    await coach.tap();
    await expect(coach).toBeHidden();
    // Still waiting for the FIRST point: no point was dropped under the coach.
    await expect(page.getByText('Set your painting scale')).toBeVisible();
    await expect(page.getByText('Now tap the second point.')).toHaveCount(0);

    // Point selection is armed: two taps on the image make the scale line.
    const canvas = page.locator('img[alt="Reference"]');
    const box = (await canvas.boundingBox())!;
    await page.touchscreen.tap(box.x + box.width * 0.5, box.y + box.height * 0.2);
    await expect(page.getByText('Now tap the second point.')).toBeVisible();
    await page.touchscreen.tap(box.x + box.width * 0.5, box.y + box.height * 0.7);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByPlaceholder('e.g. 50').fill('150');
    await page.getByRole('button', { name: 'Set', exact: true }).click();

    // Step 2: the scale stays visible and changing it is one tap away.
    await expect(page.getByText('Scale 150 cm')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Change scale' })).toBeVisible();
  });

  test('the bottom navigation never covers a tool\'s primary action', async ({ page }) => {
    await page.goto('/artist_tools/#/grid');
    await upload(page, 'Upload reference photo');
    const save = page.getByRole('button', { name: 'Save grid image' });
    const nav = page.getByRole('navigation', { name: 'Tools' });
    const s = (await save.boundingBox())!;
    const n = (await nav.boundingBox())!;
    expect(s.y + s.height).toBeLessThanOrEqual(n.y + 0.5);
  });
});
