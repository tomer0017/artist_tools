import { test, expect, type Page } from '@playwright/test';
import { photo } from './fixtures/photo';

// The visitor's journey, end to end against the production build: landing →
// plans → sign-in (this test server is invite-only, the default), first-visit
// tool introductions, and Compare's touch surface on phones. Signed in as the
// accounts scripts/e2e-server.ts seeds; `newbie*` accounts have not seen any
// tool introduction yet.
//
// Simulated, not real devices: Desktop Chrome with phone emulation and
// WebKit with iPhone 13 emulation. iOS's own long-press selection cannot be
// reproduced here; what is checked is everything the fix relies on.

const signedOut = { cookies: [], origins: [] };
const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test.describe('signed out: the way in', () => {
  test.use({ storageState: signedOut });

  test('the landing page explains the five tools and leads to plans and sign-in', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Five tools, one studio' })).toBeVisible();
    for (const title of ['Measure & Plan', 'Study & Simplify', 'Color & Mixing', 'Create a Grid', 'Compare & Correct']) {
      await expect(page.getByRole('heading', { name: title })).toBeVisible();
    }
    // This server is invite-only (the default) and says so.
    await expect(page.getByText('Invite-only while we test')).toBeVisible();
    await page.getByRole('navigation', { name: 'Site' }).getByRole('link', { name: 'Plans' }).click();
    await expect(page).toHaveURL(/\/pricing$/);
  });

  test('the plans page shows Free available and Pro coming soon, without prices or payment', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.getByRole('heading', { name: 'Plans', level: 1 })).toBeVisible();
    const free = page.getByRole('region', { name: 'Free', exact: true });
    await expect(free).toContainText('Available now');
    await expect(free).toContainText('All five tools');
    const pro = page.getByRole('region', { name: 'Pro', exact: true });
    await expect(pro).toContainText('Coming soon');
    await expect(pro).toContainText('Large GIFs');
    await expect(pro).toContainText('Compare + Difference GIFs');
    await expect(pro.getByRole('button', { name: 'Coming soon' })).toBeDisabled();
    await expect(page.getByText('Pro cannot be bought yet. Nothing is charged anywhere in Studio Companion.')).toBeVisible();
    expect(await page.locator('main').innerText()).not.toMatch(/[$€£₪]\s?\d|\d\s?[$€£₪]|per month|\/mo\b|checkout|buy now/i);
    await expect(page.getByText('How do I get an account?')).toBeVisible();
    await expect(page.getByText(/invite-only while we test it/)).toBeVisible();
    await page.getByRole('link', { name: 'Open the studio' }).first().click();
    await expect(page).toHaveURL(/\/sign-in\?callbackURL=%2Fapp$/);
  });

  test('sign-in explains the free account and the invite-only phase', async ({ page }) => {
    await page.goto('/sign-in');
    await expect(page.getByRole('heading', { name: 'Sign in to Studio Companion' })).toBeVisible();
    await expect(page.getByText(/your free account is created automatically the first time/)).toBeVisible();
    await expect(page.getByRole('list', { name: 'What you get' })).toContainText('All five tools, free with no time limit');
    await page.getByRole('link', { name: 'compare plans' }).click();
    await expect(page).toHaveURL(/\/pricing$/);
  });

  test('a refused sign-up says why', async ({ page }) => {
    await page.goto('/sign-in?error=not_invited');
    await expect(page.getByRole('alert').filter({ hasText: 'invite-only while we test it' })).toBeVisible();
  });

  test.describe('mobile', () => {
    test.use(phone);

    test('landing, plans and sign-in fit a phone', async ({ page }) => {
      for (const path of ['/', '/pricing', '/sign-in']) {
        await page.goto(path);
        await expect(page.locator('h1').first()).toBeVisible();
        expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
        await page.screenshot({ path: test.info().outputPath(`signed-out${path.replace(/\//g, '-') || '-home'}.png`), fullPage: true });
      }
    });
  });
});

