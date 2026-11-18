// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ObjectId, type Db } from 'mongodb';
import { MONGO_STARTUP_TIMEOUT, startTestMongo, type TestMongo } from '@/test/mongo';
import { PLAN_FEATURES, TOOL_FEATURES, featureRows, hasAllTools, isDefaultSplit, type FeatureId } from '@/lib/plans';
import { getAccountSummary } from './account';
import { CatalogSchema, catalogSpec, defaultCatalog, type Catalog } from './config/catalog';
import { discardDraft, getDraft, getPublished, publishDraft, publishIfUnchanged, saveDraft } from './config/versions';
import { collections } from './db/collections';
import { migrate } from './db/migrate';
import { authorizeToolUse, getEntitlements, getPlanOffer, includes } from './entitlements';
import { getUsage, usagePeriod } from './usage';

// What each plan may use comes from the published plan catalog, and nothing
// else: these tests publish catalogs the way an admin does (draft → publish,
// which writes `plans`) and check what accounts get, on their very next
// request, against a real database.

let mongo: TestMongo;
let db: Db;

beforeAll(async () => {
  mongo = await startTestMongo();
  db = mongo.db;
  await migrate(db);
}, MONGO_STARTUP_TIMEOUT);

afterAll(async () => mongo?.stop());

async function account(overrides: Record<string, unknown> = {}) {
  const _id = new ObjectId();
  await collections(db).users.insertOne({
    _id, name: 'P', email: `${_id.toHexString()}@example.com`, emailVerified: true, createdAt: new Date(), updatedAt: new Date(),
    role: 'user', status: 'active', plan: 'free', marketingConsent: false, ...overrides,
  } as never);
  return _id;
}

/** Publish a catalog as an admin would: save it as the draft, then publish it. */
async function publish(catalog: Catalog) {
  expect((await saveDraft(db, catalogSpec, catalog, 'admin:test')).status).toBe('saved');
  expect((await publishDraft(db, catalogSpec, 'admin:test')).status).toBe('published');
}

const ALL_TOOLS = Object.values(TOOL_FEATURES);
const without = (features: readonly FeatureId[], ...out: FeatureId[]) => features.filter((f) => !out.includes(f));

/** The catalog live on staging since 2026-11-18 (version 2): Free without Measure, Compare and GIFs. */
const STAGING_V2: Catalog = {
  plans: {
    free: { features: ['tool.study', 'tool.color', 'tool.grid', 'export.image'], quotas: {} },
    pro: { features: [...PLAN_FEATURES.pro], quotas: {} },
  },
  disabled: [],
};

