import { writeFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import { photo } from './fixtures/photo';
import { inspectPdf, type InspectedPage, type InspectedPdf, type PlacedImage } from '../src/test/pdfInspect';

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
// - the phone layout (Chromium phone emulation, and WebKit iPhone 13);
// - the A4 PDF (M2), read back from the downloaded file: exact A4, the same
//   canvas, grid and bar on both pages, the photo placed as in the saved
//   image; offered only to accounts that have it (admins, until the owner
//   publishes it for a plan), asked of the server first, failing closed.

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

/** Red, green, blue and alpha of a saved PNG (or JPEG) at some points, decoded by the browser. */
function samples(page: Page, png: Buffer, points: [number, number][], type = 'image/png'): Promise<number[][]> {
  return page.evaluate(
    async ({ b64, points, type }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type }));
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      return points.map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data));
    },
    { b64: png.toString('base64'), points, type },
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
    // Written back by the project's auto-save (300 ms after a change), with the new settings' defaults.
    await expect.poll(() => stored(page).then((p) => p.gridSettings)).toEqual({ ...old, rotation: 0, cellMode: 'divisions', cellSize: 3 });
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

// ─── The A4 PDF (M2) ──────────────────────────────────────────────────────────
// Before the owner publishes grid PDFs for a plan, only admins have them: the
// tests that make one are signed in as this server's admin.

const ADMIN = 'e2e/.auth/admin.json';
/** A4 in points, as each page's MediaBox must say. */
const A4_PT = { portrait: [0, 0, 595.28, 841.89], landscape: [0, 0, 841.89, 595.28] };
const MARGIN_MM = 12.7;
const FOOTER_MM = 21;
/** Grid settings as the studio saves them (its defaults: 50×70 cm, 4×4). */
const GRID = { canvasWidth: 50, canvasHeight: 70, unit: 'cm', columns: 4, rows: 4, lineColor: '#ffffff', lineOpacity: 0.5, lineWidth: 1, imageOffsetX: 0, imageOffsetY: 0, imageScale: 1, rotation: 0, cellMode: 'divisions', cellSize: 3 };
/** 50×70 cm on portrait A4: 35.8 % (the 250.6 mm above the words, over 700 mm), so 179 × 250.6 mm, centred. */
const REDUCED_FRAME = { x: 15.5, y: 12.7, w: 179, h: 250.6 };

type Box = { x: number; y: number; w: number; h: number };
type Line = InspectedPage['lines'][number];
const near = (actual: number, expected: number, tolerance = 0.01) =>
  expect(Math.abs(actual - expected), `${actual} should be ${expected} ± ${tolerance}`).toBeLessThanOrEqual(tolerance);
const sameBox = (a: Box, b: Box, tolerance = 0.01) => (['x', 'y', 'w', 'h'] as const).every((k) => Math.abs(a[k] - b[k]) <= tolerance);
const sorted = (values: number[]) => [...values].sort((a, b) => a - b);

/** Open Create a Grid with a project this browser saved earlier: the test photo and these settings. */
async function openSaved(page: Page, settings: Record<string, unknown>) {
  const photoUrl = `data:image/png;base64,${photo.buffer.toString('base64')}`;
  const project = { image: photoUrl, calibration: null, measurements: [], sampledColors: [], gridSettings: { ...GRID, ...settings }, gridImage: photoUrl, gridImageInitialized: true, savedAt: 1_763_000_000_000 };
  await page.addInitScript(([key, value]) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem(key, value);
      sessionStorage.setItem('seeded', '1');
    }
  }, [PROJECT_KEY, JSON.stringify(project)]);
  await page.goto('/app/grid');
}

/** The picture of the PDF's pages in its sheet, by its description. */
const PDF_PREVIEW = { en: 'The PDF’s pages: the reference with its grid, and the blank grid', he: 'הדפים של קובץ ה־PDF: תמונת הייחוס עם הרשת, והרשת הריקה' };

