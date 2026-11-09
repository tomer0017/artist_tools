import { test, expect } from '@playwright/test';

// Authentication and authorization, end to end, against the production build.
// Signing in with Google itself is covered by src/server/auth.test.ts (the full
// OAuth flow with a simulated Google); here the browser-facing guarantees.

const signedOut = { cookies: [], origins: [] };

test.describe('signed out', () => {
  test.use({ storageState: signedOut });

  test('the landing page is public', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: /Your All-in-One/ })).toBeVisible();
  });

  test('the studio, every tool and admin require sign-in, and remember where you were going', async ({ page }) => {
    for (const path of ['/app', '/app/compare', '/app/study', '/admin']) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`/sign-in\\?callbackURL=${encodeURIComponent(path)}$`));
      await expect(page.getByRole('heading', { name: 'Sign in to Studio Companion' })).toBeVisible();
    }
  });

  test('protected APIs refuse anonymous requests', async ({ request }) => {
    const response = await request.get('/api/me');
    expect(response.status()).toBe(401);
    expect(response.headers()['cache-control']).toContain('no-store');
  });

  test('a forged session cookie gets nobody in', async ({ page, context }) => {
    await context.addCookies([{ name: 'sc.session_token', value: 'forged.c2lnbmF0dXJl', domain: 'localhost', path: '/' }]);
    await page.goto('/app');
    await expect(page).toHaveURL(/\/sign-in\?callbackURL=%2Fapp$/);
    expect((await page.request.get('/api/me')).status()).toBe(401);
  });

  test('"Continue with Google" asks Google only for name, email and picture', async ({ page }) => {
    let googleURL = '';
    await page.route('https://accounts.google.com/**', async (route) => {
      googleURL = route.request().url();
      await route.abort();
    });
    await page.goto('/sign-in?callbackURL=%2Fapp%2Fgrid');
    await page.getByRole('button', { name: 'Continue with Google' }).click();
    await expect.poll(() => googleURL).not.toBe('');
    const q = new URL(googleURL).searchParams;
    expect(q.get('client_id')).toBe('e2e-client-id.apps.googleusercontent.com');
    expect(q.get('redirect_uri')).toBe('http://localhost:8080/api/auth/callback/google');
    expect(q.get('scope')!.split(' ').sort()).toEqual(['email', 'openid', 'profile']);
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('state')).toBeTruthy();
  });

  test('sign-in cannot be used to redirect to another site', async ({ page }) => {
    // A crafted link falls back to the studio…
    await page.goto('/sign-in?callbackURL=https%3A%2F%2Fevil.example');
    let googleURL = '';
    await page.route('https://accounts.google.com/**', async (route) => {
      googleURL = route.request().url();
      await route.abort();
    });
    await page.getByRole('button', { name: 'Continue with Google' }).click();
    await expect.poll(() => googleURL).not.toBe('');
    // …and the server refuses an external destination even if asked directly.
    const direct = await page.request.post('/api/auth/sign-in/social', {
      data: { provider: 'google', callbackURL: 'https://evil.example/steal' },
      headers: { origin: 'http://localhost:8080' },
    });
    expect(direct.status()).toBe(403);
  });

  test('a callback Google did not issue is rejected with a readable message', async ({ page }) => {
    await page.goto('/api/auth/callback/google?code=forged&state=forged');
    await expect(page).toHaveURL(/\/sign-in\?/);
    await expect(page.getByRole('alert').filter({ hasText: 'Sign-in did not complete' })).toBeVisible();
    expect((await page.request.get('/api/me')).status()).toBe(401);
  });

  test.describe('mobile', () => {
    test.use({ viewport: { width: 375, height: 740 }, hasTouch: true, isMobile: true });

    test('the sign-in page fits a phone screen', async ({ page }) => {
      await page.goto('/sign-in');
      await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    });
  });
});

test.describe('signed in', () => {
  test('the studio shows who is signed in', async ({ page }) => {
    await page.goto('/app');
    await expect(page.getByText('Signed in as user@e2e.test')).toBeVisible();
  });

  test('a signed-in visitor skips the sign-in page', async ({ page }) => {
    await page.goto('/sign-in?callbackURL=%2Fapp%2Fcolor');
    await expect(page).toHaveURL(/\/app\/color$/);
  });

  test('the plan comes from the server, whatever the browser claims', async ({ page, context }) => {
    await context.addCookies([
      { name: 'plan', value: 'pro', domain: 'localhost', path: '/' },
      { name: 'subscriptionStatus', value: 'active', domain: 'localhost', path: '/' },
    ]);
    await page.goto('/app');
    await page.evaluate(() => localStorage.setItem('plan', 'pro'));
    const response = await page.request.get('/api/me?plan=pro', { headers: { 'x-plan': 'pro' } });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.user.email).toBe('user@e2e.test');
    expect(body.entitlements).toMatchObject({ authenticated: true, accountActive: true, planId: 'free', subscriptionActive: false });
    expect(body.entitlements.features).toContain('tool.compare');
  });

  test('the admin area does not exist for regular users', async ({ page }) => {
    const response = await page.goto('/admin');
    expect(response?.status()).toBe(404);
    await expect(page.getByText('Page not found')).toBeVisible();
  });
});

test.describe('signing out', () => {
  test.use({ storageState: 'e2e/.auth/signout.json' });

  test('ends the session on the server and leaves the studio', async ({ page }) => {
    await page.goto('/app');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/$/);
    expect((await page.request.get('/api/me')).status()).toBe(401);
    await page.goto('/app');
    await expect(page).toHaveURL(/\/sign-in\?/);
  });
});

test.describe('admin', () => {
  test.use({ storageState: 'e2e/.auth/admin.json' });

  test('lists registered users with their plan and last login', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
    const table = page.getByRole('table');
    await expect(table).toContainText('user@e2e.test');
    await expect(table).toContainText('admin@e2e.test');
    await expect(table.getByRole('columnheader', { name: 'Plan' })).toBeVisible();
  });
});

test.describe('health', () => {
  test('reports the process and the database as up', async ({ request }) => {
    expect(await (await request.get('/api/health')).json()).toEqual({ status: 'ok' });
    expect(await (await request.get('/api/health?ready=1')).json()).toEqual({ status: 'ok', config: 'ok', database: 'ok' });
  });

  test('sends basic security headers', async ({ request }) => {
    const headers = (await request.get('/')).headers();
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(headers['referrer-policy']).toBe('same-origin');
    expect(headers['strict-transport-security']).toBe('max-age=31536000');
    expect(headers['x-powered-by']).toBeUndefined();
  });
});
