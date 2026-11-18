import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Browser, type Page } from '@playwright/test';
import { photo } from './fixtures/photo';

// What each plan may use, enforced (src/server/entitlements.ts,
// docs/adr/0013): against the third test server (port 8082,
// scripts/e2e-server.ts), set up like staging including the plan catalog
// published there (version 2, 2026-11-18): Free has Study & Simplify, Color &
// Mixing, Create a Grid and saving images; Pro has every tool and export. Its
// accounts are username accounts created the real way and signed in through
// the sign-in page; plans and catalogs are changed by an admin through the
// dashboard, as the owner does.
//
// Every check is about what can actually be done, not only what is shown: a
// locked tool's own screen is absent, the server refuses the tool's
// operations and exports (403), and nothing is saved.
//
// These tests change the published catalog, so they run one at a time
// (playwright.config.ts), and the catalog is put back as staging has it after
// each test that changed it. Simulated devices: Desktop Chrome, and WebKit
// with iPhone 13 emulation for the `mobile` test.

type Account = { username: string; password: string; id: string };
const accounts = (): Record<string, Account> => JSON.parse(readFileSync('e2e/.auth/entitlement-accounts.json', 'utf8'));

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

const TOOLS = {
  measure: { id: 'measure', name: 'Measure & Plan', path: '/app/measure', nav: 'Measure' },
  study: { id: 'value', name: 'Study & Simplify', path: '/app/study', nav: 'Study' },
  color: { id: 'color', name: 'Color & Mixing', path: '/app/color', nav: 'Color' },
  grid: { id: 'grid', name: 'Create a Grid', path: '/app/grid', nav: 'Grid' },
  compare: { id: 'compare', name: 'Compare & Correct', path: '/app/compare', nav: 'Compare' },
} as const;
type Tool = (typeof TOOLS)[keyof typeof TOOLS];

/** The plan editor's rows as staging publishes them (version 2). */
const STAGING: Record<string, { Free: boolean; Pro: boolean }> = {
  'Measure & Plan': { Free: false, Pro: true },
  'Study & Simplify': { Free: true, Pro: true },
  'Color & Mixing': { Free: true, Pro: true },
  'Create a Grid': { Free: true, Pro: true },
  'Compare & Correct': { Free: false, Pro: true },
  'Saved images': { Free: true, Pro: true },
  GIFs: { Free: false, Pro: true },
  'Large GIFs': { Free: false, Pro: true },
  'Compare + Difference GIFs': { Free: false, Pro: true },
};

let visitors = 0;
/** A signed-out browser of its own, from its own network address (sign-in is limited per address). */
async function visitor(browser: Browser, options: Parameters<Browser['newContext']>[0] = {}) {
  const ip = `10.82.${test.info().workerIndex % 250}.${++visitors % 250}`;
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    storageState: { cookies: [], origins: [] },
    extraHTTPHeaders: { 'x-real-ip': ip },
    ...options,
  });
  return { context, page: await context.newPage() };
}

/** Sign in on the sign-in page with a username, as a tester does, and land in the studio. */
async function signIn(page: Page, who: Account, hebrew = false) {
  await page.goto(hebrew ? '/he/sign-in' : '/sign-in');
  const form = page.getByRole('form', { name: hebrew ? 'כניסה עם שם משתמש' : 'Sign in with a username' });
  await form.locator('input[name="username"]').fill(who.username);
  await form.locator('input[name="password"]').fill(who.password);
  await form.getByRole('button', { name: /^(Sign in|כניסה)$/ }).click();
  await expect(page).toHaveURL(/\/app$/);
}

async function signedIn(browser: Browser, name: string, hebrew = false) {
  const v = await visitor(browser);
  await signIn(v.page, accounts()[name], hebrew);
  return v;
}

/** This server's admin (signed in with Google; the sign-in counts as recent for the whole run). */
async function adminPage(browser: Browser) {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, storageState: 'e2e/.auth/ent-admin.json' });
  return { context, page: await context.newPage() };
}