/** Ask for the PDF: the server is asked first (Create a Grid, grid PDFs), then the PDF's sheet opens with a picture of its pages. */
async function openPdfSheet(page: Page, button = 'Save PDF (A4)', preview = PDF_PREVIEW.en) {
  const asked = page.waitForRequest((r) => r.url().endsWith('/api/usage') && r.method() === 'POST' && (r.postData() ?? '').includes('export.pdf'));
  await page.getByRole('button', { name: button, exact: true }).first().click();
  expect((await asked).postDataJSON()).toEqual({ tool: 'tool.grid', features: ['export.pdf'] });
  const sheet = page.getByRole('dialog', { name: button });
  await expect(sheet.getByRole('img', { name: preview })).toBeVisible();
  return sheet;
}

/** Save the PDF from its sheet and read the file back. */
async function downloadPdf(page: Page, sheet: Locator, button = 'Save PDF') {
  const file = await readDownload(page, () => sheet.getByRole('button', { name: button, exact: true }).click());
  await expect(sheet).toHaveCount(0);
  expect(file.bytes.subarray(0, 5).toString()).toBe('%PDF-');
  // Kept with the test's results, to open and print when checking by eye.
  writeFileSync(test.info().outputPath(file.name), file.bytes);
  return { name: file.name, pdf: inspectPdf(file.bytes) };
}

/**
 * Both pages as the file has them: exact A4 in this orientation, printing at
 * actual size asked for; the canvas frame at `frame` on both; the photo
 * filling it on page 1 only, at 300 dpi of its printed size; the same grid
 * lines on both (black on page 2); the bar exactly 50 mm between its end
 * marks, in the same place on both; the words under the canvas, inside the
 * margins, from the reading side.
 */
function expectPages(pdf: InspectedPdf, orientation: 'portrait' | 'landscape', frame: Box, rtl = false) {
  const pageW = orientation === 'portrait' ? 210 : 297;
  const pageH = orientation === 'portrait' ? 297 : 210;
  const footerTop = pageH - MARGIN_MM - FOOTER_MM;
  expect(pdf.pages).toHaveLength(2);
  expect(pdf.printScalingNone).toBe(true);
  for (const p of pdf.pages) {
    expect(p.mediaBox).toEqual(A4_PT[orientation]);
    expect(p.rects).toHaveLength(1);
    expect(sameBox(p.rects[0], frame), `the frame ${JSON.stringify(p.rects[0])}`).toBe(true);
  }
  expect(frame.y + frame.h).toBeLessThanOrEqual(footerTop + 0.01);

  const [first, second] = pdf.pages;
  const photos = first.images.filter((i) => sameBox(i, frame));
  expect(photos).toHaveLength(1);
  expect(second.images.filter((i) => sameBox(i, frame, 1))).toHaveLength(0);
  const reference = pdf.images[pdf.xobjects[photos[0].name]];
  expect(reference.filter).toBe('DCTDecode');
  expect([reference.width, reference.height]).toEqual([Math.round((frame.w / 25.4) * 300), Math.round((frame.h / 25.4) * 300)]);

  const inside = (l: Line) =>
    Math.min(l.x1, l.x2) >= frame.x - 0.01 && Math.max(l.x1, l.x2) <= frame.x + frame.w + 0.01 && Math.min(l.y1, l.y2) >= frame.y - 0.01 && Math.max(l.y1, l.y2) <= frame.y + frame.h + 0.01;
  const shape = (l: Line) => [l.x1, l.y1, l.x2, l.y2, l.width, l.opacity].map((v) => Math.round(v * 1000) / 1000);
  const grid = pdf.pages.map((p) => p.lines.filter(inside));
  expect(grid[0].length).toBeGreaterThan(0);
  expect(grid[1].map(shape)).toEqual(grid[0].map(shape));
  for (const l of grid[1]) expect(l.color).toBe('#000000');

  const barStarts = pdf.pages.map((p) => {
    const marks = p.lines.filter((l) => !inside(l));
    expect(marks).toHaveLength(3);
    for (const m of marks) {
      expect(m.color).toBe('#000000');
      near(m.width, 0.35, 0.001);
    }
    const bar = marks.find((m) => Math.abs(m.y1 - m.y2) < 1e-6)!;
    const ends = sorted(marks.filter((m) => Math.abs(m.x1 - m.x2) < 1e-6).map((m) => m.x1));
    const [from, to] = sorted([bar.x1, bar.x2]);
    near(to - from, 50, 0.001);
    expect(ends).toHaveLength(2);
    near(ends[0], from, 0.001);
    near(ends[1], to, 0.001);
    near(bar.y1, pageH - MARGIN_MM - 3, 0.001);
    return from;
  });
  near(barStarts[1], barStarts[0], 0.0001);
  near(barStarts[0], rtl ? pageW - MARGIN_MM - 50 : MARGIN_MM, 0.001);

  for (const p of pdf.pages) {
    const words = p.images.filter((i) => !sameBox(i, frame));
    expect(words).toHaveLength(3);
    for (const w of words) {
      expect(w.x).toBeGreaterThanOrEqual(MARGIN_MM - 0.01);
      expect(w.x + w.w).toBeLessThanOrEqual(pageW - MARGIN_MM + 0.01);
      expect(w.y).toBeGreaterThanOrEqual(footerTop - 0.01);
      expect(w.y + w.h).toBeLessThanOrEqual(pageH - MARGIN_MM + 0.01);
    }
    const lines = words.filter((w) => [1.5, 7.5].some((d) => Math.abs(w.y - (footerTop + d)) < 0.01));
    expect(lines).toHaveLength(2);
    for (const w of lines) near(rtl ? w.x + w.w : w.x, rtl ? pageW - MARGIN_MM : MARGIN_MM);
  }
  return { photo: photos[0], reference, grid: grid[0] };
}