describe('published plans decide, on the next request', () => {
  it('applies a publication at once: no cached plans anywhere', async () => {
    const free = await account();
    expect(includes(await getEntitlements(db, free), 'tool.measure')).toBe(true);
    await publish(STAGING_V2);
    // The very next read, in the same process that answered a moment ago.
    const e = await getEntitlements(db, free);
    expect(e.features).toEqual(['tool.study', 'tool.color', 'tool.grid', 'export.image']);
    expect(e.offer).toEqual({ free: ['tool.study', 'tool.color', 'tool.grid', 'export.image'], pro: PLAN_FEATURES.pro });
    expect(await getPlanOffer(db)).toEqual(e.offer);
    await publish(defaultCatalog());
    expect(includes(await getEntitlements(db, free), 'tool.measure')).toBe(true);
  });

  it('Free denied, Pro allowed: a tool removed from Free only', async () => {
    await publish(STAGING_V2);
    const [free, pro] = [await account(), await account({ plan: 'pro' })];
    for (const tool of ['tool.measure', 'tool.compare'] as const) {
      expect(await authorizeToolUse(db, free, { tool, features: [] })).toEqual({ status: 'denied', reason: 'not_included', missing: [tool] });
      expect(await authorizeToolUse(db, pro, { tool, features: [] })).toEqual({ status: 'recorded' });
    }
    for (const tool of ['tool.study', 'tool.color', 'tool.grid'] as const) {
      expect(await authorizeToolUse(db, free, { tool, features: [] })).toEqual({ status: 'recorded' });
    }
  });

  it('refuses every export from a tool the plan does not include, and counts nothing', async () => {
    await publish(STAGING_V2);
    const free = await account();
    expect(await authorizeToolUse(db, free, { tool: 'tool.measure', features: ['export.image'] })).toEqual({ status: 'denied', reason: 'not_included', missing: ['tool.measure'] });
    expect(await authorizeToolUse(db, free, { tool: 'tool.compare', features: ['export.gif'] })).toEqual({ status: 'denied', reason: 'not_included', missing: ['tool.compare'] });
    expect(await getUsage(db, free, usagePeriod())).toEqual({});
  });

  it('refuses an export the plan lacks even from an included tool', async () => {
    await publish({ ...STAGING_V2, plans: { ...STAGING_V2.plans, free: { features: ['tool.compare', 'tool.grid', 'export.gif'], quotas: {} } } });
    const free = await account();
    expect(await authorizeToolUse(db, free, { tool: 'tool.grid', features: ['export.image'] })).toEqual({ status: 'denied', reason: 'not_included', missing: ['export.image'] });
    expect(await authorizeToolUse(db, free, { tool: 'tool.compare', features: ['export.gif', 'export.gif_large'] })).toEqual({ status: 'denied', reason: 'not_included', missing: ['export.gif_large'] });
    expect(await authorizeToolUse(db, free, { tool: 'tool.compare', features: ['export.gif', 'export.gif_difference'] })).toEqual({ status: 'denied', reason: 'not_included', missing: ['export.gif_difference'] });
    // An allowed export is counted; the tool it came from is checked, never counted.
    expect(await authorizeToolUse(db, free, { tool: 'tool.compare', features: ['export.gif'] })).toEqual({ status: 'recorded' });
    expect(await getUsage(db, free, usagePeriod())).toEqual({ 'export.gif': 1 });
  });

  it('Free allowed, Pro allowed', async () => {
    await publish(STAGING_V2);
    const [free, pro] = [await account(), await account({ plan: 'pro' })];
    for (const userId of [free, pro]) {
      expect(await authorizeToolUse(db, userId, { tool: 'tool.grid', features: ['export.image'] })).toEqual({ status: 'recorded' });
    }
  });

  it('both plans denied: a tool switched off for everyone, or on no plan; admins keep it', async () => {
    const [free, pro, admin] = [await account(), await account({ plan: 'pro' }), await account({ role: 'admin' })];
    await publish({ ...defaultCatalog(), disabled: ['tool.color'] });
    for (const userId of [free, pro]) expect(await authorizeToolUse(db, userId, { tool: 'tool.color', features: [] })).toMatchObject({ status: 'denied', missing: ['tool.color'] });
    expect(await authorizeToolUse(db, admin, { tool: 'tool.color', features: ['export.image'] })).toEqual({ status: 'recorded' });

    const catalog = defaultCatalog();
    for (const planId of ['free', 'pro'] as const) catalog.plans[planId].features = without(catalog.plans[planId].features, 'tool.grid');
    await publish(catalog);
    for (const userId of [free, pro]) expect(await authorizeToolUse(db, userId, { tool: 'tool.grid', features: [] })).toMatchObject({ status: 'denied', missing: ['tool.grid'] });
    expect(await authorizeToolUse(db, admin, { tool: 'tool.grid', features: [] })).toEqual({ status: 'recorded' });
    expect((await getPlanOffer(db)).free).not.toContain('tool.grid');
    await publish(defaultCatalog());
  });

  it('follows a plan change at once, without a new sign-in', async () => {
    await publish(STAGING_V2);
    const userId = await account();
    expect((await authorizeToolUse(db, userId, { tool: 'tool.measure', features: [] })).status).toBe('denied');
    await collections(db).users.updateOne({ _id: userId }, { $set: { plan: 'pro' } });
    expect((await authorizeToolUse(db, userId, { tool: 'tool.measure', features: [] })).status).toBe('recorded');
    await collections(db).users.updateOne({ _id: userId }, { $set: { plan: 'free' } });
    expect((await authorizeToolUse(db, userId, { tool: 'tool.measure', features: [] })).status).toBe('denied');
  });

  it('refuses everything to a suspended account, or one that does not exist', async () => {
    await publish(defaultCatalog());
    const suspended = await account({ status: 'suspended', plan: 'pro' });
    for (const userId of [suspended, new ObjectId()]) {
      expect((await authorizeToolUse(db, userId, { tool: 'tool.grid', features: [] })).status).toBe('denied');
      expect((await authorizeToolUse(db, userId, { tool: null, features: [] })).status).toBe('denied');
      expect((await authorizeToolUse(db, userId, { tool: 'tool.grid', features: ['export.image'] })).status).toBe('denied');
    }
  });

  it('sends the studio what the account may use, what each plan includes, and when it was read', async () => {
    await publish(STAGING_V2);
    const now = new Date();
    const summary = await getAccountSummary(db, await account(), { now });
    expect(summary?.account).toMatchObject({
      features: ['tool.study', 'tool.color', 'tool.grid', 'export.image'],
      offer: { free: ['tool.study', 'tool.color', 'tool.grid', 'export.image'], pro: PLAN_FEATURES.pro },
      asOf: now.toISOString(),
    });
    await publish(defaultCatalog());
  });
});

