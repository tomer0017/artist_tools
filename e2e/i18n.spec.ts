import { test, expect, type Browser, type Page } from '@playwright/test';
import { photo } from './fixtures/photo';

// English and Hebrew end to end: the public pages and account email (/he
// addresses, the language switch, Accept-Language, right-to-left layout) and
// the whole studio (Home, navigation, the five tools, introductions, account
// page), with the tools' canvases kept left to right.
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

/** A signed-in page for one of the Hebrew accounts (by default the one for this browser project, so runs do not interfere). */
async function asHebrewAccount(browser: Browser, name = `ivrit-${test.info().project.name}`, options: Parameters<Browser['newContext']>[0] = {}) {
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    storageState: `e2e/.auth/${name}.json`,
    ...options,
  });
  return { context, page: await context.newPage() };
}

test.describe('the studio in Hebrew', () => {
  test.use({ locale: 'he-IL' });

  test('Home, the navigation and the tools are in Hebrew, right to left', async ({ page }) => {
    await page.goto('/app');
    await expectDirection(page, 'he', 'rtl');
    await expect(page.getByRole('heading', { name: 'על מה עובדים היום?' })).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'כלים' });
    for (const label of ['בית', 'מדידה', 'לימוד', 'רשת', 'השוואה', 'צבע']) await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible();
    await page.getByRole('link', { name: /^יצירת רשת/ }).click();
    await expect(page).toHaveURL(/\/app\/grid$/);
    const heading = page.getByRole('heading', { name: 'יצירת רשת', level: 1 });
    await expect(heading).toBeVisible();
    expect(await heading.evaluate((el) => getComputedStyle(el).direction)).toBe('rtl');
    await expect(nav.getByRole('link', { name: 'רשת', exact: true })).toHaveAttribute('aria-current', 'page');
  });

  test('the five tools work in Hebrew, with their canvases left to right', async ({ page }) => {
    const ltr = (selector: string) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).direction);
    const upload = async (name: string) => {
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name }).first().click()]);
      await chooser.setFiles(photo);
    };

    await page.goto('/app/grid');
    await expect(page.getByRole('heading', { name: 'יצירת רשת', level: 1 })).toBeVisible();
    await upload('להעלות תמונת ייחוס');
    await expect(page.getByRole('button', { name: 'שמירת תמונת הרשת' }).first()).toBeVisible();
    expect(await ltr('canvas')).toBe('ltr');

    await page.goto('/app/study');
    await expect(page.getByRole('heading', { name: 'לימוד ופישוט', level: 1 })).toBeVisible();
    await upload('להעלות תמונת ייחוס');
    await expect(page.getByRole('radio', { name: /ערכים/ })).toBeVisible();

    await page.goto('/app/color');
    await expect(page.getByRole('heading', { name: 'צבע וערבוב', level: 1 })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'הרמוניות' })).toBeVisible();

    await page.goto('/app/measure');
    await expect(page.getByRole('heading', { name: 'מדידה ותכנון', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'תכנון הפרופורציות' })).toBeVisible();
    await upload('להעלות תמונת ייחוס');
    // The photo and its measurement overlay sit in a left-to-right layer.
    await expect(page.locator('main [dir="ltr"] img').first()).toBeVisible();

    await page.goto('/app/compare');
    await expect(page.getByRole('heading', { name: 'השוואה ותיקון', level: 1 })).toBeVisible();
    await expect(page.getByText('הציור שלך').first()).toBeVisible();
    // The small Hebrew hints under the English labels are for English pages only.
    await expect(page.getByText('הציור שלי')).toHaveCount(0);
  });

  test('a tool introduces itself in Hebrew the first time it opens', async ({ browser }) => {
    const { context, page } = await asHebrewAccount(browser);
    await page.goto('/app/grid');
    const intro = page.getByRole('dialog', { name: 'יצירת רשת' });
    await expect(intro).toBeVisible();
    expect(await intro.evaluate((el) => getComputedStyle(el).direction)).toBe('rtl');
    await expect(intro.getByText('איך זה עובד')).toBeVisible();
    await intro.getByRole('button', { name: 'ליצור רשת' }).click();
    await expect(intro).toBeHidden();
    await expect(page.getByRole('heading', { name: 'יצירת רשת', level: 1 })).toBeVisible();
    await context.close();
  });

  test('the account page and its answers are in Hebrew, and changing the language reloads the studio', async ({ browser }) => {
    // Its own account: it switches the language, which other tests must not see.
    const { context, page } = await asHebrewAccount(browser, 'ivrit-switch');
    await page.goto('/app/profile');
    await expectDirection(page, 'he', 'rtl');
    await expect(page.getByRole('heading', { name: 'החשבון שלך', level: 1 })).toBeVisible();
    const plan = page.getByRole('region', { name: 'מסלול', exact: true });
    await expect(plan).toContainText('המסלול הנוכחי');
    await expect(plan).toContainText('חינמי');
    await expect(page.getByRole('region', { name: 'מכשירים מחוברים' })).toContainText('המכשיר הזה');

    // A server answer, in Hebrew.
    const prefs = page.getByRole('region', { name: 'העדפות' });
    const news = prefs.getByRole('switch', { name: 'עדכונים באימייל' });
    await news.click();
    await expect(prefs.getByRole('status')).toHaveText('מעכשיו יגיעו מדי פעם עדכונים באימייל.');
    await expect(news).toHaveAttribute('aria-checked', 'true');
    await news.click();
    await expect(prefs.getByRole('status')).toHaveText('בלי אימיילים שיווקיים.');
    await expect(news).toHaveAttribute('aria-checked', 'false');

    // Deleting asks for the Hebrew word (nothing is deleted here).
    await page.getByRole('button', { name: 'מחיקת החשבון…' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog.getByLabel('לאישור, להקליד מחיקה')).toBeVisible();
    await dialog.getByRole('button', { name: 'להשאיר את החשבון' }).click();

    // English, then back to Hebrew: the whole studio follows.
    await prefs.getByLabel('שפה').selectOption('en');
    await expect(page.getByRole('heading', { name: 'Your account', level: 1 })).toBeVisible();
    await expectDirection(page, 'en', 'ltr');
    await page.getByRole('region', { name: 'Preferences' }).getByLabel('Language').selectOption('he');
    await expect(page.getByRole('heading', { name: 'החשבון שלך', level: 1 })).toBeVisible();
    await context.close();
  });
});