/** The test photo's light half, its dark half, the canvas around it, or unclear. */
function tone([r, g, b]: number[]) {
  if (r > 180 && g > 130) return 'light';
  if (r < 100 && b > 95 && b > r + 30) return 'dark';
  if (r < 70 && g < 70 && b < 70 && Math.abs(r - b) < 15) return 'canvas';
  return null;
}

/** The photo on the PDF's first page is where the saved grid image has it: the same tone at 64 places across the canvas. */
async function expectPlacedAsSaved(page: Page, png: Buffer, photoOnPage: PlacedImage, pdf: InspectedPdf) {
  const { width, height } = pngSize(png);
  const jpeg = pdf.images[pdf.xobjects[photoOnPage.name]];
  // Away from the grid's lines (at quarters): the middle of each eighth.
  const at = Array.from({ length: 64 }, (_, k) => [((k % 8) + 0.5) / 8, (Math.floor(k / 8) + 0.5) / 8]);
  const saved = await samples(page, png, at.map(([fx, fy]) => [Math.floor(fx * width), Math.floor(fy * height)]));
  const printed = await samples(page, jpeg.bytes, at.map(([fx, fy]) => [Math.floor(fx * jpeg.width), Math.floor(fy * jpeg.height)]), 'image/jpeg');
  const pairs = at.map((where, i) => ({ where, saved: tone(saved[i]), printed: tone(printed[i]) })).filter((p) => p.saved && p.printed);
  expect(pairs.length).toBeGreaterThanOrEqual(56);
  expect(pairs.filter((p) => p.saved !== p.printed)).toEqual([]);
  expect(new Set(pairs.map((p) => p.saved)).size).toBeGreaterThanOrEqual(2);
}

