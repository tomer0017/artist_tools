import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

// Username accounts for invited testers (ADR-0012), as staging runs them:
// Google for everyone, plus a username and a password for accounts an admin
// creates; no sign-up and no email. Against the second test server (port
// 8081, scripts/e2e-server.ts), whose username accounts were created the real
// way (Better Auth, hashed), with random passwords made for this run.
//
// Every visitor gets its own network address (x-real-ip, as nginx sets it),
// because sign-in is limited to 5 a minute per address.
//
// Simulated, not real devices: Desktop Chrome, and WebKit with iPhone 13
// emulation for the `mobile` tests.

type Tester = { username: string; password: string; id: string };
const testers = (): Record<string, Tester> => JSON.parse(readFileSync('e2e/.auth/username-accounts.json', 'utf8'));

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

const TOOLS = [
  { name: 'Measure & Plan', path: '/app/measure' },
  { name: 'Study & Simplify', path: '/app/study' },
  { name: 'Color & Mixing', path: '/app/color' },
  { name: 'Create a Grid', path: '/app/grid' },
  { name: 'Compare & Correct', path: '/app/compare' },
];

let visitors = 0;
/** A signed-out browser of its own, from its own network address. */
async function visitor(browser: Browser, options: Record<string, unknown> = {}): Promise<{ context: BrowserContext; page: Page }> {
  const ip = `10.66.${test.info().workerIndex % 250}.${++visitors % 250}`;
  // Signed out unless told otherwise: contexts made in a test start from its options (the admin's, in the admin tests).
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    storageState: { cookies: [], origins: [] },
    extraHTTPHeaders: { 'x-real-ip': ip },
    ...options,
  });
  return { context, page: await context.newPage() };
}

/** The sign-in page's message (not Next.js's own route announcer, which is an alert too). */
const refusal = (page: Page) => page.locator('p[role="alert"]');

/** Colours change with a short transition: let it end before measuring contrast. */
const settled = (page: Page) => page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished)));

/** Sign in on the sign-in page with a username, as a person would. */
async function signIn(page: Page, username: string, password: string, path = '/sign-in', formName = 'Sign in with a username') {
  await page.goto(path);
  const form = page.getByRole('form', { name: formName });
  await form.locator('input[name="username"]').fill(username);
  await form.locator('input[name="password"]').fill(password);
  await form.getByRole('button', { name: /^(Sign in|כניסה)$/ }).click();
}

/**
 * Who the page's session is. A request sent on a kept-alive connection the
 * server closed while it sat idle fails with ECONNRESET (CI run 47); this
 * read changes nothing, so it is sent again.
 */
async function me(page: Page) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await page.request.get('/api/me');
      return { status: response.status(), user: response.ok() ? (await response.json()).user : null };
    } catch (error) {
      if (attempt >= 3 || !/ECONNRESET|socket hang up/i.test(String(error))) throw error;
    }
  }
}

async function openAccount(page: Page, username: string) {
  await page.goto(`/admin?q=${encodeURIComponent(username)}`);
  await page.getByRole('table').getByRole('link', { name: new RegExp(`Username: ${username}$`) }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText(`Username ${username}`, { exact: true })).toBeVisible();
}

