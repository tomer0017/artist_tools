import { test, expect, type Page, type PlaywrightWorkerArgs } from '@playwright/test';
import { photo } from './fixtures/photo';

// Accounts, plans and administration, end to end against the production build.
// Signed in as the accounts scripts/e2e-server.ts seeds: `user` is on Free,
// `pro` on Pro, `admin` an administrator (on Free); `target` and `promote`
// are the accounts the admin specs change, `leaver` signs out and `expired`
// holds a session that has run out. Google sign-in itself is covered by
// src/server/auth.test.ts.

const as = (name: string) => ({ storageState: `e2e/.auth/${name}.json` });
const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

/** An API client signed in as another seeded account: what that person's next request sees. */
const signedInAs = (playwright: PlaywrightWorkerArgs['playwright'], name: string) =>
  playwright.request.newContext({ baseURL: test.info().project.use.baseURL, storageState: `e2e/.auth/${name}.json` });

/** Upload two photos and open Compare's full save options. */
async function openCompareExport(page: Page) {
  await page.goto('/app/compare');
  for (let i = 0; i < 2; i++) {
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Choose' }).first().click()]);
    await chooser.setFiles(photo);
    await expect(page.getByRole('button', { name: 'Confirm crop' })).toBeEnabled();
    await page.getByRole('button', { name: 'Confirm crop' }).click();
  }
  await page.getByRole('button', { name: /Continue to Align/ }).click();
  await page.getByRole('button', { name: /Manual Align/ }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: /Next: Save/ }).click();
  await page.getByRole('button', { name: /Save still image/ }).click();
  await expect(page.getByRole('group', { name: 'GIF output size' })).toBeVisible();
}