async function upload(page: Page, buttonName: string | RegExp) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: buttonName }).first().click()]);
  await chooser.setFiles(photo);
}

/** What the server answers for an export or another protected operation of a tool (as the studio asks it). */
async function authorize(page: Page, body: { tool?: string; features?: string[] }) {
  const response = await page.request.post('/api/usage', { data: body });
  const answer = (await response.json()) as { features?: string[] };
  return { status: response.status(), refused: answer.features ?? [] };
}

async function features(page: Page): Promise<string[]> {
  const response = await page.request.get('/api/me?check=1');
  expect(response.status()).toBe(200);
  return (await response.json()).user.features;
}

/** The tool's own screen is there to use, with no lock. */
async function expectOpen(page: Page, tool: Tool) {
  await expect(page.getByRole('heading', { name: tool.name, exact: true, level: 1 })).toBeVisible();
  await expect(page.locator('[data-tool-locked]')).toHaveCount(0);
}

/** The tool is locked: its place says so, and nothing of the tool itself is there to use. */
async function expectLocked(page: Page, tool: Tool, reason: RegExp = /It is part of Pro, which is coming soon/) {
  const locked = page.locator(`[data-tool-locked="${tool.id}"]`);
  await expect(locked).toBeVisible();
  await expect(locked.getByRole('heading', { level: 1 })).toHaveText(`${tool.name} is not included in your plan`);
  await expect(locked).toContainText(reason);
  await expect(locked).toContainText('Nothing you made is deleted.');
  await expect(page.getByRole('heading', { name: tool.name, exact: true, level: 1 })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^(Upload reference photo|Choose)$/ })).toHaveCount(0);
}

const toolsNav = (page: Page) => page.getByRole('navigation', { name: 'Tools' });

/** Change an account's plan in the admin dashboard. */
async function setPlan(page: Page, username: string, plan: 'Free' | 'Pro') {
  await page.goto(`/admin?q=${encodeURIComponent(username)}`);
  await page.getByRole('table').getByRole('link', { name: new RegExp(`Username: ${username}$`) }).click();
  const card = page.getByRole('region', { name: 'Plan and access', exact: true });
  const button = card.getByRole('button', { name: plan, exact: true });
  await expect(button).toBeVisible();
  if ((await button.getAttribute('aria-pressed')) === 'true') return;
  await button.click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Change plan' }).click();
  await expect(card.getByRole('status')).toHaveText(`Plan changed to ${plan}.`);
  // The admin page says what the account can use now (under staging's catalog, Measure & Plan is Pro only).
  if (plan === 'Pro') await expect(card).toContainText('Measure & Plan');
  else await expect(card).not.toContainText('Measure & Plan');
}

/**
 * Publish a plan catalog through the admin dashboard: start a draft from what
 * is live, set the editor's checkboxes (`Off` is "Off for everyone"), save,
 * publish. A draft that would change nothing is discarded instead.
 */