test.describe('Create a Grid PDF (A4)', () => {
  test.use({ storageState: ADMIN });

  test('reduced to fit: 50×70 cm on portrait A4, the photo with its grid then the same grid blank, and a 50 mm bar', async ({ page }) => {
    await page.goto('/app/grid');
    await upload(page);
    const sheet = await openPdfSheet(page);
    await expect(sheet).toContainText('Print at 100% (Actual size), then check that the bar on the page measures 50 mm.');
    await expect(sheet.getByRole('button', { name: 'Open to print' })).toBeVisible();
    const axe = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(WCAG).analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);

    const { name, pdf } = await downloadPdf(page, sheet);
    expect(name).toBe('grid-4x4-50x70cm-a4.pdf');
    const { grid } = expectPages(pdf, 'portrait', REDUCED_FRAME);
    // 4×4: lines at the quarters, white at the grid's 50 % over the photo, 0.3 mm (1 px of 600, to scale).
    const across = grid.filter((l) => l.x1 === l.x2);
    const down = grid.filter((l) => l.y1 === l.y2);
    expect(sorted(across.map((l) => l.x1)).map((x) => Math.round(x * 100) / 100)).toEqual([60.25, 105, 149.75]);
    expect(sorted(down.map((l) => l.y1)).map((y) => Math.round(y * 100) / 100)).toEqual([75.35, 138, 200.65]);
    for (const l of pdf.pages[0].lines.filter((l) => grid.includes(l))) {
      expect(l.color).toBe('#ffffff');
      expect(l.opacity).toBe(0.5);
      near(l.width, 179 / 600, 0.001);
    }
  });

  test('true size when it fits: 25×15 cm with 3 cm squares on landscape A4, every square exactly 30 mm', async ({ page }) => {
    await openSaved(page, { canvasWidth: 25, canvasHeight: 15, cellMode: 'square', cellSize: 3 });
    await expect(page.getByText('25×15 cm · 3 cm squares (9×5)')).toBeVisible();
    const { name, pdf } = await downloadPdf(page, await openPdfSheet(page));
    expect(name).toBe('grid-3cm-squares-25x15cm-a4.pdf');
    // 250 × 150 mm in the 271.6 × 163.6 mm above the words: centred, unscaled.
    const { grid } = expectPages(pdf, 'landscape', { x: 23.5, y: 19.5, w: 250, h: 150 });
    const across = sorted(grid.filter((l) => l.x1 === l.x2).map((l) => l.x1));
    const down = sorted(grid.filter((l) => l.y1 === l.y2).map((l) => l.y1));
    // Squares from the top-left corner: 8 whole columns and a 10 mm one; 5 whole rows.
    expect(across).toHaveLength(8);
    across.forEach((x, k) => near(x, 23.5 + 30 * (k + 1), 0.001));
    expect(down).toHaveLength(4);
    down.forEach((y, k) => near(y, 19.5 + 30 * (k + 1), 0.001));
  });

  test('the photo on page 1 is placed as in the saved grid image: turned, zoomed and moved; then filling the canvas, turned the other way', async ({ page }) => {
    await page.goto('/app/grid');
    await upload(page);
    await page.getByRole('button', { name: 'Rotate right 90°' }).click();
    await openCustomize(page);
    const percent = page.getByRole('spinbutton', { name: 'Image scale in percent' });
    await percent.fill('150');
    await percent.press('Enter');
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Move the image right by 0.1 cm' }).click();
    await page.getByRole('button', { name: 'Move the image up by 0.1 cm' }).click();
    await expect.poll(async () => [await setting(page, 'rotation'), await setting(page, 'imageScale'), await setting(page, 'imageOffsetX'), await setting(page, 'imageOffsetY')]).toEqual([90, 1.5, 0.3, -0.1]);
    const turned = await saveAndDownload(page, 'Save grid image');
    const first = await downloadPdf(page, await openPdfSheet(page));
    await expectPlacedAsSaved(page, turned.bytes, expectPages(first.pdf, 'portrait', REDUCED_FRAME).photo, first.pdf);

    await page.getByRole('button', { name: 'Rotate left 90°' }).click();
    await page.getByRole('button', { name: 'Rotate left 90°' }).click();
    await page.getByRole('button', { name: 'Fill', exact: true }).click();
    await expect.poll(() => setting(page, 'rotation')).toBe(270);
    const filled = await saveAndDownload(page, 'Save grid image');
    const second = await downloadPdf(page, await openPdfSheet(page));
    await expectPlacedAsSaved(page, filled.bytes, expectPages(second.pdf, 'portrait', REDUCED_FRAME).photo, second.pdf);
  });

  test('the server is asked first: with no answer, or an error, nothing is made; when it answers, the PDF is', async ({ page }) => {
    await page.goto('/app/grid');
    await upload(page);
    const button = page.getByRole('button', { name: 'Save PDF (A4)', exact: true });
    const refused = page.getByRole('alertdialog');
    const sheet = page.getByRole('dialog', { name: 'Save PDF (A4)' });
    const answers: ((route: Route) => Promise<void>)[] = [(route) => route.abort(), (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })];
    for (const answer of answers) {
      await page.route('**/api/usage', answer);
      await button.click();
      await expect(refused).toContainText('Your plan could not be checked');
      await expect(sheet).toHaveCount(0);
      await refused.getByRole('button', { name: 'Close', exact: true }).click();
      await page.unroute('**/api/usage');
    }
    await expect(button).toBeEnabled();
    await openPdfSheet(page);
  });
});