test.describe('a tester', () => {
  test('signs in with a username in any capitals and uses all five tools on Free, with no way into the admin', async ({ browser }) => {
    const { username, password } = testers().QA_Free;
    const { context, page } = await visitor(browser);
    await signIn(page, username.toLowerCase(), password);
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByText(`Signed in as ${username}`)).toBeVisible();
    const { user } = await me(page);
    expect(user).toMatchObject({ username, role: 'user', access: 'free', plan: { assigned: 'free', effective: 'free' } });
    expect(user.features).toEqual(expect.arrayContaining(['tool.measure', 'tool.study', 'tool.color', 'tool.grid', 'tool.compare']));
    expect(user.features).not.toContain('export.gif_large');

    for (const tool of TOOLS) {
      await page.goto(tool.path);
      await expect(page.getByRole('heading', { name: tool.name })).toBeVisible();
    }

    for (const path of ['/admin', '/admin/users/new', `/admin/users/${testers().QA_Pro.id}`, '/admin/activity']) {
      expect((await page.goto(path))?.status(), path).toBe(404);
    }
    expect((await page.request.get('/admin/activity/export')).status()).toBe(404);

    await page.goto('/app/profile');
    const methods = page.getByRole('region', { name: 'Sign-in methods' });
    await expect(methods).toContainText('Username and password');
    await expect(methods).toContainText(`You sign in as ${username}.`);
    await expect(methods.getByRole('button', { name: 'Connect Google' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Profile' })).toContainText(`Username: ${username}`);
    await expect(page.locator('body')).not.toContainText('studio-companion.invalid');
    await context.close();
  });

  test('on Pro has the Pro features, and still no admin access', async ({ browser }) => {
    const { username, password } = testers().QA_Pro;
    const { context, page } = await visitor(browser);
    await signIn(page, username, password);
    await expect(page).toHaveURL(/\/app$/);
    const { user } = await me(page);
    expect(user).toMatchObject({ role: 'user', access: 'pro', plan: { effective: 'pro' } });
    expect(user.features).toEqual(expect.arrayContaining(['export.gif_large', 'export.gif_difference', 'tool.compare']));
    expect((await page.goto('/admin'))?.status()).toBe(404);
    await context.close();
  });

  test('gets one plain message for a wrong password and for a username nobody has, and no session', async ({ browser }) => {
    const { username } = testers().QA_Wrong;
    const { context, page } = await visitor(browser);
    const message = 'That username and password do not match. Check both and try again.';
    await signIn(page, username, 'Not-The-Pass-word-42');
    await expect(refusal(page)).toHaveText(message);
    await signIn(page, 'nobody_has_this', 'Not-The-Pass-word-42');
    await expect(refusal(page)).toHaveText(message);
    await expect(page).toHaveURL(/\/sign-in$/);
    expect((await me(page)).status).toBe(401);
    await context.close();
  });

  test('in Hebrew: the form reads right to left, and a Hebrew tester lands in the studio in Hebrew', async ({ browser }) => {
    const { username, password } = testers().QA_Ivrit;
    const { context, page } = await visitor(browser);
    await page.goto('/he/sign-in');
    const form = page.getByRole('form', { name: 'כניסה עם שם משתמש' });
    await expect(form.getByLabel('שם משתמש')).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    expect((await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations.map((v) => v.id)).toEqual([]);
    await signIn(page, username, 'Not-The-Pass-word-42', '/he/sign-in', 'כניסה עם שם משתמש');
    await expect(refusal(page)).toHaveText('שם המשתמש והסיסמה לא תואמים. כדאי לבדוק את שניהם ולנסות שוב.');
    await signIn(page, username, password, '/he/sign-in', 'כניסה עם שם משתמש');
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.locator('[lang="he"][dir="rtl"]').first()).toBeAttached();
    await expect(page.getByText(`מחוברים בתור ${username}`)).toBeVisible();
    await context.close();
  });

  test('changes the password they were given on their account page', async ({ browser }) => {
    const { username, password } = testers().QA_Change;
    const { context, page } = await visitor(browser);
    await signIn(page, username, password);
    await expect(page).toHaveURL(/\/app$/);
    await page.goto('/app/profile');
    const methods = page.getByRole('region', { name: 'Sign-in methods' });
    await methods.getByRole('button', { name: 'Change password' }).click();
    const form = methods.getByRole('form', { name: 'Change password' });
    await form.getByLabel('Current password', { exact: true }).fill(password);
    await form.getByLabel('New password', { exact: true }).fill('violet cactus harbor 42');
    await form.getByRole('button', { name: 'Change password' }).click();
    await expect(methods.getByRole('status')).toHaveText('Password changed. Your other devices were signed out.');

    const fresh = await visitor(browser);
    await signIn(fresh.page, username, password);
    await expect(refusal(fresh.page)).toContainText('do not match');
    await signIn(fresh.page, username, 'violet cactus harbor 42');
    await expect(fresh.page).toHaveURL(/\/app$/);
    await fresh.context.close();
    await context.close();
  });
});

test.describe('the admin', () => {
  test.use({ storageState: 'e2e/.auth/google-admin-qa.json' });

  test('finds testers by username and sees their role, plan, status, creation date and last login', async ({ page }) => {
    await page.goto('/admin?q=qa_');
    const table = page.getByRole('table');
    for (const heading of ['User', 'Signs in with', 'Registered', 'Last active', 'Role', 'Access', 'Billing']) {
      await expect(table.getByRole('columnheader', { name: heading, exact: true })).toBeVisible();
    }
    await expect(table).toContainText('Username: QA_Free');
    await expect(table).toContainText('Username: QA_Pro');
    await expect(table).not.toContainText('studio-companion.invalid');
    await expect(table.getByRole('row', { name: /Username: QA_Pro/ })).toContainText('Pro');
    await expect(table.getByRole('row', { name: /Username: QA_Pro/ })).toContainText('Username');

    await openAccount(page, 'QA_Pro');
    await expect(page.getByRole('region', { name: 'Account', exact: true })).toContainText('Username and password');
    const role = page.getByRole('region', { name: 'Role', exact: true });
    await expect(role).toContainText('can never be made an admin');
    await expect(role.getByRole('button', { name: 'Make admin' })).toHaveCount(0);
    await settled(page);
    expect((await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations.map((v) => v.id)).toEqual([]);
  });

  test('switches a tester from Free to Pro and back, and the tester sees it on their next request', async ({ page, browser }) => {
    const { username, password } = testers().QA_Plan;
    const tester = await visitor(browser);
    await signIn(tester.page, username, password);
    await expect(tester.page).toHaveURL(/\/app$/);
    expect((await me(tester.page)).user.plan.effective).toBe('free');

    await openAccount(page, username);
    const manual = page.getByRole('region', { name: 'Manage access', exact: true });
    await manual.getByLabel('Change to').selectOption('none');
    await manual.getByRole('button', { name: 'Give Pro with no end date' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Give Pro' }).click();
    await expect(manual.getByRole('status')).toHaveText('Pro given with no end date.');
    const pro = (await me(tester.page)).user;
    expect(pro).toMatchObject({ role: 'user', plan: { effective: 'pro' } });
    expect(pro.features).toContain('export.gif_large');

    await manual.getByRole('button', { name: 'End…', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'End', exact: true }).click();
    await expect(manual.getByRole('status')).toContainText('Pro with no end date ended.');
    const free = (await me(tester.page)).user;
    expect(free.plan.effective).toBe('free');
    expect(free.features).not.toContain('export.gif_large');
    await tester.context.close();
  });

  test('resets a password: the new one is shown once, the old one stops working and every session ends', async ({ page, browser }) => {
    const { username, password: old } = testers().QA_Reset;
    const tester = await visitor(browser);
    await signIn(tester.page, username, old);
    await expect(tester.page).toHaveURL(/\/app$/);

    await openAccount(page, username);
    const card = page.getByRole('region', { name: 'Password and sessions', exact: true });
    await card.getByRole('button', { name: 'Reset password' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Reset password' }).click();
    const handover = card.getByRole('region', { name: 'Password to hand over' });
    await expect(handover).toContainText(username);
    const fresh = await handover.getByLabel('Password').inputValue();
    expect(fresh).toMatch(/^[A-Za-z2-9]{4}(-[A-Za-z2-9]{4}){3}$/);
    expect(fresh).not.toBe(old);
    await expect(card.getByText('New password made. One session was signed out.')).toBeVisible();

    // Signed out at once.
    expect((await me(tester.page)).status).toBe(401);
    await tester.page.goto('/app/measure');
    await expect(tester.page).toHaveURL(/\/sign-in/);
    // The old password no longer works; the new one does.
    await signIn(tester.page, username, old);
    await expect(refusal(tester.page)).toContainText('do not match');
    await signIn(tester.page, username, fresh);
    await expect(tester.page).toHaveURL(/\/app$/);

    // Gone from the page once dismissed, never shown again.
    await handover.getByRole('button', { name: 'Done' }).click();
    await expect(card.getByRole('region', { name: 'Password to hand over' })).toHaveCount(0);
    await page.reload();
    await expect(page.locator('body')).not.toContainText(fresh);
    await expect(page.getByRole('region', { name: 'Activity' })).toContainText('Password reset by an admin (1 session signed out)');
    // The activity log finds the account by its username too.
    await page.goto(`/admin/activity?email=${username.toUpperCase()}`);
    await expect(page.locator('main')).toContainText('Password reset by an admin');
    await tester.context.close();
  });

  test('signs a tester out everywhere', async ({ page, browser }) => {
    const { username, password } = testers().QA_Sessions;
    const laptop = await visitor(browser);
    const tablet = await visitor(browser);
    for (const device of [laptop, tablet]) {
      await signIn(device.page, username, password);
      await expect(device.page).toHaveURL(/\/app$/);
    }
    await openAccount(page, username);
    const card = page.getByRole('region', { name: 'Password and sessions', exact: true });
    await expect(card).toContainText('Signed in on 2 devices.');
    await card.getByRole('button', { name: 'Sign out everywhere' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Sign out everywhere' }).click();
    await expect(card.getByRole('status')).toHaveText('Signed out everywhere (2 sessions ended).');
    for (const device of [laptop, tablet]) {
      expect((await me(device.page)).status).toBe(401);
      await device.context.close();
    }
  });

  test('suspends a tester, who can neither continue nor sign in, then reactivates them', async ({ page, browser }) => {
    const { username, password } = testers().QA_Suspend;
    const tester = await visitor(browser);
    await signIn(tester.page, username, password);
    await expect(tester.page).toHaveURL(/\/app$/);

    await openAccount(page, username);
    const status = page.getByRole('region', { name: 'Status', exact: true });
    await status.getByRole('button', { name: 'Suspend account' }).click();
    const dialog = page.getByRole('alertdialog');
    await dialog.getByLabel('Reason').selectOption('security');
    await dialog.getByRole('button', { name: 'Suspend' }).click();
    await expect(status.getByRole('status')).toHaveText('Account suspended and signed out everywhere.');

    await tester.page.goto('/app/color');
    await expect(tester.page).toHaveURL(/\/sign-in/);
    expect((await me(tester.page)).status).toBe(401);
    await signIn(tester.page, username, password);
    await expect(refusal(tester.page)).toHaveText('This account is suspended. Please contact the Studio Companion team.');
    await signIn(tester.page, username, 'Not-The-Pass-word-42');
    await expect(refusal(tester.page)).toContainText('do not match');

    await status.getByRole('button', { name: 'Reactivate account' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Reactivate' }).click();
    await expect(status.getByRole('status')).toHaveText('Account reactivated.');
    await signIn(tester.page, username, password);
    await expect(tester.page).toHaveURL(/\/app$/);
    await tester.context.close();
  });

  test('reveals an initial password from the command line exactly once', async ({ page, browser }) => {
    const { username, password } = testers().QA_Reveal;
    await openAccount(page, username);
    const card = page.getByRole('region', { name: 'Password and sessions', exact: true });
    await expect(card).toContainText('An initial password is waiting');
    await card.getByRole('button', { name: 'Reveal initial password' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Reveal' }).click();
    const handover = card.getByRole('region', { name: 'Password to hand over' });
    expect(await handover.getByLabel('Password').inputValue()).toBe(password);
    await page.reload();
    await expect(card.getByRole('button', { name: 'Reveal initial password' })).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(password);
    await expect(page.getByRole('region', { name: 'Activity' })).toContainText('Initial password revealed to an admin');

    const tester = await visitor(browser);
    await signIn(tester.page, username, password);
    await expect(tester.page).toHaveURL(/\/app$/);
    await tester.context.close();
  });

  test('creates a tester account, whose password works once handed over; a taken username changes nothing', async ({ page, browser }) => {
    await page.goto('/admin');
    await page.getByRole('link', { name: 'New tester account' }).click();
    await expect(page).toHaveURL(/\/admin\/users\/new$/);
    const form = page.getByRole('form', { name: 'New tester account' });
    await form.getByLabel('Username').fill('bad name!');
    await expect(form.getByText('English letters, digits, dots and underscores only.')).toBeVisible();
    await expect(form.getByRole('button', { name: 'Create account' })).toBeDisabled();
    await form.getByLabel('Username').fill('E2E_Created');
    await form.getByRole('group', { name: 'Plan' }).getByRole('button', { name: 'Pro' }).click();
    await expect(form.getByRole('group', { name: 'Plan' }).getByRole('button', { name: 'Pro' })).toHaveAttribute('aria-pressed', 'true');
    await settled(page);
    expect((await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations.map((v) => v.id)).toEqual([]);
    await form.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('status').first()).toContainText('Account E2E_Created created. Role User, plan Pro, active.');
    const password = await page.getByRole('region', { name: 'Password to hand over' }).getByLabel('Password').inputValue();

    const tester = await visitor(browser);
    await signIn(tester.page, 'e2e_created', password);
    await expect(tester.page).toHaveURL(/\/app$/);
    expect((await me(tester.page)).user).toMatchObject({ username: 'E2E_Created', role: 'user', plan: { effective: 'pro' } });
    await tester.context.close();

    await page.getByRole('button', { name: 'Create another' }).click();
    await form.getByLabel('Username').fill('e2e_CREATED');
    await form.getByRole('button', { name: 'Create account' }).click();
    await expect(refusal(page)).toContainText('That username is taken. Nothing was changed');

    await page.goto('/admin/activity');
    await expect(page.locator('main')).toContainText('Account created for username sign-in (Pro, test account)');
  });
});

test.describe('mobile', () => {
  test.use(phone);

  test('mobile: the username form fits a phone in English and Hebrew, and signing in works by touch', async ({ browser }) => {
    for (const [name, path, formName] of [['QA_Phone', '/sign-in', 'Sign in with a username'], ['QA_Phone_He', '/he/sign-in', 'כניסה עם שם משתמש']] as const) {
      const { username, password } = testers()[name];
      const { context, page } = await visitor(browser, phone);
      await page.goto(path);
      const form = page.getByRole('form', { name: formName });
      for (const field of [form.locator('input[name="username"]'), form.locator('input[name="password"]'), form.getByRole('button', { name: /^(Sign in|כניסה)$/ })]) {
        const box = (await field.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(390);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
      expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
      await form.locator('input[name="username"]').tap();
      await form.locator('input[name="username"]').fill(username);
      await form.locator('input[name="password"]').fill(password);
      await form.getByRole('button', { name: /^(Sign in|כניסה)$/ }).tap();
      await expect(page).toHaveURL(/\/app$/);
      await context.close();
    }
  });

  test('mobile: an admin creates a tester on a phone, and the one-time password fits', async ({ browser }) => {
    const { context, page } = await visitor(browser, { ...phone, storageState: 'e2e/.auth/google-admin-qa.json' });
    await page.goto('/admin/users/new');
    expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
    const username = `E2E_${test.info().project.name.replace(/\W/g, '_')}`.slice(0, 30);
    const form = page.getByRole('form', { name: 'New tester account' });
    await form.getByLabel('Username').fill(username);
    await form.getByRole('button', { name: 'Create account' }).tap();
    const handover = page.getByRole('region', { name: 'Password to hand over' });
    await expect(handover).toBeVisible();
    const box = (await handover.getByLabel('Password').boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
    await context.close();
  });
});
