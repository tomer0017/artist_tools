import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Locator, type Page } from '@playwright/test';

// Sketchy, the studio companion (ADR-0024), in real browsers: he walks into
// Home's hero (his drawn walking cycle) and scrolls away with it, introduces
// himself on a sign that never covers the navigation, the tool cards or
// himself, opens his menu from a click or the keyboard with
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

  test('mobile: as big as the room beside the text allows, and his menu does not cover him or the bottom bar', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'phones only');
    await page.goto('/app');
    await expect(fox(page)).toBeVisible({ timeout: 15_000 });
    const f = await box(page.locator('[data-sketchy-fox]'));
    expect(f.height).toBeGreaterThanOrEqual(80);
    expect(f.height).toBeLessThanOrEqual(125);
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
    // A slot machine, not the wheel: the pick is on its pay line.
    await expect(roulette.locator('[data-roulette-slot]')).toBeVisible();
    await expect(roulette.locator('[data-roulette-wheel]')).toBeHidden();
    await expect(roulette.locator('[data-slot-row="picked"]')).toHaveText(await result.locator('h3').innerText());
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

test.describe('his home is the hero', () => {
  test.use({ storageState: auth('sketchy-tools'), locale: 'en-US' });

  test('he scrolls away with the hero like the rest of the page: nothing of him floats', async ({ page }) => {
    await page.goto('/app');
    await expect(fox(page)).toBeVisible({ timeout: 15_000 });
    const where = page.locator('[data-sketchy-fox]');
    await expect(where.locator('[data-walking]')).toHaveCount(0, { timeout: 15_000 });
    await expect(where).toBeInViewport();
    await homeScroller(page).evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    await expect(where).not.toBeInViewport();
    await expect(page.locator('[data-sketchy-dock]')).toHaveCount(0);
    await expect(drawn(page)).toHaveCount(1);
    await homeScroller(page).evaluate((el) => el.scrollTo({ top: 0 }));
    await expect(where).toBeInViewport();
  });

  test('back on Home from a tool he is simply there: no second entrance', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the top navigation');
    await page.goto('/app');
    const where = page.locator('[data-sketchy-fox]');
    await expect(where.locator('[data-walking]')).toBeAttached({ timeout: 15_000 });
    await expect(where.locator('[data-walking]')).toHaveCount(0, { timeout: 15_000 });
    await page.getByRole('link', { name: 'Grid', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/grid$/);
    await page.getByRole('link', { name: 'Home', exact: true }).click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(where).toBeVisible({ timeout: 10_000 });
    for (let i = 0; i < 6; i++) {
      await expect(where.locator('[data-walking]')).toHaveCount(0);
      await page.waitForTimeout(250);
    }
  });
});

test.describe('walking and looking', () => {
  test.use({ storageState: auth('sketchy-menu'), locale: 'en-US' });

  test('walks in on his drawn walking cycle, frame by frame, then stands drawn live (WebGL)', async ({ page }) => {
    await page.goto('/app');
    const where = page.locator('[data-sketchy-fox]');
    await expect(where.locator('[data-walking]')).toBeAttached({ timeout: 15_000 });
    const strip = where.locator('[data-raster-walk]');
    const frames = new Set<string>();
    for (let i = 0; i < 8; i++) {
      frames.add((await strip.getAttribute('data-frame')) ?? '');
      await page.waitForTimeout(70);
    }
    expect(frames.size).toBeGreaterThanOrEqual(3);
    expect(Number(await strip.evaluate((el) => getComputedStyle(el).opacity))).toBeGreaterThan(0.5);
    // Arrived: the cycle fades out and the live canvas draws him.
    await expect(where.locator('[data-walking]')).toHaveCount(0, { timeout: 15_000 });
    await expect.poll(() => where.locator('[data-raster-fallback]').evaluate((el) => getComputedStyle(el).visibility), { timeout: 5_000 }).toBe('hidden');
  });

  test('his head and eyes follow the mouse', async ({ page }) => {
    await page.goto('/app');
    await expect(sign(page)).toBeVisible({ timeout: 20_000 });
    const f = await box(page.locator('[data-sketchy-fox]'));
    const head = page.locator('[data-sketchy-fox] [data-part="head"]');
    const tilt = async () => Number(/rotate\((-?[\d.]+)/.exec((await head.getAttribute('transform')) ?? '')?.[1] ?? 'NaN');
    // Far above him, then far below: his head turns from one to the other.
    await page.mouse.move(f.x + f.width / 2, Math.max(1, f.y - 400));
    await page.waitForTimeout(700);
    const up = await tilt();
    await page.mouse.move(f.x + f.width / 2, Math.min(page.viewportSize()!.height - 2, f.y + f.height + 400));
    await page.waitForTimeout(700);
    const down = await tilt();
    expect(down - up).toBeGreaterThan(4);
  });
});
