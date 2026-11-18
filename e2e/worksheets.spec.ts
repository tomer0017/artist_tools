import { writeFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Download, type Locator, type Page } from '@playwright/test';
import { makePng, photo } from './fixtures/photo';

// Prepare Worksheets (Learn plan M3) in real browsers: practice sheets from
// one photo, saved as PNG images, read back from the downloaded files:
// - every sheet has Create a Grid's image size and the photo in one place:
//   the grid sheet is Create a Grid's saved image byte for byte, the original
//   shows the photo exactly where it does, the outline's line runs along the
//   photo's edge, the values sheet holds only the study's grays;
// - the server is asked first (both tools whose work the sheets are, then
//   Worksheets and Saved images) and no answer makes nothing;
// - in no plan until the owner publishes it: admins only (this server's
//   admin), Free and Pro see nothing and are refused;
// - from Create a Grid and from Study & Simplify, in English and Hebrew, on a
//   phone (Chromium phone emulation, and WebKit iPhone 13), WCAG A/AA (axe),
//   five photos in a row.

const ADMIN = 'e2e/.auth/admin.json';
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const PROJECT_KEY = 'painter-studio-project';
const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
type File = { name: string; mimeType: string; buffer: Buffer };

async function upload(page: Page, name = 'Upload reference photo', file: File = photo) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name }).first().click()]);
  await chooser.setFiles(file);
}
const stored = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), PROJECT_KEY);

async function read(download: Download) {
  const chunks: Buffer[] = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk as Buffer);
  const bytes = Buffer.concat(chunks);
  // Kept with the test's results, to look at.
  writeFileSync(test.info().outputPath(download.suggestedFilename()), bytes);
  return { name: download.suggestedFilename(), bytes };
}

/** The files one click downloads, in the order they came. */
async function downloads(page: Page, count: number, click: () => Promise<void>) {
  const seen: Download[] = [];
  const listener = (d: Download) => void seen.push(d);
  page.on('download', listener);
  await click();
  await expect.poll(() => seen.length, { timeout: 30_000 }).toBe(count);
  page.off('download', listener);
  return Promise.all(seen.map(read));
}

