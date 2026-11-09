import { test, expect, type Page } from '@playwright/test';
import { photo } from './fixtures/photo';

// Visual parity between the pre-migration Vite app and the app being tested.
//
// The baseline comes from the checkpoint build (tag
// pre-nextjs-migration-2026-11-09, served at /artist_tools/ with hash routes)
// and is machine-specific, so it is not committed:
//   PARITY=vite PARITY_BASE_URL=http://localhost:4180 npx playwright test --update-snapshots
// Later runs compare the current app against it:
//   PARITY=next npx playwright test

const TARGET = process.env.PARITY === 'vite' ? 'vite' : 'next';

/** URL of a view in the app under test ('' = Home). */
function url(view: string): string {
  if (TARGET === 'vite') return view ? `/artist_tools/#/${view}` : '/artist_tools/';
  return view ? `/app/${view}` : '/app';
}

const VIEWPORTS = [
  { name: '375', width: 375, height: 740, mobile: true },
  { name: '390', width: 390, height: 844, mobile: true },
  { name: '820', width: 820, height: 1180, mobile: false },
  { name: '1366', width: 1366, height: 900, mobile: false },
];

const HEADINGS: Record<string, string | RegExp> = {
  '': /Your All-in-One/,
  measure: 'Measure & Plan',
  study: 'Study & Simplify',
  color: 'Color & Mixing',
  grid: 'Create a Grid',
  compare: 'Compare & Correct',
};

async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(async () => {
    await document.fonts.ready;
    for (const img of Array.from(document.images)) {
      img.loading = 'eager';
      await img.decode().catch(() => {});
    }
  });
}

async function upload(page: Page, buttonName: string) {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: buttonName }).first().click(),
  ]);
  await chooser.setFiles(photo);
}

const SHOT = { fullPage: true, animations: 'disabled' as const, maxDiffPixelRatio: 0.001 };

for (const vp of VIEWPORTS) {
  test.describe(`${vp.name}px`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile, hasTouch: vp.mobile });

    for (const view of Object.keys(HEADINGS)) {
      test(`${view || 'home'} (empty)`, async ({ page }) => {
        await page.goto(url(view));
        await expect(page.getByRole('heading', { name: HEADINGS[view] }).first()).toBeVisible();
        await settle(page);
        await expect(page).toHaveScreenshot(`${view || 'home'}-${vp.name}.png`, SHOT);
      });
    }

    test('grid (with photo)', async ({ page }) => {
      await page.goto(url('grid'));
      await upload(page, 'Upload reference photo');
      await expect(page.getByRole('button', { name: 'Save grid image' })).toBeVisible();
      await settle(page);
      await expect(page).toHaveScreenshot(`grid-photo-${vp.name}.png`, SHOT);
    });

    test('study (with photo)', async ({ page }) => {
      await page.goto(url('study'));
      await upload(page, 'Upload reference photo');
      await expect(page.getByRole('radio', { name: /Values/ })).toBeVisible();
      await settle(page);
      await expect(page).toHaveScreenshot(`study-photo-${vp.name}.png`, SHOT);
    });

    test('measure (with photo)', async ({ page }) => {
      await page.goto(url('measure'));
      await upload(page, 'Upload reference photo');
      await expect(page.locator('img[alt="Reference"]')).toBeVisible();
      await settle(page);
      await expect(page).toHaveScreenshot(`measure-photo-${vp.name}.png`, SHOT);
    });
  });
}
