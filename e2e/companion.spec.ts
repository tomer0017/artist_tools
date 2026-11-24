import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Locator, type Page } from '@playwright/test';

// Sketchy, the studio companion (ADR-0024), in real browsers: he walks once
// into his corner of Home and stays there while the page scrolls, introduces
// himself on a sign that never covers him or the navigation and stays on
// screen, opens his menu from a click or the keyboard with
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

/**
 * His face and body in the official artwork (the sign is held up on the post in his paw, beside
 * his head, never over them): the middle of his box, shifted toward the side he faces away from.
 */
async function body(page: Page) {
  const where = page.locator('[data-sketchy-fox]');
  const b = await box(where);
  const left = (await where.locator('[data-facing]').getAttribute('data-facing')) === 'left';
  return { x: b.x + b.width * (left ? 0.36 : 0.26), y: b.y + b.height * 0.15, width: b.width * 0.38, height: b.height * 0.7 };
}

/** Every Sketchy drawn on the page (the root of his artwork), in a dialog or not. */
const drawn = (page: Page) => page.locator('[data-sketchy-art]');
/** Home's scrolling area. */
const homeScroller = (page: Page) => page.locator('main .overflow-y-auto').first();

test.describe('Sketchy on Home', () => {
  test.use({ storageState: auth('sketchy'), locale: 'en-US' });

  test('walks into his corner and introduces himself on a sign that covers neither him nor the navigation, all on screen', async ({ page }) => {
    await page.goto('/app');
    await expect(fox(page)).toBeVisible({ timeout: 15_000 });
    await expect(sign(page)).toBeVisible({ timeout: 25_000 });
    await expect(sign(page)).toHaveAttribute('data-sketchy-sign', 'T-001');
    await expect(sign(page).getByText('Hi, I’m Sketchy!')).toBeVisible();
    const s = await box(sign(page));
    const viewport = page.viewportSize()!;
    expect(overlaps(s, await box(page.getByRole('navigation').first()))).toBe(false);
    expect(overlaps(s, await body(page))).toBe(false);
    expect(s.x).toBeGreaterThanOrEqual(0);
    expect(s.y).toBeGreaterThanOrEqual(0);
    expect(s.x + s.width).toBeLessThanOrEqual(viewport.width);
    expect(s.y + s.height).toBeLessThanOrEqual(viewport.height);
    // In his corner (the end of the reading direction, at the bottom).
    const f = await box(page.locator('[data-sketchy-fox]'));
    expect(f.x + f.width / 2).toBeGreaterThan(viewport.width / 2);
    expect(f.y + f.height).toBeGreaterThan(viewport.height * 0.6);
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

  test('mobile: big enough to read his face, above the bottom bar, and his menu covers neither him nor the bar', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'phones only');
    await page.goto('/app');
    await expect(fox(page)).toBeVisible({ timeout: 15_000 });
    await expect(sign(page)).toBeVisible({ timeout: 25_000 });
    const f = await box(page.locator('[data-sketchy-fox]'));
    const bar = await box(page.getByRole('navigation').last());
    expect(f.height).toBeGreaterThanOrEqual(112);
    expect(f.height).toBeLessThanOrEqual(132);
    expect(f.y + f.height).toBeLessThanOrEqual(bar.y + 1);
    await sign(page).getByRole('button', { name: 'Not now' }).click();
    await fox(page).tap();
    const menu = page.locator('[data-sketchy-menu]');
    await expect(menu).toBeVisible();
    const m = await box(menu);
    expect(overlaps(m, await body(page))).toBe(false);
    expect(overlaps(m, bar)).toBe(false);
  });
});

