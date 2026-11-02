import { test, expect } from '@playwright/test';

// End-to-end coverage for the Guided Onboarding System after the redesign:
// tutorials never open by themselves (each screen explains itself), but every
// tool's Help (?) button replays its tour on demand. Measure and Compare keep
// their own workflow intros instead of the generic tour.

test.beforeEach(async ({ page }) => {
  // Start each test with no completion state, so "never auto-opens" is tested
  // against a genuine first visit.
  await page.addInitScript(() => {
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith('studio-onboarding-'))
        .forEach((k) => localStorage.removeItem(k));
    } catch {
      /* ignore */
    }
  });
});

test('tutorials do not open on their own, even on a first visit', async ({ page }) => {
  await page.goto('/artist_tools/#/study');
  await expect(page.getByRole('heading', { name: 'Study & Simplify' })).toBeVisible();
  // Give the old 450ms auto-start delay ample time to (not) fire.
  await page.waitForTimeout(1500);
  await expect(page.getByRole('dialog', { name: 'Value Study' })).toBeHidden();

  await page.goto('/artist_tools/#/color');
  await page.waitForTimeout(1500);
  await expect(page.getByRole('dialog', { name: 'Color Studio' })).toBeHidden();

  await page.goto('/artist_tools/#/compare');
  await page.waitForTimeout(1500);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('Help replays the preview and the guided tour on demand', async ({ page }) => {
  await page.goto('/artist_tools/#/study');
  await page.getByRole('button', { name: 'Show tutorial' }).click();

  const preview = page.getByRole('dialog', { name: 'Value Study' });
  await expect(preview).toBeVisible();
  await expect(preview.getByLabel('Original example')).toBeVisible();

  await page.getByRole('button', { name: 'Show me how' }).click();
  const tour = page.getByRole('dialog', { name: 'Guided tour' });
  await expect(tour).toBeVisible();
  await expect(tour.getByText('1 / 4')).toBeVisible();
  for (const n of [2, 3, 4]) {
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(tour.getByText(`${n} / 4`)).toBeVisible();
  }
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(tour).toBeHidden();
  await expect(preview).toBeHidden();
});

test('each tool replays its own onboarding', async ({ page }) => {
  await page.goto('/artist_tools/#/study');
  await page.getByRole('button', { name: 'Show tutorial' }).click();
  const value = page.getByRole('dialog', { name: 'Value Study' });
  await expect(value).toBeVisible();
  await value.getByRole('button', { name: 'Skip' }).click();

  await page.getByRole('link', { name: 'Color' }).click();
  await expect(page.getByRole('heading', { name: 'Color & Mixing' })).toBeVisible();
  await page.getByRole('button', { name: 'Show tutorial' }).click();
  await expect(page.getByRole('dialog', { name: 'Color Studio' })).toBeVisible();
});

test('Measure never shows the generic tour', async ({ page }) => {
  await page.goto('/artist_tools/#/measure');
  await expect(page.getByRole('heading', { name: 'Measure & Plan' })).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(page.getByRole('dialog', { name: 'Proportion Measure' })).toBeHidden();
});
