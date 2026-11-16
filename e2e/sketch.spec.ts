import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';
import { photo, sketchPhoto } from './fixtures/photo';

// Study & Simplify → Sketch: Clean Outline and Pencil Study, drawn by the
// sketch engine in a Web Worker. Desktop Chrome, and WebKit with iPhone 13
// emulation for the `mobile` tests (emulation, not a real device).

const DRAWING = 20_000; // a first drawing at 1.6 MP on a slow CI machine
// Several drawings and full-size saves per test: CI runners are slower than a laptop.
test.describe.configure({ timeout: 90_000 });

async function upload(page: Page, file = sketchPhoto) {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Upload reference photo' }).first().click(),
  ]);
  await chooser.setFiles(file);
}

async function openSketch(page: Page) {
  await page.goto('/app/study');
  await upload(page);
  await page.getByRole('radio', { name: /Sketch/ }).click();
}

const ALT = {
  outline: 'Clean Outline drawing of the reference',
  pencil: 'Pencil Study of the reference',
  overlay: 'The drawing’s lines in red over the reference',
};

/** Pixel statistics of an image on the page, read back through a canvas. */
async function stats(page: Page, alt: string) {
  const img = page.getByRole('img', { name: alt, exact: true }).first();
  await expect(img).toBeVisible({ timeout: DRAWING });
  return img.evaluate(async (el: HTMLImageElement) => {
    await el.decode();
    const c = document.createElement('canvas');
    c.width = el.naturalWidth;
    c.height = el.naturalHeight;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(el, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const n = c.width * c.height;
    let white = 0;
    let dark = 0;
    let red = 0;
    let mid = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > 240 && d[i + 1] > 240 && d[i + 2] > 240) white++;
      if (d[i] < 90 && d[i + 1] < 90 && d[i + 2] < 90) dark++;
      if (d[i] > 170 && d[i + 1] < 100 && d[i + 2] < 100) red++;
      if (d[i] > 90 && d[i] < 230 && Math.abs(d[i] - d[i + 1]) < 3) mid++;
    }
    return { width: c.width, height: c.height, white: white / n, dark: dark / n, red: red / n, grey: mid / n, src: el.src };
  });
}

