import { test, expect, type Browser, type Page } from '@playwright/test';

// English and Hebrew on the public pages and account email, end to end:
// /he addresses, the language switch, Accept-Language, right-to-left layout,
// and the studio staying English until it is translated (Phase 3b).
//
// Simulated, not real devices: Desktop Chrome, and WebKit with iPhone 13
// emulation for the `mobile` test.

const signedOut = { cookies: [], origins: [] };
const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
/** The page's language and direction, waiting for the page that is loading. */
async function expectDirection(page: Page, lang: string, dir: string) {
  await expect(page.locator('html')).toHaveAttribute('lang', lang);
  await expect(page.locator('html')).toHaveAttribute('dir', dir);
}

async function linkFromOutbox(browser: Browser, address: string, subject: string) {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, storageState: 'e2e/.auth/admin.json' });
  const page = await context.newPage();
  await page.goto('/admin/mail');
  const message = page.getByRole('listitem').filter({ hasText: `To ${address}` }).filter({ hasText: subject }).first();
  await expect(message).toBeVisible();
  await context.close();
}

test.describe('Hebrew public pages', () => {
  // Forwarded headers as nginx sends them. (Behind the real nginx, /he once
  // failed in a way these local runs could not reproduce; staging is checked
  // directly after every deploy.)
  test.use({ storageState: signedOut, extraHTTPHeaders: { 'x-real-ip': '10.88.0.1', 'x-forwarded-proto': 'https' } });

  test('/he is the landing page in Hebrew, right to left, with language alternates for search engines', async ({ page }) => {
    await page.goto('/he');
    await expectDirection(page, 'he', 'rtl');
    await expect(page.getByRole('heading', { name: 'חמישה כלים, סטודיו אחד' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'מדידה ותכנון' })).toBeVisible();
    // Absolute addresses (metadataBase), as search engines prefer.
    await expect(page.locator('link[rel="alternate"][hreflang="he"]')).toHaveAttribute('href', /^https?:\/\/[^/]+\/he$/);
    await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute('href', /^https?:\/\/[^/]+\/?$/);
    // Links stay in Hebrew.
    await page.getByRole('navigation', { name: 'האתר' }).getByRole('link', { name: 'מסלולים' }).click();
    await expect(page).toHaveURL(/\/he\/pricing$/);
    await expect(page.getByRole('heading', { name: 'מסלולים', level: 1 })).toBeVisible();
  });

  test('the language switch moves between English and Hebrew and remembers the choice', async ({ page }) => {
    await page.goto('/pricing');
    await expectDirection(page, 'en', 'ltr');
    await page.getByRole('group', { name: 'Choose a language' }).getByRole('button', { name: 'עברית' }).click();
    await expect(page).toHaveURL(/\/he\/pricing$/);
    await expectDirection(page, 'he', 'rtl');
    await expect(page.getByRole('region', { name: 'חינמי', exact: true })).toContainText('זמין עכשיו');
    // Remembered: an unprefixed page now opens in Hebrew too.
    await page.goto('/sign-in');
    await expect(page.getByRole('heading', { name: 'כניסה ל-Studio Companion' })).toBeVisible();
    await page.getByRole('group', { name: 'בחירת שפה' }).getByRole('button', { name: 'English' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in to Studio Companion' })).toBeVisible();
    await expectDirection(page, 'en', 'ltr');
  });

  test('sign-in errors are explained in Hebrew, and email fields stay left to right', async ({ page }) => {
    await page.goto('/he/sign-in?error=not_invited');
    await expect(page.getByRole('alert').filter({ hasText: 'בהזמנה בלבד' })).toBeVisible();
    await expect(page.getByLabel('כתובת אימייל')).toHaveAttribute('dir', 'ltr');
  });

  test('a Hebrew sign-up gets its confirmation email in Hebrew', async ({ page, browser }) => {
    test.skip(test.info().project.name !== 'chromium', 'one browser is enough');
    await page.goto('/he/sign-up');
    await page.getByLabel('שם').fill('אמנית חדשה');
    await page.getByLabel('כתובת אימייל').fill('hebrew-chromium@e2e.test');
    await page.getByLabel('סיסמה', { exact: true }).fill('violet cactus harbor 42');
    await page.getByRole('button', { name: 'יצירת חשבון' }).click();
    await expect(page.getByRole('heading', { name: 'בדיקת האימייל' })).toBeVisible();
    await linkFromOutbox(browser, 'hebrew-chromium@e2e.test', 'אישור כתובת האימייל');
  });
});

test.describe('the browser language', () => {
  test.use({ storageState: signedOut, locale: 'he-IL' });

  test('a Hebrew browser gets Hebrew pages without choosing anything', async ({ page }) => {
    await page.goto('/');
    await expectDirection(page, 'he', 'rtl');
    await expect(page.getByRole('heading', { name: 'חמישה כלים, סטודיו אחד' })).toBeVisible();
  });
});

test.describe('the studio', () => {
  test.use({ locale: 'he-IL' });

  test('stays English and left to right inside until it is translated', async ({ page }) => {
    await page.goto('/app');
    await expectDirection(page, 'he', 'rtl');
    const studio = page.locator('div[lang="en"][dir="ltr"]').first();
    await expect(studio).toBeAttached();
    await expect(page.getByRole('heading', { name: /Your All-in-One/ })).toBeVisible();
  });
});

test.describe('mobile', () => {
  test.use({ ...phone, storageState: signedOut });

  test('Hebrew pages fit a phone', async ({ page }) => {
    for (const path of ['/he', '/he/pricing', '/he/sign-in', '/he/sign-up']) {
      await page.goto(path);
      await expect(page.locator('h1').first()).toBeVisible();
      await expectDirection(page, 'he', 'rtl');
      expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
      await page.screenshot({ path: test.info().outputPath(`he${path.replace(/\//g, '-')}.png`), fullPage: true });
    }
  });
});
