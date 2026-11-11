import { createHmac } from 'node:crypto';
import { test, expect, type Browser } from '@playwright/test';

// Two-factor verification for administrators, end to end, with four
// sessions of one admin account (scripts/e2e-server.ts): set it up with an
// authenticator code, see another session sent to verify first, get in with
// an authenticator code and with a one-time recovery code, admin API routes
// refused until verified, then turn it off. Desktop Chrome only.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** What an authenticator app shows for this setup key, `offset` 30-second steps from now. */
function totp(setupKey: string, offset = 0): string {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of setupKey.replace(/\s/g, '')) {
    value = (value << 5) | ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + offset));
  const mac = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  const o = mac[mac.length - 1] & 15;
  return String((((mac[o] & 127) << 24) | (mac[o + 1] << 16) | (mac[o + 2] << 8) | mac[o + 3]) % 1_000_000).padStart(6, '0');
}

async function session(browser: Browser, name: string) {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, storageState: `e2e/.auth/${name}.json` });
  return { context, page: await context.newPage() };
}

test.describe.serial('admin two-factor verification', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'one browser is enough');

  let setupKey = '';
  let recoveryCodes: string[] = [];

  test('is set up with an authenticator app and gives ten one-time recovery codes', async ({ browser }) => {
    const { context, page } = await session(browser, 'admin-mfa');
    await page.goto('/admin/security');
    await expect(page.getByRole('heading', { name: 'Security', level: 1 })).toBeVisible();
    await expect(page.getByText('Not set up.')).toBeVisible();
    await page.getByRole('button', { name: 'Set up two-factor verification' }).click();

    await expect(page.getByRole('img', { name: 'QR code for your authenticator app' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open in an authenticator app' })).toHaveAttribute('href', /^otpauth:\/\/totp\/Studio%20Companion:admin-mfa%40e2e\.test\?secret=[A-Z2-7]+&issuer=Studio\+Companion/);
    setupKey = (await page.getByTestId('mfa-setup-key').innerText()).replace(/\s/g, '');
    expect(setupKey).toMatch(/^[A-Z2-7]{32}$/);

    // A wrong code is refused.
    const code = page.getByLabel('2. Enter the 6-digit code the app shows');
    await code.fill(totp(setupKey) === '000000' ? '111111' : '000000');
    await page.getByRole('button', { name: 'Turn on two-factor verification' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'That code did not work' })).toBeVisible();

    await code.fill(totp(setupKey));
    await page.getByRole('button', { name: 'Turn on two-factor verification' }).click();
    const list = page.getByRole('list', { name: 'Recovery codes' });
    await expect(list.getByRole('listitem')).toHaveCount(10);
    recoveryCodes = await list.getByRole('listitem').allInnerTexts();
    expect(recoveryCodes[0]).toMatch(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/);
    await page.getByRole('button', { name: 'I have saved them' }).click();
    await expect(page.getByText(/On since \d/)).toBeVisible();
    await expect(page.getByText('10 of 10 recovery codes left.')).toBeVisible();
    // This session set it up, so it stays verified.
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
    await context.close();
  });

  test('another session must enter a code before any admin page, and admin routes refuse it until then', async ({ browser }) => {
    const { context, page } = await session(browser, 'admin-mfa-2');
    expect((await page.request.get('/admin/activity/export')).status()).toBe(404);
    await page.goto('/admin/analytics');
    await expect(page).toHaveURL(/\/admin\/verify\?returnTo=%2Fadmin%2Fanalytics$/);
    await expect(page.getByRole('navigation', { name: 'Admin sections' })).toHaveCount(0);
    // The code used to set it up was used; the next one works.
    await page.getByLabel('Code from your authenticator app').fill(totp(setupKey, 1));
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(/\/admin\/analytics$/);
    await expect(page.getByRole('heading', { name: 'Analytics', level: 1 })).toBeVisible();
    expect((await page.request.get('/admin/activity/export')).status()).toBe(200);
    await context.close();
  });

  test('a recovery code gets in once', async ({ browser }) => {
    const { context, page } = await session(browser, 'admin-mfa-3');
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin\/verify/);
    await page.getByRole('button', { name: 'Lost your phone? Use a recovery code' }).click();
    await page.getByLabel('Recovery code').fill(recoveryCodes[0].toLowerCase());
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
    await context.close();

    const other = await session(browser, 'admin-mfa-4');
    await other.page.goto('/admin');
    await other.page.getByRole('button', { name: 'Lost your phone? Use a recovery code' }).click();
    await other.page.getByLabel('Recovery code').fill(recoveryCodes[0]);
    await other.page.getByRole('button', { name: 'Continue' }).click();
    await expect(other.page.getByRole('alert').filter({ hasText: 'That code did not work' })).toBeVisible();
    await other.context.close();
  });

  test('is turned off with a code, after which admin pages open without one', async ({ browser }) => {
    const { context, page } = await session(browser, 'admin-mfa');
    await page.goto('/admin/security');
    await expect(page.getByText('9 of 10 recovery codes left.')).toBeVisible();
    await page.getByRole('button', { name: 'Turn off…' }).click();
    await page.getByLabel(/to turn two-factor verification off/).fill(recoveryCodes[1]);
    await page.getByRole('button', { name: 'Turn off', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Two-factor verification is off.');
    await expect(page.getByText('Not set up.')).toBeVisible();
    await context.close();

    const other = await session(browser, 'admin-mfa-4');
    await other.page.goto('/admin');
    await expect(other.page.getByRole('heading', { name: 'Users' })).toBeVisible();
    await other.context.close();
  });
});
