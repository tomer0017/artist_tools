import AxeBuilder from '@axe-core/playwright';
import { test, expect, type APIRequestContext, type Browser } from '@playwright/test';

// Learn's server side (ADR-0017, ADR-0023): the main test server has the
// synthetic Learn content published (scripts/e2e-server.ts,
// src/test/learn-fixture.ts), written before access modes, and no plan's old
// rules open any of it: every item is Admin only. So Free and Pro open
// nothing and get no image, admins open everything (unpublished items too),
// and signed-out visitors get 401. Every check here is on what the server
// answers; the Learn screens (M5, ADR-0018) are in e2e/learn-screens.spec.ts.
// Access modes set in Admin → Learn are in e2e/learn-admin.spec.ts.

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const COLLECTIONS = ['curriculum', 'color', 'challenges'] as const;
const PUBLISHED = {
  'D-TEST-01': 'learn.curriculum',
  'D-TEST-02': 'learn.curriculum',
  'D-BASE-01': 'learn.curriculum',
  'D-LESSON-01': 'learn.curriculum',
  'C-TEST-01': 'learn.color',
  'CH-901': 'learn.challenges',
  'CH-902': 'learn.challenges',
} as const;
const UNPUBLISHED = ['D-TEST-03', 'CH-903'];

async function api(browser: Browser, who: string | null) {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, storageState: who ? `e2e/.auth/${who}.json` : { cookies: [], origins: [] } });
  return { context, request: context.request };
}

type Picture = { assetId: string; thumbnailAssetId: string };

/** Every asset the content uses, found as an admin: each picture (references, and a lesson's demonstration, step and mistake pictures) with its thumbnail, and each static worksheet. */
async function assetIds(request: APIRequestContext): Promise<{ references: string[]; thumbnails: string[]; worksheets: string[] }> {
  const pictures = new Map<string, string>();
  const worksheets = new Set<string>();
  for (const id of Object.keys(PUBLISHED)) {
    const { item } = await (await request.get(`/api/learn/items/${id}`)).json();
    const all: Picture[] = [
      ...item.references,
      ...(item.demo ?? []).map((frame: { image: Picture }) => frame.image),
      ...(item.steps ?? []).flatMap((step: { image?: Picture }) => (step.image ? [step.image] : [])),
      ...(item.mistake?.image ? [item.mistake.image] : []),
    ];
    for (const picture of all) pictures.set(picture.assetId, picture.thumbnailAssetId);
    if (item.worksheet?.kind === 'static') worksheets.add(item.worksheet.assetId);
  }
  return { references: [...pictures.keys()], thumbnails: [...pictures.values()], worksheets: [...worksheets] };
}

test.describe('Learn with every item Admin only (no plan’s old rules open any)', () => {
  test('Free and Pro: lists are empty, every item and image is unknown to them, and so is an export from an item', async ({ browser }) => {
    const admin = await api(browser, 'admin');
    const assets = await assetIds(admin.request);
    // Six pictures (three references, a lesson's picture and its mistake picture, the baseline's picture) and one static worksheet.
    expect(assets.references).toHaveLength(6);
    expect(assets.worksheets).toHaveLength(1);
    await admin.context.close();

    for (const who of ['user', 'pro']) {
      const { context, request } = await api(browser, who);
      for (const collection of COLLECTIONS) {
        const list = await request.get(`/api/learn/items?collection=${collection}`);
        expect(list.status()).toBe(200);
        expect(list.headers()['cache-control']).toBe('private, no-store');
        expect((await list.json()).items).toEqual([]);
      }
      for (const id of Object.keys(PUBLISHED)) {
        const response = await request.get(`/api/learn/items/${id}`);
        expect(response.status(), `${who} ${id}`).toBe(404);
        const text = await response.text();
        expect(JSON.parse(text)).toEqual({ error: 'not_found' });
        expect(text).not.toContain('Secret');
      }
      // The admin preview is for admins only: the same answer.
      expect((await request.get('/api/learn/items/CH-901?preview=1')).status()).toBe(404);
      for (const id of [...UNPUBLISHED, 'CH-999', 'not-an-item', 'D-TEST-01.json']) expect((await request.get(`/api/learn/items/${id}`)).status(), `${who} ${id}`).toBe(404);
      for (const id of [...assets.references, ...assets.thumbnails, ...assets.worksheets]) {
        const response = await request.get(`/api/learn/assets/${id}`);
        expect(response.status(), `${who} asset ${id}`).toBe(404);
        expect(response.headers()['content-type']).toContain('application/json');
      }
      const exported = await request.post('/api/usage', { data: { tool: 'tool.grid', features: ['export.image'], learnItem: 'CH-901' } });
      expect(exported.status()).toBe(403);
      expect(await exported.json()).toEqual({ error: 'not_included', features: [], learnItem: { id: 'CH-901', reason: 'unavailable' } });
      // A teacher's own photo still saves as before.
      expect((await request.post('/api/usage', { data: { tool: 'tool.grid', features: ['export.image'] } })).status()).toBe(200);
      await context.close();
    }
  });

  test('an admin opens every item, unpublished ones too, with its images, privately cached', async ({ browser }) => {
    const { context, request } = await api(browser, 'admin');
    const list = await (await request.get('/api/learn/items?collection=curriculum')).json();
    expect(list.items.map((row: { id: string; open: boolean; published: boolean }) => `${row.id}:${row.open}:${row.published}`)).toEqual([
      'D-TEST-01:true:true',
      'D-TEST-02:true:true',
      'D-TEST-03:true:false',
      'D-BASE-01:true:true',
      'D-LESSON-01:true:true',
    ]);
    // Lists never carry an item's content.
    expect(JSON.stringify(list)).not.toContain('Secret');
    const { item, contentVersion } = await (await request.get('/api/learn/items/D-TEST-01')).json();
    expect(contentVersion).toBe(1);
    expect(item).toMatchObject({ id: 'D-TEST-01', kind: 'exercise', published: true, instruction: { en: 'Secret instruction D-TEST-01', he: 'הוראה סודית D-TEST-01' } });
    expect(item.references[0]).toMatchObject({ width: 96, height: 64, alt: { en: 'Test picture sky' } });
    expect((await request.get('/api/learn/items/CH-903')).status()).toBe(200);

    const image = await request.get(`/api/learn/assets/${item.references[0].assetId}`);
    expect(image.status()).toBe(200);
    expect(image.headers()).toMatchObject({
      'content-type': 'image/png',
      'cache-control': 'private, no-cache',
      'x-content-type-options': 'nosniff',
      'cross-origin-resource-policy': 'same-origin',
      etag: `"${item.references[0].assetId}"`,
    });
    expect((await image.body()).subarray(0, 4).toString('hex')).toBe('89504e47');
    // Revalidated on every use: unchanged, but checked again.
    const again = await request.get(`/api/learn/assets/${item.references[0].assetId}`, { headers: { 'if-none-match': `"${item.references[0].assetId}"` } });
    expect(again.status()).toBe(304);
    expect((await request.get(`/api/learn/assets/${item.references[0].thumbnailAssetId}`)).status()).toBe(200);
    expect((await request.get(`/api/learn/assets/${'0'.repeat(64)}`)).status()).toBe(404);
    for (const bad of ['..%2F..%2Fetc%2Fpasswd', 'ABC', `${'a'.repeat(64)}.png`]) expect((await request.get(`/api/learn/assets/${bad}`)).status()).toBe(404);
    await context.close();
  });

  test('signed out: every Learn request answers 401; a malformed one 400', async ({ browser }) => {
    const { context, request } = await api(browser, null);
    expect((await request.get('/api/learn/items?collection=challenges')).status()).toBe(401);
    expect((await request.get('/api/learn/items/CH-901')).status()).toBe(401);
    expect((await request.get(`/api/learn/assets/${'a'.repeat(64)}`)).status()).toBe(401);
    expect((await request.get('/api/learn/items?collection=sculpture')).status()).toBe(400);
    await context.close();
    const expired = await api(browser, 'expired');
    expect((await expired.request.get('/api/learn/items/CH-901')).status()).toBe(401);
    await expired.context.close();
  });

  test('the studio’s pages carry no Learn content', async ({ page }) => {
    for (const path of ['/app', '/app/grid', '/app/study', '/app/profile']) {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      const html = await page.content();
      expect(html, path).not.toContain('Secret instruction');
      expect(html, path).not.toContain('Secret prompt');
    }
  });
});

