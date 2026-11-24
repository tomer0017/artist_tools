import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Locator, type Page } from '@playwright/test';

// Sketchy, the studio companion (ADR-0024), in real browsers: he walks onto
// Home, introduces himself on a sign that never covers the navigation, the
// tool cards or himself, opens his menu from a click or the keyboard with
// only what the account can really use, leads to real tools, spins a
// roulette of challenges the account may open, celebrates a completed
// challenge, can be hidden (and brought back from the account page), speaks
// Hebrew right to left, and keeps still for people who ask for less motion.
// Each test signs in as its own account (scripts/e2e-server.ts).

const auth = (name: string) => `e2e/.auth/${name}.json`;
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const fox = (page: Page) => page.locator('[data-sketchy-button]');
const sign = (page: Page) => page.locator('[data-sketchy-sign]');

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error('not on screen');
  return b;
}

const overlaps = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** The middle part of his body (the sign may hold its post in his outer paw, never cover him). */
async function body(page: Page) {
  const b = await box(page.locator('[data-sketchy-fox]'));
  return { x: b.x + b.width * 0.3, y: b.y + b.height * 0.15, width: b.width * 0.4, height: b.height * 0.7 };
}

test.describe('Sketchy on Home', () => {
  test.use({ storageState: auth('sketchy'), locale: 'en-US' });

  test('walks in, introduces himself on a sign that covers neither the navigation, the tool cards nor himself', async ({ page }) => {
    await page.goto('/app');
    await expect(fox(page)).toBeVisible({ timeout: 15_000 });
    await expect(sign(page)).toBeVisible({ timeout: 20_000 });
    await expect(sign(page)).toHaveAttribute('data-sketchy-sign', 'T-001');
    await expect(sign(page).getByText('Hi, I’m Sketchy!')).toBeVisible();
    const s = await box(sign(page));
    expect(overlaps(s, await box(page.getByRole('navigation').first()))).toBe(false);
    expect(overlaps(s, await box(page.locator('[data-tool-card="measure"]')))).toBe(false);
    expect(overlaps(s, await body(page))).toBe(false);
    // "Show me around" opens his tool guide.
    await sign(page).getByRole('button', { name: 'Show me around' }).click();
    await expect(page.locator('[data-sketchy-menu="choose"]')).toBeVisible();
    await expect(page.locator('[data-menu-tool]')).toHaveCount(5);
  });

  test('passes the accessibility checks with his sign up', async ({ page }) => {
    await page.goto('/app');
    await expect(sign(page)).toBeVisible({ timeout: 20_000 });
    // Its fade-in finished first: mid-fade, colours read paler than they are.
    await sign(page).evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
    const results = await new AxeBuilder({ page }).withTags(WCAG).include('[data-sketchy-stage]').analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);
  });
});

test.describe('his menu', () => {
  test.use({ storageState: auth('sketchy-menu'), locale: 'en-US' });

  test('opens from the keyboard with only what the account can use, and Escape gives the focus back', async ({ page }) => {
    await page.goto('/app');
    await expect(fox(page)).toBeVisible({ timeout: 15_000 });
    // Past his introduction first.
    await expect(sign(page)).toBeVisible({ timeout: 20_000 });
    await sign(page).getByRole('button', { name: 'Not now' }).click();
    await expect(sign(page)).toHaveCount(0);
    await fox(page).focus();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('dialog', { name: 'What can I do for you?' });
    await expect(menu).toBeVisible();
    await expect(menu.locator('button:focus')).toHaveCount(1);
    // This Free account has no Learn on the e2e server: no challenge or lesson entries.
    const entries = await menu.locator('[data-menu-entry]').evaluateAll((els) => els.map((e) => e.getAttribute('data-menu-entry')));
    expect(entries).toEqual(['surprise', 'tip', 'improve', 'choose', 'about', 'hide']);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(fox(page)).toBeFocused();
  });

  test('gives a drawing tip, and another one', async ({ page }) => {
    await page.goto('/app');
    await expect(fox(page)).toBeVisible({ timeout: 15_000 });
    await fox(page).click();
    await page.locator('[data-menu-entry="tip"]').click();
    const tip = page.locator('[data-menu-tip]');
    await expect(tip).toBeVisible();
    const first = await tip.getAttribute('data-menu-tip');
    await page.locator('[data-menu-another]').click();
    await expect(tip).not.toHaveAttribute('data-menu-tip', first!);
  });
});

test.describe('guided help', () => {
  test.use({ storageState: auth('sketchy-tools'), locale: 'en-US' });

  test('"Help me improve my drawing" leads to the right tool', async ({ page }) => {
    await page.goto('/app');
    await expect(fox(page)).toBeVisible({ timeout: 15_000 });
    await fox(page).click();
    await page.locator('[data-menu-entry="improve"]').click();
    await page.locator('[data-menu-need="values"]').click();
    await page.locator('[data-menu-tool="value"]').click();
    await expect(page).toHaveURL(/\/app\/study$/);
  });
});

test.describe('the roulette', () => {
  test.use({ storageState: auth('sketchy-roulette'), locale: 'en-US' });

  test('spins and lands on a challenge the account may open, then opens it', async ({ page }) => {
    await page.goto('/app');
    await expect(fox(page)).toBeVisible({ timeout: 15_000 });
    await fox(page).click();
    await page.locator('[data-menu-entry="challenge"]').click();
    const roulette = page.getByRole('dialog', { name: 'Sketchy’s challenge roulette' });
    await expect(roulette).toBeVisible();
    await expect(roulette.locator('[data-roulette-count]')).not.toHaveAttribute('data-roulette-count', '0');
    await roulette.locator('[data-roulette-spin]').click();
    const result = roulette.locator('[data-roulette-result]');
    await expect(result).toBeVisible({ timeout: 10_000 });
    const id = (await result.getAttribute('data-roulette-result'))!;
    const list = (await (await page.request.get('/api/learn/items?collection=challenges')).json()) as { items: { id: string; open: boolean }[] };
    expect(list.items.find((item) => item.id === id)?.open).toBe(true);
    await roulette.locator('[data-roulette-open]').click();
    await expect(page).toHaveURL(new RegExp(`/app/learn/challenges/${id}$`));
  });
});

