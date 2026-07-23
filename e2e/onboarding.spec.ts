import { test, expect } from '@playwright/test';

// End-to-end coverage for the Guided Onboarding System: auto-show once, the
// preview → tour flow, spotlight targeting, replay via Help, and completion
// persistence. Runs against the real app in Chromium.
//
// NOTE: Measure deliberately no longer uses the generic preview + spotlight
// tour — it has its own workflow-driven onboarding (see
// src/components/measure/onboarding/). These tests therefore exercise the
// generic system through the Value tool, and assert Measure opts out of it.

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

  // Opening the Value tool auto-shows its preview within ~1s.
  await page.getByRole('button', { name: 'Value' }).click();
  const preview = page.getByRole('dialog', { name: 'Value Study' });
  await expect(preview).toBeVisible({ timeout: 4000 });

  // Value-before-controls: the outcome art is shown before any interface.
  await expect(preview.getByLabel('Original example')).toBeVisible();

  // Enter the guided tour.
  await page.getByRole('button', { name: 'Show me how' }).click();

  const tour = page.getByRole('dialog', { name: 'Guided tour' });
  await expect(tour).toBeVisible();
  await expect(tour.getByText('1 / 4')).toBeVisible();

  // Step through to the end.
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(tour.getByText('2 / 4')).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(tour.getByText('3 / 4')).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(tour.getByText('4 / 4')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // Tour closes and does not re-open.
  await expect(tour).toBeHidden();
  await expect(preview).toBeHidden();
});

test('Help replays a tool onboarding on demand', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Value' }).click();
  const preview = page.getByRole('dialog', { name: 'Value Study' });
  await expect(preview).toBeVisible({ timeout: 4000 });

  // Dismiss (marks it seen).
  await preview.getByRole('button', { name: 'Skip' }).click();
  await expect(preview).toBeHidden();

  // The Help (?) button replays it on demand.
  await page.getByRole('button', { name: 'Show tutorial' }).click();
  await expect(preview).toBeVisible();
});

test('each tool has its own onboarding', async ({ page }) => {
  await page.goto('/');

  // Value auto-shows its own preview.
  await page.getByRole('button', { name: 'Value' }).click();
  const value = page.getByRole('dialog', { name: 'Value Study' });
  await expect(value).toBeVisible({ timeout: 4000 });
  await value.getByRole('button', { name: 'Skip' }).click();

  // Switching to Color auto-shows a different preview.
  await page.getByRole('button', { name: 'Color' }).click();
  await expect(page.getByRole('dialog', { name: 'Color Studio' })).toBeVisible({ timeout: 4000 });
});

test('Measure opts out of the generic tour and uses its own intro', async ({ page }) => {
  await page.goto('/');

  // Measure is the default tab — the generic preview must never appear for it.
  await expect(page.getByRole('dialog', { name: 'Proportion Measure' })).toBeHidden();

  // Its dedicated Help button is present (replay for the workflow intro).
  await expect(page.getByRole('button', { name: 'Show tutorial' })).toBeVisible();
});
