import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Browser, type Locator, type Page } from '@playwright/test';
import { photo } from './fixtures/photo';
import { makePng } from '../src/test/png';

// Admin → Learn as the owner uses it (ADR-0023): add, edit, copy, move,
// archive and restore lessons and challenges, upload and replace their
// pictures, set each one's Access (Free, Pro, Admin only, Blocked), and go
// back through an item's history or the whole content's. Every change is
// checked where it matters: what Free and Pro accounts get from the studio's
// own routes (lists, items, pictures, exports, completions), at once.
//
// Runs on the plan-enforcement server (port 8082, scripts/e2e-server.ts),
// after its own specs (playwright.config.ts), one test at a time: the tests
// build on each other (CH-904 is added by the first one).

test.describe.configure({ mode: 'serial' });

type Account = { username: string; password: string; id: string };
const accounts = (): Record<string, Account> => JSON.parse(readFileSync('e2e/.auth/entitlement-accounts.json', 'utf8'));
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

let visitors = 0;
async function signedIn(browser: Browser, name: string) {
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    storageState: { cookies: [], origins: [] },
    extraHTTPHeaders: { 'x-real-ip': `10.83.${test.info().workerIndex % 250}.${++visitors % 250}` },
    locale: 'en-US',
  });
  const page = await context.newPage();
  const who = accounts()[name];
  await page.goto('/sign-in');
  const form = page.getByRole('form', { name: 'Sign in with a username' });
  await form.locator('input[name="username"]').fill(who.username);
  await form.locator('input[name="password"]').fill(who.password);
  await form.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/app$/);
  return { context, page };
}

async function adminPage(browser: Browser) {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, storageState: 'e2e/.auth/ent-admin.json', locale: 'en-US' });
  const page = await context.newPage();
  await page.goto('/admin/learn');
  await expect(page.getByRole('heading', { name: 'Learn content', level: 1 })).toBeVisible();
  return { context, page };
}

const status = async (page: Page, path: string) => (await page.request.get(path)).status();
const itemOf = async (page: Page, id: string) => {
  const response = await page.request.get(`/api/learn/items/${id}`);
  return { status: response.status(), body: await response.json() };
};

const editor = (page: Page) => page.getByRole('dialog');

async function openEditor(page: Page, id: string) {
  await page.locator(`[data-learn-row="${id}"]`).getByRole('button', { name: 'Edit' }).click();
  await expect(editor(page).getByRole('heading', { name: new RegExp(`^${id}`) })).toBeVisible();
  await expect(editor(page).getByLabel('Title · English')).toBeVisible();
}

async function fill(scope: Locator, label: string, en: string, he: string) {
  await scope.getByLabel(`${label} · English`, { exact: true }).fill(en);
  await scope.getByLabel(`${label} · עברית`, { exact: true }).fill(he);
}

/** Save the editor: done when it has nothing unsaved and says nothing went wrong (toasts may linger from an earlier save). */
async function save(page: Page, toast: RegExp) {
  await editor(page).getByRole('button', { name: /^(Save|Add)$/ }).click();
  await expect(editor(page).getByText('· unsaved changes')).toHaveCount(0, { timeout: 20_000 });
  await expect(editor(page).getByRole('alert')).toHaveCount(0);
  await expect(page.getByText(toast).first()).toBeVisible();
}

async function upload(page: Page, button: Locator, file: { name: string; mimeType: string; buffer: Buffer }) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), button.click()]);
  await chooser.setFiles(file);
}

const second = { name: 'second.png', mimeType: 'image/png', buffer: Buffer.from(makePng(240, 180, (x, y) => [(x * 3) % 256, (y * 5) % 256, 120])) };
const third = { name: 'third.png', mimeType: 'image/png', buffer: Buffer.from(makePng(200, 200, (x, y) => [40, (x + y) % 256, 200])) };
// Not the lesson's picture: a file is stored once by its bytes, and the lesson (Free) shares it otherwise.
const kettle = { name: 'kettle.png', mimeType: 'image/png', buffer: Buffer.from(makePng(320, 240, (x, y) => [200, (x * 2) % 256, (y * 2) % 256])) };

const MODES = { Free: 'free', Pro: 'pro', 'Admin only': 'admin', Blocked: 'blocked' } as const;
async function setRowAccess(page: Page, id: string, label: keyof typeof MODES) {
  await page.getByLabel(`Access of ${id}`).selectOption({ label });
  await expect(page.locator(`[data-learn-row="${id}"]`)).toHaveAttribute('data-access', MODES[label]);
  await expect(page.getByText(new RegExp(`^${id} is now ${label}$`)).first()).toBeVisible();
}