test.describe('Admin → Learn and the Learn summary in Admin → Plans', () => {
  test.use({ storageState: 'e2e/.auth/admin.json' });

  test('Admin → Learn: every item in its table with its access (from the old rules until saved), pictures and history', async ({ page }) => {
    await page.goto('/admin/learn');
    await expect(page.getByRole('heading', { name: 'Learn content', level: 1 })).toBeVisible();
    const curriculum = page.getByRole('table', { name: 'Drawing curriculum' });
    await expect(curriculum.locator('[data-learn-row]')).toHaveCount(5);
    const draft = curriculum.locator('[data-learn-row="D-TEST-03"]');
    await expect(draft.getByLabel('Access of D-TEST-03')).toHaveValue('admin');
    await expect(draft).toContainText('from the old plan rules');
    await expect(page.getByRole('table', { name: 'Challenges' }).locator('[data-learn-row="CH-901"] img')).toBeVisible();
    // The thumbnail really loaded through the authorized route.
    expect(await page.locator('[data-learn-row="CH-901"] img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(48);
    await expect(page.getByRole('region', { name: 'Summary' })).toContainText('Admin only 9');
    // Search by ID, English or Hebrew title.
    await page.getByRole('searchbox', { name: 'Search' }).fill('אתגר בדיקה one');
    await expect(page.locator('[data-learn-row]')).toHaveCount(1);
    await page.getByRole('searchbox', { name: 'Search' }).fill('');
    await page.getByText('All pictures and sheets (7)').click();
    await expect(page.getByText('Synthetic sky')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'History of the whole content' })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(results.violations).toEqual([]);
  });

  test('Admin → Plans: Learn is only summed up there; the old modules are not settings any more', async ({ page }) => {
    await page.goto('/admin/plans');
    for (const label of ['Drawing curriculum', 'Color module', 'Challenges']) {
      await expect(page.getByRole('listitem').filter({ has: page.getByText(label, { exact: true }) })).toHaveCount(0);
    }
    const section = page.getByRole('region', { name: 'Learn access' });
    await expect(section.getByRole('link', { name: 'Admin → Learn' })).toHaveAttribute('href', '/admin/learn');
    await expect(section.getByLabel('Learn items by access')).toContainText('Admin only 9');
    await expect(section.getByRole('combobox')).toHaveCount(0);
    const results = await new AxeBuilder({ page }).include('#learn-access').withTags(WCAG).analyze();
    expect(results.violations).toEqual([]);
  });
});

test('Admin → Learn does not exist for anyone but admins', async ({ browser }) => {
  for (const who of ['user', 'pro']) {
    const { context } = await api(browser, who);
    const page = await context.newPage();
    const response = await page.goto('/admin/learn');
    expect(response?.status()).toBe(404);
    expect(await page.content()).not.toContain('Secret');
    await context.close();
  }
});