describe('operator tools publish only over the version they expect (never over an admin)', () => {
  it('refuses when another version went live, or a draft is open (left untouched), and otherwise publishes and restores', async () => {
    await publish(defaultCatalog());
    const live = (await getPublished(db, catalogSpec))!;
    const temporary: Catalog = { ...defaultCatalog(), disabled: ['tool.grid'] };

    expect(await publishIfUnchanged(db, catalogSpec, temporary, { version: live.version - 1 }, 'cli', 'test')).toEqual({ status: 'changed', live: live.version });
    expect((await getPublished(db, catalogSpec))!.version).toBe(live.version);

    await saveDraft(db, catalogSpec, STAGING_V2, 'admin:someone', 'an admin is editing');
    const draft = await getDraft(db, catalogSpec);
    expect(await publishIfUnchanged(db, catalogSpec, temporary, { version: live.version }, 'cli', 'test')).toEqual({ status: 'draft_exists' });
    expect(await getDraft(db, catalogSpec)).toEqual(draft);
    expect((await getPublished(db, catalogSpec))!.version).toBe(live.version);
    expect(await discardDraft(db, 'catalog', 'admin:someone')).toBe(true);

    const published = await publishIfUnchanged(db, catalogSpec, temporary, { version: live.version }, 'cli', 'test');
    expect(published).toEqual({ status: 'published', version: live.version + 1 });
    expect((await getPlanOffer(db)).free).not.toContain('tool.grid');
    // Back from the temporary version, over that version only.
    expect(await publishIfUnchanged(db, catalogSpec, defaultCatalog(), { version: live.version }, 'cli', 'restore')).toEqual({ status: 'changed', live: live.version + 1 });
    expect(await publishIfUnchanged(db, catalogSpec, defaultCatalog(), { version: live.version + 1 }, 'cli', 'restore')).toEqual({ status: 'published', version: live.version + 2 });
    expect(CatalogSchema.parse((await getPublished(db, catalogSpec))!.document)).toEqual(defaultCatalog());
    expect((await getPlanOffer(db)).free).toEqual(PLAN_FEATURES.free);
  });
});

describe('the catalog: tools are on or off', () => {
  it('drops a quota on a tool (nothing would count it) and keeps quotas on saves', () => {
    const parsed = CatalogSchema.parse({
      plans: {
        free: { features: ['tool.measure', 'export.image'], quotas: { 'tool.measure': { limit: 3, period: 'day' }, 'export.image': { limit: 50, period: 'month' } } },
        pro: { features: ['tool.measure'] },
      },
    });
    expect(parsed.plans.free.quotas).toEqual({ 'export.image': { limit: 50, period: 'month' } });
    expect(parsed.plans.pro.quotas).toEqual({});
  });
});