test.describe('Create a Grid PDF in Hebrew', () => {
  test.use({ storageState: ADMIN, locale: 'he-IL' });

  test('the words on the pages read right to left: from the right margin, the bar on the right', async ({ page }) => {
    await page.goto('/app/grid');
    await upload(page, 'להעלות תמונת ייחוס');
    const sheet = await openPdfSheet(page, 'שמירת PDF\u200f (A4)', PDF_PREVIEW.he);
    await expect(sheet).toContainText('להדפיס ב־100% (גודל אמיתי), ואז לבדוק שהפס שבדף באורך 50 מ״מ.');
    const { name, pdf } = await downloadPdf(page, sheet, 'שמירת PDF');
    expect(name).toBe('grid-4x4-50x70cm-a4.pdf');
    expectPages(pdf, 'portrait', REDUCED_FRAME, true);
  });

  test.describe('on a phone', () => {
    test.use(phone);

    test('mobile: in Hebrew on a phone, the PDF keeps its Hebrew name and its pages read right to left', async ({ page }) => {
      await page.goto('/app/grid');
      await upload(page, 'להעלות תמונת ייחוס');
      await expect(page.getByRole('button', { name: 'שמירת PDF\u200f (A4)', exact: true })).toHaveText('PDF');
      const sheet = await openPdfSheet(page, 'שמירת PDF\u200f (A4)', PDF_PREVIEW.he);
      const shares = await sheet.getByRole('button', { name: 'שיתוף או הדפסה' }).isVisible();
      const { pdf } = await downloadPdf(page, sheet, shares ? 'שמירת הקובץ' : 'שמירת PDF');
      expectPages(pdf, 'portrait', REDUCED_FRAME, true);
    });
  });
});

test.describe('Create a Grid PDF on a phone', () => {
  test.use({ ...phone, storageState: ADMIN });

  test('mobile: the PDF sits with the saves under the grid; its sheet fits the screen and saves the A4 PDF', async ({ page }) => {
    await page.goto('/app/grid');
    await upload(page);
    const nav = (await page.getByRole('navigation', { name: 'Tools' }).boundingBox())!;
    const button = page.getByRole('button', { name: 'Save PDF (A4)', exact: true });
    await expect(button).toBeVisible();
    await expect(button).toHaveText('PDF');
    const box = (await button.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(nav.y + 0.5);
    expect(box.height).toBeGreaterThanOrEqual(40);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

    const sheet = await openPdfSheet(page);
    // Where files can be shared, the share sheet (Print, Save to Files) comes first and the file can be saved too.
    const share = sheet.getByRole('button', { name: 'Share or print' });
    const shares = await share.isVisible();
    if (shares) await expect(sheet).toContainText('In the next screen, choose Print, or Save to Files.');
    const saveButton = shares ? 'Save file' : 'Save PDF';
    await expect(sheet.getByRole('button', { name: saveButton, exact: true })).toBeInViewport();
    const sheetBox = (await sheet.boundingBox())!;
    expect(sheetBox.x).toBeGreaterThanOrEqual(0);
    expect(sheetBox.x + sheetBox.width).toBeLessThanOrEqual(page.viewportSize()!.width + 0.5);
    const { pdf } = await downloadPdf(page, sheet, saveButton);
    expectPages(pdf, 'portrait', REDUCED_FRAME);
  });
});

test.describe('Create a Grid PDF, not in the plan', () => {
  test('Free and Pro before a plan offers grid PDFs: no PDF button, not on the plans page, and the server refuses one', async ({ browser }) => {
    for (const name of ['user', 'pro']) {
      const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, storageState: `e2e/.auth/${name}.json` });
      const page = await context.newPage();
      await page.goto('/app/grid');
      await upload(page);
      await expect(page.getByRole('button', { name: 'Save grid image' }).first()).toBeVisible();
      await expect(page.getByRole('button', { name: /PDF/ })).toHaveCount(0);
      const response = await page.request.post('/api/usage', { data: { tool: 'tool.grid', features: ['export.pdf'] } });
      expect(response.status()).toBe(403);
      expect((await response.json()).features).toEqual(['export.pdf']);
      await page.goto('/app/plans');
      await expect(page.getByRole('row', { name: /Create a Grid/ })).toBeVisible();
      await expect(page.getByRole('row', { name: /Print-ready PDFs/ })).toHaveCount(0);
      await context.close();
    }
  });
});
