import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { photo } from './fixtures/photo';

// Create a Grid in real browsers (M1 of the Learn plan):
// - rotation turns the image on the grid, never the photo itself, and the
//   saved image is turned;
// - A4 exactly, square cells, and the blank grid with its lines where the
//   squares fall (read back from the saved PNG);
// - exact zoom and moves, beside drag and wheel;
// - a grid saved before M1 opens and saves as before;
// - every save is authorized first (Create a Grid and saving images) and
//   fails closed;
// - English, Hebrew, WCAG A/AA (axe);
// - the phone layout (Chromium phone emulation, and WebKit iPhone 13).

const PROJECT_KEY = 'painter-studio-project';
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

async function upload(page: Page, name = 'Upload reference photo') {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name }).first().click()]);
  await chooser.setFiles(photo);
}

/** The project as this browser keeps it. */
const stored = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), PROJECT_KEY);

async function readDownload(page: Page, click: () => Promise<void>) {
  const [download] = await Promise.all([page.waitForEvent('download'), click()]);
  const chunks: Buffer[] = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk as Buffer);
  return { name: download.suggestedFilename(), bytes: Buffer.concat(chunks) };
}

function pngSize(bytes: Buffer) {
  expect(bytes.subarray(1, 4).toString()).toBe('PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** Red, green, blue and alpha of a saved PNG at some points, decoded by the browser. */
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
      return points.map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data));
    },
    { b64: png.toString('base64'), points },
  );
}

/** Save through the save sheet: on a computer, "Save Image" downloads the file. */
async function saveAndDownload(page: Page, button: string) {
  await page.getByRole('button', { name: button }).first().click();
  await expect(page.getByAltText('Image preview')).toBeVisible();
  const file = await readDownload(page, () => page.getByRole('button', { name: 'Save Image' }).click());
  const close = page.getByRole('button', { name: 'Close', exact: true });
  if (await close.isVisible()) await close.click();
  return file;
}

const openCustomize = (page: Page) => page.getByText('Customize grid & canvas').click();
const setting = async (page: Page, key: string) => (await stored(page))?.gridSettings?.[key];