test.describe('less motion', () => {
  // Playwright takes reduced motion as a context option (a top-level `reducedMotion` is silently ignored).
  test.use({ storageState: auth('sketchy-motion'), locale: 'en-US', contextOptions: { reducedMotion: 'reduce' } });

  test('he appears without walking, and keeps still', async ({ page }) => {
    await page.goto('/app');
    const where = page.locator('[data-sketchy-fox]');
    await expect(where).toBeVisible({ timeout: 15_000 });
    // Still poses may follow one another (a wave, then his sign); no joint ever turns, and he never moves.
    const turns = () => where.locator('[data-part]').evaluateAll((els) => els.map((e) => /rotate\((-?[\d.]+)/.exec(e.getAttribute('transform') ?? '')?.[1] ?? '0.00'));
    await page.waitForTimeout(2500);
    const before = await where.getAttribute('style');
    for (let i = 0; i < 6; i++) {
      expect((await turns()).every((a) => Number(a) === 0)).toBe(true);
      await page.waitForTimeout(200);
    }
    expect(await where.getAttribute('style')).toBe(before);
    await expect(sign(page)).toBeVisible({ timeout: 20_000 });
  });
});

test.describe('exactly one Sketchy', () => {
  test.use({ storageState: auth('sketchy-roulette'), locale: 'en-US' });

  test('with the roulette open he is only beside its wheel, and comes back once when it closes', async ({ page }) => {
    await page.goto('/app');
    await expect(fox(page)).toBeVisible({ timeout: 15_000 });
    await expect(drawn(page)).toHaveCount(1);
    await fox(page).click();
    await page.locator('[data-menu-entry="challenge"]').click();
    const roulette = page.getByRole('dialog', { name: 'Sketchy’s challenge roulette' });
    await expect(roulette).toBeVisible();
    await expect(roulette.locator('[data-sketchy-art]')).toHaveCount(1);
    await expect(drawn(page)).toHaveCount(1);
    await expect(page.locator('[data-sketchy-fox]')).toHaveCount(0);
    await roulette.locator('[data-roulette-spin]').click();
    await expect(roulette.locator('[data-roulette-result]')).toBeVisible({ timeout: 10_000 });
    await expect(drawn(page)).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(roulette).toHaveCount(0);
    await expect(page.locator('[data-sketchy-fox]')).toHaveCount(1);
    await expect(drawn(page)).toHaveCount(1);
  });

  test('his suggestion has a real button: "Spin a challenge" opens the roulette, with only the roulette\'s Sketchy', async ({ page }) => {
    // He has met this person before and not said hello today: the day's greeting is on his sign.
    const me = (await (await page.request.get('/api/me?check=1')).json()) as { user: { id: string } };
    await page.addInitScript((k) => window.localStorage.setItem(k, JSON.stringify({ shown: { 'T-003': 1, 'T-027': 1 }, day: '', count: 0, lastTipAt: 0, snoozeUntil: 0, metAt: 1, greetedDay: null, rev: 2 })), `studio-companion:${me.user.id}`);
    await page.goto('/app');
    await expect(sign(page)).toBeVisible({ timeout: 25_000 });
    const action = sign(page).locator('[data-sketchy-action]');
    await expect(action).toBeVisible();
    const type = await action.getAttribute('data-sketchy-action');
    test.skip(type !== 'roulette', `the greeting picked was "${type}"`);
    await action.click();
    const roulette = page.getByRole('dialog', { name: 'Sketchy’s challenge roulette' });
    await expect(roulette).toBeVisible();
    await expect(drawn(page)).toHaveCount(1);
    await expect(roulette.locator('[data-sketchy-art]')).toHaveCount(1);
  });

  test('mobile: after a spin the challenge and its button are on screen at once, no scrolling', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'phones only');
    await page.goto('/app');
    await expect(fox(page)).toBeVisible({ timeout: 15_000 });
    await expect(sign(page)).toBeVisible({ timeout: 25_000 });
    await sign(page).getByRole('button', { name: 'Not now' }).click();
    await fox(page).tap();
    await page.locator('[data-menu-entry="challenge"]').tap();
    const roulette = page.getByRole('dialog', { name: 'Sketchy’s challenge roulette' });
    await expect(roulette).toBeVisible();
    await expect(roulette.locator('[data-roulette-count]')).not.toHaveAttribute('data-roulette-count', '0');
    await roulette.locator('[data-roulette-spin]').tap();
    const result = roulette.locator('[data-roulette-result]');
    await expect(result).toBeVisible({ timeout: 10_000 });
    const open = roulette.locator('[data-roulette-open]');
    await expect.poll(async () => { const b = await box(open); return b.y >= 0 && b.y + b.height <= page.viewportSize()!.height; }, { timeout: 5_000 }).toBe(true);
    const title = await box(result.locator('h3'));
    expect(title.y).toBeGreaterThanOrEqual(0);
    // Spin again and the options are right there too.
    await expect(roulette.locator('[data-roulette-spin]')).toBeInViewport();
    await expect(roulette.locator('[data-roulette-options]')).toBeVisible();
  });

  test('a sign closed with ✕ just closes: only "Not now" keeps him quiet for a while', async ({ page }) => {
    // He has met this person before and not said hello today: he greets them on a sign.
    const me = (await (await page.request.get('/api/me?check=1')).json()) as { user: { id: string } };
    const key = `studio-companion:${me.user.id}`;
    await page.addInitScript((k) => window.localStorage.setItem(k, JSON.stringify({ shown: {}, day: '', count: 0, lastTipAt: 0, snoozeUntil: 0, metAt: 1, greetedDay: null, rev: 2 })), key);
    await page.goto('/app');
    await expect(sign(page)).toBeVisible({ timeout: 25_000 });
    await sign(page).locator('[data-sketchy-close]').click();
    await expect(sign(page)).toHaveCount(0);
    const memory = (await page.evaluate((k) => JSON.parse(window.localStorage.getItem(k) ?? '{}'), key)) as { snoozeUntil: number; greetedDay: string | null };
    expect(memory.snoozeUntil).toBe(0);
    expect(memory.greetedDay).not.toBeNull();
  });
});

