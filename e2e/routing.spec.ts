import { test, expect } from '@playwright/test';

// Routing introduced by the Next.js migration: a public landing page at /, the
// studio under /app, and old hash links (/#/compare) still reaching their tool.

test('the public landing page opens the studio', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Your All-in-One/ })).toBeVisible();
  await page.getByRole('link', { name: 'Open the studio' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole('link', { name: /^Compare & Correct:/ })).toBeVisible();
});

test('links from the old hash URLs open the right tool', async ({ page }) => {
  await page.goto('/#/compare');
  await expect(page).toHaveURL(/\/app\/compare$/);
  await expect(page.getByRole('heading', { name: 'Compare & Correct' })).toBeVisible();

  await page.goto('/#/study');
  await expect(page).toHaveURL(/\/app\/study$/);
  await expect(page.getByRole('heading', { name: 'Study & Simplify' })).toBeVisible();
});

test('old hash links to an unknown tool land on Home', async ({ page }) => {
  await page.goto('/#/nope');
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole('link', { name: /^Measure & Plan:/ })).toBeVisible();
});

test('every tool has its own URL, and reloading keeps the tool open', async ({ page }) => {
  for (const [path, heading] of [
    ['/app/measure', 'Measure & Plan'],
    ['/app/study', 'Study & Simplify'],
    ['/app/color', 'Color & Mixing'],
    ['/app/grid', 'Create a Grid'],
    ['/app/compare', 'Compare & Correct'],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
  }
});
