import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';

// The public sign-in exactly as staging runs it: Google, open to every
// Google-verified account; email and password switched off; no mail at all;
// and a username form for testers whose accounts an admin created (no
// registration with it; e2e/username-accounts.spec.ts). These run against
// the second test server (port 8081, with its own database;
// scripts/e2e-server.ts). Google itself is never contacted: the browser's
// redirect to it is caught.

const signedOut = { storageState: { cookies: [], origins: [] } };
const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

test.describe('signed out', () => {
  test.use(signedOut);

  test('the sign-in page offers Continue with Google, and a username form for invited testers, with no registration, email or reset', async ({ page }) => {
    await page.goto('/sign-in');
    await expect(page.getByRole('heading', { name: 'Sign in to SketchyArtLab' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
    await expect(page.getByText(/your free account is created automatically/)).toBeVisible();
    const form = page.getByRole('form', { name: 'Sign in with a username' });
    await expect(form.getByLabel('Username')).toHaveAttribute('autocomplete', 'username');
    await expect(form.locator('input[type="password"]')).toHaveAttribute('autocomplete', 'current-password');
    // Two fields, the username and its password: no email address anywhere.
    await expect(page.locator('input:not([type="hidden"])')).toHaveCount(2);
    await expect(page.locator('input[type="email"]')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /create an account|forgot/i })).toHaveCount(0);
    await expect(page.getByText(/there is no sign-up with one/)).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/invite-only|create an account|email address and a password/i);
    expect((await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations.map((v) => v.id)).toEqual([]);
  });

  test('in Hebrew the actions read המשך עם Google and כניסה עם שם משתמש', async ({ page }) => {
    await page.goto('/he/sign-in');
    await expect(page.getByRole('heading', { name: 'כניסה ל-SketchyArtLab' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'המשך עם Google' })).toBeEnabled();
    await expect(page.getByRole('form', { name: 'כניסה עם שם משתמש' }).getByLabel('שם משתמש')).toBeVisible();
    await expect(page.locator('input:not([type="hidden"])')).toHaveCount(2);
    await expect(page.locator('body')).not.toContainText(/בהזמנה בלבד|יצירת חשבון|שכחת/);
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

  test('the email password endpoints, the username lookup and the server-only account endpoints do not exist', async ({ request }) => {
    for (const path of [
      'sign-up/email',
      'sign-in/email',
      'request-password-reset',
      'reset-password',
      'send-verification-email',
      'is-username-available',
      'studio/create-username-account',
      'studio/set-username-password',
    ]) {
      const response = await request.post(`/api/auth/${path}`, {
        headers: { origin: 'http://localhost:8081' },
        data: { email: 'someone@example.com', password: 'violet cactus harbor 42', name: 'Someone', username: 'someone', plan: 'pro', locale: 'en' },
      });
      expect(response.status(), path).toBe(404);
    }
    // Username sign-in exists, and says nothing about whether a username does.
    const signIn = await request.post('/api/auth/sign-in/username', {
      headers: { origin: 'http://localhost:8081', 'x-real-ip': '10.67.0.1' },
      data: { username: 'nobody_at_all', password: 'violet cactus harbor 42' },
    });
    expect(signIn.status()).toBe(401);
    expect((await signIn.json()).code).toBe('INVALID_USERNAME_OR_PASSWORD');
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
