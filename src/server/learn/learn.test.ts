// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ObjectId, type Db } from 'mongodb';
import { MONGO_STARTUP_TIMEOUT, MONGO_STOP_TIMEOUT, startTestMongo, type TestMongo } from '@/test/mongo';
import { fixtureSeed, writeLearnFixture } from '@/test/learn-fixture';
import { PLAN_FEATURES } from '@/lib/plans';
import { NO_LEARN_ACCESS, defaultLearnSection, type LearnContent, type LearnSection } from '@/lib/learn/model';
import { catalogSpec, describeCatalogChanges, learnSectionOf, planOpens, readCatalog, saveCatalogEdit, type Catalog } from '@/server/config/catalog';
import { getDraft, getPublished, listVersions, publishDraft, restoreAsDraft, saveDraft } from '@/server/config/versions';
import { collections } from '@/server/db/collections';
import { migrate } from '@/server/db/migrate';
import { authorizeToolUse, getEntitlements } from '@/server/entitlements';
import { describeContentChanges, everPublishedIds, learnContentSpec, publishedLearnContent } from './content';
import { importSeed } from './import';
import { liveLearn } from './live';

// Learn end to end on a real database (ADR-0017): importing a folder as a
// draft, publishing it, the checks every draft and publication passes, the
// catalog's Learn section copied into `plans`, entitlements, and exports
// from a Learn item. Nothing opens for Free or Pro until a catalog says so.

let mongo: TestMongo;
let assetsDir: string;
let seedDir: string;

beforeAll(async () => {
  mongo = await startTestMongo();
  assetsDir = mkdtempSync(path.join(tmpdir(), 'learn-assets-'));
  seedDir = writeLearnFixture(mkdtempSync(path.join(tmpdir(), 'learn-seed-')));
  process.env.LEARN_ASSETS_DIR = assetsDir;
}, MONGO_STARTUP_TIMEOUT);

afterAll(async () => {
  delete process.env.LEARN_ASSETS_DIR;
  rmSync(assetsDir, { recursive: true, force: true });
  rmSync(seedDir, { recursive: true, force: true });
  await mongo?.stop();
}, MONGO_STOP_TIMEOUT);

let db: Db;
beforeEach(async () => {
  db = mongo.client.db(`learn_${Math.random().toString(36).slice(2, 10)}`);
  await migrate(db);
});

/** The owner's staging catalog (version 2 of 2026-11-18), without any Learn section. */
const OWNER: Catalog = {
  plans: { free: { features: ['tool.study', 'tool.color', 'tool.grid', 'export.image'], quotas: {} }, pro: { features: [...PLAN_FEATURES.pro], quotas: {} } },
  disabled: [],
};

async function publishCatalog(catalog: unknown) {
  const saved = await saveDraft(db, catalogSpec, catalog, 'admin:owner');
  expect(saved.status).toBe('saved');
  return publishDraft(db, catalogSpec, 'admin:owner');
}

async function importAndPublish() {
  const imported = await importSeed(db, assetsDir, seedDir, 'cli');
  expect(imported.status).toBe('saved');
  expect(await publishDraft(db, learnContentSpec, 'cli')).toMatchObject({ status: 'published' });
}

