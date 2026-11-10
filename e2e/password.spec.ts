import { readFile } from 'node:fs/promises';
import { test, expect, type Browser, type Page } from '@playwright/test';

// Email + password accounts and the account page's own controls, end to end
// against the production build. The e2e server runs email/password with the
// mail outbox (APP_ENV=test): emails are read the way an admin reads them on
// staging, at /admin/mail. Each describe gets its own client address (nginx
// sets X-Real-IP on the server), so per-IP limits never collide between tests.
//
// Simulated, not real devices: Desktop Chrome, and WebKit with iPhone 13
// emulation for the `mobile` tests.

const signedOut = { cookies: [], origins: [] };
const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const ip = (n: number) => ({ extraHTTPHeaders: { 'x-real-ip': `10.77.0.${n}` } });
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const PASSWORD = 'violet cactus harbor 42';
const NEW_PASSWORD = 'amber falcon orchard 9';

/** The first link of the newest test email to `address` with `subject`, read as an admin. */
async function linkFromOutbox(browser: Browser, address: string, subject: string): Promise<string> {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, storageState: 'e2e/.auth/admin.json' });
  const page = await context.newPage();
  await page.goto('/admin/mail');
  const message = page.getByRole('listitem').filter({ hasText: `To ${address}` }).filter({ hasText: subject }).first();
  await expect(message).toBeVisible();
  await message.locator('summary').click();
  const href = await message.getByRole('link').first().getAttribute('href');
  await context.close();
  return href!;
}

async function signInWithEmail(page: Page, email: string, password: string) {
  const form = page.getByRole('form', { name: 'Sign in with email' });
  await form.getByLabel('Email address').fill(email);
  await form.getByLabel('Password', { exact: true }).fill(password);
  await form.getByRole('button', { name: 'Sign in' }).click();
}

test.describe('email and password', () => {
  test.use({ storageState: signedOut, ...ip(1) });

  test('create an account, confirm it, sign in, reset the password and delete the account', async ({ page, browser }) => {
    const email = 'newcomer-chromium@e2e.test';
    await page.goto('/sign-in');
    await page.getByRole('link', { name: 'Create an account' }).click();
    await expect(page).toHaveURL(/\/sign-up\?callbackURL=%2Fapp$/);
    await expect(page.getByRole('heading', { name: 'Create your free account' })).toBeVisible();
    await expect(page.getByText('Studio Companion is invite-only while we test it.')).toBeVisible();
    await page.getByLabel('Your name').fill('New Artist');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password', { exact: true }).fill('Password1234');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText('That password is too common.')).toBeVisible();
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
    await expect(page.getByRole('status')).toContainText(email);

    // Not usable before the address is confirmed.
    await page.goto('/sign-in');
    await signInWithEmail(page, email, PASSWORD);
    await expect(page.getByRole('status').filter({ hasText: 'Please confirm your email address first' })).toBeVisible();

    // The confirmation link signs this browser in and opens the studio.
    await page.goto(await linkFromOutbox(browser, email, 'Confirm your email address'));
    await expect(page).toHaveURL(/\/app$/);
    const me = (await (await page.request.get('/api/me')).json()).user;
    expect(me).toMatchObject({ email, emailVerified: true, role: 'user', plan: { assigned: 'free' }, methods: { google: false, password: true }, marketingConsent: false });

    // Signing out and back in with the password returns to the page asked for.
    await page.goto('/app/profile');
    await expect(page.getByRole('region', { name: 'Profile', exact: true })).toContainText('Email and password');
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto('/sign-in?callbackURL=%2Fapp%2Fprofile');
    await signInWithEmail(page, email, PASSWORD);
    await expect(page).toHaveURL(/\/app\/profile$/);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/$/);

    // Forgotten password: a link by email, a new password, the old one stops working.
    await page.goto('/sign-in');
    await page.getByRole('link', { name: 'Forgot password?' }).click();
    await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
    await page.getByLabel('Email address').fill(email);
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByRole('status')).toContainText(`If an account uses ${email}`);
    await page.goto(await linkFromOutbox(browser, email, 'Reset your password'));
    await page.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Save new password' }).click();
    await expect(page.getByRole('heading', { name: 'Password changed' })).toBeVisible();
    await page.getByRole('link', { name: 'Sign in' }).click();
    await signInWithEmail(page, email, PASSWORD);
    await expect(page.getByRole('alert').filter({ hasText: 'do not match' })).toBeVisible();
    await signInWithEmail(page, email, NEW_PASSWORD);
    await expect(page).toHaveURL(/\/app$/);

    // Deleting the account (signed in moments ago, so no extra confirmation).
    await page.goto('/app/profile');
    await page.getByRole('button', { name: 'Delete account…' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Delete your account?' });
    await expect(dialog.getByRole('button', { name: 'Delete permanently' })).toBeDisabled();
    await dialog.getByLabel('Type DELETE to confirm').fill('DELETE');
    await dialog.getByRole('button', { name: 'Delete permanently' }).click();
    await expect(page).toHaveURL(/\/\?account=deleted$/);
    await expect(page.getByRole('status').filter({ hasText: 'Your account was deleted.' })).toBeVisible();
    expect((await page.request.get('/api/me')).status()).toBe(401);
    await page.goto('/sign-in');
    await signInWithEmail(page, email, NEW_PASSWORD);
    await expect(page.getByRole('alert').filter({ hasText: 'do not match' })).toBeVisible();
  });

  test('signing up never reveals whether an address already has an account', async ({ page, browser }) => {
    // user@e2e.test already exists (it signs in with Google).
    await page.goto('/sign-up');
    await page.getByLabel('Your name').fill('Somebody');
    await page.getByLabel('Email address').fill('user@e2e.test');
    await page.getByLabel('Password', { exact: true }).fill('quiet lanterns over water');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
    // Only the owner learns why, from their inbox.
    expect(await linkFromOutbox(browser, 'user@e2e.test', 'You already have a Studio Companion account')).toMatch(/\/sign-in$/);
  });
});