test.describe('mobile', () => {
  test.use({ ...phone, storageState: signedOut });

  test('the Hebrew studio fits a phone, with its bottom navigation right to left', async ({ browser }) => {
    const { context, page } = await asHebrewAccount(browser, undefined, phone);
    await page.goto('/app');
    await expectDirection(page, 'he', 'rtl');
    await expect(page.getByRole('heading', { name: 'על מה עובדים היום?' })).toBeVisible();
    expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
    const nav = page.getByRole('navigation', { name: 'כלים' });
    const home = await nav.getByRole('link', { name: 'בית', exact: true }).boundingBox();
    const color = await nav.getByRole('link', { name: 'צבע', exact: true }).boundingBox();
    expect(home!.x).toBeGreaterThan(color!.x); // Home first, on the right
    await page.screenshot({ path: test.info().outputPath('he-studio-home.png'), fullPage: true });

    await nav.getByRole('link', { name: 'השוואה', exact: true }).click();
    const intro = page.getByRole('dialog', { name: 'השוואה ותיקון' });
    await expect(intro).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('he-studio-intro.png') });
    await intro.getByRole('button', { name: 'להתחיל להשוות' }).click();
    await expect(intro).toBeHidden();

    await page.goto('/app/profile');
    await expect(page.getByRole('heading', { name: 'החשבון שלך', level: 1 })).toBeVisible();
    expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: test.info().outputPath('he-studio-account.png'), fullPage: true });
    await context.close();
  });

  test('the five tools fit a phone in Hebrew', async ({ browser }) => {
    // A Hebrew account that has seen every introduction.
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, storageState: 'e2e/.auth/user.json', locale: 'he-IL', ...phone });
    const page = await context.newPage();
    const tools: [string, string][] = [['measure', 'מדידה ותכנון'], ['study', 'לימוד ופישוט'], ['color', 'צבע וערבוב'], ['grid', 'יצירת רשת'], ['compare', 'השוואה ותיקון']];
    for (const [path, title] of tools) {
      await page.goto(`/app/${path}`);
      await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
      expect(await noSideScroll(page), path).toBeLessThanOrEqual(0);
      // A photo loaded in one tool opens in the others, so upload only where it is asked for.
      const uploadButton = page.getByRole('button', { name: 'להעלות תמונת ייחוס' }).first();
      if (await uploadButton.isVisible()) {
        const [chooser] = await Promise.all([page.waitForEvent('filechooser'), uploadButton.click()]);
        await chooser.setFiles(photo);
        await page.waitForTimeout(400);
        expect(await noSideScroll(page), `${path} with a photo`).toBeLessThanOrEqual(0);
      }
      await page.screenshot({ path: test.info().outputPath(`he-tool-${path}.png`), fullPage: true });
    }
    await context.close();
  });

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