async function publish(page: Page, rows: Record<string, Partial<Record<'Free' | 'Pro' | 'Off', boolean>>>) {
  await page.goto('/admin/plans');
  await expect(page.getByRole('heading', { name: 'Plans and features' })).toBeVisible();
  await page.getByRole('button', { name: 'Start a draft' }).click();
  await expect(page.getByRole('button', { name: 'Save draft' })).toBeVisible();
  let changed = false;
  for (const [label, boxes] of Object.entries(rows)) {
    const row = page.getByRole('listitem').filter({ has: page.getByText(label, { exact: true }) });
    for (const [box, on] of Object.entries(boxes)) {
      const checkbox = row.getByLabel(box === 'Off' ? 'Off for everyone' : box, { exact: true });
      await expect(checkbox).toBeEnabled();
      if ((await checkbox.isChecked()) === on) continue;
      await checkbox.setChecked(on);
      changed = true;
    }
  }
  if (!changed) {
    await page.getByRole('button', { name: 'Discard draft' }).click();
    await expect(page.getByRole('button', { name: 'Start a draft' })).toBeVisible();
    return;
  }
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'saved. Nothing changes until you publish it.' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Changes in this draft' })).toBeVisible();
  await page.getByRole('button', { name: /^Publish version \d+$/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Publish' }).click();
  // Exactly the publication's answer ("Draft version N started from what is live." is a status too).
  await expect(page.getByRole('status').filter({ hasText: /^Version \d+ is live\.$/ })).toBeVisible();
}

/** Put the catalog back as staging publishes it. */
const publishStaging = (page: Page) => publish(page, Object.fromEntries(Object.entries(STAGING).map(([label, plans]) => [label, { ...plans, Off: false }])));

let catalogChanged = false;
test.afterEach(async ({ browser }) => {
  if (!catalogChanged) return;
  catalogChanged = false;
  const admin = await adminPage(browser);
  await publishStaging(admin.page);
  await admin.context.close();
});

test('Free cannot use Measure & Plan or Compare & Correct by any route, and the server refuses them; Pro can', async ({ browser }) => {
  const free = await signedIn(browser, 'ENT_Free');
  const page = free.page;
  expect(await features(page)).toEqual(['tool.study', 'tool.color', 'tool.grid', 'export.image']);

  // Home and the navigation mark the two tools as locked.
  await expect(page.getByRole('link', { name: /Measure & Plan/ })).toContainText('Locked');
  await expect(page.getByRole('link', { name: /Compare & Correct/ })).toContainText('Locked');
  await expect(page.getByRole('link', { name: /Create a Grid/ })).not.toContainText('Locked');
  await expect(toolsNav(page).getByRole('link', { name: 'Compare (Locked)' })).toBeVisible();

  // Through the navigation, the address bar and a reload: the locked screen, never the tool.
  await toolsNav(page).getByRole('link', { name: 'Measure (Locked)' }).click();
  await expect(page).toHaveURL(/\/app\/measure$/);
  await expectLocked(page, TOOLS.measure);
  await page.goto(TOOLS.compare.path);
  await expectLocked(page, TOOLS.compare);
  await page.reload();
  await expectLocked(page, TOOLS.compare);
  expect((await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations.map((v) => v.id)).toEqual([]);
  await page.getByRole('link', { name: 'Back to Home' }).click();
  await expect(page).toHaveURL(/\/app$/);

  // The server refuses the tools' operations and exports, whatever a page shows.
  expect(await authorize(page, { tool: 'tool.measure' })).toEqual({ status: 403, refused: ['tool.measure'] });
  expect(await authorize(page, { tool: 'tool.measure', features: ['export.image'] })).toEqual({ status: 403, refused: ['tool.measure'] });
  expect(await authorize(page, { tool: 'tool.compare', features: ['export.gif'] })).toEqual({ status: 403, refused: ['tool.compare'] });
  expect(await authorize(page, { tool: 'tool.compare', features: ['export.image'] })).toEqual({ status: 403, refused: ['tool.compare'] });
  expect((await authorize(page, { tool: 'tool.grid', features: ['export.image'] })).status).toBe(200);

  // The account page and the plans page show the same answer, tool by tool.
  await page.goto('/app/profile');
  const includes = page.getByRole('list', { name: 'What your plan includes' });
  await expect(includes.getByRole('listitem').filter({ hasText: 'Measure & Plan' }).locator('[aria-label="Not included"]')).toHaveCount(1);
  await expect(includes.getByRole('listitem').filter({ hasText: 'Create a Grid' }).locator('[aria-label="Included"]')).toHaveCount(1);
  await page.goto('/app/plans');
  const compareRow = page.getByRole('row', { name: /Compare & Correct/ });
  await expect(compareRow.locator('[aria-label="Not included"]')).toHaveCount(1);
  await expect(compareRow.locator('[aria-label="Included"]')).toHaveCount(1);
  await free.context.close();

  // Pro: both tools open and work, saving included.
  const pro = await signedIn(browser, 'ENT_Pro');
  await pro.page.goto(TOOLS.measure.path);
  await expectOpen(pro.page, TOOLS.measure);
  await upload(pro.page, 'Upload reference photo');
  await expect(pro.page.locator('main [dir="ltr"] img').first()).toBeVisible();
  await pro.page.getByRole('button', { name: 'Save Image' }).click();
  await expect(pro.page.getByAltText('Image preview')).toBeVisible();
  await pro.page.getByRole('button', { name: 'Close', exact: true }).click();
  await pro.page.goto(TOOLS.compare.path);
  await expectOpen(pro.page, TOOLS.compare);
  await expect(pro.page.getByText('Your Artwork')).toBeVisible();
  expect((await authorize(pro.page, { tool: 'tool.compare', features: ['export.gif', 'export.gif_large', 'export.gif_difference'] })).status).toBe(200);
  await pro.context.close();
});

test('Free and Pro both use Study & Simplify, Color & Mixing and Create a Grid, and save from them', async ({ browser }) => {
  for (const name of ['ENT_Free', 'ENT_Pro']) {
    const { context, page } = await signedIn(browser, name);
    await page.goto(TOOLS.study.path);
    await expectOpen(page, TOOLS.study);
    await upload(page, 'Upload reference photo');
    await expect(page.getByRole('radio', { name: /Values/ })).toBeVisible();
    await page.goto(TOOLS.color.path);
    await expectOpen(page, TOOLS.color);
    await expect(page.getByRole('tab', { name: 'Wheel & Harmonies' })).toBeVisible();
    await page.goto(TOOLS.grid.path);
    await expectOpen(page, TOOLS.grid);
    await upload(page, 'Upload reference photo');
    await page.getByRole('button', { name: 'Save grid image' }).first().click();
    await expect(page.getByAltText('Image preview')).toBeVisible();
    await context.close();
  }
});

test('in Hebrew, the locked screen reads right to left, after a reload too', async ({ browser }) => {
  const { context, page } = await signedIn(browser, 'ENT_Ivrit', true);
  await page.goto(TOOLS.measure.path);
  const locked = page.locator('[data-tool-locked="measure"]');
  await expect(locked.getByRole('heading', { level: 1 })).toHaveText('הכלי מדידה ותכנון לא כלול במסלול הנוכחי');
  await expect(locked).toContainText('הכלי הזה הוא חלק ממסלול Pro, שיגיע בקרוב.');
  await expect(page.locator('[lang="he"][dir="rtl"]').first()).toBeAttached();
  await page.reload();
  await expect(locked.getByRole('heading', { level: 1 })).toHaveText('הכלי מדידה ותכנון לא כלול במסלול הנוכחי');
  await expect(page.getByRole('navigation', { name: 'כלים' }).getByRole('link', { name: 'השוואה (נעול)' })).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations.map((v) => v.id)).toEqual([]);
  await locked.getByRole('link', { name: 'חזרה לדף הבית' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await context.close();
});

test('an admin opens every tool, whatever the plans say', async ({ browser }) => {
  const admin = await adminPage(browser);
  catalogChanged = true;
  await publish(admin.page, { 'Color & Mixing': { Off: true } });
  for (const tool of Object.values(TOOLS)) {
    await admin.page.goto(tool.path);
    await expectOpen(admin.page, tool);
  }
  expect((await authorize(admin.page, { tool: 'tool.color', features: ['export.image'] })).status).toBe(200);
  await admin.context.close();
});

test('a tool off for both plans is locked for Free and Pro alike, and the server refuses it', async ({ browser }) => {
  const admin = await adminPage(browser);
  catalogChanged = true;
  await publish(admin.page, { 'Color & Mixing': { Off: true } });
  for (const name of ['ENT_Both_Free', 'ENT_Both_Pro']) {
    const { context, page } = await signedIn(browser, name);
    await page.goto(TOOLS.color.path);
    await expectLocked(page, TOOLS.color, /It is not available on any plan right now/);
    expect(await authorize(page, { tool: 'tool.color' })).toEqual({ status: 403, refused: ['tool.color'] });
    await context.close();
  }
  await admin.context.close();
});

test('switching plans while signed in: the studio follows on its next step, with no new sign-in', async ({ browser }) => {
  const tester = await signedIn(browser, 'ENT_Switch');
  const page = tester.page;
  await page.goto(TOOLS.measure.path);
  await expectLocked(page, TOOLS.measure);

  const admin = await adminPage(browser);
  await setPlan(admin.page, 'ENT_Switch', 'Pro');
  // The next navigation brings the account as it is now.
  await toolsNav(page).getByRole('link', { name: 'Home', exact: true }).click();
  await toolsNav(page).getByRole('link', { name: 'Measure', exact: true }).click();
  await expectOpen(page, TOOLS.measure);

  // Back to Free while Measure stays open: coming back to the tab checks again.
  await setPlan(admin.page, 'ENT_Switch', 'Free');
  await page.waitForTimeout(10_500);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expectLocked(page, TOOLS.measure);
  await admin.context.close();
  await tester.context.close();
});

test('publishing while a tool is open locks it within a minute, and its work is there when it opens again', async ({ browser }) => {
  const tester = await visitor(browser);
  const page = tester.page;
  await page.clock.install();
  await signIn(page, accounts().ENT_Open);
  await page.goto(TOOLS.measure.path);
  await expectOpen(page, TOOLS.measure);
  await upload(page, 'Upload reference photo');
  const picture = page.locator('main [dir="ltr"] img').first();
  await expect(picture).toBeVisible();

  const admin = await adminPage(browser);
  catalogChanged = true;
  await publish(admin.page, { 'Measure & Plan': { Pro: false } });
  // Nobody touches the open tab: it checks by itself within a minute.
  await page.clock.fastForward('01:05');
  await expectLocked(page, TOOLS.measure, /It is not available on any plan right now/);
  expect(await authorize(page, { tool: 'tool.measure', features: ['export.image'] })).toEqual({ status: 403, refused: ['tool.measure'] });

  await publishStaging(admin.page);
  catalogChanged = false;
  await page.clock.fastForward('01:05');
  await expectOpen(page, TOOLS.measure);
  await expect(picture).toBeVisible();
  await admin.context.close();
  await tester.context.close();
});

test('two tabs of one account follow a plan change together, and a session an admin ends leaves both', async ({ browser }) => {
  // On Pro to start with (a run against the same database leaves it on Free).
  const setup = await adminPage(browser);
  await setPlan(setup.page, 'ENT_Tabs', 'Pro');
  await setup.context.close();
  const tester = await signedIn(browser, 'ENT_Tabs');
  const [first, second] = [tester.page, await tester.context.newPage()];
  for (const page of [first, second]) {
    await page.goto(TOOLS.compare.path);
    await expectOpen(page, TOOLS.compare);
  }
  const admin = await adminPage(browser);
  await setPlan(admin.page, 'ENT_Tabs', 'Free');
  // One tab takes a step in the studio; the other, untouched, follows at once.
  await toolsNav(first).getByRole('link', { name: 'Home', exact: true }).click();
  await expect(toolsNav(first).getByRole('link', { name: 'Compare (Locked)' })).toBeVisible();
  await expectLocked(second, TOOLS.compare);
  // A stale tab's export is refused by the server all the same.
  expect(await authorize(second, { tool: 'tool.compare', features: ['export.gif'] })).toEqual({ status: 403, refused: ['tool.compare'] });

  // The admin signs the account out everywhere: the next step in either tab goes to sign-in.
  await admin.page.goto(`/admin?q=ENT_Tabs`);
  await admin.page.getByRole('table').getByRole('link', { name: /Username: ENT_Tabs$/ }).click();
  const sessions = admin.page.getByRole('region', { name: 'Password and sessions', exact: true });
  await sessions.getByRole('button', { name: 'Sign out everywhere' }).click();
  await admin.page.getByRole('alertdialog').getByRole('button', { name: 'Sign out everywhere' }).click();
  await expect(sessions.getByRole('status')).toContainText('Signed out everywhere');
  await second.getByRole('link', { name: 'Back to Home' }).click();
  await expect(second).toHaveURL(/\/sign-in/);
  await toolsNav(first).getByRole('link', { name: 'Grid', exact: true }).click();
  await expect(first).toHaveURL(/\/sign-in/);
  await admin.context.close();
  await tester.context.close();
});

test('exports: refused by the server when the plan lacks them or it cannot answer, and nothing is saved', async ({ browser }) => {
  const tester = await signedIn(browser, 'ENT_Export');
  const page = tester.page;
  await page.goto(TOOLS.grid.path);
  await expectOpen(page, TOOLS.grid);
  await upload(page, 'Upload reference photo');
  const save = page.getByRole('button', { name: 'Save grid image' }).first();
  const preview = page.getByAltText('Image preview');
  const refused = page.getByRole('alertdialog');

  // Allowed: the save sheet opens.
  await save.click();
  await expect(preview).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  // No answer from the server: nothing is saved, and it can be tried again.
  await page.route('**/api/usage', (route) => route.abort());
  await save.click();
  await expect(refused).toContainText('Your plan could not be checked');
  await expect(preview).toHaveCount(0);
  await page.unroute('**/api/usage');
  await refused.getByRole('button', { name: 'Try again' }).click();
  await expect(preview).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  // The admin takes saving images out of Free while the tool is open: the tool stays, saving is refused.
  const admin = await adminPage(browser);
  catalogChanged = true;
  await publish(admin.page, { 'Saved images': { Free: false } });
  await save.click();
  await expect(refused).toContainText('Saved images are not part of your plan right now, so nothing was saved.');
  await expect(preview).toHaveCount(0);
  await refused.getByRole('button', { name: 'Close', exact: true }).click();
  await expectOpen(page, TOOLS.grid);
  expect(await authorize(page, { tool: 'tool.grid', features: ['export.image'] })).toEqual({ status: 403, refused: ['export.image'] });

  // GIFs: never from a tool the plan lacks; with Compare and GIFs in Free, still not the Pro options.
  expect(await authorize(page, { tool: 'tool.compare', features: ['export.gif'] })).toEqual({ status: 403, refused: ['tool.compare'] });
  await publish(admin.page, { 'Compare & Correct': { Free: true }, GIFs: { Free: true } });
  expect((await authorize(page, { tool: 'tool.compare', features: ['export.gif'] })).status).toBe(200);
  expect(await authorize(page, { tool: 'tool.compare', features: ['export.gif', 'export.gif_large'] })).toEqual({ status: 403, refused: ['export.gif_large'] });
  expect(await authorize(page, { tool: 'tool.compare', features: ['export.gif', 'export.gif_difference'] })).toEqual({ status: 403, refused: ['export.gif_difference'] });
  await admin.context.close();
  await tester.context.close();
});

test('mobile: on a phone the locked screen fits, the bottom bar marks locked tools, Hebrew too, and Pro opens them', async ({ browser }) => {
  const free = await signedIn(browser, 'ENT_Phone');
  const nav = toolsNav(free.page);
  await expect(nav.getByRole('link', { name: 'Measure (Locked)' })).toBeVisible();
  await nav.getByRole('link', { name: 'Compare (Locked)' }).click();
  await expectLocked(free.page, TOOLS.compare);
  expect(await noSideScroll(free.page)).toBeLessThanOrEqual(0);
  const back = free.page.getByRole('link', { name: 'Back to Home' });
  await expect(back).toBeInViewport();
  await back.click();
  await expect(free.page).toHaveURL(/\/app$/);
  await free.context.close();

  const hebrew = await signedIn(browser, 'ENT_Ivrit', true);
  await hebrew.page.goto(TOOLS.compare.path);
  await expect(hebrew.page.locator('[data-tool-locked="compare"]').getByRole('heading', { level: 1 })).toHaveText('הכלי השוואה ותיקון לא כלול במסלול הנוכחי');
  expect(await noSideScroll(hebrew.page)).toBeLessThanOrEqual(0);
  await hebrew.context.close();

  const pro = await signedIn(browser, 'ENT_Phone_Pro');
  await pro.page.goto(TOOLS.measure.path);
  await expectOpen(pro.page, TOOLS.measure);
  await pro.context.close();
});