test.describe('Free account', () => {
  test('the account page shows the plan, what it includes, and that upgrades are coming soon', async ({ page }) => {
    await page.goto('/app/profile');
    await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();
    const profile = page.getByRole('region', { name: 'Profile', exact: true });
    await expect(profile).toContainText('E2E user');
    await expect(profile).toContainText('user@e2e.test');
    await expect(profile).toContainText('Verified by Google');
    await expect(profile).toContainText('Member');

    const plan = page.getByRole('region', { name: 'Plan', exact: true });
    await expect(plan).toContainText('Free');
    await expect(plan).toContainText('None (billing is not live yet)');
    const included = page.getByRole('list', { name: 'What your plan includes' });
    await expect(included.getByRole('listitem').filter({ hasText: 'All five tools' })).not.toContainText('Pro');
    await expect(included.getByRole('listitem').filter({ hasText: 'Large GIFs' })).toContainText('Pro');
    await expect(page.getByRole('button', { name: 'Upgrade: coming soon' })).toBeDisabled();
    await expect(page.getByRole('link', { name: 'Open the admin dashboard' })).toHaveCount(0);

    await page.getByRole('link', { name: 'Compare plans' }).click();
    await expect(page).toHaveURL(/\/app\/plans$/);
    await expect(page.getByRole('region', { name: 'Free', exact: true })).toContainText('Your current plan');
    const pro = page.getByRole('region', { name: 'Pro', exact: true });
    await expect(pro).toContainText('Coming soon');
    await expect(pro.getByRole('button', { name: 'Coming soon' })).toBeDisabled();
  });

  test('a locked option explains itself and leads to the plans, keeping the Compare work', async ({ page }) => {
    await openCompareExport(page);
    await page.getByRole('group', { name: 'GIF output size' }).getByRole('button', { name: /^L\s*\(Pro\)$/ }).click();
    const notice = page.getByRole('status').filter({ hasText: 'Large GIFs are part of Pro' });
    await expect(notice).toContainText('Saves your comparison GIF at up to 800 px');
    await expect(notice).toContainText('Free includes small and medium GIFs');
    await expect(notice).toContainText('Pro is coming soon and cannot be bought yet');
    await notice.getByRole('link', { name: 'Compare plans' }).click();
    await expect(page).toHaveURL(/\/app\/plans$/);
    await expect(page.getByRole('heading', { name: 'Plans', exact: true })).toBeVisible();
    // Back to Compare: its images and the open save options are still there.
    await page.goBack();
    await expect(page).toHaveURL(/\/app\/compare$/);
    await expect(page.getByRole('group', { name: 'GIF output size' })).toBeVisible();
  });

  test('the account page has its own URL and survives a reload', async ({ page }) => {
    await page.goto('/app');
    await page.getByRole('link', { name: 'Your account' }).click();
    await expect(page).toHaveURL(/\/app\/profile$/);
    await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();
    // Back to a tool and the account page is gone again.
    await page.getByRole('link', { name: 'Grid' }).click();
    await expect(page.getByRole('heading', { name: 'Create a Grid' })).toBeVisible();
  });

  test('Pro GIF options are locked and explained, and the server refuses them', async ({ page }) => {
    await openCompareExport(page);
    await expect(page.getByText('Large size and Compare+Diff are Pro features.')).toBeVisible();

    const size = page.getByRole('group', { name: 'GIF output size' });
    await size.getByRole('button', { name: /^L\s*\(Pro\)$/ }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Large GIFs are part of Pro' })).toBeVisible();
    await expect(size.getByRole('button', { name: /^L\s*\(Pro\)$/ })).toHaveAttribute('aria-pressed', 'false');
    await expect(size.getByRole('button', { name: 'M', exact: true })).toHaveAttribute('aria-pressed', 'true');

    const animation = page.getByRole('group', { name: 'GIF animation type' });
    await animation.getByRole('button', { name: /^Compare\+Diff\s*\(Pro\)$/ }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Compare + Difference GIFs are part of Pro' })).toBeVisible();

    // The lock is not only on screen: the server decides, from the database.
    const refused = await page.request.post('/api/usage', { data: { features: ['export.gif', 'export.gif_large'] } });
    expect(refused.status()).toBe(403);
    expect(await refused.json()).toEqual({ error: 'not_included', features: ['export.gif_large'] });
    expect((await page.request.post('/api/usage', { data: { features: ['export.gif'] } })).status()).toBe(200);
  });

  test('admin pages do not exist for a regular user', async ({ page }) => {
    for (const path of ['/admin', '/admin/activity', `/admin/users/${'0'.repeat(24)}`]) {
      expect((await page.goto(path))?.status()).toBe(404);
    }
  });
});

test.describe('Pro account', () => {
  test.use(as('pro'));

  test('the account page shows Pro, given for testing, and no upgrade prompt', async ({ page }) => {
    await page.goto('/app/profile');
    const plan = page.getByRole('region', { name: 'Plan', exact: true });
    await expect(plan).toContainText('Pro was given to this account by an administrator. No payment is involved.');
    await expect(page.getByRole('list', { name: 'What your plan includes' }).getByText('Pro', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Upgrade/ })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Profile', exact: true })).toContainText('Member');
    await page.getByRole('link', { name: 'Compare plans' }).click();
    await expect(page.getByRole('region', { name: 'Pro', exact: true })).toContainText('Your current plan');
    await expect(page.getByRole('region', { name: 'Free', exact: true })).not.toContainText('Your current plan');
  });

  test('Pro GIF options can be chosen, and the server agrees', async ({ page }) => {
    await openCompareExport(page);
    await expect(page.getByText('Large size and Compare+Diff are Pro features.')).toHaveCount(0);
    const size = page.getByRole('group', { name: 'GIF output size' });
    await size.getByRole('button', { name: 'L', exact: true }).click();
    await expect(size.getByRole('button', { name: 'L', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const animation = page.getByRole('group', { name: 'GIF animation type' });
    await animation.getByRole('button', { name: 'Compare+Diff', exact: true }).click();
    await expect(animation.getByRole('button', { name: 'Compare+Diff', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const allowed = await page.request.post('/api/usage', { data: { features: ['export.gif', 'export.gif_large', 'export.gif_difference'] } });
    expect(allowed.status()).toBe(200);
  });

  test('Pro never opens the admin area', async ({ page }) => {
    expect((await page.goto('/admin'))?.status()).toBe(404);
  });
});

test.describe('admin', () => {
  test.use(as('admin'));

  test('the account page shows the admin role and leads to the dashboard', async ({ page }) => {
    await page.goto('/app/profile');
    await expect(page.getByRole('region', { name: 'Profile', exact: true })).toContainText('Administrator');
    await expect(page.getByRole('region', { name: 'Plan', exact: true })).toContainText('As an administrator you have every feature, whatever your plan.');
    await expect(page.getByRole('button', { name: /Upgrade/ })).toHaveCount(0);
    await page.getByRole('link', { name: 'Compare plans' }).click();
    await expect(page.getByText('You are an administrator, so every feature is already open to you')).toBeVisible();
    await page.goBack();
    await page.getByRole('link', { name: 'Open the admin dashboard' }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
  });

  test('finds an account by email and shows it without provider secrets', async ({ page }) => {
    await page.goto('/admin');
    await page.getByRole('searchbox', { name: 'Search by email' }).fill('target@');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page).toHaveURL(/\/admin\?q=target%40$/);
    const table = page.getByRole('table');
    await expect(table).toContainText('target@e2e.test');
    await expect(table).not.toContainText('user@e2e.test');
    await table.getByRole('link', { name: /E2E target/ }).click();
    await expect(page.getByRole('heading', { name: 'E2E target' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Account', exact: true })).toContainText('Linked · id …rget');
    // Google's full account id ("e2e-target") is never shown.
    await expect(page.locator('body')).not.toContainText('e2e-target');
  });

  test('changes a plan for testing, and the account sees it on its next request', async ({ page, browser, playwright }) => {
    const target = await signedInAs(playwright, 'target');
    const me = async () => (await (await target.get('/api/me')).json()).user;
    expect((await me()).plan.effective).toBe('free');
    const targetContext = await browser.newContext({ ...as('target'), baseURL: test.info().project.use.baseURL });
    const targetPage = await targetContext.newPage();
    await targetPage.goto('/app/profile');
    await expect(targetPage.getByRole('region', { name: 'Plan', exact: true })).toContainText('All five tools, with no time limit.');

    await page.goto('/admin?q=target%40e2e.test');
    await page.getByRole('table').getByRole('link', { name: /E2E target/ }).click();
    const planCard = page.getByRole('region', { name: 'Plan and access', exact: true });
    await planCard.getByRole('button', { name: 'Pro', exact: true }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('no payment is taken');
    await dialog.getByRole('button', { name: 'Change plan' }).click();
    await expect(planCard.getByRole('status')).toHaveText('Plan changed to Pro.');
    await expect(planCard.getByRole('button', { name: 'Pro', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('region', { name: 'Activity', exact: true }).getByRole('listitem').filter({ hasText: 'Plan changed: Free → Pro' }).first()).toContainText('by You');

    const pro = await me();
    expect(pro).toMatchObject({ role: 'user', plan: { assigned: 'pro', effective: 'pro' }, access: 'pro' });
    expect(pro.features).toContain('export.gif_large');
    await targetPage.reload();
    await expect(targetPage.getByRole('region', { name: 'Plan', exact: true })).toContainText('Pro was given to this account by an administrator.');

    // Downgrade again: the test Pro access is revoked as quickly.
    await planCard.getByRole('button', { name: 'Free', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Change plan' }).click();
    await expect(planCard.getByRole('status')).toHaveText('Plan changed to Free.');
    const free = await me();
    expect(free).toMatchObject({ role: 'user', plan: { assigned: 'free', effective: 'free' }, access: 'free' });
    expect(free.features).not.toContain('export.gif_large');
    await targetContext.close();
    await target.dispose();
  });

  test('role changes are confirmed and audited, and nobody can remove their own admin access', async ({ page, playwright }) => {
    await page.goto('/admin?q=admin%40e2e.test');
    await page.getByRole('table').getByRole('link', { name: /E2E admin/ }).click();
    const ownRole = page.getByRole('region', { name: 'Role', exact: true });
    await expect(ownRole).toContainText('You cannot remove your own admin access here');
    await expect(ownRole.getByRole('button')).toHaveCount(0);

    const promote = await signedInAs(playwright, 'promote');
    await page.goto('/admin?q=promote%40e2e.test');
    await page.getByRole('table').getByRole('link', { name: /E2E promote/ }).click();
    const role = page.getByRole('region', { name: 'Role', exact: true });
    await role.getByRole('button', { name: 'Make admin' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Make admin' }).click();
    await expect(role.getByRole('status')).toHaveText('Admin access granted.');
    expect((await (await promote.get('/api/me')).json()).user).toMatchObject({ role: 'admin', access: 'admin', plan: { effective: 'free' } });
    expect((await promote.get('/admin')).status()).toBe(200);

    await role.getByRole('button', { name: 'Remove admin access' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove access' }).click();
    await expect(role.getByRole('status')).toHaveText('Admin access removed.');
    expect((await promote.get('/admin')).status()).toBe(404);
    const activity = page.getByRole('region', { name: 'Activity', exact: true });
    await expect(activity).toContainText('Made an admin');
    await expect(activity).toContainText('Admin access removed');
    await promote.dispose();
  });

  test('the activity log lists account events', async ({ page }) => {
    await page.goto('/admin/activity');
    await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible();
    await expect(page.getByText('Created an account with Google').first()).toBeVisible();
  });
});

test.describe('sessions', () => {
  test.describe('signed out', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('the account page and the usage API need a session', async ({ page }) => {
      await page.goto('/app/profile');
      await expect(page).toHaveURL(/\/sign-in\?callbackURL=%2Fapp%2Fprofile$/);
      expect((await page.request.post('/api/usage', { data: { features: ['export.gif'] } })).status()).toBe(401);
      // A request from another site is refused before anything else.
      const crossSite = await page.request.post('/api/usage', { data: { features: ['export.gif'] }, headers: { origin: 'https://evil.example' } });
      expect(crossSite.status()).toBe(403);
    });
  });

  test.describe('expired', () => {
    test.use(as('expired'));

    test('an expired session is sent to sign in, and back to where it was going', async ({ page }) => {
      await page.goto('/app/compare');
      await expect(page).toHaveURL(/\/sign-in\?callbackURL=%2Fapp%2Fcompare$/);
      expect((await page.request.get('/api/me')).status()).toBe(401);
    });
  });

  test.describe('signing out from the account page', () => {
    test.use(as('leaver'));

    test('ends the session on the server', async ({ page }) => {
      await page.goto('/app/profile');
      await page.getByRole('button', { name: 'Sign out' }).click();
      await expect(page).toHaveURL(/\/$/);
      expect((await page.request.get('/api/me')).status()).toBe(401);
      await page.goto('/app/profile');
      await expect(page).toHaveURL(/\/sign-in\?/);
    });
  });
});

// Evidence screenshots land in each test's own output folder.
const shot = (page: Page, name: string) => page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });

test.describe('mobile', () => {
  test.use(phone);

  test('the account page fits a phone, above the bottom navigation', async ({ page }) => {
    await page.goto('/app');
    await shot(page, 'home-free');
    await page.getByRole('link', { name: 'Your account' }).click();
    await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();
    const tools = page.getByRole('navigation', { name: 'Tools' });
    await expect(tools).toBeVisible();
    // The account page is not one of the tabs: none of them is marked current.
    await expect(tools.locator('[aria-current="page"]')).toHaveCount(0);
    expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
    await shot(page, 'profile-free');
    const signOut = page.getByRole('button', { name: 'Sign out' });
    await signOut.scrollIntoViewIfNeeded();
    await expect(signOut).toBeInViewport();
  });

  test('Pro GIF options are locked on a phone too', async ({ page }) => {
    await openCompareExport(page);
    const size = page.getByRole('group', { name: 'GIF output size' });
    await size.getByRole('button', { name: /^L\s*\(Pro\)$/ }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Large GIFs are part of Pro' })).toBeVisible();
    expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: test.info().outputPath('compare-locked-free.png') });
  });

  test.describe('as Pro', () => {
    test.use(as('pro'));

    test('the account page shows Pro on a phone', async ({ page }) => {
      await page.goto('/app/profile');
      await expect(page.getByRole('region', { name: 'Plan', exact: true })).toContainText('Pro was given to this account');
      expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
      await shot(page, 'profile-pro');
    });
  });

  test.describe('as an admin', () => {
    test.use(as('admin'));

    test('the dashboard works on a phone', async ({ page }) => {
      await page.goto('/app/profile');
      await expect(page.getByRole('link', { name: 'Open the admin dashboard' })).toBeVisible();
      await shot(page, 'profile-admin');
      await page.goto('/admin');
      const cards = page.getByRole('list', { name: 'Accounts' });
      await expect(cards).toBeVisible();
      await expect(page.getByRole('table')).toBeHidden();
      expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
      await shot(page, 'admin-users');
      await cards.getByRole('link', { name: /E2E user\b/ }).click();
      await expect(page.getByRole('group', { name: 'Assigned plan' })).toBeVisible();
      expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
      await shot(page, 'admin-user-detail');
    });
  });
});