test.describe('Create a Grid', () => {
  test('rotation turns the image on the grid, never the photo itself, and the saved image is turned', async ({ page }) => {
    await page.goto('/app/grid');
    await upload(page);
    await expect.poll(() => stored(page).then((p) => p?.gridImage)).toMatch(/^data:image\//);
    const photoBefore = (await stored(page)).gridImage;

    await page.getByRole('button', { name: 'Rotate right 90°' }).click();
    await expect.poll(() => setting(page, 'rotation')).toBe(90);
    await page.getByRole('button', { name: 'Rotate 180°' }).click();
    await page.getByRole('button', { name: 'Rotate left 90°' }).click();
    await page.getByRole('button', { name: 'Rotate left 90°' }).click();
    await expect.poll(() => setting(page, 'rotation')).toBe(90);
    expect((await stored(page)).gridImage).toBe(photoBefore);

    const { name, bytes } = await saveAndDownload(page, 'Save grid image');
    expect(name).toBe('grid-4x4-50x70cm.png');
    expect(pngSize(bytes)).toEqual({ width: 2400, height: 3360 });
    // The photo (300 × 400, light on its left half) turned right fills the width, 37.5 cm tall:
    // light on top across the whole width, dark below. Unturned, its right half would be dark.
    const [topLeft, topRight, bottomLeft, bottomRight] = await samples(page, bytes, [[1000, 1200], [1400, 1200], [1000, 2200], [1400, 2200]]);
    for (const light of [topLeft, topRight]) expect(light[0]).toBeGreaterThan(180);
    for (const dark of [bottomLeft, bottomRight]) expect(dark[0]).toBeLessThan(100);
  });

  test('A4 and 3 cm squares: the blank grid is white paper with lines exactly where the squares fall', async ({ page }) => {
    await page.goto('/app/grid');
    await upload(page);
    await openCustomize(page);
    await page.getByRole('button', { name: 'A4 portrait' }).click();
    await page.getByRole('radiogroup', { name: 'Grid preset' }).getByRole('radio', { name: 'Square cells of 3 cm' }).click();
    await expect(page.getByText('21×29.7 cm · 3 cm squares (7×10)')).toBeVisible();
    await expect(page.getByText('7×10 cells. The last column or row is partial.').first()).toBeVisible();

    const { name, bytes } = await saveAndDownload(page, 'Save blank grid');
    expect(name).toBe('grid-blank-3cm-squares-21x29.7cm.png');
    expect(pngSize(bytes)).toEqual({ width: 2400, height: 3394 });
    // 3 cm is 342.86 px across (2400 px for 21 cm) and down (3394 px for 29.7 cm): black at the
    // lines' 50 % opacity, white between them.
    const across = [343, 686, 1029, 1371, 1714, 2057];
    const down = [343, 686, 1029, 1371, 1714, 2057, 2400, 2743, 3086];
    const onLines = await samples(page, bytes, [...across.map((x): [number, number] => [x, 171]), ...down.map((y): [number, number] => [171, y])]);
    for (const p of onLines) expect(p[0]).toBeLessThan(170);
    const between = await samples(page, bytes, [[171, 171], [514, 514], [2228, 3240]]);
    for (const p of between) expect(p.slice(0, 3)).toEqual([255, 255, 255]);
  });

  test('exact zoom and moves, beside drag and wheel as before', async ({ page }) => {
    await page.goto('/app/grid');
    await upload(page);
    await openCustomize(page);
    await page.getByRole('button', { name: 'Zoom in by 1%' }).click();
    await expect.poll(() => setting(page, 'imageScale')).toBe(1.01);
    const percent = page.getByRole('spinbutton', { name: 'Image scale in percent' });
    await percent.fill('150');
    await percent.press('Enter');
    await expect.poll(() => setting(page, 'imageScale')).toBe(1.5);
    await page.getByRole('button', { name: 'Move the image right by 0.1 cm' }).click();
    await page.getByRole('button', { name: 'Move the image right by 0.1 cm' }).click();
    await page.getByRole('button', { name: 'Move the image up by 0.1 cm' }).click();
    await expect.poll(async () => [await setting(page, 'imageOffsetX'), await setting(page, 'imageOffsetY')]).toEqual([0.2, -0.1]);

    const canvas = page.locator('[data-onboarding="grid-canvas"] canvas').first();
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect.poll(() => setting(page, 'imageOffsetX')).toBeGreaterThan(0.2);
    await page.mouse.wheel(0, -100);
    await expect.poll(() => setting(page, 'imageScale')).toBeCloseTo(1.575, 9);
  });

  test('a grid saved before M1 opens and saves exactly as before', async ({ page }) => {
    const photoUrl = `data:image/png;base64,${photo.buffer.toString('base64')}`;
    const old = { canvasWidth: 40, canvasHeight: 50, unit: 'cm', columns: 3, rows: 5, lineColor: '#ef4444', lineOpacity: 0.7, lineWidth: 2, imageOffsetX: 0, imageOffsetY: 0, imageScale: 1 };
    // Written before the studio's own scripts run, as a project saved by an earlier release.
    await page.addInitScript(([key, value]) => {
      if (!sessionStorage.getItem('seeded')) {
        localStorage.setItem(key, value);
        sessionStorage.setItem('seeded', '1');
      }
    }, [PROJECT_KEY, JSON.stringify({ image: photoUrl, calibration: null, measurements: [], sampledColors: [], gridSettings: old, gridImage: photoUrl, gridImageInitialized: true, savedAt: 1_731_000_000_000 })]);
    await page.goto('/app/grid');
    await expect(page.getByText('40×50 cm · 3×5 grid')).toBeVisible();
    const { name, bytes } = await saveAndDownload(page, 'Save grid image');
    expect(name).toBe('grid-3x5-40x50cm.png');
    expect(pngSize(bytes)).toEqual({ width: 2400, height: 3000 });
    // Unturned: the photo's left half light, its right half dark; a red line between columns 1 and 2.
    const [left, right] = await samples(page, bytes, [[1000, 1300], [1400, 1300]]);
    expect(left[0]).toBeGreaterThan(180);
    expect(right[0]).toBeLessThan(100);
    expect((await stored(page)).gridSettings).toEqual({ ...old, rotation: 0, cellMode: 'divisions', cellSize: 3 });
  });

  test('every save asks the server first (Create a Grid, saving images); with no answer nothing is saved', async ({ page }) => {
    await page.goto('/app/grid');
    await upload(page);
    const asked = page.waitForRequest((r) => r.url().endsWith('/api/usage') && r.method() === 'POST');
    await page.getByRole('button', { name: 'Save blank grid' }).click();
    expect((await asked).postDataJSON()).toEqual({ tool: 'tool.grid', features: ['export.image'] });
    await expect(page.getByAltText('Image preview')).toBeVisible();
    await page.getByRole('button', { name: 'Close', exact: true }).click();

    await page.route('**/api/usage', (route) => route.abort());
    await page.getByRole('button', { name: 'Save blank grid' }).click();
    const refused = page.getByRole('alertdialog');
    await expect(refused).toContainText('Your plan could not be checked');
    await expect(page.getByAltText('Image preview')).toHaveCount(0);
    await page.unroute('**/api/usage');
    await refused.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByAltText('Image preview')).toBeVisible();
  });

  test('with an image, square cells and every control open: no detectable WCAG A/AA problems', async ({ page }) => {
    await page.goto('/app/grid');
    await upload(page);
    await page.getByRole('radiogroup', { name: 'Grid preset' }).getByRole('radio', { name: 'Square cells of 3 cm' }).click();
    await openCustomize(page);
    await expect(page.getByRole('button', { name: 'Move the image left by 0.1 cm' })).toBeVisible();
    const result = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });

});

