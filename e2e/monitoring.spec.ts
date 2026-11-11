import { test, expect } from '@playwright/test';

// First-party error monitoring, end to end: an error a page hits in the
// browser reaches the admin's Errors page without the email address or
// query string it contained, and the endpoint refuses other sites,
// oversized bodies and malformed reports. Desktop Chrome only.

test.describe('error monitoring', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'one browser is enough');

  test('a browser error reaches the admin, without personal data', async ({ page, browser }) => {
    await page.goto('/app');
    await expect(page.getByRole('heading', { name: /Your All-in-One/ })).toBeVisible();
    const reported = page.waitForResponse((r) => r.url().endsWith('/api/client-errors') && r.request().method() === 'POST');
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error('e2e monitoring check for ada@example.com at https://site.test/reset?token=abc123');
      });
    });
    expect((await reported).status()).toBe(200);

    const admin = await browser.newContext({ baseURL: test.info().project.use.baseURL, storageState: 'e2e/.auth/admin.json' });
    const adminPage = await admin.newPage();
    await adminPage.goto('/admin/errors');
    const item = adminPage.getByRole('listitem').filter({ hasText: 'e2e monitoring check for' });
    await expect(item).toContainText('e2e monitoring check for [email] at https://site.test/reset');
    await expect(item).not.toContainText('ada@example.com');
    await expect(item).not.toContainText('token=abc123');
    await item.locator('summary').click();
    await expect(item).toContainText('/app');
    await admin.close();
  });

  test('the endpoint refuses other sites, oversized bodies and malformed reports', async ({ request, baseURL }) => {
    const report = { message: 'x', path: '/app', release: null };
    expect((await request.post('/api/client-errors', { data: report, headers: { origin: 'https://evil.example' } })).status()).toBe(403);
    expect((await request.post('/api/client-errors', { data: { ...report, stack: 'y'.repeat(12_000) }, headers: { origin: baseURL! } })).status()).toBe(413);
    expect((await request.post('/api/client-errors', { data: { ...report, extra: 1 }, headers: { origin: baseURL! } })).status()).toBe(400);
  });
});