test.describe('celebrations', () => {
  test.use({ storageState: auth('sketchy-celebrate'), locale: 'en-US' });

  test('a completed challenge gets a cheer in the corner, which never takes a tap', async ({ page }) => {
    await page.goto('/app/learn/challenges/CH-901');
    await page.locator('[data-mark-done="ready"]').click();
    const cheer = page.locator('[data-sketchy-celebration]');
    await expect(cheer).toBeVisible({ timeout: 10_000 });
    await expect(cheer.getByRole('status')).toHaveText('Challenge complete! Bravo!');
    expect(await cheer.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
    await expect(cheer).toHaveCount(0, { timeout: 8_000 });
  });
});

test.describe('hiding him', () => {
  test.use({ storageState: auth('sketchy-hide'), locale: 'en-US' });

  test('he waves goodbye, stays hidden on every visit, and comes back from the account page', async ({ page }) => {
    await page.goto('/app');
    await expect(fox(page)).toBeVisible({ timeout: 15_000 });
    await fox(page).click();
    await page.locator('[data-menu-entry="hide"]').click();
    await page.locator('[data-menu-hide-confirm]').click();
    await expect(page.locator('[data-sketchy-fox]')).toHaveCount(0, { timeout: 15_000 });
    await page.reload();
    await page.waitForTimeout(4000);
    await expect(page.locator('[data-sketchy-fox]')).toHaveCount(0);
    await page.goto('/app/profile');
    const show = page.locator('[data-companion-show]');
    await expect(show).toHaveAttribute('aria-checked', 'false');
    await show.click();
    await expect(show).toHaveAttribute('aria-checked', 'true');
    await page.goto('/app');
    await expect(fox(page)).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('who you are', () => {
  test.use({ storageState: auth('sketchy-about'), locale: 'en-US' });

  test('telling him you teach is saved on the account', async ({ page }) => {
    await page.goto('/app');
    await expect(fox(page)).toBeVisible({ timeout: 15_000 });
    await fox(page).click();
    await page.locator('[data-menu-entry="about"]').click();
    await page.locator('[data-menu-audience="teacher"]').click();
    await expect(page.getByText('Thanks! I’ll keep that in mind.')).toBeVisible();
    const me = (await (await page.request.get('/api/me?check=1')).json()) as { user: { companion: { audience: string } } };
    expect(me.user.companion.audience).toBe('teacher');
  });
});

test.describe('in Hebrew', () => {
  test.use({ storageState: auth('sketchy-he'), locale: 'he-IL' });

  test('mobile: mirrored on the left, a Hebrew sign beside him, right to left', async ({ page, context }) => {
    await context.addCookies([{ name: 'sc_locale', value: 'he', domain: 'localhost', path: '/' }]);
    await page.goto('/app');
    await expect(sign(page)).toBeVisible({ timeout: 20_000 });
    await expect(sign(page).getByText('היי, אני סקצ׳י!')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.dir)).toBe('rtl');
    const viewport = page.viewportSize()!;
    const f = await box(page.locator('[data-sketchy-fox]'));
    expect(f.x + f.width / 2).toBeLessThan(viewport.width / 2);
    expect(overlaps(await box(sign(page)), await body(page))).toBe(false);
    await expect(fox(page)).toHaveAttribute('aria-label', /סקצ׳י/);
  });
});

test.describe('on a phone', () => {
  test.use({ storageState: auth('sketchy-mobile'), locale: 'en-US' });

  test('mobile: smaller, beside the text, and his menu does not cover him or the bottom bar', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'phones only');
    await page.goto('/app');
    await expect(fox(page)).toBeVisible({ timeout: 15_000 });
    const f = await box(page.locator('[data-sketchy-fox]'));
    expect(f.height).toBeLessThan(120);
    const lead = await box(page.locator('[data-sketchy-avoid]').last());
    expect(f.x).toBeGreaterThanOrEqual(lead.x + lead.width - 1);
    await expect(sign(page)).toBeVisible({ timeout: 20_000 });
    await sign(page).getByRole('button', { name: 'Not now' }).click();
    await fox(page).tap();
    const menu = page.locator('[data-sketchy-menu]');
    await expect(menu).toBeVisible();
    expect(overlaps(await box(menu), await body(page))).toBe(false);
  });
});

test.describe('less motion', () => {
  test.use({ storageState: auth('sketchy-motion'), locale: 'en-US', reducedMotion: 'reduce' });

  test('he appears without walking, and keeps still', async ({ page }) => {
    await page.goto('/app');
    const where = page.locator('[data-sketchy-fox]');
    await expect(where).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(2500);
    const before = await where.getAttribute('style');
    const svg = page.locator('[data-sketchy-fox] svg [data-part="legFront"]');
    const pose = await svg.getAttribute('transform');
    await page.waitForTimeout(1200);
    expect(await where.getAttribute('style')).toBe(before);
    expect(await svg.getAttribute('transform')).toBe(pose);
    await expect(sign(page)).toBeVisible({ timeout: 20_000 });
  });
});