function pngSize(bytes: Buffer) {
  expect(bytes.subarray(1, 4).toString()).toBe('PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** RGB of a PNG at some points, decoded by the browser. */
function samples(page: Page, png: Buffer, points: [number, number][]): Promise<number[][]> {
  return page.evaluate(
    async ({ b64, points }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
      return points.map(([x, y]) => Array.from(data.slice((y * bitmap.width + x) * 4, (y * bitmap.width + x) * 4 + 3)));
    },
    { b64: png.toString('base64'), points },
  );
}

/** Save through Create a Grid's own save sheet (on a computer, "Save Image" downloads). */
async function saveGridImage(page: Page) {
  await page.getByRole('button', { name: 'Save grid image' }).first().click();
  await expect(page.getByAltText('Image preview')).toBeVisible();
  const [file] = await downloads(page, 1, () => page.getByRole('button', { name: 'Save Image' }).click());
  // On a computer the save sheet closes itself once the file is saved.
  await expect(page.getByAltText('Image preview')).toHaveCount(0);
  return file;
}

async function openWorksheets(page: Page, button = 'Prepare worksheets', title = button) {
  await page.getByRole('button', { name: button, exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: title });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** What the studio asks the server, and its answers, while `run` goes on. */
async function usage(page: Page, run: () => Promise<void>) {
  const asked: unknown[] = [];
  const answers: number[] = [];
  const onRequest = (r: import('@playwright/test').Request) => {
    if (r.url().endsWith('/api/usage') && r.method() === 'POST') asked.push(r.postDataJSON());
  };
  const onResponse = (r: import('@playwright/test').Response) => {
    if (r.url().endsWith('/api/usage') && r.request().method() === 'POST') answers.push(r.status());
  };
  page.on('request', onRequest);
  page.on('response', onResponse);
  await run();
  page.off('request', onRequest);
  page.off('response', onResponse);
  return { asked, answers };
}

async function makeSet(dialog: Locator, count: number, ready = `Sheets ready: ${count}`, make = `Make sheets (${count})`) {
  await dialog.getByRole('button', { name: make }).click();
  await expect(dialog.getByText(ready)).toBeVisible({ timeout: 60_000 });
}

/** The test photo's light half, dark half, a dark canvas, white paper, or unclear. */
function tone([r, g, b]: number[]) {
  if (r > 245 && g > 245 && b > 245) return 'paper';
  if (r > 180 && g > 130) return 'light';
  if (r < 100 && b > 95 && b > r + 30) return 'dark';
  if (r < 70 && g < 70 && b < 70 && Math.abs(r - b) < 15) return 'canvas';
  return null;
}

// 50×70 cm (2400 × 3360 px), the photo turned right: 400 × 300, so 2400 × 1800 px from y 780 to 2580,
// its light half on top. Points in the middle of each eighth, away from the 4×4 grid's lines.
const EIGHTHS = Array.from({ length: 64 }, (_, k): [number, number] => [Math.floor((((k % 8) + 0.5) / 8) * 2400), Math.floor(((Math.floor(k / 8) + 0.5) / 8) * 3360)]);
const inPhoto = ([, y]: [number, number]) => y > 790 && y < 2570;

test.describe('Prepare Worksheets', () => {
  test.use({ storageState: ADMIN });

  test('from Create a Grid: asked first, then the sheets, all the size of the grid image, the photo in one place on each', async ({ page }) => {
    await page.goto('/app/grid');
    await upload(page);
    await page.getByRole('button', { name: 'Rotate right 90°' }).click();
    await expect.poll(() => stored(page).then((p) => p?.gridSettings?.rotation)).toBe(90);
    const gridImage = await saveGridImage(page);

    const dialog = await openWorksheets(page);
    const { asked, answers } = await usage(page, () => makeSet(dialog, 4));
    // The other tool whose work the sheets are (Study & Simplify: outline, values), checked alone, then this tool with what is saved.
    expect(asked).toEqual([{ tool: 'tool.study', features: [] }, { tool: 'tool.grid', features: ['export.worksheets', 'export.image'] }]);
    expect(answers).toEqual([200, 200]);
    await expect(dialog.getByRole('img')).toHaveCount(4);

    const files = await downloads(page, 4, () => dialog.getByRole('button', { name: 'Save all' }).click());
    expect(files.map((f) => f.name)).toEqual([
      'worksheet-1-original-50x70cm.png',
      'worksheet-2-outline-50x70cm.png',
      'worksheet-3-grid-4x4-50x70cm.png',
      'worksheet-4-values-5-50x70cm.png',
    ]);
    for (const f of files) expect(pngSize(f.bytes)).toEqual({ width: 2400, height: 3360 });
    const [original, outline, grid, values] = files;

    // The reference with its grid is Create a Grid's saved image, byte for byte.
    expect(grid.bytes.equals(gridImage.bytes)).toBe(true);

    // The original: the photo exactly where the grid image has it (the same tone at every point
    // inside it); around it, white paper where the grid image shows its dark canvas.
    const [onGrid, onOriginal] = [await samples(page, grid.bytes, EIGHTHS), await samples(page, original.bytes, EIGHTHS)];
    EIGHTHS.forEach((point, i) => {
      if (inPhoto(point)) expect([point, tone(onOriginal[i])]).toEqual([point, tone(onGrid[i])]);
      else expect([point, tone(onGrid[i]), tone(onOriginal[i])]).toEqual([point, 'canvas', 'paper']);
    });
    expect(new Set(EIGHTHS.filter(inPhoto).map((_, i) => tone(onOriginal[EIGHTHS.indexOf(EIGHTHS.filter(inPhoto)[i])])))).toEqual(new Set(['light', 'dark']));

    // The outline: dark lines only along the photo's edge between its light and dark halves (y 1680), white paper elsewhere.
    const column = Array.from({ length: 3360 }, (_, y): [number, number] => [900, y]);
    const lines = (await samples(page, outline.bytes, column)).map(([r], y) => [y, r] as const).filter(([, r]) => r < 128).map(([y]) => y);
    expect(lines.length).toBeGreaterThan(0);
    for (const y of lines) expect(Math.abs(y - 1680)).toBeLessThanOrEqual(24);

    // The values: only the study's five grays on the photo (light half 178, dark half 76), white paper around it.
    const grays = [26, 76, 128, 178, 230];
    const onValues = await samples(page, values.bytes, EIGHTHS);
    EIGHTHS.forEach((point, i) => {
      const [r, g, b] = onValues[i];
      expect([r, g]).toEqual([b, b]);
      if (!inPhoto(point)) expect(r).toBe(255);
      else expect(grays.some((v) => Math.abs(v - r) <= 1)).toBe(true);
    });
    expect(onValues[EIGHTHS.findIndex(([x, y]) => x === 450 && y === 1470)][0]).toBe(178);
    expect(onValues[EIGHTHS.findIndex(([x, y]) => x === 450 && y === 1890)][0]).toBe(76);
  });

  test('from Study & Simplify: its photo fitted to Create a Grid’s canvas, the blank grid and 3 values chosen', async ({ page }) => {
    await page.goto('/app/study');
    await upload(page);
    const dialog = await openWorksheets(page);
    await expect(dialog).toContainText('The canvas and grid come from Create a Grid. The photo is fitted to the canvas.');
    await dialog.getByRole('checkbox', { name: /^Outline/ }).uncheck();
    await dialog.getByRole('checkbox', { name: /^Blank grid/ }).check();
    await dialog.getByText('3 values').click();
    const { asked, answers } = await usage(page, () => makeSet(dialog, 4));
    expect(asked).toEqual([{ tool: 'tool.grid', features: [] }, { tool: 'tool.study', features: ['export.worksheets', 'export.image'] }]);
    expect(answers).toEqual([200, 200]);
    const files = await downloads(page, 4, () => dialog.getByRole('button', { name: 'Save all' }).click());
    expect(files.map((f) => f.name)).toEqual([
      'worksheet-1-original-50x70cm.png',
      'worksheet-2-grid-4x4-50x70cm.png',
      'worksheet-3-grid-blank-4x4-50x70cm.png',
      'worksheet-4-values-3-50x70cm.png',
    ]);
    // Fitted, unturned: 2400 × 3200 px from y 80. The values in three grays: the light half in the
    // lightest (212), the dark half in the darkest (42).
    const onValues = await samples(page, files[3].bytes, [[600, 1680], [1800, 1680], [1200, 40], [1200, 3330]]);
    expect(onValues.map(([r]) => r)).toEqual([212, 42, 255, 255]);
    // The blank grid: black lines at the quarters on white.
    const onBlank = await samples(page, files[2].bytes, [[600, 300], [300, 300]]);
    expect(onBlank[0][0]).toBeLessThan(170);
    expect(onBlank[1]).toEqual([255, 255, 255]);
    // The choices are remembered on this device; the photo is not.
    const remembered = await page.evaluate(() => localStorage.getItem('studio-worksheet-choices'));
    expect(JSON.parse(remembered!)).toEqual({ sheets: ['original', 'grid', 'blank', 'values'], levels: 3 });
  });

  test('the server is asked first: with no answer, or an error, nothing is made; when it answers, the sheets are', async ({ page }) => {
    await page.goto('/app/grid');
    await upload(page);
    const dialog = await openWorksheets(page);
    const refused = page.getByRole('alertdialog');
    for (const answer of ['abort', 500] as const) {
      await page.route('**/api/usage', (route) => (answer === 'abort' ? route.abort() : route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })));
      await dialog.getByRole('button', { name: 'Make sheets (4)' }).click();
      await expect(refused).toContainText('Your plan could not be checked');
      await refused.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(dialog.getByText('Sheets ready: 4')).toHaveCount(0);
      await expect(dialog.getByRole('img')).toHaveCount(0);
      await page.unroute('**/api/usage');
    }
    await makeSet(dialog, 4);
  });

  test('with every choice open, and with the sheets made: no detectable WCAG A/AA problems', async ({ page }) => {
    await page.goto('/app/grid');
    await upload(page);
    const dialog = await openWorksheets(page);
    const scan = async () => (await new AxeBuilder({ page }).include('[role="dialog"]').withTags(WCAG).analyze()).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
    expect(await scan()).toEqual([]);
    await makeSet(dialog, 4);
    expect(await scan()).toEqual([]);
  });

  test('five photos in a row, as a teacher prepares one set per student: each set from its own photo, nothing left from the one before', async ({ page }) => {
    await page.goto('/app/grid');
    await upload(page);
    const sizes: [number, number][] = [[300, 400], [400, 300], [500, 500], [240, 480], [480, 200]];
    for (const [i, [w, h]] of sizes.entries()) {
      if (i > 0) await upload(page, 'Replace image', { name: `student-${i}.png`, mimeType: 'image/png', buffer: makePng(w, h) });
      await expect.poll(() => stored(page).then((p) => p?.gridImage?.length ?? 0)).toBeGreaterThan(0);
      const dialog = await openWorksheets(page);
      for (const name of ['Outline', 'Reference with grid', 'Values']) await dialog.getByRole('checkbox', { name: new RegExp(`^${name}`) }).uncheck();
      await makeSet(dialog, 1);
      const [original] = await downloads(page, 1, () => dialog.getByRole('button', { name: 'Save all' }).click());
      expect(pngSize(original.bytes)).toEqual({ width: 2400, height: 3360 });
      // Fitted to 2400 × 3360: the photo's top edge, white paper just above it, its light left half just below.
      const scale = Math.min(2400 / w, 3360 / h);
      const top = Math.round((3360 - h * scale) / 2);
      const left = Math.round((2400 - w * scale) / 2);
      const [above, below] = await samples(page, original.bytes, [[left + 20, Math.max(0, top - 6)], [left + 20, top + 6]]);
      if (top > 6) expect(tone(above)).toBe('paper');
      expect(tone(below)).toBe('light');
      await dialog.getByRole('button', { name: 'Close' }).click();
      await expect(dialog).toHaveCount(0);
    }
  });
});

test.describe('Prepare Worksheets in Hebrew', () => {
  test.use({ storageState: ADMIN, locale: 'he-IL' });

  test('the sheets and buttons are in Hebrew; the files keep their names', async ({ page }) => {
    await page.goto('/app/grid');
    await upload(page, 'להעלות תמונת ייחוס');
    const dialog = await openWorksheets(page, 'הכנת דפי תרגול');
    await expect(dialog.getByRole('checkbox', { name: /^תמונת ייחוס עם רשת/ })).toBeChecked();
    await expect(dialog).toContainText('הבד, הרשת והמסגור לקוחים מיצירת רשת.');
    await makeSet(dialog, 4, 'דפים מוכנים: 4', 'הכנת הדפים (4)');
    const files = await downloads(page, 4, () => dialog.getByRole('button', { name: 'שמירת הכול' }).click());
    expect(files.map((f) => f.name)).toEqual(['worksheet-1-original-50x70cm.png', 'worksheet-2-outline-50x70cm.png', 'worksheet-3-grid-4x4-50x70cm.png', 'worksheet-4-values-5-50x70cm.png']);
    expect((await new AxeBuilder({ page }).include('[role="dialog"]').withTags(WCAG).analyze()).violations.map((v) => v.id)).toEqual([]);
  });
});

test.describe('Prepare Worksheets on a phone', () => {
  test.use({ ...phone, storageState: ADMIN });

  test('mobile: Worksheets sits with the saves above the navigation; its sheet fits the screen; the set is made and saved', async ({ page }) => {
    await page.goto('/app/grid');
    await upload(page);
    const nav = (await page.getByRole('navigation', { name: 'Tools' }).boundingBox())!;
    const button = page.getByRole('button', { name: 'Prepare worksheets', exact: true });
    await expect(button).toHaveText('Worksheets');
    const box = (await button.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(nav.y + 0.5);
    expect(box.height).toBeGreaterThanOrEqual(40);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

    const dialog = await openWorksheets(page);
    const fits = async () => {
      const b = (await dialog.boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(page.viewportSize()!.width + 0.5);
      expect(b.y + b.height).toBeLessThanOrEqual(page.viewportSize()!.height + 0.5);
    };
    await fits();
    await expect(dialog.getByRole('button', { name: 'Make sheets (4)' })).toBeInViewport();
    await makeSet(dialog, 4);
    await fits();
    // Where files can be shared, one share sheet comes first; the files can be saved too.
    const shares = await dialog.getByRole('button', { name: 'Share or save all' }).isVisible();
    if (shares) await expect(dialog).toContainText('In the next screen, choose Save Images, Save to Files or Print.');
    const files = await downloads(page, 4, () => dialog.getByRole('button', { name: shares ? 'Save files' : 'Save all' }).click());
    for (const f of files) expect(pngSize(f.bytes)).toEqual({ width: 2400, height: 3360 });
  });

  test('mobile: in Study & Simplify, Prepare worksheets is in the Adjust sheet, and opens over it', async ({ page }) => {
    await page.goto('/app/study');
    await upload(page);
    await page.getByRole('button', { name: 'Adjust' }).click();
    await page.getByRole('button', { name: 'Prepare worksheets', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Prepare worksheets' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Make sheets (4)' })).toBeInViewport();
  });
});

test.describe('Prepare Worksheets, not in the plan', () => {
  test('Free and Pro before a plan offers worksheets: no button in either tool, not on the plans page, and the server refuses a set', async ({ browser }) => {
    for (const name of ['user', 'pro']) {
      const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, storageState: `e2e/.auth/${name}.json` });
      const page = await context.newPage();
      for (const path of ['/app/grid', '/app/study']) {
        await page.goto(path);
        await upload(page);
        await expect(page.getByRole('button', { name: /^(Save grid image|Save study)$/ }).first()).toBeVisible();
        await expect(page.getByRole('button', { name: /worksheets/i })).toHaveCount(0);
      }
      for (const tool of ['tool.grid', 'tool.study']) {
        const response = await page.request.post('/api/usage', { data: { tool, features: ['export.worksheets', 'export.image'] } });
        expect(response.status()).toBe(403);
        expect((await response.json()).features).toEqual(['export.worksheets']);
      }
      await page.goto('/app/plans');
      await expect(page.getByRole('row', { name: /Create a Grid/ })).toBeVisible();
      await expect(page.getByRole('row', { name: /Worksheets/ })).toHaveCount(0);
      await context.close();
    }
  });
});
