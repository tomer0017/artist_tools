import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Browser } from '@playwright/test';

// Admin → Companion (ADR-0024) as the owner uses it: settings, access and
// tips saved live, checked where it matters: what a Free account gets from
// /api/companion right after the save. Runs last on the plan-enforcement
// server (port 8082), one test at a time: it changes the live configuration.

test.describe.configure({ mode: 'serial' });

type Account = { username: string; password: string; id: string };
const accounts = (): Record<string, Account> => JSON.parse(readFileSync('e2e/.auth/entitlement-accounts.json', 'utf8'));
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

let visitors = 0;
async function free(browser: Browser) {
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    storageState: { cookies: [], origins: [] },
    extraHTTPHeaders: { 'x-real-ip': `10.84.${test.info().workerIndex % 250}.${++visitors % 250}` },
    locale: 'en-US',
  });
  const page = await context.newPage();
  const who = accounts().ENT_Free;
  await page.goto('/sign-in');
  const form = page.getByRole('form', { name: 'Sign in with a username' });
  await form.locator('input[name="username"]').fill(who.username);
  await form.locator('input[name="password"]').fill(who.password);
  await form.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/app$/);
  return { context, page };
}

type View = { features: Record<string, string>; settings: { size: number; enabled: boolean }; tips: { id: string; text: { en: string } }[] };

async function admin(browser: Browser) {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, storageState: 'e2e/.auth/ent-admin.json', locale: 'en-US' });
  const page = await context.newPage();
  await page.goto('/admin/companion');
  await expect(page.getByRole('heading', { name: 'Sketchy, the studio companion' })).toBeVisible();
  return { context, page };
}

test('the page shows every section, previews every animation, and passes the accessibility checks', async ({ browser }) => {
  const { context, page } = await admin(browser);
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Who may use what' })).toBeVisible();
  await expect(page.locator('[data-tip]')).not.toHaveCount(0);
  for (const id of ['walk', 'celebrate', 'holdSign', 'draw']) await page.locator(`[data-preview-play="${id}"]`).click();
  await page.locator('[data-tip="T-001"] [data-tip-action="preview"]').click();
  await expect(page.locator('[data-companion-preview] [data-sketchy-sign="T-001"]')).toBeVisible();
  await page.getByRole('button', { name: 'עברית' }).click();
  await expect(page.locator('[data-companion-preview] [data-sketchy-sign="T-001"]')).toContainText('סקצ׳י');
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);
  await context.close();
});

test('a new tip and a settings change are live for a Free account at once', async ({ browser }) => {
  const { context, page } = await admin(browser);
  await page.locator('[data-add-tip]').click();
  const editor = page.locator('[data-tip-editor="new"]');
  await editor.locator('[data-field="tip-text-en"]').fill('Sketchy e2e: try a quick gesture drawing.');
  await editor.locator('[data-field="tip-text-he"]').fill('בדיקה: רישום תנועה מהיר.');
  await editor.locator('[data-field="trigger"]').selectOption('menu');
  await editor.locator('[data-field="category"]').selectOption('drawing');
  await editor.locator('[data-field="access"]').selectOption('free');
  await editor.locator('[data-tip-save]').click();
  await expect(page.getByText(/added · live now/)).toBeVisible();
  // A range input: set it as a person dragging it would (React hears the input event).
  await page.locator('[data-setting="size"]').evaluate((el: HTMLInputElement) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, '120');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('[data-save-settings]').click();
  await expect(page.getByText(/Settings saved · live now/)).toBeVisible();

  const { context: learner, page: studio } = await free(browser);
  const view = (await (await studio.request.get('/api/companion')).json()) as View;
  expect(view.settings.size).toBe(120);
  expect(view.tips.some((t) => t.text.en === 'Sketchy e2e: try a quick gesture drawing.')).toBe(true);
  await learner.close();
  await context.close();
});

test('access: a capability made Pro is locked for Free, and Sketchy switched off disappears from the studio', async ({ browser }) => {
  const { context, page } = await admin(browser);
  await page.locator('[data-access="roulette"]').selectOption('pro');
  await page.locator('[data-save-access]').click();
  await expect(page.getByText(/Access saved · live now/)).toBeVisible();
  const { context: learner, page: studio } = await free(browser);
  expect(((await (await studio.request.get('/api/companion')).json()) as View).features.roulette).toBe('locked');

  await page.locator('[data-setting="enabled"]').click();
  await page.locator('[data-save-settings]').click();
  await expect(page.getByText(/Settings saved · live now/)).toBeVisible();
  const me = (await (await studio.request.get('/api/me?check=1')).json()) as { user: { companion: { show: boolean } } };
  expect(me.user.companion.show).toBe(false);
  await studio.goto('/app');
  await studio.waitForTimeout(3500);
  await expect(studio.locator('[data-sketchy-fox]')).toHaveCount(0);

  // Back as it was: on, and the roulette Free again.
  await page.reload();
  await page.locator('[data-setting="enabled"]').click();
  await page.locator('[data-save-settings]').click();
  await expect(page.getByText(/Settings saved · live now/)).toBeVisible();
  await page.locator('[data-access="roulette"]').selectOption('free');
  await page.locator('[data-save-access]').click();
  await expect(page.getByText(/Access saved · live now/)).toBeVisible();
  expect(((await (await studio.request.get('/api/companion')).json()) as View).features.roulette).toBe('open');
  await learner.close();
  await context.close();
});

test('archive and restore a tip; restore an earlier version', async ({ browser }) => {
  const { context, page } = await admin(browser);
  await page.locator('[data-tip="T-002"] [data-tip-action="archive"]').click();
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.getByText(/Tip T-002 archived · live now/)).toBeVisible();
  const { context: learner, page: studio } = await free(browser);
  expect(((await (await studio.request.get('/api/companion')).json()) as View).tips.some((t) => t.id === 'T-002')).toBe(false);
  await page.reload();
  await page.locator('select[aria-label="Status"]').selectOption('archived');
  await page.locator('[data-tip="T-002"] [data-tip-action="restore"]').click();
  await expect(page.getByText(/Tip T-002 restored · live now/)).toBeVisible();
  expect(((await (await studio.request.get('/api/companion')).json()) as View).tips.some((t) => t.id === 'T-002')).toBe(true);
  // Version 1 (the first save: the tip added above) comes back as a new version.
  await page.reload();
  await page.locator('[data-restore-version="1"]').click();
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(page.getByText(/Version 1 restored · live now/)).toBeVisible();
  await learner.close();
  await context.close();
});