test('add a challenge and a lesson, edit them, and learners see every save at once', async ({ browser }) => {
  test.setTimeout(180_000);
  const admin = await adminPage(browser);
  const free = await signedIn(browser, 'ENT_Free');
  const { page } = admin;

  // A new challenge starts Admin only: unknown to Free.
  await page.getByRole('button', { name: 'Add challenge' }).click();
  await expect(editor(page).getByRole('heading', { name: /^New challenge/ })).toBeVisible();
  const results = await new AxeBuilder({ page }).include('[data-learn-editor]').withTags(WCAG).analyze();
  expect(results.violations).toEqual([]);
  await fill(editor(page), 'Title', 'Kettle study', 'מחקר קומקום');
  await fill(editor(page), 'Prompt', 'Draw the kettle from three sides.', 'לרשום את הקומקום משלושה צדדים.');
  await fill(editor(page), 'Skill', 'Seeing simple forms', 'לראות צורות פשוטות');
  await expect(editor(page).getByLabel(/^Access/)).toHaveValue('admin');
  await save(page, /^Added CH-904$/);
  await expect(editor(page).getByRole('heading', { name: /^CH-904/ })).toBeVisible();
  await expect(page.locator('[data-learn-row="CH-904"]')).toHaveAttribute('data-access', 'admin');
  expect(await status(free.page, '/api/learn/items/CH-904')).toBe(404);
  expect((await itemOf(page, 'CH-904')).body.item.prompt.en).toBe('Draw the kettle from three sides.');

  // Edit it, and make it Free in the same save: Free opens it at once.
  await editor(page).getByLabel(/^Access/).selectOption('free');
  await fill(editor(page), 'Tip (focus, optional)', 'Look for the big shapes first.', 'קודם מחפשים את הצורות הגדולות.');
  await save(page, /^Saved CH-904$/);
  const opened = await itemOf(free.page, 'CH-904');
  expect(opened.status).toBe(200);
  expect(opened.body.item).toMatchObject({ title: { en: 'Kettle study', he: 'מחקר קומקום' }, focus: { en: 'Look for the big shapes first.' } });
  // A further edit: live on Free's next request.
  await fill(editor(page), 'Prompt', 'Draw the kettle from two sides.', 'לרשום את הקומקום משני צדדים.');
  await save(page, /^Saved CH-904$/);
  expect((await itemOf(free.page, 'CH-904')).body.item.prompt.en).toBe('Draw the kettle from two sides.');
  await editor(page).getByRole('button', { name: 'Close', exact: true }).click();
  await expect(editor(page)).toHaveCount(0);

  // A new lesson, with its picture uploaded from this computer; Free needs every text in both languages first.
  await page.getByRole('button', { name: 'Add lesson' }).click();
  const lesson = editor(page);
  await lesson.getByLabel(/^Unit/).selectOption('shapes');
  await fill(lesson, 'Title', 'Ovals in boxes', 'אליפסות בתוך קופסאות');
  await lesson.getByLabel(/^Access/).selectOption('free');
  await lesson.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(lesson.getByRole('alert')).toContainText('needs English and Hebrew before it can be Free or Pro');
  await fill(lesson, 'What you will learn (objective)', 'Draw an oval that fits its box.', 'לרשום אליפסה שמתאימה לקופסה שלה.');
  await upload(page, lesson.getByRole('button', { name: 'Add the lesson picture' }), photo);
  const picture = lesson.locator('[data-picture]').first();
  await expect(picture.locator('img')).toBeVisible();
  await fill(picture, 'Description for screen readers', 'An oval drawn inside a box', 'אליפסה בתוך קופסה');
  await fill(lesson, 'Caption under the picture', 'The oval touches all four sides.', 'האליפסה נוגעת בארבע הצלעות.');
  await fill(lesson, 'Line 1', 'Draw a box, then the oval inside it.', 'לרשום קופסה ואז את האליפסה בתוכה.');
  await fill(lesson, 'Done when', 'The oval touches every side.', 'האליפסה נוגעת בכל צלע.');
  await fill(lesson, 'Short description', 'Ovals that fit.', 'אליפסות שמתאימות.');
  await fill(lesson, 'Common mistake', 'Pointed ends.', 'קצוות מחודדים.');
  await fill(lesson, 'How to fix it', 'Keep the ends round.', 'לשמור על קצוות עגולים.');
  await fill(lesson, 'What you need', 'A pencil and paper.', 'עיפרון ונייר.');
  await save(page, /^Added D-LESSON-02$/);
  const added = await itemOf(free.page, 'D-LESSON-02');
  expect(added.status).toBe(200);
  expect(added.body.item.demo).toHaveLength(1);
  // Its picture is served to Free (it opens the lesson).
  expect(await status(free.page, `/api/learn/assets/${added.body.item.demo[0].image.assetId}`)).toBe(200);
  for (const v of [admin, free]) await v.context.close();
});