async function account(plan: 'free' | 'pro', role: 'user' | 'admin' = 'user') {
  const _id = new ObjectId();
  await collections(db).users.insertOne({ _id, name: plan, email: `${_id.toHexString()}@learn.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date(), role, status: 'active', plan } as never);
  return _id;
}

/** A Learn section with these rules for Free (and None elsewhere). */
function freeRules(rules: Partial<LearnSection['access']['free']>, previews: LearnSection['previews'] = 'title'): LearnSection {
  const section = defaultLearnSection();
  section.access.free = { ...section.access.free, ...rules };
  section.previews = previews;
  return section;
}

const content = async () => (await publishedLearnContent(db)) as LearnContent;

describe('importing and publishing content', () => {
  it('stores the assets, saves the content as a draft, and publishes it; nothing is visible before', async () => {
    const imported = await importSeed(db, assetsDir, seedDir, 'cli');
    expect(imported).toMatchObject({ status: 'saved', version: 1 });
    if (imported.status !== 'saved') return;
    expect(imported.assets.map((a) => a.key)).toEqual(['sky', 'leaf', 'wing', 'demo-a', 'demo-b', 'mistake', 'sheet']);
    // Six pictures with their thumbnails, and a static worksheet (no thumbnail).
    expect(await collections(db).learnAssets.countDocuments()).toBe(13);
    // Only a draft: the published content is still empty.
    expect((await content()).exercises).toEqual([]);
    // A second import never overwrites the draft.
    expect(await importSeed(db, assetsDir, seedDir, 'cli')).toEqual({ status: 'draft_exists', version: 1 });
    expect(await publishDraft(db, learnContentSpec, 'cli')).toMatchObject({ status: 'published', version: 1 });
    const live = await content();
    expect(live.exercises.map((e) => e.id)).toEqual(['D-TEST-01', 'D-TEST-02', 'D-TEST-03', 'D-BASE-01', 'D-LESSON-01', 'C-TEST-01']);
    expect(live.exercises[0].references[0].assetId).toBe(imported.assets[0].assetId);
    expect([...(await everPublishedIds(db)).keys()].sort()).toEqual(['C-TEST-01', 'CH-901', 'CH-902', 'D-BASE-01', 'D-LESSON-01', 'D-TEST-01', 'D-TEST-02']);
  });

  it('refuses a seed whose references or files are wrong, and saves nothing', async () => {
    const dir = writeLearnFixture(mkdtempSync(path.join(tmpdir(), 'learn-bad-')));
    const seed = fixtureSeed();
    seed.content.exercises[0].references[0].asset = 'nowhere';
    const { writeFileSync } = await import('node:fs');
    writeFileSync(path.join(dir, 'seed.json'), JSON.stringify(seed));
    expect(await importSeed(db, assetsDir, dir, 'cli')).toEqual({ status: 'invalid', issues: ['D-TEST-01: no asset with the key nowhere'] });
    seed.assets[0].file = '../../etc/passwd';
    writeFileSync(path.join(dir, 'seed.json'), JSON.stringify(seed));
    await expect(importSeed(db, assetsDir, dir, 'cli')).rejects.toThrow('outside the seed folder');
    expect(await getDraft(db, learnContentSpec)).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('what every draft and publication must pass', () => {
  it('both languages for published items, groups that exist, assets with their licence and file', async () => {
    await importAndPublish();
    const base = await content();
    const check = async (change: (c: LearnContent) => void) => {
      const next = structuredClone(base);
      change(next);
      return saveDraft(db, learnContentSpec, next, 'cli');
    };
    expect(await check((c) => (c.exercises[0].instruction.he = ' '))).toMatchObject({ status: 'invalid', issues: ['D-TEST-01: instruction needs English and Hebrew before it can be published'] });
    // An unpublished item may still be incomplete.
    expect((await check((c) => (c.exercises[2].instruction.he = ''))).status).toBe('saved');
    await collections(db).configVersions.deleteMany({ kind: 'learn_content', status: 'draft' });
    expect(await check((c) => (c.challenges[0].groupId = 'missing'))).toMatchObject({ status: 'invalid', issues: ['CH-901: group missing does not exist'] });
    expect(await check((c) => (c.exercises[0].references[0].assetId = 'f'.repeat(64)))).toMatchObject({ status: 'invalid', issues: [`asset ${'f'.repeat(12)}… does not exist`] });
    expect(await check((c) => (c.challenges[0].references = []))).toMatchObject({ status: 'invalid', issues: ['CH-901: a challenge with a provided reference needs one'] });
    expect(await check((c) => (c.exercises[0].collection = 'color'))).toMatchObject({ status: 'invalid' });
    // A reference whose licence was lost cannot be published.
    await collections(db).learnAssets.updateOne({ _id: base.exercises[0].references[0].assetId }, { $set: { licence: null } });
    expect((await check(() => undefined)).status).toBe('invalid');
  });

  it('a published item is never deleted, only unpublished; restoring an earlier version keeps it, unpublished', async () => {
    // Version 1 without CH-902; version 2 adds and publishes it.
    const seedless = structuredClone(fixtureSeed());
    expect(seedless.content.challenges.length).toBe(3);
    await importAndPublish();
    const v1 = await content();
    const v2 = structuredClone(v1);
    v2.challenges.push({ ...structuredClone(v1.challenges[1]), id: 'CH-904', order: 4 });
    expect((await saveDraft(db, learnContentSpec, v2, 'cli')).status).toBe('saved');
    expect((await publishDraft(db, learnContentSpec, 'cli')).status).toBe('published');

    const without = structuredClone(v2);
    without.challenges = without.challenges.filter((c) => c.id !== 'CH-904');
    expect(await saveDraft(db, learnContentSpec, without, 'cli')).toEqual({ status: 'invalid', issues: ['CH-904 was published, so it cannot be removed (unpublish it instead)'] });
    const unpublished = structuredClone(v2);
    unpublished.challenges.find((c) => c.id === 'CH-904')!.published = false;
    expect((await saveDraft(db, learnContentSpec, unpublished, 'cli')).status).toBe('saved');
    await collections(db).configVersions.deleteMany({ kind: 'learn_content', status: 'draft' });

    // Going back to version 1 keeps CH-904, unpublished.
    expect(await restoreAsDraft(db, learnContentSpec, 1, 'admin:owner')).toMatchObject({ status: 'saved' });
    const draft = (await getDraft(db, learnContentSpec))!;
    expect(draft.note).toBe('Restored from version 1; kept unpublished: CH-904');
    const restored = draft.document as LearnContent;
    expect(restored.challenges.map((c) => `${c.id}:${c.published}`)).toEqual(['CH-901:true', 'CH-902:true', 'CH-903:false', 'CH-904:false']);
    expect((await publishDraft(db, learnContentSpec, 'admin:owner')).status).toBe('published');
    expect((await listVersions(db, 'learn_content')).map((v) => v.status)).toEqual(['published', 'archived', 'archived']);
  });
});

describe('the catalog’s Learn section', () => {
  it('a catalog without one opens nothing, and the migration writes nothing into `plans`', async () => {
    await importAndPublish();
    await publishCatalog(OWNER);
    const before = await collections(db).plans.find({}).sort({ _id: 1 }).toArray();
    expect(before.every((p) => !('learn' in p))).toBe(true);
    expect(await migrate(db)).toMatchObject({ plansInserted: 0, plansUpdated: 0 });
    expect(await collections(db).plans.find({}).sort({ _id: 1 }).toArray()).toEqual(before);
    for (const plan of ['free', 'pro'] as const) {
      const entitlements = await getEntitlements(db, await account(plan));
      expect(entitlements.learn).toEqual(NO_LEARN_ACCESS());
      const { view } = await liveLearn(db, entitlements);
      expect(['D-TEST-01', 'C-TEST-01', 'CH-901', 'CH-902'].map((id) => view.state(id).status)).toEqual(['locked', 'locked', 'locked', 'locked']);
      expect(view.list('challenges')).toEqual([]);
    }
  });

  it('a published rule reaches `plans` and entitlements; the module still decides', async () => {
    await importAndPublish();
    const rules = freeRules({ challenges: { mode: 'selected', items: ['CH-901'], made: { by: 'pick' } }, curriculum: { mode: 'all' } }, 'thumbnail');
    // Rules without the module: nothing opens yet.
    expect(await publishCatalog({ ...OWNER, learn: rules })).toMatchObject({ status: 'published' });
    const free = await account('free');
    let view = (await liveLearn(db, await getEntitlements(db, free))).view;
    expect(view.state('CH-901')).toEqual({ status: 'locked', reason: 'module_off' });
    // With the Challenges module for Free: exactly CH-901.
    const withModule = structuredClone({ ...OWNER, learn: rules });
    withModule.plans.free.features.push('learn.challenges');
    expect(await publishCatalog(withModule)).toMatchObject({ status: 'published' });
    const freeDoc = (await collections(db).plans.findOne({ _id: 'free' }))!;
    expect(freeDoc.learn).toEqual({ rules: rules.access.free, previews: 'thumbnail' });
    view = (await liveLearn(db, await getEntitlements(db, free))).view;
    expect(['CH-901', 'CH-902', 'CH-903', 'D-TEST-01'].map((id) => view.state(id).status)).toEqual(['open', 'locked', 'hidden', 'locked']);
    expect(view.thumbnail('CH-902')).toBe(true);
    // Pro has neither the module nor a rule; an admin has everything, drafts included.
    const pro = (await liveLearn(db, await getEntitlements(db, await account('pro')))).view;
    expect(pro.state('CH-901')).toEqual({ status: 'locked', reason: 'module_off' });
    const admin = (await liveLearn(db, await getEntitlements(db, await account('free', 'admin')))).view;
    expect(['CH-901', 'CH-903', 'D-TEST-03'].map((id) => admin.state(id).status)).toEqual(['open', 'open', 'open']);
    // Back to no Learn access: `plans` says None again.
    expect(await publishCatalog(OWNER)).toMatchObject({ status: 'published' });
    expect((await collections(db).plans.findOne({ _id: 'free' }))!.learn).toEqual(NO_LEARN_ACCESS());
    expect((await liveLearn(db, await getEntitlements(db, free))).view.state('CH-901').status).toBe('locked');
  });

  it('a list may name only published items of its own collection; one already listed may stay after it is unpublished', async () => {
    await importAndPublish();
    const unknown = await publishCatalog({ ...OWNER, learn: freeRules({ challenges: { mode: 'selected', items: ['CH-999'] } }) });
    expect(unknown).toEqual({ status: 'invalid', issues: ['Free · Challenges: CH-999 is not in the published Learn content'] });
    await collections(db).configVersions.deleteMany({ kind: 'catalog', status: 'draft' });
    const draftItem = await publishCatalog({ ...OWNER, learn: freeRules({ challenges: { mode: 'selected', items: ['CH-903'] } }) });
    expect(draftItem).toEqual({ status: 'invalid', issues: ['Free · Challenges: CH-903 is not published, so it cannot be added'] });
    await collections(db).configVersions.deleteMany({ kind: 'catalog', status: 'draft' });
    expect(await publishCatalog({ ...OWNER, learn: freeRules({ challenges: { mode: 'selected', items: ['CH-902'] } }) })).toMatchObject({ status: 'published' });

    // Unpublishing a listed item warns first; the list keeps it, and the catalog can still be published.
    const live = await content();
    const next = structuredClone(live);
    next.challenges.find((c) => c.id === 'CH-902')!.published = false;
    const changes = describeContentChanges(live, next, { free: learnSectionOf(readCatalogOf(await currentCatalog())).access.free });
    expect(changes).toContain("Warning: Free's Challenges list names CH-902; Free loses it until it is published again");
    expect((await saveDraft(db, learnContentSpec, next, 'cli')).status).toBe('saved');
    expect((await publishDraft(db, learnContentSpec, 'cli')).status).toBe('published');
    const again = structuredClone({ ...OWNER, learn: freeRules({ challenges: { mode: 'selected', items: ['CH-902'] } }) });
    again.plans.pro.features = again.plans.pro.features.filter((f) => f !== 'export.gif_large');
    expect(await publishCatalog(again)).toMatchObject({ status: 'published' });
  });

  it('reordering content never changes anyone’s access; the diff names the items each plan gains and loses', async () => {
    await importAndPublish();
    const catalog = structuredClone({ ...OWNER, learn: freeRules({ curriculum: { mode: 'selected', items: ['D-TEST-01'], made: { by: 'first', n: 1, contentVersion: 1 } } }) });
    catalog.plans.free.features.push('learn.curriculum');
    expect(await publishCatalog(catalog)).toMatchObject({ status: 'published' });
    const live = await content();
    expect(planOpens(catalog, live).free).toEqual(['D-TEST-01']);
    const reordered = structuredClone(live);
    reordered.exercises.find((e) => e.id === 'D-TEST-02')!.order = 0;
    expect((await saveDraft(db, learnContentSpec, reordered, 'cli')).status).toBe('saved');
    expect((await publishDraft(db, learnContentSpec, 'cli')).status).toBe('published');
    const free = await account('free');
    const view = (await liveLearn(db, await getEntitlements(db, free))).view;
    expect(view.opens('curriculum')).toEqual(['D-TEST-01']);

    const wider = structuredClone(catalog);
    wider.learn.access.free.curriculum = { mode: 'all' };
    expect(describeCatalogChanges(catalog, wider, await content())).toEqual(['Free · Drawing curriculum: First 1 (D-TEST-01) → All', 'Free: gains D-TEST-02, D-BASE-01, D-LESSON-01']);
    expect(describeCatalogChanges(wider, OWNER, await content())).toEqual(['Free: removes Drawing curriculum', 'Free · Drawing curriculum: All → None', 'Free: loses D-TEST-02, D-TEST-01, D-BASE-01, D-LESSON-01']);
  });

  it('the editor saves the section; a catalog that never had one is written back exactly while it says nothing', async () => {
    await importAndPublish();
    await publishCatalog(OWNER);
    const form = { ...structuredClone(OWNER), learn: defaultLearnSection() };
    expect(await saveCatalogEdit(db, form, 'admin:owner')).toMatchObject({ status: 'saved' });
    expect((await getDraft(db, catalogSpec))!.document).toEqual(OWNER);
    form.learn.access.pro.challenges = { mode: 'all' };
    expect(await saveCatalogEdit(db, form, 'admin:owner')).toMatchObject({ status: 'saved' });
    expect(((await getDraft(db, catalogSpec))!.document as Catalog).learn?.access.pro.challenges).toEqual({ mode: 'all' });
  });
});

describe('exports from a Learn item', () => {
  it('need the item open to the account, checked before anything is counted', async () => {
    await importAndPublish();
    const catalog = structuredClone({ ...OWNER, learn: freeRules({ challenges: { mode: 'selected', items: ['CH-901'] } }) });
    catalog.plans.free.features.push('learn.challenges');
    expect(await publishCatalog(catalog)).toMatchObject({ status: 'published' });
    const free = await account('free');
    expect(await authorizeToolUse(db, free, { tool: 'tool.grid', features: ['export.image'], learnItem: 'CH-901' })).toEqual({ status: 'recorded' });
    expect(await authorizeToolUse(db, free, { tool: 'tool.grid', features: ['export.image'], learnItem: 'CH-902' })).toEqual({
      status: 'denied',
      reason: 'not_included',
      missing: [],
      learnItem: { id: 'CH-902', reason: 'not_in_plan' },
    });
    expect(await authorizeToolUse(db, free, { tool: 'tool.grid', features: ['export.image'], learnItem: 'CH-903' })).toMatchObject({ learnItem: { id: 'CH-903', reason: 'unavailable' } });
    const pro = await account('pro');
    expect(await authorizeToolUse(db, pro, { tool: 'tool.grid', features: ['export.image'], learnItem: 'CH-901' })).toMatchObject({ learnItem: { id: 'CH-901', reason: 'module_off' } });
    // Only the one authorized export was counted.
    expect(await collections(db).usage.countDocuments({ userId: free, feature: 'export.image' })).toBe(2);
    expect((await collections(db).usage.find({ userId: free, feature: 'export.image' }).toArray()).every((u) => u.quantity === 1)).toBe(true);
    // A teacher's own photo needs only the export.
    expect(await authorizeToolUse(db, pro, { tool: 'tool.grid', features: ['export.image'] })).toEqual({ status: 'recorded' });
  });

  it('refuse when the published content cannot be read (fail closed)', async () => {
    await importAndPublish();
    await collections(db).configVersions.updateOne({ kind: 'learn_content', status: 'published' }, { $set: { document: { exercises: 'broken' } } });
    const admin = await account('free', 'admin');
    await expect(authorizeToolUse(db, admin, { tool: 'tool.grid', features: ['export.image'], learnItem: 'CH-901' })).rejects.toThrow('cannot be read');
  });
});

async function currentCatalog() {
  return (await getPublished(db, catalogSpec))!.document;
}

function readCatalogOf(document: unknown): Catalog {
  const read = readCatalog(document);
  if (read.status === 'unreadable') throw new Error('unreadable');
  return read.catalog;
}
