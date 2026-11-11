import { test, expect } from '@playwright/test';
import { photo } from './fixtures/photo';

// Browser-side security: every page carries a Content-Security-Policy with a
// fresh nonce, the app runs under it without a single violation (landing,
// sign-in, each tool with a photo, the account page, admin), and oversized
// request bodies are refused before anything reads them.

const violations = (page: import('@playwright/test').Page) => {
  const seen: string[] = [];
  page.on('console', (message) => {
    if (/Content Security Policy|Refused to (load|execute|apply)/i.test(message.text())) seen.push(message.text());
  });
  return seen;
};

test.describe('content security policy', () => {
  test('every page gets its own nonce-based policy', async ({ request }) => {
    const nonces = new Set<string>();
    for (const path of ['/', '/pricing', '/sign-in', '/he', '/app']) {
      const response = await request.get(path);
      const policy = response.headers()['content-security-policy'] ?? '';
      expect(policy, path).toContain("object-src 'none'");
      expect(policy, path).toContain("frame-ancestors 'self'");
      expect(policy, path).toContain("base-uri 'self'");
      const nonce = /'nonce-([^']+)'/.exec(policy)?.[1];
      expect(nonce, path).toBeTruthy();
      nonces.add(nonce!);
      // The page's own scripts carry that nonce.
      expect(await response.text(), path).toContain(`nonce="${nonce}"`);
    }
    expect(nonces.size).toBe(5);
  });

  test('the tools work under the policy without a single violation', async ({ page }) => {
    const seen = violations(page);
    await page.goto('/');
    await page.goto('/sign-in');
    for (const tool of ['measure', 'study', 'color', 'grid', 'compare']) {
      await page.goto(`/app/${tool}`);
      await expect(page.getByRole('navigation', { name: 'Tools' })).toBeVisible();
    }
    // A real image through the browser's blob/data URLs.
    await page.goto('/app/grid');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: /Choose|Upload/ }).first().click()]);
    await chooser.setFiles(photo);
    await page.waitForTimeout(800);
    await page.goto('/app/profile');
    await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();
    expect(seen).toEqual([]);
  });
});

test.describe('admin under the policy', () => {
  test.use({ storageState: 'e2e/.auth/admin.json' });

  test('admin pages run without violations', async ({ page }) => {
    const seen = violations(page);
    for (const path of ['/admin', '/admin/analytics', '/admin/plans', '/admin/activity']) {
      await page.goto(path);
      await expect(page.locator('h1')).toBeVisible();
    }
    expect(seen).toEqual([]);
  });
});

test.describe('request size limits', () => {
  test('oversized bodies are refused before they are read', async ({ request }) => {
    const big = 'x'.repeat(40 * 1024);
    const signIn = await request.post('/api/auth/sign-in/email', { headers: { origin: 'http://localhost:8080' }, data: { email: 'a@e2e.test', password: big } });
    expect(signIn.status()).toBe(413);
    const usage = await request.post('/api/usage', { headers: { origin: 'http://localhost:8080' }, data: { features: ['export.gif'], padding: big } });
    expect(usage.status()).toBe(413);
    const events = await request.post('/api/events', { headers: { origin: 'http://localhost:8080' }, data: { name: 'tool_open', tool: 'color', padding: 'y'.repeat(2048) } });
    expect(events.status()).toBe(413);
    // Normal-sized requests still work.
    expect((await request.post('/api/events', { headers: { origin: 'http://localhost:8080' }, data: { name: 'tool_open', tool: 'color' } })).status()).toBe(200);
  });
});