test.describe('first-visit tool introductions', () => {
  test.use({ storageState: 'e2e/.auth/newbie.json' });

  test('each tool introduces itself once per account, and the account page can bring them back', async ({ page }) => {
    const introsSeen = async () => (await (await page.request.get('/api/me')).json()).user.introsSeen;

    await page.goto('/app/measure');
    const measure = page.getByRole('dialog', { name: 'Measure & Plan' });
    await expect(measure).toBeVisible();
    await expect(measure).toContainText('Get accurate proportions and real measurements for your artwork.');
    await expect(measure).toContainText('How it works');
    await expect(measure.getByRole('listitem')).toHaveCount(3);
    await measure.getByRole('button', { name: 'Start measuring' }).click();
    await expect(measure).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Measure & Plan' })).toBeVisible();
    expect(await introsSeen()).toEqual(['measure']);

    // Not again on a later visit (it would appear within 300 ms).
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Measure & Plan' })).toBeVisible();
    await page.waitForTimeout(1000);
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Another tool introduces itself the first time; Escape dismisses it too.
    await page.getByRole('navigation', { name: 'Tools' }).getByRole('link', { name: 'Compare' }).click();
    const compare = page.getByRole('dialog', { name: 'Compare & Correct' });
    await expect(compare).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(compare).toBeHidden();
    await expect.poll(introsSeen).toEqual(['measure', 'compare']);

    // The account page brings them all back.
    await page.goto('/app/profile');
    await page.getByRole('button', { name: 'Show introductions again' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Each tool will introduce itself the next time you open it.' })).toBeVisible();
    expect(await introsSeen()).toEqual([]);
    await page.getByRole('navigation', { name: 'Tools' }).getByRole('link', { name: 'Measure' }).click();
    await expect(page.getByRole('dialog', { name: 'Measure & Plan' })).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

test.describe('mobile', () => {
  test.use(phone);

  test('a tool introduction fits a phone and starts the tool', async ({ browser }) => {
    // One first-time account per browser project, so the two runs never share state.
    const context = await browser.newContext({
      ...phone,
      baseURL: test.info().project.use.baseURL,
      storageState: `e2e/.auth/newbie-${test.info().project.name}.json`,
    });
    const page = await context.newPage();
    await page.goto('/app/compare');
    const intro = page.getByRole('dialog', { name: 'Compare & Correct' });
    await expect(intro).toBeVisible();
    const start = intro.getByRole('button', { name: 'Start comparing' });
    await start.scrollIntoViewIfNeeded();
    await expect(start).toBeInViewport();
    expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: test.info().outputPath('intro-compare.png') });
    await start.click();
    await expect(intro).toBeHidden();
    await expect(page.getByText('Your Artwork')).toBeVisible();
    await context.close();
  });

  test('Compare: placing Smart Align points never selects anything, and alignment still works', async ({ page }) => {
    await page.goto('/app/compare');
    for (let i = 0; i < 2; i++) {
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Choose' }).first().click()]);
      await chooser.setFiles(photo);
      await expect(page.getByRole('button', { name: 'Confirm crop' })).toBeEnabled();
      await page.getByRole('button', { name: 'Confirm crop' }).click();
    }
    await page.getByRole('button', { name: /Continue to Align/ }).click();
    await page.getByRole('button', { name: /Smart Align/ }).click();
    await expect(page.getByText('Smart Align · point 1 of 4')).toBeVisible();

    const canvas = page.locator('[data-onboarding="compare-canvas"] > canvas').first();
    const box = (await canvas.boundingBox())!;
    const at = (fx: number, fy: number) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });

    // The surface opts out of selection, the callout and browser gestures…
    const surface = await canvas.evaluate((el) => {
      const style = getComputedStyle(el);
      return { select: style.userSelect || style.webkitUserSelect, touch: style.touchAction };
    });
    expect(surface).toEqual({ select: 'none', touch: 'none' });
    // …cancels touches that start on it (what stops Safari's long-press selection)…
    expect(await canvas.evaluate((el) => {
      const touch = new Event('touchstart', { bubbles: true, cancelable: true });
      el.dispatchEvent(touch);
      return touch.defaultPrevented;
    })).toBe(true);
    // …and leaves the rest of the page alone: the instructions stay selectable and touchable.
    const instructions = page.getByText(/Tap a clear feature/);
    expect(await instructions.evaluate((el) => {
      const touch = new Event('touchstart', { bubbles: true, cancelable: true });
      el.dispatchEvent(touch);
      const style = getComputedStyle(el);
      return { prevented: touch.defaultPrevented, selectable: (style.userSelect || style.webkitUserSelect) !== 'none' };
    })).toEqual({ prevented: false, selectable: true });

    // Point 1: a press-and-hold that wanders across the surface, like a finger
    // steering the magnifier. It selects nothing and places the point on release.
    const p1 = at(0.3, 0.3);
    await page.mouse.move(p1.x, p1.y);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.move(box.x + 12, box.y + 12, { steps: 6 });
    await page.mouse.up();
    expect(await page.evaluate(() => document.getSelection()?.toString() ?? '')).toBe('');
    await expect(page.getByText('Smart Align · point 2 of 4')).toBeVisible();

    // Points 2–4 with taps; after the fourth the images are aligned and Compare opens.
    await page.touchscreen.tap(at(0.3, 0.3).x, at(0.3, 0.3).y);
    await expect(page.getByText('Smart Align · point 3 of 4')).toBeVisible();
    await page.touchscreen.tap(at(0.7, 0.7).x, at(0.7, 0.7).y);
    await expect(page.getByText('Smart Align · point 4 of 4')).toBeVisible();
    await page.touchscreen.tap(at(0.7, 0.7).x, at(0.7, 0.7).y);
    await expect(page.getByRole('slider', { name: 'Reference opacity' })).toBeVisible();
    expect(await page.evaluate(() => document.getSelection()?.toString() ?? '')).toBe('');

    // Pages still scroll as usual: Home's list is a normal scrolling area.
    await page.getByRole('navigation', { name: 'Tools' }).getByRole('link', { name: 'Home' }).click();
    const heading = page.getByRole('heading', { name: /Your All-in-One/ });
    await expect(heading).toBeVisible();
    const scroll = await heading.evaluate((el) => {
      const list = el.closest('.overflow-y-auto') as HTMLElement;
      const before = list.scrollTop;
      list.scrollTop = 300;
      return { touch: getComputedStyle(list).touchAction, scrollable: list.scrollHeight > list.clientHeight, moved: list.scrollTop > before };
    });
    expect(scroll).toEqual({ touch: 'auto', scrollable: true, moved: true });
  });
});
