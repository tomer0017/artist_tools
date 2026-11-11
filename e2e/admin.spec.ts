import { readFile } from 'node:fs/promises';
import { test, expect, type Browser, type Page } from '@playwright/test';

// The commercial admin dashboard, end to end against the production build:
// time-limited Pro, suspension (signs the person out), the recent-sign-in
// rule for sensitive changes, list filters, and the activity log's filters
// and CSV export. Signed in as accounts scripts/e2e-server.ts seeds.
//
// Simulated, not real devices: Desktop Chrome, and WebKit with iPhone 13
// emulation for the `mobile` test.

const as = (name: string) => ({ storageState: `e2e/.auth/${name}.json` });
const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

async function openAccount(page: Page, email: string) {
  await page.goto(`/admin?q=${encodeURIComponent(email)}`);
  await page.getByRole('link', { name: new RegExp(email.replace('.', '\\.')) }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

async function asPerson(browser: Browser, name: string) {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, ...as(name) });
  return { context, page: await context.newPage() };
}

test.describe('as an admin', () => {
  test.use(as('admin'));

  test('gives Pro for a limited time, which the person sees, and ends it early', async ({ page, browser }) => {
    await openAccount(page, 'grantee@e2e.test');
    const access = page.getByRole('region', { name: 'Promotional access', exact: true });
    await access.getByLabel('For').selectOption('30');
    await access.getByLabel('Reason').selectOption('trial');
    await access.getByRole('button', { name: 'Give Pro for 30 days' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Give Pro' }).click();
    await expect(access.getByRole('status')).toContainText('Pro given for 30 days');
    await expect(access.getByRole('list', { name: 'Access given' })).toContainText('until');
    await expect(page.getByRole('region', { name: 'Plan and access', exact: true })).toContainText('Pro features (given until');

    const grantee = await asPerson(browser, 'grantee');
    await grantee.page.goto('/app/profile');
    await expect(grantee.page.getByRole('region', { name: 'Plan', exact: true })).toContainText('Pro, given by Studio Companion until');
    expect((await (await grantee.page.request.get('/api/me')).json()).user).toMatchObject({ plan: { assigned: 'free', effective: 'pro' }, grant: { planId: 'pro' } });

    await access.getByRole('button', { name: 'End now' }).click();
    await expect(access.getByRole('status')).toContainText('Access ended.');
    expect((await (await grantee.page.request.get('/api/me')).json()).user).toMatchObject({ plan: { effective: 'free' }, grant: null });
    await grantee.context.close();
  });

  test('suspends an account (signing it out) and reactivates it', async ({ page, browser }) => {
    const suspendee = await asPerson(browser, 'suspendee');
    expect((await suspendee.page.request.get('/api/me')).status()).toBe(200);

    await openAccount(page, 'suspendee@e2e.test');
    const status = page.getByRole('region', { name: 'Status', exact: true });
    await status.getByRole('button', { name: 'Suspend account' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog.getByRole('button', { name: 'Suspend' })).toBeDisabled();
    await dialog.getByLabel('Reason').selectOption('abuse');
    await dialog.getByRole('button', { name: 'Suspend' }).click();
    await expect(status.getByRole('status')).toContainText('Account suspended and signed out everywhere.');
    await expect(status).toContainText('Suspended');
    await expect.poll(async () => (await suspendee.page.request.get('/api/me')).status()).toBe(401);

    // It shows up under the Suspended filter, and in the activity log.
    await page.goto('/admin?status=suspended');
    await expect(page.getByRole('list', { name: 'Accounts' }).or(page.getByRole('table'))).toContainText('suspendee@e2e.test');
    await page.goto('/admin/activity?kind=admin');
    await expect(page.getByRole('region', { name: 'Events' })).toContainText('Account suspended (abuse)');

    await openAccount(page, 'suspendee@e2e.test');
    await status.getByRole('button', { name: 'Reactivate account' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Reactivate' }).click();
    await expect(status.getByRole('status')).toContainText('Account reactivated.');
    await suspendee.context.close();
  });

  test('filters accounts and exports the activity log as CSV', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('Filters', { exact: true }).click();
    const filters = page.getByRole('form', { name: 'Filter accounts' });
    await filters.getByLabel('Role').selectOption('admin');
    await filters.getByRole('button', { name: 'Apply filters' }).click();
    await expect(page).toHaveURL(/role=admin/);
    await expect(page.getByText(/matching the filters/)).toBeVisible();
    await expect(page.getByRole('table')).toContainText('admin@e2e.test');
    await expect(page.getByRole('table')).not.toContainText('grantee@e2e.test');

    await page.goto('/admin/activity');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Export CSV' }).click()]);
    const csv = await readFile((await download.path())!, 'utf8');
    expect(csv.split('\r\n')[0]).toBe('"time_utc","event","account_id","account_email","by","by_email","details"');
    expect(csv).toContain('"user.registered"');
  });
});

test.describe('an admin signed in an hour ago', () => {
  test.use(as('admin-settled'));

  test('is asked to confirm it is them before changing a role', async ({ page }) => {
    await openAccount(page, 'candidate@e2e.test');
    const role = page.getByRole('region', { name: 'Role', exact: true });
    await role.getByRole('button', { name: 'Make admin' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Make admin' }).click();
    await expect(role.getByRole('status')).toContainText('confirm it is you');
    await expect(role.getByText('Confirm it is you', { exact: true })).toBeVisible();
    await expect(role.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
    // Nothing changed.
    await page.reload();
    await expect(page.getByRole('region', { name: 'Role', exact: true }).getByRole('button', { name: 'Make admin' })).toBeVisible();
  });
});

test.describe('mobile', () => {
  test.use({ ...phone, ...as('admin') });

  test('the admin dashboard and an account fit a phone', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
    expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: test.info().outputPath('admin-users.png'), fullPage: true });
    await page.getByRole('list', { name: 'Accounts' }).getByRole('link').first().click();
    for (const name of ['Account', 'Plan and access', 'Role', 'Status', 'Promotional access']) {
      await expect(page.getByRole('region', { name, exact: true })).toBeVisible();
    }
    expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: test.info().outputPath('admin-account.png'), fullPage: true });
  });
});