test.describe('Create a Grid in Hebrew', () => {
  test.use({ locale: 'he-IL' });

  test('the new controls are translated, the canvas stays left to right', async ({ page }) => {
    await page.goto('/app/grid');
    await upload(page, 'להעלות תמונת ייחוס');
    for (const name of ['סיבוב שמאלה ב־90°', 'סיבוב ב־180°', 'סיבוב ימינה ב־90°', 'שמירת רשת ריקה', 'שמירת תמונת הרשת']) {
      await expect(page.getByRole('button', { name }).first()).toBeVisible();
    }
    await page.getByRole('radio', { name: 'משבצות ריבועיות של 3 cm' }).click();
    await page.getByText('התאמת הרשת והבד').click();
    await expect(page.getByRole('button', { name: 'A4 לאורך' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'הזזת התמונה ימינה ב־0.1 cm' })).toBeVisible();
    expect(await page.locator('[data-onboarding="grid-canvas"]').first().evaluate((el) => getComputedStyle(el).direction)).toBe('ltr');
    const result = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(result.violations.map((v) => v.id)).toEqual([]);
  });
});

test.describe('Create a Grid on a phone', () => {
  test.use(phone);

  test('mobile: the rotations, square cells and both saves sit under the grid, above the navigation', async ({ page }) => {
    await page.goto('/app/grid');
    await upload(page);
    const nav = (await page.getByRole('navigation', { name: 'Tools' }).boundingBox())!;
    for (const name of ['Rotate left 90°', 'Rotate 180°', 'Rotate right 90°', 'Save grid image', 'Save blank grid']) {
      const button = page.getByRole('button', { name });
      await expect(button).toBeVisible();
      const box = (await button.boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(nav.y + 0.5);
      expect(box.height).toBeGreaterThanOrEqual(40);
    }
    await page.getByRole('button', { name: 'Rotate right 90°' }).click();
    await expect.poll(() => setting(page, 'rotation')).toBe(90);

    const presets = page.getByRole('radiogroup', { name: 'Grid preset' });
    await expect(presets.getByRole('radio')).toHaveCount(4);
    await presets.getByRole('radio', { name: 'Square cells of 3 cm' }).click();
    await expect(page.getByRole('spinbutton', { name: 'Cell size in cm' })).toBeVisible();
    await page.getByRole('button', { name: 'Larger cells' }).click();
    await expect.poll(() => setting(page, 'cellSize')).toBe(3.5);

    await page.getByRole('tab', { name: 'Customize' }).click();
    await page.getByRole('button', { name: 'A4 portrait' }).click();
    await expect.poll(async () => [await setting(page, 'canvasWidth'), await setting(page, 'canvasHeight'), await setting(page, 'unit')]).toEqual([21, 29.7, 'cm']);
    await page.getByRole('tab', { name: 'Preset' }).click();

    await page.getByRole('button', { name: 'Save blank grid' }).click();
    await expect(page.getByAltText('Image preview')).toBeVisible();
  });
});