/** Width and height from a PNG's header. */
function pngSize(bytes: Buffer) {
  expect(bytes.subarray(1, 4).toString()).toBe('PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** Close the save sheet if it is still open (downloading may close it already). */
async function closeSheet(page: Page) {
  const close = page.getByRole('button', { name: 'Close', exact: true });
  if (await close.isVisible()) await close.click();
}

async function readDownload(page: Page, click: () => Promise<void>) {
  const [download] = await Promise.all([page.waitForEvent('download'), click()]);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return { name: download.suggestedFilename(), bytes: Buffer.concat(chunks) };
}

test.describe('Sketch', () => {
  test('Clean Outline is drawn off the main thread: thin dark lines on white, no solid black', async ({ page }) => {
    const workers: string[] = [];
    page.on('worker', (w) => workers.push(w.url()));
    await openSketch(page);
    const styles = page.getByRole('radiogroup', { name: 'Sketch style' });
    await expect(styles.getByRole('radio', { name: 'Clean Outline' })).toHaveAttribute('aria-checked', 'true');
    await expect(styles.getByRole('radio', { name: 'Pencil Study' })).toHaveAttribute('aria-checked', 'false');

    const s = await stats(page, ALT.outline);
    expect(s.src).toMatch(/^blob:/);
    // The working size of a 2000 × 1500 photo: 1.6 MP at most.
    expect(s.width * s.height).toBeLessThanOrEqual(1_600_000);
    expect(s.width / s.height).toBeCloseTo(4 / 3, 2);
    expect(s.white).toBeGreaterThan(0.85);
    expect(s.dark).toBeGreaterThan(0.002);
    expect(s.dark).toBeLessThan(0.08);
    expect(workers.some((url) => /worker/i.test(url))).toBe(true);

    // The old black-and-white trace's controls are gone.
    await expect(page.getByRole('slider', { name: 'Ink' })).toHaveCount(0);
    await expect(page.getByText('Presets')).toHaveCount(0);
  });

  test('the controls redraw, Reset restores the defaults, and each style keeps its own settings', async ({ page }) => {
    await openSketch(page);
    const before = await stats(page, ALT.outline);

    const detail = page.getByRole('slider', { name: 'Detail' });
    await expect(detail).toHaveAttribute('aria-valuetext', 'Balanced');
    await detail.focus();
    await page.keyboard.press('End');
    await expect(detail).toHaveAttribute('aria-valuetext', 'Everything');
    await expect.poll(async () => (await stats(page, ALT.outline)).src, { timeout: DRAWING }).not.toBe(before.src);
    const detailed = await stats(page, ALT.outline);
    expect(detailed.white).toBeLessThan(before.white);

    const weight = page.getByRole('slider', { name: 'Line thickness' });
    await weight.focus();
    await page.keyboard.press('PageUp');
    await page.keyboard.press('PageUp');
    await expect(weight).toHaveAttribute('aria-valuenow', '70');

    const reset = page.getByRole('button', { name: 'Reset Clean Outline to its default settings' });
    await expect(reset).toBeEnabled();
    await reset.click();
    await expect(detail).toHaveAttribute('aria-valuenow', '50');
    await expect(weight).toHaveAttribute('aria-valuenow', '50');
    await expect(reset).toBeDisabled();
    // Back at the defaults, the drawing is the same as the first one.
    await expect.poll(async () => (await stats(page, ALT.outline)).white, { timeout: DRAWING }).toBeCloseTo(before.white, 4);

    // Pencil Study: graphite tone, and a Shading control of its own.
    await page.getByRole('radio', { name: 'Pencil Study' }).click();
    const pencil = await stats(page, ALT.pencil);
    expect(pencil.grey).toBeGreaterThan(0.1);
    // No black masses: the shaded disc is grey graphite.
    expect(pencil.dark).toBeLessThan(0.05);
    const shading = page.getByRole('slider', { name: 'Shading' });
    await expect(shading).toBeVisible();
    await shading.focus();
    await page.keyboard.press('Home');
    await expect(shading).toHaveAttribute('aria-valuetext', 'Whisper');
    await page.getByRole('radio', { name: 'Clean Outline' }).click();
    await expect(page.getByRole('slider', { name: 'Shading' })).toHaveCount(0);
    await page.getByRole('radio', { name: 'Pencil Study' }).click();
    await expect(page.getByRole('slider', { name: 'Shading' })).toHaveAttribute('aria-valuenow', '0');
  });

  test('Overlay compares the lines with the photo, in red, from the existing Compare controls', async ({ page }) => {
    await openSketch(page);
    await stats(page, ALT.outline);
    await page.getByRole('button', { name: 'Overlay', exact: true }).click();
    const overlay = await stats(page, ALT.overlay);
    expect(overlay.red).toBeGreaterThan(0.002);
    // The photo shows through, lightened: not a white page.
    expect(overlay.white).toBeLessThan(0.5);
    // Slider and side-by-side still work with the drawing.
    await page.getByRole('button', { name: 'Side', exact: true }).click();
    await expect(page.getByRole('img', { name: ALT.outline })).toBeVisible({ timeout: DRAWING });
    await expect(page.getByRole('img', { name: 'Original' }).first()).toBeVisible();
    // Leaving Sketch turns the overlay off; Color and Values draw as before.
    await page.getByRole('button', { name: 'Overlay', exact: true }).click();
    await page.getByRole('radio', { name: /Values/ }).click();
    await expect(page.getByRole('button', { name: 'Overlay', exact: true })).toHaveCount(0);
    const values = page.getByRole('img', { name: 'Value study' });
    await expect(values).toBeVisible();
    await expect(values).toHaveAttribute('src', /^data:image\/jpeg/);
  });

  test('saves a large PNG of each style, and Clean Outline as a true vector SVG', async ({ page }) => {
    await openSketch(page);
    await stats(page, ALT.outline);

    await page.getByRole('button', { name: 'Save drawing (PNG)' }).click();
    const outlinePng = await readDownload(page, () => page.getByRole('button', { name: 'Save Image' }).click());
    expect(outlinePng.name).toBe('clean-outline.png');
    // Drawn from the vector paths at the photo's own size (2000 × 1500), larger than the on-screen drawing.
    expect(pngSize(outlinePng.bytes)).toEqual({ width: 2000, height: 1500 });
    await closeSheet(page);

    await page.getByRole('button', { name: 'Save as SVG (vector)' }).click();
    const svg = await readDownload(page, () => page.getByRole('button', { name: 'Save Image' }).click());
    expect(svg.name).toBe('clean-outline.svg');
    const text = svg.bytes.toString('utf8');
    expect(text).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="2000" height="1500" viewBox="0 0 \d+ \d+">/);
    expect(text).toContain('<path d="M');
    expect(text).not.toMatch(/<image|base64|data:/);
    await closeSheet(page);

    await page.getByRole('radio', { name: 'Pencil Study' }).click();
    await stats(page, ALT.pencil);
    // No vector export for a tonal drawing.
    await expect(page.getByRole('button', { name: 'Save as SVG (vector)' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Save drawing (PNG)' }).click();
    const pencilPng = await readDownload(page, () => page.getByRole('button', { name: 'Save Image' }).click());
    expect(pencilPng.name).toBe('pencil-study.png');
    // Recomputed at the photo's size (3 MP, within the 4.2 MP desktop limit).
    expect(pngSize(pencilPng.bytes)).toEqual({ width: 2000, height: 1500 });
  });

  test('a project saved with the old black-and-white Sketch still opens, and keeps its old settings', async ({ page }) => {
    const legacyTrace = { ink: 70, detail: 20, separation: 80, invert: true, smoothing: 10, local: 30, simplify: 90, corners: 0 };
    const image = `data:image/png;base64,${photo.buffer.toString('base64')}`;
    await page.addInitScript(
      ([img, trace]) => {
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem(
          'painter-studio-project',
          JSON.stringify({
            image: img,
            calibration: null,
            measurements: [],
            layers: [{ id: 'general', name: 'General Lines', visible: true, color: '#f59e0b' }],
            activeLayerId: 'general',
            valueSettings: { grayscale: false, posterize: 0, contrast: 100, brightness: 100, mode: 'sketch', levels: 9, focus: 'none', sketchTrace: trace },
            sampledColors: [],
            gridSettings: { canvasWidth: 50, canvasHeight: 70, unit: 'cm', columns: 4, rows: 4, lineColor: '#ffffff', lineOpacity: 0.5, lineWidth: 1, imageOffsetX: 0, imageOffsetY: 0, imageScale: 1 },
            savedAt: 1,
          }),
        );
      },
      [image, legacyTrace] as const,
    );
    await page.goto('/app/study');
    await expect(page.getByRole('radio', { name: /Sketch/ })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('radio', { name: 'Clean Outline' })).toHaveAttribute('aria-checked', 'true');
    await stats(page, ALT.outline);
    // A change is saved alongside the old fields, which stay as they were.
    await page.getByRole('radio', { name: 'Pencil Study' }).click();
    await expect
      .poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('painter-studio-project') ?? '{}').valueSettings?.sketchStyle))
      .toBe('pencil');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('painter-studio-project') ?? '{}').valueSettings);
    expect(saved.sketchTrace).toEqual(legacyTrace);
    expect(saved.mode).toBe('sketch');
  });

  test('has no automatically detectable accessibility problems', async ({ page }) => {
    await openSketch(page);
    await stats(page, ALT.outline);
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });

  test.describe('in Hebrew', () => {
    test.use({ locale: 'he-IL' });

    test('the styles and controls are in Hebrew, and the drawing stays left to right', async ({ page }) => {
      await page.goto('/app/study');
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'להעלות תמונת ייחוס' }).first().click()]);
      await chooser.setFiles(sketchPhoto);
      await page.getByRole('radio', { name: /סקיצה/ }).click();
      const styles = page.getByRole('radiogroup', { name: 'סגנון הסקיצה' });
      await expect(styles.getByRole('radio', { name: 'קו מתאר נקי' })).toBeVisible();
      await expect(styles.getByRole('radio', { name: 'לימוד בעיפרון' })).toBeVisible();
      for (const name of ['עובי קו', 'פירוט']) await expect(page.getByRole('slider', { name })).toBeVisible();
      await expect(page.getByRole('slider', { name: 'פירוט' })).toHaveAttribute('aria-valuetext', 'מאוזן');
      await expect(page.getByRole('img', { name: 'רישום בקו מתאר נקי של תמונת הייחוס' })).toBeVisible({ timeout: DRAWING });
      await page.getByRole('radio', { name: 'לימוד בעיפרון' }).click();
      await expect(page.getByRole('slider', { name: 'הצללה' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'על המקור', exact: true })).toBeVisible();
    });
  });
});