test('upload, replace, reorder and remove pictures; copy an item; archive and restore it', async ({ browser }) => {
  test.setTimeout(180_000);
  const admin = await adminPage(browser);
  const free = await signedIn(browser, 'ENT_Free');
  const { page } = admin;
  await openEditor(page, 'CH-904');
  await editor(page).getByLabel(/^Reference/).selectOption('provided');
  await upload(page, editor(page).getByRole('button', { name: 'Add reference picture' }), kettle);
  await fill(editor(page).locator('[data-picture]').nth(0), 'Description for screen readers', 'A kettle', 'קומקום');
  await save(page, /^Saved CH-904$/);
  const first = (await itemOf(free.page, 'CH-904')).body.item.references[0].assetId as string;
  expect(await status(free.page, `/api/learn/assets/${first}`)).toBe(200);

  // Replace it: a new file (the old one is kept, so earlier versions still have theirs).
  await upload(page, editor(page).locator('[data-picture]').nth(0).getByRole('button', { name: 'Replace' }), second);
  await save(page, /^Saved CH-904$/);
  const replaced = (await itemOf(free.page, 'CH-904')).body.item.references[0].assetId as string;
  expect(replaced).not.toBe(first);
  expect(await status(free.page, `/api/learn/assets/${replaced}`)).toBe(200);
  expect(await status(free.page, `/api/learn/assets/${first}`)).toBe(404);
  expect(await status(page, `/api/learn/assets/${first}`)).toBe(200);

  // Add a second, move it first, save; then remove the other.
  await upload(page, editor(page).getByRole('button', { name: 'Add another reference picture' }), third);
  await fill(editor(page).locator('[data-picture]').nth(1), 'Description for screen readers', 'A kettle from the side', 'קומקום מהצד');
  await editor(page).getByRole('button', { name: 'Move reference picture 2 up' }).click();
  await save(page, /^Saved CH-904$/);
  const two = (await itemOf(free.page, 'CH-904')).body.item.references.map((r: { assetId: string }) => r.assetId);
  expect(two).toHaveLength(2);
  expect(two[1]).toBe(replaced);
  await editor(page).locator('[data-picture]').nth(1).getByRole('button', { name: 'Remove' }).click();
  await save(page, /^Saved CH-904$/);
  expect((await itemOf(free.page, 'CH-904')).body.item.references.map((r: { assetId: string }) => r.assetId)).toEqual([two[0]]);
  await editor(page).getByRole('button', { name: 'Close', exact: true }).click();
  await expect(editor(page)).toHaveCount(0);

  // A copy: the next ID, right after its original, Admin only.
  await page.locator('[data-learn-row="CH-904"]').getByRole('button', { name: 'Duplicate CH-904' }).click();
  await expect(page.getByText('Added CH-905, a copy of CH-904 (Admin only)', { exact: true })).toBeVisible();
  await expect(page.locator('[data-learn-row="CH-905"]')).toHaveAttribute('data-access', 'admin');
  const rows = await page.getByRole('table', { name: 'Challenges' }).locator('[data-learn-row]').evaluateAll((els) => els.map((el) => el.getAttribute('data-learn-row')));
  expect(rows.indexOf('CH-905')).toBe(rows.indexOf('CH-904') + 1);
  expect(await status(free.page, '/api/learn/items/CH-905')).toBe(404);

  // Archive (asked first), then restore.
  await page.locator('[data-learn-row="CH-905"]').getByRole('button', { name: 'Archive CH-905' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Archive' }).click();
  await expect(page.getByText('CH-905 archived: in the studio for nobody', { exact: true })).toBeVisible();
  await expect(page.locator('[data-learn-row="CH-905"]')).toHaveCount(0);
  // Archived: not in the studio for admins either, though Preview shows it.
  expect(await status(page, '/api/learn/items/CH-905')).toBe(404);
  expect((await itemOf(page, 'CH-905?preview=1')).body).toMatchObject({ preview: true, item: { id: 'CH-905', archived: true } });
  await page.getByLabel('Status').selectOption('archived');
  await page.locator('[data-learn-row="CH-905"]').getByRole('button', { name: 'Restore CH-905 from the archive' }).click();
  await expect(page.getByText(/^CH-905 restored \(Admin only\)$/)).toBeVisible();
  await page.getByLabel('Status').selectOption('live');
  await expect(page.locator('[data-learn-row="CH-905"]')).toHaveAttribute('data-access', 'admin');
  expect(await status(page, '/api/learn/items/CH-905')).toBe(200);
  for (const v of [admin, free]) await v.context.close();
});

test('moving up and down within a group changes the order learners see', async ({ browser }) => {
  const admin = await adminPage(browser);
  const free = await signedIn(browser, 'ENT_Free');
  const { page } = admin;
  await setRowAccess(page, 'CH-901', 'Free');
  const order = async () => ((await (await free.page.request.get('/api/learn/items?collection=challenges')).json()).items as { id: string }[]).map((i) => i.id);
  expect(await order()).toEqual(['CH-901', 'CH-904']);
  await page.getByRole('button', { name: 'Move CH-904 up' }).click();
  await expect.poll(order).toEqual(['CH-904', 'CH-901']);
  // First in its group now: it cannot go further up (once the page has its new order).
  await expect(page.getByRole('button', { name: 'Move CH-904 up' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Move CH-904 down' })).toBeEnabled();
  await page.getByRole('button', { name: 'Move CH-904 down' }).click();
  await expect.poll(order).toEqual(['CH-901', 'CH-904']);
  await expect(page.getByRole('button', { name: 'Move CH-904 up' })).toBeEnabled();
  await setRowAccess(page, 'CH-901', 'Admin only');
  for (const v of [admin, free]) await v.context.close();
});

test('Access: Free → Pro → Free, Admin only and Blocked, the same on every route; progress is kept', async ({ browser }) => {
  test.setTimeout(180_000);
  const admin = await adminPage(browser);
  const free = await signedIn(browser, 'ENT_Free');
  const pro = await signedIn(browser, 'ENT_Pro');
  const { page } = admin;
  const picture = (await itemOf(page, 'CH-904')).body.item.references[0].assetId as string;
  // Free marks it done: progress that must survive every change below.
  expect((await free.page.request.post('/api/learn/completions', { data: { itemId: 'CH-904' } })).status()).toBe(201);

  await setRowAccess(page, 'CH-904', 'Pro');
  const locked = await itemOf(free.page, 'CH-904');
  expect(locked).toMatchObject({ status: 403, body: { error: 'locked', reason: 'not_in_plan', inPro: true, item: { id: 'CH-904', open: false } } });
  expect(JSON.stringify(locked.body)).not.toContain('kettle from two sides');
  expect(await status(free.page, `/api/learn/assets/${picture}`)).toBe(403);
  const exported = await free.page.request.post('/api/usage', { data: { tool: 'tool.grid', features: ['export.image'], learnItem: 'CH-904' } });
  expect(exported.status()).toBe(403);
  expect((await free.page.request.post('/api/learn/completions', { data: { itemId: 'CH-904' } })).status()).toBe(403);
  const list = await (await free.page.request.get('/api/learn/items?collection=challenges')).json();
  expect(list.items.find((i: { id: string }) => i.id === 'CH-904')).toMatchObject({ open: false, lock: 'not_in_plan', inPro: true });
  expect(JSON.stringify(list)).not.toContain('kettle from two sides');
  // Pro opens it, with its picture.
  expect((await itemOf(pro.page, 'CH-904')).status).toBe(200);
  expect(await status(pro.page, `/api/learn/assets/${picture}`)).toBe(200);
  // The studio's own page for Free: locked, nothing of it.
  await free.page.goto('/app/learn/challenges/CH-904');
  await expect(free.page.locator('[data-learn-locked="not_in_plan"]')).toBeVisible();
  expect(await free.page.content()).not.toContain('kettle from two sides');

  await setRowAccess(page, 'CH-904', 'Free');
  expect((await itemOf(free.page, 'CH-904')).status).toBe(200);

  await setRowAccess(page, 'CH-904', 'Admin only');
  for (const who of [free.page, pro.page]) {
    expect(await status(who, '/api/learn/items/CH-904')).toBe(404);
    expect(await status(who, `/api/learn/assets/${picture}`)).toBe(404);
    expect(await status(who, '/api/learn/items/CH-904?preview=1')).toBe(404);
  }
  expect(await status(page, '/api/learn/items/CH-904')).toBe(200);

  await setRowAccess(page, 'CH-904', 'Blocked');
  for (const who of [free.page, pro.page]) expect(await status(who, '/api/learn/items/CH-904')).toBe(404);
  // Blocked: not in the studio for admins either; Admin → Learn's Preview still shows it, marked.
  expect(await status(page, '/api/learn/items/CH-904')).toBe(404);
  await page.goto('/app/learn/challenges/CH-904?preview=1');
  await expect(page.locator('[data-learn-admin-view="blocked"]')).toHaveText('Preview · Blocked: nobody sees this in the studio');
  await expect(page.locator('[data-learn-card="CH-904"]')).toBeVisible();
  await page.goto('/admin/learn');
  await setRowAccess(page, 'CH-904', 'Free');

  // The completion from before is still there.
  const history = await (await free.page.request.get('/api/learn/completions')).json();
  expect(history.summary.items['CH-904'].count).toBe(1);
  // Admin → Plans only sums it up.
  await page.goto('/admin/plans');
  await expect(page.getByLabel('Learn items by access')).toContainText('Free 2');
  for (const v of [admin, free, pro]) await v.context.close();
});

test('history: restore one item’s earlier copy, and the whole content as an earlier version', async ({ browser }) => {
  test.setTimeout(180_000);
  const admin = await adminPage(browser);
  const free = await signedIn(browser, 'ENT_Free');
  const { page } = admin;
  await openEditor(page, 'CH-904');
  await editor(page).getByRole('tab', { name: /^History/ }).click();
  const entries = editor(page).getByRole('region', { name: 'History of this item' }).getByRole('listitem');
  await expect(entries.first()).toContainText('live');
  // The copy with "three sides" (the first prompt) is the one saved when it was added.
  const added = entries.filter({ hasText: 'Added CH-904' });
  await added.getByRole('button', { name: 'Restore this copy' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByText(/^Restored CH-904 from version \d+$/)).toBeVisible();
  // Texts back as they were; access (Free) as it is now.
  const restored = await itemOf(free.page, 'CH-904');
  expect(restored.status).toBe(200);
  expect(restored.body.item.prompt.en).toBe('Draw the kettle from three sides.');
  await editor(page).getByRole('button', { name: 'Close', exact: true }).click();
  await expect(editor(page)).toHaveCount(0);

  // The whole content: version 1 (the import), after a preview of what it changes; items added since stay, archived.
  const versions = page.getByRole('region', { name: 'Version history' });
  await versions.getByRole('listitem').filter({ hasText: /^Version 1 ·/ }).getByRole('button', { name: 'Restore this version' }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm.getByRole('list', { name: 'What restoring changes' })).toContainText('Archives CH-904');
  await confirm.getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByText('Version 1 restored', { exact: true })).toBeVisible();
  expect(await status(free.page, '/api/learn/items/CH-904')).toBe(404);
  await page.reload();
  await page.getByLabel('Status').selectOption('archived');
  await expect(page.locator('[data-learn-row="CH-904"]')).toBeVisible();
  // And forward again: the newest earlier version brings CH-904 back as it was.
  const latest = versions.getByRole('listitem').nth(1);
  await latest.getByRole('button', { name: 'Restore this version' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByText(/^Version \d+ restored$/)).toBeVisible();
  expect((await itemOf(free.page, 'CH-904')).status).toBe(200);
  for (const v of [admin, free]) await v.context.close();
});

test('mobile: the tables and the editor on a phone, with a picture uploaded from Safari’s engine', async ({ browser }) => {
  test.setTimeout(120_000);
  const admin = await adminPage(browser);
  const { page } = admin;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await openEditor(page, 'CH-905');
  const dialog = editor(page);
  const box = (await dialog.boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  // The copy has its original's picture; add one more from the phone.
  await upload(page, dialog.getByRole('button', { name: 'Add another reference picture' }), photo);
  await expect(dialog.locator('[data-picture] img')).toHaveCount(2);
  await fill(dialog.locator('[data-picture]').nth(1), 'Description for screen readers', 'A kettle, from the phone', 'קומקום, מהטלפון');
  await expect(dialog.getByRole('button', { name: 'Save' })).toBeInViewport();
  await save(page, /^Saved CH-905$/);
  expect((await itemOf(page, 'CH-905')).body.item.references).toHaveLength(2);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  // The page rendered in Safari's engine exactly as the server rendered it: no React (hydration) error.
  // (WebKit also reports the keep-alive request the reload aborted, as an access-control error: not ours.)
  expect(errors.filter((message) => /React error|Hydration|hydrat/i.test(message))).toEqual([]);
  await admin.context.close();
});
