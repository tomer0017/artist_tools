import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { hexToHsv, hsvToHex } from '../src/components/color/colorMath';
import { harmoniesOf, type HarmonyId } from '../src/components/color/harmonies';

// Color & Mixing: the wheel and every harmony on one screen. Choosing a colour
// (dragging the ring or the square, typing a HEX) updates all six harmonies at
// once; a harmony card shows its colours on the wheel; a swatch copies its
// HEX. Desktop Chrome, and phones in Chrome and WebKit (iPhone emulation).

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const IDS: HarmonyId[] = ['complementary', 'splitComplementary', 'analogous', 'triadic', 'warm', 'cool'];

const hexField = (page: Page) => page.getByRole('textbox', { name: /HEX/ });
const card = (page: Page, id: HarmonyId) => page.locator(`[data-harmony="${id}"]`);
const wheel = (page: Page) => page.locator('[data-onboarding="color-wheel"] > div');

/** The colours each card shows, read from its swatches (each shows its HEX). */
async function shownColors(page: Page): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const id of IDS) {
    const texts = await card(page, id).locator('button:not([aria-pressed])').allTextContents();
    out[id] = texts.map((text) => text.match(/#[0-9A-F]{6}/)![0]);
  }
  return out;
}
const expectedColors = (hex: string) => Object.fromEntries(harmoniesOf(hex).map((h) => [h.id, h.colors.map((c) => c.hex.toUpperCase())]));

async function center(locator: Locator) {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}

/** The clipboard as the page sees it, recorded (WebKit cannot read it back in tests). */
async function recordClipboard(page: Page) {
  await page.addInitScript(() => {
    const copied: string[] = [];
    (window as unknown as { copied: string[] }).copied = copied;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { copied.push(text); } } });
  });
}
const copiedTexts = (page: Page) => page.evaluate(() => (window as unknown as { copied: string[] }).copied);

/** No element of the tool sticks out past either side of the screen. */
async function overflowing(page: Page) {
  return page.evaluate(() => {
    const scroller = document.querySelector('.canvas-area') as HTMLElement;
    const left = scroller.getBoundingClientRect().left;
    const right = left + scroller.clientWidth;
    return [...scroller.querySelectorAll<HTMLElement>('*')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && (r.left < left - 0.5 || r.right > right + 0.5);
      })
      .map((el) => `${el.tagName.toLowerCase()} ${el.getAttribute('aria-label') ?? (el.textContent ?? '').slice(0, 24)}`);
  });
}

async function openColor(page: Page) {
  await page.goto('/app/color');
  await expect(page.getByRole('heading', { name: 'Color & Mixing' })).toBeVisible();
  await expect(card(page, 'cool')).toBeVisible();
}