test.describe('always at hand while the page scrolls', () => {
  test.use({ storageState: auth('sketchy-tools'), locale: 'en-US' });

  test('he stays in his corner while the page scrolls (no second entrance, no jump), and takes a tap there', async ({ page }) => {
    await page.goto('/app');
    await expect(fox(page)).toBeVisible({ timeout: 15_000 });
    const where = page.locator('[data-sketchy-fox]');
    // Arrived: standing, not walking any more.
    await expect(where.locator('svg[data-pose="walk"]')).toHaveCount(0, { timeout: 15_000 });
    const before = await box(where);
    await homeScroller(page).evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    await page.waitForTimeout(600);
    const after = await box(where);
    expect(Math.abs(after.x - before.x)).toBeLessThan(1);
    expect(Math.abs(after.y - before.y)).toBeLessThan(1);
    await expect(where.locator('svg[data-pose="walk"]')).toHaveCount(0);
    await expect(drawn(page)).toHaveCount(1);
    const viewport = page.viewportSize()!;
    await fox(page).click();
    const menu = page.locator('[data-sketchy-menu]');
    await expect(menu).toBeVisible();
    const m = await box(menu);
    expect(m.y).toBeGreaterThanOrEqual(0);
    expect(m.y + m.height).toBeLessThanOrEqual(viewport.height);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await homeScroller(page).evaluate((el) => el.scrollTo({ top: 0 }));
    await page.waitForTimeout(600);
    const top = await box(where);
    expect(Math.abs(top.y - before.y)).toBeLessThan(1);
    await expect(drawn(page)).toHaveCount(1);
  });

  test('mobile: floating above the bottom bar, big enough to read his face', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'phones only');
    await page.goto('/app');
    await expect(fox(page)).toBeVisible({ timeout: 15_000 });
    await homeScroller(page).evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    const docked = page.locator('[data-sketchy-dock] [data-sketchy-fox]');
    await expect(docked).toBeVisible({ timeout: 10_000 });
    const bar = await box(page.getByRole('navigation').last());
    await expect.poll(async () => { const b = await box(docked); return b.x + b.width <= page.viewportSize()!.width + 1; }, { timeout: 15_000 }).toBe(true);
    const f = await box(docked);
    expect(f.height).toBeGreaterThanOrEqual(112);
    expect(f.y + f.height).toBeLessThanOrEqual(bar.y + 1);
    await expect(drawn(page)).toHaveCount(1);
  });
});

test.describe('one entrance a visit', () => {
  test.use({ storageState: auth('sketchy-class'), locale: 'en-US' });

  test('going to Learn and back to Home he is simply there, never walking in again', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the top navigation');
    await page.goto('/app');
    const where = page.locator('[data-sketchy-fox]');
    await expect(where.locator('svg[data-pose="walk"]')).toBeAttached({ timeout: 15_000 });
    await expect(where.locator('svg[data-pose="walk"]')).toHaveCount(0, { timeout: 15_000 });
    const home = await box(where);
    for (const [link, path] of [[page.locator('[data-nav-learn]'), /\/app\/learn$/], [page.getByRole('link', { name: 'Home', exact: true }), /\/app$/]] as const) {
      await link.click();
      await expect(page).toHaveURL(path);
      await expect(where).toBeVisible({ timeout: 10_000 });
      // Watched for a second and a half: never his walk, always in the same corner.
      for (let i = 0; i < 6; i++) {
        await expect(where.locator('svg[data-pose="walk"]')).toHaveCount(0);
        const now = await box(where);
        expect(Math.abs(now.x - home.x)).toBeLessThan(2);
        expect(Math.abs(now.y - home.y)).toBeLessThan(2);
        await page.waitForTimeout(250);
      }
    }
  });
});

test.describe('walking and looking', () => {
  test.use({ storageState: auth('sketchy-menu'), locale: 'en-US' });

  test('walks in with his walk animation, his legs moving as he goes, drawn live (WebGL)', async ({ page }) => {
    await page.goto('/app');
    const where = page.locator('[data-sketchy-fox]');
    await expect(where.locator('svg[data-pose="walk"]')).toBeAttached({ timeout: 15_000 });
    const leg = where.locator('[data-part="legFront"]');
    const first = await leg.getAttribute('transform');
    await page.waitForTimeout(200);
    expect(await leg.getAttribute('transform')).not.toBe(first);
    await expect.poll(() => where.locator('[data-raster-fallback]').evaluate((el) => getComputedStyle(el).visibility), { timeout: 5_000 }).toBe('hidden');
  });

  test('his head and eyes follow the mouse', async ({ page }) => {
    await page.goto('/app');
    await expect(sign(page)).toBeVisible({ timeout: 20_000 });
    const f = await box(page.locator('[data-sketchy-fox]'));
    const head = page.locator('[data-sketchy-fox] [data-part="head"]');
    const tilt = async () => Number(/rotate\((-?[\d.]+)/.exec((await head.getAttribute('transform')) ?? '')?.[1] ?? 'NaN');
    // Far above him, then low beside him (he floats at the bottom of the window): his head turns from one to the other.
    await page.mouse.move(f.x + f.width / 2, Math.max(1, f.y - 400));
    await page.waitForTimeout(700);
    const up = await tilt();
    await page.mouse.move(Math.max(1, f.x - 200), page.viewportSize()!.height - 2);
    await page.waitForTimeout(700);
    const down = await tilt();
    expect(down - up).toBeGreaterThan(4);
  });
});