describe('what pages show comes from the same published plans', () => {
  it('shows "All five tools" as one row only while each plan has all five or none', () => {
    expect(featureRows([PLAN_FEATURES.free, PLAN_FEATURES.pro]).map((r) => r.id)).toEqual(['tools', 'images', 'gifs', 'large', 'difference']);
    const v2 = STAGING_V2.plans.free.features;
    expect(featureRows([v2, PLAN_FEATURES.pro]).map((r) => `${r.kind}:${r.id}`)).toEqual([
      'tool:measure', 'tool:value', 'tool:color', 'tool:grid', 'tool:compare', 'group:images', 'group:gifs', 'group:large', 'group:difference',
    ]);
    expect(featureRows([[]]).map((r) => r.id)[0]).toBe('tools');
  });

  it('uses the default texts ("all five tools are free") only for the default split', () => {
    expect(isDefaultSplit({ free: [...PLAN_FEATURES.free], pro: [...PLAN_FEATURES.pro] })).toBe(true);
    expect(isDefaultSplit({ free: STAGING_V2.plans.free.features, pro: [...PLAN_FEATURES.pro] })).toBe(false);
    expect(hasAllTools(STAGING_V2.plans.free.features)).toBe(false);
    expect(hasAllTools(ALL_TOOLS)).toBe(true);
  });
});

describe('worksheets (M3): in no plan until an admin publishes it', () => {
  // As Prepare Worksheets asks: the other tool its sheets use, checked alone
  // (nothing counted), then the tool it was opened from with Worksheets and
  // Saved images (both counted).
  type Who = Awaited<ReturnType<typeof account>>;
  const askForSet = (who: Who, from: 'tool.grid' | 'tool.study') => authorizeToolUse(db, who, { tool: from, features: ['export.worksheets', 'export.image'] });
  const checkTool = (who: Who, tool: 'tool.grid' | 'tool.study') => authorizeToolUse(db, who, { tool, features: [] });

  it('is refused to Free and Pro on the default and the staging catalogs, allowed to admins, and counted with the saved images', async () => {
    for (const catalog of [defaultCatalog(), STAGING_V2]) {
      await publish(catalog);
      const [free, pro, admin] = [await account(), await account({ plan: 'pro' }), await account({ role: 'admin' })];
      for (const who of [free, pro]) {
        for (const from of ['tool.grid', 'tool.study'] as const) {
          expect(await askForSet(who, from)).toEqual({ status: 'denied', reason: 'not_included', missing: ['export.worksheets'] });
        }
        expect((await getEntitlements(db, who)).features).not.toContain('export.worksheets');
        // A refusal counts nothing, not even the saved images.
        expect(await getUsage(db, who, usagePeriod())).toEqual({});
      }
      expect(await checkTool(admin, 'tool.grid')).toEqual({ status: 'recorded' });
      expect(await askForSet(admin, 'tool.study')).toEqual({ status: 'recorded' });
      expect(await getUsage(db, admin, usagePeriod())).toEqual({ 'export.worksheets': 1, 'export.image': 1 });
      expect((await getPlanOffer(db)).pro).not.toContain('export.worksheets');
    }
  });

  it('follows a publication for Pro; a set also needs Saved images and both tools; then out again, refused at once', async () => {
    const proWithSheets: Catalog = {
      ...STAGING_V2,
      plans: { ...STAGING_V2.plans, pro: { features: [...STAGING_V2.plans.pro.features, 'export.worksheets'], quotas: {} } },
    };
    await publish(proWithSheets);
    const [free, pro] = [await account(), await account({ plan: 'pro' })];
    expect(await askForSet(free, 'tool.grid')).toEqual({ status: 'denied', reason: 'not_included', missing: ['export.worksheets'] });
    for (const from of ['tool.grid', 'tool.study'] as const) expect(await askForSet(pro, from)).toEqual({ status: 'recorded' });
    expect(await checkTool(pro, 'tool.study')).toEqual({ status: 'recorded' });
    expect(await getUsage(db, pro, usagePeriod())).toEqual({ 'export.worksheets': 2, 'export.image': 2 });
    // Without saved images in the plan: no set (the sheets are saved images).
    await publish({ ...proWithSheets, plans: { ...proWithSheets.plans, pro: { features: without(proWithSheets.plans.pro.features, 'export.image'), quotas: {} } } });
    expect(await askForSet(pro, 'tool.grid')).toEqual({ status: 'denied', reason: 'not_included', missing: ['export.image'] });
    // Without Study & Simplify: its sheets (outline, values) are refused at the tool check.
    await publish({ ...proWithSheets, plans: { ...proWithSheets.plans, pro: { features: without(proWithSheets.plans.pro.features, 'tool.study'), quotas: {} } } });
    expect(await checkTool(pro, 'tool.study')).toEqual({ status: 'denied', reason: 'not_included', missing: ['tool.study'] });
    expect(await askForSet(pro, 'tool.grid')).toEqual({ status: 'recorded' });
    await publish(STAGING_V2);
    expect(await askForSet(pro, 'tool.grid')).toEqual({ status: 'denied', reason: 'not_included', missing: ['export.worksheets'] });
  });
});