test.describe('Wheel & Harmonies', () => {
  test('the wheel and all six harmonies are on screen together, side by side', async ({ page }) => {
    await openColor(page);
    await expect(page.getByRole('tab')).toHaveText(['Wheel & Harmonies', 'Mixing', 'Skin Tones']);
    await expect(page.getByRole('tab', { name: 'Harmonies', exact: true })).toHaveCount(0);
    await expect(wheel(page)).toBeInViewport({ ratio: 1 });
    await expect(hexField(page)).toBeInViewport({ ratio: 1 });
    const wheelBox = (await wheel(page).boundingBox())!;
    for (const id of IDS) {
      await expect(card(page, id)).toBeInViewport({ ratio: 1 });
      expect((await card(page, id).boundingBox())!.x).toBeGreaterThan(wheelBox.x + wheelBox.width);
    }
    expect(await shownColors(page)).toEqual(expectedColors('#D4827A'));
  });

  test('turning the ring and dragging in the square update every harmony at once', async ({ page }) => {
    await openColor(page);
    const [, s, v] = hexToHsv('#D4827A');
    const { x, y, box } = await center(wheel(page));
    const r = box.width * 0.42; // the middle of the ring

    // 3 o'clock on the ring is hue 90°.
    await page.mouse.click(x + r, y);
    await expect(hexField(page)).toHaveValue(hsvToHex(90, s, v));
    expect(await shownColors(page)).toEqual(expectedColors(hsvToHex(90, s, v)));

    // Dragging round to 6 o'clock (180°): the harmonies follow during the drag.
    await page.mouse.move(x + r, y);
    await page.mouse.down();
    await page.mouse.move(x + r * Math.cos(Math.PI / 4), y + r * Math.sin(Math.PI / 4), { steps: 4 });
    await expect(hexField(page)).toHaveValue(hsvToHex(135, s, v));
    expect(await shownColors(page)).toEqual(expectedColors(hsvToHex(135, s, v)));
    await page.mouse.move(x, y + r, { steps: 4 });
    await page.mouse.up();
    await expect(hexField(page)).toHaveValue(hsvToHex(180, s, v));
    expect(await shownColors(page)).toEqual(expectedColors(hsvToHex(180, s, v)));

    // The square's top right corner: full saturation and brightness.
    const square = (await page.getByRole('slider', { name: 'Saturation and brightness' }).boundingBox())!;
    await page.mouse.click(square.x + square.width - 1, square.y + 1);
    const value = await hexField(page).inputValue();
    expect(hexToHsv(value)[1]).toBeGreaterThanOrEqual(98);
    expect(await shownColors(page)).toEqual(expectedColors(value));

    // Typing a code works too.
    await hexField(page).fill('#2A5FAA');
    expect(await shownColors(page)).toEqual(expectedColors('#2A5FAA'));
  });

  test('a harmony card shows its colours on the wheel at their hues; a dot makes that colour the base', async ({ page }) => {
    await openColor(page);
    await card(page, 'triadic').getByRole('button', { name: 'Triadic', exact: true }).click();
    await expect(card(page, 'triadic').getByRole('button', { name: 'Triadic', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Triadic: tap a dot to make it the base color')).toBeVisible();

    const dots = page.locator('[data-harmony-dot]');
    await expect(dots).toHaveCount(2);
    const middle = await center(wheel(page));
    const [, triA, triB] = harmoniesOf('#D4827A')[3].colors;
    for (const [i, color] of [triA, triB].entries()) {
      const dot = await center(dots.nth(i));
      await expect(dots.nth(i)).toHaveAttribute('data-harmony-dot', color.hex);
      // On the ring (110 px from the centre of the 256 px wheel), at the colour's own hue.
      expect(Math.hypot(dot.x - middle.x, dot.y - middle.y)).toBeCloseTo(110, 0);
      const angle = ((Math.atan2(dot.y - middle.y, dot.x - middle.x) * 180) / Math.PI + 90 + 360) % 360;
      expect(Math.abs(angle - hexToHsv(color.hex)[0])).toBeLessThan(1);
    }

    // One harmony at a time.
    await card(page, 'complementary').getByRole('button', { name: 'Complementary', exact: true }).click();
    await expect(card(page, 'triadic').getByRole('button', { name: 'Triadic', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await expect(dots).toHaveCount(1);

    const comp = harmoniesOf('#D4827A')[0].colors[1].hex;
    await dots.first().click();
    await expect(hexField(page)).toHaveValue(comp);
    expect(await shownColors(page)).toEqual(expectedColors(comp));
    await expect(dots.first()).toHaveAttribute('data-harmony-dot', harmoniesOf(comp)[0].colors[1].hex);
  });

  test('a click on a swatch copies its HEX, with a visible and a spoken confirmation', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openColor(page);
    const triA = harmoniesOf('#D4827A')[3].colors[1].hex;
    const swatch = page.getByRole('button', { name: `Copy Tri A ${triA.toUpperCase()}` });
    await swatch.click();
    await expect(swatch.getByText('Copied')).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Copied' })).toHaveText(`Copied ${triA.toUpperCase()}`);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(triA);
    // Copying does not change the selected colour; the label comes back.
    await expect(hexField(page)).toHaveValue('#D4827A');
    await expect(swatch.getByText(triA.toUpperCase())).toBeVisible();

    await page.getByRole('button', { name: 'Copy HEX' }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('#D4827A');
  });

  test('Mixing and Skin Tones are unchanged, and a recipe colour comes back to the wheel with its harmonies', async ({ page }) => {
    await openColor(page);
    await page.getByRole('tab', { name: 'Mixing' }).click();
    await expect(page.getByText('Grass Green')).toBeVisible();
    await expect(page.getByText('Painter Cheat Sheet')).toBeVisible();
    await page.getByTitle('#4A8C2A').click();
    await page.getByRole('tab', { name: 'Skin Tones' }).click();
    await expect(page.getByText('Medium Skin')).toBeVisible();
    await page.getByRole('tab', { name: 'Wheel & Harmonies' }).click();
    await expect(hexField(page)).toHaveValue('#4A8C2A');
    expect(await shownColors(page)).toEqual(expectedColors('#4A8C2A'));
  });

  test('has no automatically detectable accessibility problems, with a harmony on the wheel and a colour copied', async ({ page }) => {
    await recordClipboard(page);
    await openColor(page);
    await card(page, 'splitComplementary').getByRole('button', { name: 'Split Complementary', exact: true }).click();
    await card(page, 'analogous').getByRole('button', { name: /^Copy −30°/ }).click();
    await expect(card(page, 'analogous').getByText('Copied')).toBeVisible();
    const result = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });

  test.describe('in Hebrew', () => {
    test.use({ locale: 'he-IL' });

    test('the harmonies read from the right, beside a wheel that stays left to right', async ({ page }) => {
      await page.goto('/he/app/color');
      await expect(page.getByRole('heading', { name: 'צבע וערבוב' })).toBeVisible();
      await expect(page.getByRole('tab')).toHaveText(['גלגל והרמוניות', 'ערבוב', 'גווני עור']);
      const wheelBox = (await wheel(page).boundingBox())!;
      expect(await wheel(page).evaluate((el) => getComputedStyle(el).direction)).toBe('ltr');
      for (const id of IDS) {
        await expect(card(page, id)).toBeInViewport({ ratio: 1 });
        expect((await card(page, id).boundingBox())!.x + (await card(page, id).boundingBox())!.width).toBeLessThan(wheelBox.x);
      }
      // Complementary first, on the right.
      expect((await card(page, 'complementary').boundingBox())!.x).toBeGreaterThan((await card(page, 'splitComplementary').boundingBox())!.x);
      await card(page, 'triadic').getByRole('button', { name: 'טריאדי', exact: true }).click();
      await expect(page.getByText('טריאדי: הקשה על נקודה הופכת אותה לצבע הבסיס')).toBeVisible();
      await expect(page.locator('[data-harmony-dot]')).toHaveCount(2);
      const result = await new AxeBuilder({ page }).withTags(WCAG).analyze();
      expect(result.violations.map((v) => v.id)).toEqual([]);
    });
  });
});

test.describe('mobile', () => {
  test.use({ viewport: { width: 390, height: 664 }, isMobile: true, hasTouch: true });

  test('mobile: the wheel leads, the harmonies follow two by two, and nothing is wider than the screen', async ({ page }) => {
    await recordClipboard(page);
    await openColor(page);
    await expect(wheel(page)).toBeInViewport({ ratio: 1 });
    // Two columns, three rows.
    const boxes = await Promise.all(IDS.map(async (id) => (await card(page, id).boundingBox())!));
    expect(new Set(boxes.map((b) => Math.round(b.x))).size).toBe(2);
    expect(new Set(boxes.map((b) => Math.round(b.y))).size).toBe(3);
    expect(await overflowing(page)).toEqual([]);

    // All six fit on the screen together, one short scroll below the wheel.
    await page.locator('#color-harmonies-title').evaluate((el) => el.scrollIntoView({ block: 'start' }));
    for (const id of IDS) await expect(card(page, id)).toBeInViewport({ ratio: 1 });

    // A tap shows the harmony (on the wheel and in the card's own small ring); a tap on a colour copies it.
    await card(page, 'warm').getByRole('button', { name: 'Warm Version', exact: true }).tap();
    await expect(card(page, 'warm').getByRole('button', { name: 'Warm Version', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-harmony-dot]')).toHaveCount(1);
    const warmer = harmoniesOf('#D4827A')[4].colors[1].hex;
    const swatch = page.getByRole('button', { name: `Copy Warmer ${warmer.toUpperCase()}` });
    await swatch.tap();
    await expect(swatch.getByText('Copied')).toBeVisible();
    expect(await copiedTexts(page)).toEqual([warmer]);

    // Turning the ring by touch updates the harmonies.
    await wheel(page).scrollIntoViewIfNeeded();
    const { x, y, box } = await center(wheel(page));
    await page.touchscreen.tap(x - box.width * 0.42, y); // 9 o'clock: 270°
    const [, s, v] = hexToHsv('#D4827A');
    await expect(hexField(page)).toHaveValue(hsvToHex(270, s, v));
    expect(await shownColors(page)).toEqual(expectedColors(hsvToHex(270, s, v)));
    expect(await overflowing(page)).toEqual([]);
  });

  test('mobile: in Hebrew the columns start from the right, still within the screen', async ({ page }) => {
    await page.goto('/he/app/color');
    await expect(page.getByRole('heading', { name: 'צבע וערבוב' })).toBeVisible();
    await expect(wheel(page)).toBeInViewport({ ratio: 1 });
    expect((await card(page, 'complementary').boundingBox())!.x).toBeGreaterThan((await card(page, 'splitComplementary').boundingBox())!.x);
    expect(await overflowing(page)).toEqual([]);
    const result = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    // On iPhone the studio's viewport has maximum-scale=1 (a documented exception, docs/accessibility/README.md).
    const found = result.violations.filter((v) => !(v.id === 'meta-viewport' && test.info().project.name === 'iphone-webkit'));
    expect(found.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });

  test.describe('on a 320 px phone', () => {
    test.use({ viewport: { width: 320, height: 568 } });

    test('mobile: two columns still fit, in English and Hebrew', async ({ page }) => {
      await openColor(page);
      expect(await overflowing(page)).toEqual([]);
      const boxes = await Promise.all(IDS.map(async (id) => (await card(page, id).boundingBox())!));
      expect(new Set(boxes.map((b) => Math.round(b.x))).size).toBe(2);
      await page.goto('/he/app/color');
      await expect(card(page, 'cool')).toBeVisible();
      expect(await overflowing(page)).toEqual([]);
    });
  });
});