test.describe('the account page', () => {
  test.use({ storageState: 'e2e/.auth/editor.json', ...ip(2) });

  test('edits the name and preferences, lists devices and downloads the data', async ({ page }) => {
    await page.goto('/app/profile');
    const profile = page.getByRole('region', { name: 'Profile', exact: true });
    await profile.getByRole('button', { name: 'Edit name' }).click();
    await profile.getByRole('textbox', { name: 'Your name' }).fill('  Edited   Artist ');
    await profile.getByRole('button', { name: 'Save' }).click();
    await expect(profile.getByText('Edited Artist', { exact: true })).toBeVisible();

    const preferences = page.getByRole('region', { name: 'Preferences', exact: true });
    await preferences.getByLabel('Language').selectOption('he');
    await expect(preferences.getByRole('status')).toContainText('Saved.');
    await preferences.getByLabel('Currency').selectOption('ILS');
    const news = preferences.getByRole('switch', { name: 'News by email' });
    await expect(news).toHaveAttribute('aria-checked', 'false');
    await news.click();
    await expect(news).toHaveAttribute('aria-checked', 'true');
    await expect.poll(async () => (await (await page.request.get('/api/me')).json()).user).toMatchObject({
      name: 'Edited Artist',
      locale: 'he',
      currency: 'ILS',
      marketingConsent: true,
    });

    await expect(page.getByRole('region', { name: 'Signed-in devices', exact: true }).getByText('This device')).toBeVisible();
    const methods = page.getByRole('region', { name: 'Sign-in methods', exact: true });
    await expect(methods).toContainText('Connected');
    await expect(methods.getByRole('button', { name: 'Add a password' })).toBeVisible();

    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download my data' }).click()]);
    expect(download.suggestedFilename()).toMatch(/^studio-companion-account-\d{4}-\d{2}-\d{2}\.json$/);
    const data = JSON.parse(await readFile((await download.path())!, 'utf8'));
    expect(data.account).toMatchObject({ name: 'Edited Artist', language: 'he', currency: 'ILS', email: 'editor@e2e.test' });
    expect(data.marketingEmail).toMatchObject({ consent: true });
    expect(data.signInMethods).toEqual([expect.objectContaining({ method: 'google' })]);
    await expect(page.getByRole('status').filter({ hasText: 'Your data was downloaded' })).toBeVisible();
  });

  test('the test mail outbox does not exist for people who are not admins', async ({ page }) => {
    expect((await page.goto('/admin/mail'))!.status()).toBe(404);
  });
});

test.describe('sensitive changes after a while', () => {
  test.use({ storageState: 'e2e/.auth/settled.json', ...ip(3) });

  test('deleting the account asks someone signed in an hour ago to confirm it is them', async ({ page }) => {
    await page.goto('/app/profile');
    await page.getByRole('button', { name: 'Delete account…' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Delete your account?' });
    await dialog.getByLabel('Type DELETE to confirm').fill('DELETE');
    await dialog.getByRole('button', { name: 'Delete permanently' }).click();
    await expect(page.getByText('Confirm it is you')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
    expect((await page.request.get('/api/me')).status()).toBe(200);
  });
});

test.describe('mobile', () => {
  test.use({ ...phone, storageState: signedOut, ...ip(4) });

  test('signing up with email, confirming and the account page all fit a phone', async ({ page, browser }) => {
    const email = `phone-${test.info().project.name}@e2e.test`;
    await page.goto('/sign-up');
    expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
    await page.getByLabel('Your name').fill('Phone Artist');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.screenshot({ path: test.info().outputPath('sign-up.png'), fullPage: true });
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('check-email.png'), fullPage: true });

    await page.goto(await linkFromOutbox(browser, email, 'Confirm your email address'));
    await expect(page).toHaveURL(/\/app$/);
    await page.goto('/app/profile');
    for (const name of ['Profile', 'Preferences', 'Sign-in methods', 'Signed-in devices', 'Your data']) {
      await expect(page.getByRole('region', { name, exact: true })).toBeVisible();
    }
    expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: test.info().outputPath('profile-password.png'), fullPage: true });
  });

  test('the sign-in page offers Google and email on a phone', async ({ page }) => {
    await page.goto('/sign-in');
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
    await expect(page.getByRole('form', { name: 'Sign in with email' })).toBeVisible();
    // 16 px text, so iOS does not zoom into the field.
    expect(await page.getByLabel('Email address').evaluate((el) => getComputedStyle(el).fontSize)).toBe('16px');
    expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: test.info().outputPath('sign-in.png'), fullPage: true });
  });
});