test.describe('mobile', () => {
  // iPhone 13's screen in both projects (in WebKit the device profile adds Safari's user agent).
  test.use({ viewport: { width: 390, height: 664 }, isMobile: true, hasTouch: true });

  test('Sketch on a phone: the drawing, its controls under it, the overlay among the views, and saving', async ({ page }) => {
    await openSketch(page);
    const s = await stats(page, ALT.outline);
    expect(s.white).toBeGreaterThan(0.85);
    // Style and controls sit under the image, on screen without scrolling.
    for (const control of [
      page.getByRole('radio', { name: 'Clean Outline' }),
      page.getByRole('slider', { name: 'Line thickness' }),
      page.getByRole('slider', { name: 'Detail' }),
    ]) {
      await expect(control).toBeInViewport();
    }
    const views = page.getByRole('group', { name: 'Show' });
    await expect(views.getByRole('button')).toHaveText(['Original', 'Study', 'Overlay']);
    await views.getByRole('button', { name: 'Overlay' }).click();
    expect((await stats(page, ALT.overlay)).red).toBeGreaterThan(0.002);
    await views.getByRole('button', { name: 'Study' }).click();

    await page.getByRole('radio', { name: 'Pencil Study' }).click();
    await stats(page, ALT.pencil);
    await expect(page.getByRole('slider', { name: 'Shading' })).toBeInViewport();
    const width = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(width).toBeLessThanOrEqual(0);

    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('img', { name: 'Image preview' })).toBeVisible({ timeout: DRAWING });
  });

  test('Sketch on a phone has no automatically detectable accessibility problems', async ({ page }) => {
    await openSketch(page);
    await stats(page, ALT.outline);
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    // On iPhone the studio's viewport has maximum-scale=1 (a documented exception, docs/accessibility/README.md).
    const found = result.violations.filter((v) => !(v.id === 'meta-viewport' && test.info().project.name === 'iphone-webkit'));
    expect(found.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });
});
