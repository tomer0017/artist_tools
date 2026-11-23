import { readFile } from 'node:fs/promises';
import { test, expect, type Browser, type Page } from '@playwright/test';

// The commercial admin dashboard, end to end against the production build:
// manual Pro (given, extended, ended, back to Free in one step; next to a paid
// subscription that stays untouched; never on one's own account), the owner's
// account out of other admins' reach, suspension (signs the person out), the recent-sign-in
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

  test('gives Pro for a limited time, extends it, which the person sees, and ends it early', async ({ page, browser }) => {
    await openAccount(page, 'grantee@e2e.test');
    const manual = page.getByRole('region', { name: 'Manage access', exact: true });
    await manual.getByLabel('Change to').selectOption('30');
    await manual.getByLabel('Reason').selectOption('trial');
    await manual.getByRole('button', { name: 'Give Pro for 30 days' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('their billing is not changed');
    await dialog.getByRole('button', { name: 'Give Pro' }).click();
    await expect(manual.getByRole('status')).toContainText('Pro given for 30 days, until');
    const inForce = manual.getByRole('list', { name: 'Manual Pro in force' });
    await expect(inForce).toContainText('Pro until');
    await expect(inForce).toContainText('Trial');
    await expect(page.getByRole('region', { name: 'Access', exact: true })).toContainText('Pro given until');
    await expect(page.getByRole('region', { name: 'Billing', exact: true })).toContainText('None recorded.');

    const grantee = await asPerson(browser, 'grantee');
    await grantee.page.goto('/app/profile');
    await expect(grantee.page.getByRole('region', { name: 'Plan', exact: true })).toContainText('Pro, given by Studio Companion until');
    const me = async () => (await (await grantee.page.request.get('/api/me')).json()).user;
    const first = await me();
    expect(first).toMatchObject({ plan: { assigned: 'free', effective: 'pro' }, grant: { planId: 'pro' } });

    // Extended from its current end, not from today.
    await inForce.getByRole('button', { name: 'Extend' }).click();
    await dialog.getByLabel('By').selectOption('30');
    await expect(dialog).toContainText('New end:');
    await dialog.getByRole('button', { name: 'Extend', exact: true }).click();
    await expect(manual.getByRole('status')).toContainText('Extended by 30 days, until');
    await expect(inForce).toContainText('extended');
    const second = await me();
    expect(new Date(second.grant.endsAt).getTime() - new Date(first.grant.endsAt).getTime()).toBe(30 * 24 * 60 * 60 * 1000);

    // The list says where the access comes from.
    await page.goto('/admin?q=grantee%40e2e.test');
    await expect(page.getByRole('table').getByRole('row', { name: /grantee@e2e\.test/ })).toContainText('Pro · given until');
    await page.getByRole('table').getByRole('link', { name: /grantee@e2e\.test/ }).click();

    await manual.getByRole('button', { name: 'End now' }).click();
    await expect(dialog).toContainText('They go back to Free.');
    await dialog.getByRole('button', { name: 'End now' }).click();
    await expect(manual.getByRole('status')).toContainText('Access ended.');
    expect(await me()).toMatchObject({ plan: { effective: 'free' }, grant: null });
    await expect(page.getByRole('region', { name: 'Activity', exact: true })).toContainText('extended by 30 days');
    await grantee.context.close();
  });

  test('a paying account: manual Pro is given and ended next to the subscription, and billing stays exactly as it was', async ({ page }) => {
    await page.goto('/admin?q=subscriber%40e2e.test');
    const row = page.getByRole('table').getByRole('row', { name: /subscriber@e2e\.test/ });
    await expect(row).toContainText('Pro · paid');
    await expect(row).toContainText('Active');
    await row.getByRole('link').click();
    const billing = page.getByRole('region', { name: 'Billing', exact: true });
    await expect(billing).toContainText('Pro · monthly · $9.90');
    await expect(billing).toContainText('Active · renews');
    await expect(billing.getByRole('list', { name: 'Payments' })).toContainText('Charge $9.90');
    // Read-only: nothing in it can change billing.
    await expect(billing.locator('button, form, input, select')).toHaveCount(0);
    const before = await billing.innerText();

    const manual = page.getByRole('region', { name: 'Manage access', exact: true });
    await manual.getByLabel('Change to').selectOption('7');
    await manual.getByRole('button', { name: 'Give Pro for 7 days' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('They already have Pro through a paid subscription');
    await dialog.getByRole('button', { name: 'Give Pro' }).click();
    await expect(manual.getByRole('status')).toContainText('Pro given for 7 days');
    const why = page.getByRole('region', { name: 'Access', exact: true }).getByRole('list', { name: 'Where access comes from' });
    await expect(why).toContainText('A subscription: active');
    await expect(why).toContainText('Pro given until');

    await manual.getByRole('button', { name: 'End now' }).click();
    await expect(dialog).toContainText('They keep Pro through their paid subscription.');
    await dialog.getByRole('button', { name: 'End now' }).click();
    await expect(manual.getByRole('status')).toContainText('Access ended.');
    await expect(why).not.toContainText('Pro given until');
    await expect(why).toContainText('A subscription: active');
    expect(await billing.innerText()).toBe(before);
  });

  test('cannot change its own access: no manual Pro controls on its own account', async ({ page }) => {
    await openAccount(page, 'admin@e2e.test');
    const manual = page.getByRole('region', { name: 'Manage access', exact: true });
    await expect(manual).toContainText('This is your account.');
    await expect(manual.getByRole('button')).toHaveCount(0);
    await expect(manual.getByRole('combobox')).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Access', exact: true })).toContainText('Every feature (admin)');
  });

  test('takes an account back to Free in one step: every manual Pro ends, billing untouched', async ({ page, browser }) => {
    await openAccount(page, 'freeback@e2e.test');
    const manual = page.getByRole('region', { name: 'Manage access', exact: true });
    const change = manual.getByLabel('Change to');
    // "Free" is offered only while there is manual Pro to end.
    await expect(change.locator('option[value="free"]')).toHaveCount(0);
    await change.selectOption('30');
    await manual.getByRole('button', { name: 'Give Pro for 30 days' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Give Pro' }).click();
    await expect(manual.getByRole('status')).toContainText('Pro given for 30 days');
    await change.selectOption('none');
    await manual.getByRole('button', { name: 'Give Pro with no end date' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Give Pro' }).click();
    await expect(manual.getByRole('status')).toContainText('Pro given with no end date');

    await change.selectOption('free');
    await expect(manual.getByLabel('Reason')).toHaveCount(0);
    await manual.getByRole('button', { name: 'End manual Pro…' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('Pro with no end date and Pro until');
    await expect(dialog).toContainText('They go back to Free.');
    await dialog.getByRole('button', { name: 'End manual Pro' }).click();
    await expect(manual.getByRole('status')).toContainText('Ended: Pro with no end date and Pro for a time.');
    await expect(manual.getByText('None given.')).toBeVisible();

    const person = await asPerson(browser, 'freeback');
    await person.page.goto('/app/profile');
    await expect(person.page.getByRole('region', { name: 'Plan', exact: true })).toContainText('Free');
    await person.context.close();
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

test.describe('configuration, coupons and analytics', () => {
  test.use(as('admin'));

  test('publishes a plan change as a new version and restores the previous one', async ({ page }) => {
    await page.goto('/admin/plans');
    await expect(page.getByRole('heading', { name: 'Plans and features' })).toBeVisible();
    await page.getByRole('button', { name: 'Start a draft' }).click();
    const quota = page.getByLabel('Free quota for Saved images', { exact: true });
    await expect(quota).toBeEnabled();
    await quota.fill('500');
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'saved. Nothing changes until you publish it.' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Changes in this draft' })).toContainText('Free: Saved images unlimited → 500 per month');

    await page.getByRole('button', { name: /^Publish version \d+$/ }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'is live.' })).toBeVisible();
    const history = page.getByRole('region', { name: 'Version history' });
    await expect(history).toContainText('live');

    // Going back: restore version 1 as a draft and publish it.
    await history.getByRole('listitem').filter({ hasText: 'Version 1 ' }).getByRole('button', { name: 'Restore as draft' }).click();
    await expect(page.getByRole('list', { name: 'Changes in this draft' })).toContainText('Free: Saved images 500 per month → unlimited');
    await page.getByRole('button', { name: /^Publish version \d+$/ }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'is live.' })).toBeVisible();
    await expect(page.getByLabel('Free quota for Saved images', { exact: true })).toHaveValue('');
  });

  test('keeps the Pro price as an exact amount, never offered on the public plans page without PayPal', async ({ page }) => {
    await page.goto('/admin/pricing');
    await page.getByRole('button', { name: 'Start a draft' }).click();
    await page.getByLabel('USD per month').fill('9.90');
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByRole('list', { name: 'Changes in this draft' })).toContainText('Monthly Pro price: no price → $9.90 a month');
    await page.getByRole('button', { name: /^Publish version \d+$/ }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'is live.' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'PayPal and the shekel price' })).toContainText('Not set up on this server');

    // This server has no PayPal: Pro is still "coming soon", with no price.
    await page.goto('/pricing');
    expect(await page.locator('main').innerText()).not.toContain('9.90');
  });

  test('creates a coupon and switches it off', async ({ page }) => {
    await page.goto('/admin/coupons');
    const form = page.getByRole('form', { name: 'New coupon' });
    await form.getByLabel('Code').fill('e2e-spring');
    await form.getByLabel('Percent off').fill('25');
    await form.getByRole('button', { name: 'Create coupon' }).click();
    await expect(form.getByRole('status')).toContainText('Coupon created.');
    const row = page.getByRole('region', { name: 'All coupons' }).getByRole('listitem').filter({ hasText: 'E2E-SPRING' });
    await expect(row).toContainText('25% off');
    await expect(row).toContainText('Active');
    await row.getByRole('button', { name: 'Switch off E2E-SPRING' }).click();
    await expect(row).toContainText('Off');
  });

  test('shows product analytics without test accounts', async ({ page }) => {
    await page.goto('/admin/analytics');
    for (const name of ['New accounts', 'Active accounts']) await expect(page.getByRole('figure').filter({ hasText: name })).toBeVisible();
    for (const name of ['Tools used, last 30 days', 'Returning accounts by sign-up week', 'Revenue']) {
      await expect(page.getByRole('heading', { name })).toBeVisible();
    }
    await expect(page.getByRole('region', { name: 'Headline figures' })).toContainText('Accounts');
  });

  test('shows billing read-only, with no payment provider connected', async ({ page }) => {
    await page.goto('/admin/billing');
    await expect(page.getByRole('heading', { level: 1, name: 'Billing' })).toBeVisible();
    await expect(page.getByText('No payment provider is connected yet')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Headline figures' })).toContainText('MRR');
    for (const name of ['Subscriptions', 'Payments and refunds', 'Notifications from the provider', 'Checks against the provider']) {
      await expect(page.getByRole('heading', { name })).toBeVisible();
    }
    // Read-only: nothing on the page can change billing.
    await expect(page.locator('main form, main button')).toHaveCount(0);
  });
});

test.describe('an admin who is not the owner', () => {
  test.use(as('deputy'));

  test("sees the owner's account without any control, and leaves roles to the owner", async ({ page }) => {
    await page.goto('/admin?q=admin%40e2e.test');
    await page.getByRole('table').getByRole('link', { name: /E2E admin/ }).click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText('Owner', { exact: true })).toBeVisible();
    for (const name of ['Manage access', 'Role', 'Password and sessions', 'Status']) {
      const card = page.getByRole('region', { name, exact: true });
      await expect(card, name).toContainText('This is the owner’s account: only the owner can change it.');
      await expect(card.getByRole('button'), name).toHaveCount(0);
    }

    await openAccount(page, 'candidate@e2e.test');
    const role = page.getByRole('region', { name: 'Role', exact: true });
    await expect(role).toContainText('Only the owner can change who is an admin.');
    await expect(role.getByRole('button')).toHaveCount(0);
    // Everything else on other accounts stays theirs to do.
    await expect(page.getByRole('region', { name: 'Manage access', exact: true }).getByRole('button', { name: /^Give Pro/ })).toBeVisible();
  });
});

test.describe('the owner signed in an hour ago', () => {
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

  test('analytics and plans fit a phone', async ({ page }) => {
    for (const path of ['/admin/analytics', '/admin/plans', '/admin/coupons', '/admin/billing']) {
      await page.goto(path);
      await expect(page.locator('h1')).toBeVisible();
      expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
      await page.screenshot({ path: test.info().outputPath(`admin${path.replace(/\//g, '-')}.png`), fullPage: true });
    }
  });

  test('the admin dashboard and an account fit a phone', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
    expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: test.info().outputPath('admin-users.png'), fullPage: true });
    await page.getByRole('list', { name: 'Accounts' }).getByRole('link').first().click();
    for (const name of ['Account', 'Access', 'Manage access', 'Billing', 'Role', 'Status']) {
      await expect(page.getByRole('region', { name, exact: true })).toBeVisible();
    }
    expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: test.info().outputPath('admin-account.png'), fullPage: true });
  });
});