describe('the grid PDF (M2): in no plan until an admin publishes it', () => {
  it('is refused to Free and Pro on the default and the staging catalogs, allowed to admins, and counted', async () => {
    for (const catalog of [defaultCatalog(), STAGING_V2]) {
      await publish(catalog);
      const [free, pro, admin] = [await account(), await account({ plan: 'pro' }), await account({ role: 'admin' })];
      for (const who of [free, pro]) {
        expect(await authorizeToolUse(db, who, { tool: 'tool.grid', features: ['export.pdf'] })).toEqual({ status: 'denied', reason: 'not_included', missing: ['export.pdf'] });
        expect((await getEntitlements(db, who)).features).not.toContain('export.pdf');
      }
      expect(await authorizeToolUse(db, admin, { tool: 'tool.grid', features: ['export.pdf'] })).toEqual({ status: 'recorded' });
      expect((await getUsage(db, admin, usagePeriod()))['export.pdf']).toBe(1);
      expect((await getPlanOffer(db)).pro).not.toContain('export.pdf');
    }
  });

  it('follows a publication: for Pro only, with a quota; then out again, refused at once', async () => {
    const proWithPdf: Catalog = {
      ...STAGING_V2,
      plans: { ...STAGING_V2.plans, pro: { features: [...STAGING_V2.plans.pro.features, 'export.pdf'], quotas: { 'export.pdf': { limit: 2, period: 'day' } } } },
    };
    await publish(proWithPdf);
    const [free, pro] = [await account(), await account({ plan: 'pro' })];
    expect(await authorizeToolUse(db, free, { tool: 'tool.grid', features: ['export.pdf'] })).toEqual({ status: 'denied', reason: 'not_included', missing: ['export.pdf'] });
    expect(await authorizeToolUse(db, pro, { tool: 'tool.grid', features: ['export.pdf'] })).toEqual({ status: 'recorded' });
    expect(await authorizeToolUse(db, pro, { tool: 'tool.grid', features: ['export.pdf'] })).toEqual({ status: 'recorded' });
    expect(await authorizeToolUse(db, pro, { tool: 'tool.grid', features: ['export.pdf'] })).toEqual({ status: 'denied', reason: 'limit_reached', missing: ['export.pdf'] });
    // From a tool the plan lacks, never.
    await publish({ ...proWithPdf, plans: { ...proWithPdf.plans, pro: { features: without(proWithPdf.plans.pro.features, 'tool.grid'), quotas: {} } } });
    expect(await authorizeToolUse(db, pro, { tool: 'tool.grid', features: ['export.pdf'] })).toEqual({ status: 'denied', reason: 'not_included', missing: ['tool.grid'] });
    await publish(STAGING_V2);
    expect(await authorizeToolUse(db, pro, { tool: 'tool.grid', features: ['export.pdf'] })).toEqual({ status: 'denied', reason: 'not_included', missing: ['export.pdf'] });
  });
});
