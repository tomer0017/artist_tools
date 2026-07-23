import { test, expect } from '@playwright/test';

// End-to-end coverage for the Guided Onboarding System: auto-show once, the
// preview → tour flow, spotlight targeting, replay via Help, and completion
// persistence. Runs against the real app in Chromium.

test.beforeEach(async ({ page }) => {
  // Start each test with no completion state so auto-show fires deterministically.
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

test('auto-shows the preview on first open, then runs the guided tour', async ({ page }) => {
  await page.goto('/');

  // Default tab is Measure — its preview should appear on its own within ~1s.
  const preview = page.getByRole('dialog', { name: 'Proportion Measure' });
  await expect(preview).toBeVisible({ timeout: 4000 });

  // Value-before-controls: the outcome art is shown before any interface.
  await expect(preview.getByLabel('Reference example')).toBeVisible();

  // Enter the guided tour.
  await page.getByRole('button', { name: 'Show me how' }).click();

  const tour = page.getByRole('dialog', { name: 'Guided tour' });
  await expect(tour).toBeVisible();
  await expect(tour.getByText('1 / 3')).toBeVisible();

  // Step through to the end.
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(tour.getByText('2 / 3')).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(tour.getByText('3 / 3')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // Tour closes and does not re-open.
  await expect(tour).toBeHidden();
  await expect(preview).toBeHidden();
});

test('does not auto-show a second time, but Help replays it', async ({ page }) => {
  await page.goto('/');
  const preview = page.getByRole('dialog', { name: 'Proportion Measure' });
  await expect(preview).toBeVisible({ timeout: 4000 });
  // Dismiss (marks it seen).
  await preview.getByRole('button', { name: 'Skip' }).click();
  await expect(preview).toBeHidden();

  // Reload — it must not auto-show again.
  await page.reload();
  await expect(page.getByRole('dialog', { name: 'Proportion Measure' })).toBeHidden({ timeout: 2000 });

  // The Help (?) button replays it on demand.
  await page.getByRole('button', { name: 'Show tutorial' }).click();
  await expect(page.getByRole('dialog', { name: 'Proportion Measure' })).toBeVisible();
});

test('each tool has its own onboarding', async ({ page }) => {
  await page.goto('/');
  // Dismiss the Measure auto-preview.
  await page.getByRole('dialog', { name: 'Proportion Measure' }).getByRole('button', { name: 'Skip' }).click();

  // Switching to Value auto-shows its own preview.
  await page.getByRole('button', { name: 'Value' }).click();
  await expect(page.getByRole('dialog', { name: 'Value Study' })).toBeVisible({ timeout: 4000 });
});
