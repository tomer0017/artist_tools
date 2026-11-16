import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';

// The public sign-in exactly as staging runs it: Google only, open to every
// Google-verified account, email and password switched off, no mail at all.
// These run against the second test server (port 8081, with its own
// database; scripts/e2e-server.ts). Google itself is never contacted: the
// browser's redirect to it is caught.

const signedOut = { storageState: { cookies: [], origins: [] } };
const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

test.describe('signed out', () => {
  test.use(signedOut);

  test('the sign-in page has one action, Continue with Google, and nothing about passwords, registration or invitations', async ({ page }) => {
    await page.goto('/sign-in');
    await expect(page.getByRole('heading', { name: 'Sign in to Studio Companion' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
    await expect(page.getByText(/your free account is created automatically/)).toBeVisible();
    await expect(page.getByRole('textbox')).toHaveCount(0);
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /create an account|forgot/i })).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(/invite|create an account|forgot/i);
    expect((await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations.map((v) => v.id)).toEqual([]);
  });

  test('in Hebrew the one action reads המשך עם Google', async ({ page }) => {
    await page.goto('/he/sign-in');
    await expect(page.getByRole('heading', { name: 'כניסה ל-Studio Companion' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'המשך עם Google' })).toBeEnabled();
    await expect(page.getByRole('textbox')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(/הזמנה|יצירת חשבון|שכחת/);
    expect((await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations.map((v) => v.id)).toEqual([]);
  });

  test('there is no separate registration: its addresses, and the password pages, lead to sign-in', async ({ page }) => {
    await page.goto('/sign-up?callbackURL=%2Fapp%2Fcompare');
    await expect(page).toHaveURL(/\/sign-in\?callbackURL=%2Fapp%2Fcompare$/);
    await page.goto('/he/sign-up');
    await expect(page).toHaveURL(/\/he\/sign-in\?callbackURL=%2Fapp$/);
    for (const path of ['/forgot-password', '/reset-password?token=abcdefgh']) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/sign-in$/);
    }
    await page.goto('/he/forgot-password');
    await expect(page).toHaveURL(/\/he\/sign-in$/);
  });

  test('the password endpoints do not exist', async ({ request }) => {
    for (const path of ['sign-up/email', 'sign-in/email', 'request-password-reset', 'reset-password', 'send-verification-email']) {
      const response = await request.post(`/api/auth/${path}`, {
        headers: { origin: 'http://localhost:8081' },
        data: { email: 'someone@example.com', password: 'violet cactus harbor 42', name: 'Someone' },
      });
      expect(response.status(), path).toBe(404);
    }
  });

  test('Continue with Google sends anyone to Google, asking only for openid, email and profile, with state and PKCE', async ({ page }) => {
    await page.route('https://accounts.google.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>Google</p>' }));
    await page.goto('/sign-in');
    const [request] = await Promise.all([
      page.waitForRequest((r) => r.url().startsWith('https://accounts.google.com/')),
      page.getByRole('button', { name: 'Continue with Google' }).click(),
    ]);
    const url = new URL(request.url());
    expect(url.searchParams.get('client_id')).toBe('e2e-client-id.apps.googleusercontent.com');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:8081/api/auth/callback/google');
    expect(url.searchParams.get('scope')?.split(' ').sort()).toEqual(['email', 'openid', 'profile']);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(url.searchParams.get('prompt')).toBe('select_account');
  });
});

test.describe('a Google account that has just registered', () => {
  test.use({ storageState: 'e2e/.auth/google-newcomer.json' });

  test('goes straight into the studio, on Free, with no admin access and no password settings', async ({ page }) => {
    await page.goto('/sign-in');
    await expect(page).toHaveURL(/\/app$/);
    expect((await page.goto('/admin'))?.status()).toBe(404);
    expect((await page.goto('/admin/users'))?.status()).toBe(404);
    await page.goto('/app/profile');
    await expect(page.getByRole('region', { name: 'Plan', exact: true })).toContainText('Free');
    await expect(page.getByRole('region', { name: 'Sign-in methods' })).toContainText('Google');
    await expect(page.getByText('Email and password', { exact: true })).toHaveCount(0);
  });
});

test.describe('the admin', () => {
  test.use({ storageState: 'e2e/.auth/google-admin.json' });

  test('sees the new account in the dashboard, with its registration date, and that registration is open', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.getByText(/Registration is open/)).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Registered' })).toBeVisible();
    await expect(page.getByRole('table')).toContainText('google-newcomer@e2e.test');
  });
});

test.describe('mobile', () => {
  test.use({ ...signedOut, ...phone });

  test('the one Google button fits a phone, in English and Hebrew', async ({ page }) => {
    for (const [path, name] of [['/sign-in', 'Continue with Google'], ['/he/sign-in', 'המשך עם Google']]) {
      await page.goto(path);
      const box = (await page.getByRole('button', { name }).boundingBox())!;
      const width = page.viewportSize()!.width;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  });
});
