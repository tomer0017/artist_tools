// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ObjectId, type Db } from 'mongodb';
import { z } from 'zod';
import { MONGO_STARTUP_TIMEOUT, startTestMongo, type TestMongo } from '@/test/mongo';
import { FEATURES, PLAN_FEATURES, PLAN_IDS, isToolFeature, type FeatureId } from '@/lib/plans';
import { catalogReadNotes, catalogSpec, defaultCatalog, mergeKnown, planDocsFor, readCatalog, saveCatalogEdit, type Catalog } from './config/catalog';
import { pricingSpec } from './config/pricing';
import { UnreadableConfigError, getPublished, listVersions, publishDraft, publishIfUnchanged, publishedDocument, restoreAsDraft, saveDraft } from './config/versions';
import { collections } from './db/collections';
import { migrate } from './db/migrate';
import { authorizeToolUse, getEntitlements, getPlanOffer, planStateOf } from './entitlements';

// Rolling back must never reset or widen the published plans (ADR-0014,
// docs/security/catalog-rollback-safety.md). A newer release can publish a
// catalog with feature ids and sections this release does not know; this
// release keeps them and applies none of them. What it cannot read leaves
// `plans` as it is; what it cannot apply is withheld. Against a real database.

let mongo: TestMongo;

beforeAll(async () => {
  mongo = await startTestMongo();
}, MONGO_STARTUP_TIMEOUT);

afterAll(async () => mongo?.stop());

/** A database of its own, migrated as a release does it. */
async function freshDb(): Promise<Db> {
  const db = mongo.client.db(`rollback_${Math.random().toString(36).slice(2, 10)}`);
  await migrate(db);
  return db;
}

/** The owner's catalog on staging (published as version 2 on 2026-11-18): Free without Measure, Compare or GIFs. */
const OWNER: Catalog = {
  plans: {
    free: { features: ['tool.study', 'tool.color', 'tool.grid', 'export.image'], quotas: {} },
    pro: { features: [...PLAN_FEATURES.pro], quotas: {} },
  },
  disabled: [],
};

/** A newer release's catalog: the owner's plans, plus feature ids and sections this release does not know. */
const NEWER = () => ({
  plans: {
    free: {
      features: ['tool.study', 'tool.color', 'tool.grid', 'export.image', 'learn.curriculum', 'export.lesson_pack'],
      quotas: { 'export.lesson_pack': { limit: 5, period: 'month' } },
      learn: { curriculum: { rule: 'selected', ids: ['D-START-01', 'D-SHAPE-01'] } },
    },
    pro: { features: [...PLAN_FEATURES.pro, 'learn.curriculum', 'export.lesson_pack'], quotas: {}, learn: { curriculum: { rule: 'all' } } },
  },
  disabled: ['learn.color'],
  learnPreviews: 'title_and_thumbnail',
});

/** The `plans` documents that newer release writes (with its feature ids). */
const NEWER_PLANS = {
  free: { features: [...OWNER.plans.free.features, 'learn.curriculum', 'export.lesson_pack'], limits: { 'export.lesson_pack': 5 } },
  pro: { features: [...PLAN_FEATURES.pro, 'learn.curriculum', 'export.lesson_pack'] },
};

/** Publish as an admin does here: a draft, then publish it. */
async function publish(db: Db, catalog: unknown) {
  expect((await saveDraft(db, catalogSpec, catalog, 'admin:owner')).status).toBe('saved');
  expect((await publishDraft(db, catalogSpec, 'admin:owner')).status).toBe('published');
}

/** Publish the way another release's code would (bypassing this release's checks), and sync `plans` as it would. */
async function publishAsAnotherRelease(db: Db, document: unknown, plans: Record<string, Record<string, unknown>> = {}) {
  const { configVersions } = collections(db);
  const live = await getPublished(db, catalogSpec);
  if (live) await configVersions.updateOne({ _id: live._id }, { $set: { status: 'archived' } });
  const version = (live?.version ?? 0) + 1;
  const now = new Date();
  await configVersions.insertOne({ kind: 'catalog', version, status: 'published', document, note: 'another release', createdBy: 'admin:owner', createdAt: now, updatedAt: now, publishedBy: 'admin:owner', publishedAt: now } as never);
  for (const [planId, set] of Object.entries(plans)) await db.collection('plans').updateOne({ _id: planId as never }, { $set: set });
  return version;
}

async function account(db: Db, plan: 'free' | 'pro') {
  const _id = new ObjectId();
  await collections(db).users.insertOne({
    _id, name: 'P', email: `${_id.toHexString()}@example.com`, emailVerified: true, createdAt: new Date(), updatedAt: new Date(),
    role: 'user', status: 'active', plan, marketingConsent: false,
  } as never);
  return _id;
}

const plansDocs = (db: Db) => collections(db).plans.find({}, { sort: { _id: 1 } }).toArray();
const known = (docs: Awaited<ReturnType<typeof plansDocs>>) => docs.map((p) => ({ id: p._id, features: p.features, limits: p.limits, dailyLimits: p.dailyLimits ?? {} }));

/** Free gets exactly the owner's plan: no Measure & Plan, no Compare & Correct, no GIFs (checked by the server's own authorization). */
async function expectOwnerPlans(db: Db) {
  const free = await account(db, 'free');
  expect((await getEntitlements(db, free)).features).toEqual(OWNER.plans.free.features);
  for (const tool of ['tool.measure', 'tool.compare'] as const) {
    expect(await authorizeToolUse(db, free, { tool, features: [] })).toEqual({ status: 'denied', reason: 'not_included', missing: [tool] });
  }
  expect(await authorizeToolUse(db, free, { tool: 'tool.study', features: ['export.gif'] })).toEqual({ status: 'denied', reason: 'not_included', missing: ['export.gif'] });
  expect(await authorizeToolUse(db, free, { tool: 'tool.study', features: ['export.image'] })).toEqual({ status: 'recorded' });
  const pro = await account(db, 'pro');
  expect((await getEntitlements(db, pro)).features).toEqual(PLAN_FEATURES.pro);
  expect(await authorizeToolUse(db, pro, { tool: 'tool.compare', features: ['export.gif', 'export.gif_difference'] })).toEqual({ status: 'recorded' });
  expect(await getPlanOffer(db)).toEqual({ free: OWNER.plans.free.features, pro: PLAN_FEATURES.pro });
}

describe('rolling back after a newer release published new feature ids and sections', () => {
  it('keeps every published permission: the hazard reproduced on 2026-11-18 is gone', async () => {
    const db = await freshDb();
    await publish(db, OWNER);
    const before = known(await plansDocs(db));
    const newer = await publishAsAnotherRelease(db, NEWER(), NEWER_PLANS);

    // Going back to this release runs its migration.
    const report = await migrate(db);
    expect(report.catalog).toEqual({ version: newer, status: 'ok', notes: expect.any(Array) });
    expect(report.catalog.notes.join(' ')).toContain('learn.curriculum');
    expect(report.configSeeded).toBe(0);

    // `plans` holds exactly what it held before the newer release; accounts get the owner's plans.
    expect(known(await plansDocs(db))).toEqual(before);
    await expectOwnerPlans(db);
    // The newer release's catalog is kept as it was, and nothing new was published.
    expect((await getPublished(db, catalogSpec))!.document).toEqual(NEWER());
    expect((await listVersions(db, 'catalog')).map((v) => v.version)).toEqual([3, 2, 1]);
    // Going forward again finds its catalog intact.
    const again = readCatalog((await getPublished(db, catalogSpec))!.document);
    expect(again.status === 'unreadable' ? null : again.stored).toEqual(NEWER());
  });

  it('also without the migration (an instant rollback): what `plans` holds that this release does not know is ignored', async () => {
    const db = await freshDb();
    await publish(db, OWNER);
    await publishAsAnotherRelease(db, NEWER(), NEWER_PLANS);
    expect((await plansDocs(db)).find((p) => p._id === 'free')!.features).toContain('learn.curriculum');
    await expectOwnerPlans(db);
    const free = await account(db, 'free');
    expect((await getEntitlements(db, free)).limits).toEqual({});
  });

  it('says what it keeps without applying', () => {
    const read = readCatalog(NEWER());
    expect(read.status).toBe('ok');
    if (read.status === 'unreadable') return;
    expect(read.catalog).toEqual(OWNER);
    expect(read.unknown).toEqual({ features: ['export.lesson_pack', 'learn.color', 'learn.curriculum'], sections: ['learnPreviews', 'plans.free.learn', 'plans.pro.learn'] });
    expect(catalogReadNotes(read)).toEqual([
      'Feature ids this version of the app does not know: export.lesson_pack, learn.color, learn.curriculum.',
      'Settings this version of the app does not know: learnPreviews, plans.free.learn, plans.pro.learn.',
    ]);
  });
});

describe('what a newer release added survives editing, publishing and restoring here', () => {
  it('a draft started from what is live, edited and published keeps every id and section it did not know', async () => {
    const db = await freshDb();
    await publish(db, OWNER);
    await publishAsAnotherRelease(db, NEWER(), NEWER_PLANS);
    await migrate(db);

    // "Start a draft": the live document as stored.
    expect((await saveDraft(db, catalogSpec, (await getPublished(db, catalogSpec))!.document, 'admin:owner')).status).toBe('saved');
    // The editor's form knows only this release's features: give Free Compare & Correct.
    const form = structuredClone(OWNER);
    form.plans.free.features = [...form.plans.free.features, 'tool.compare'];
    expect(await saveCatalogEdit(db, form, 'admin:owner', 'Compare for Free')).toMatchObject({ status: 'saved' });
    expect(await publishDraft(db, catalogSpec, 'admin:owner')).toMatchObject({ status: 'published' });

    const expected = NEWER();
    // Kept in place; the new one added at the end.
    expected.plans.free.features = ['tool.study', 'tool.color', 'tool.grid', 'export.image', 'learn.curriculum', 'export.lesson_pack', 'tool.compare'];
    expect((await getPublished(db, catalogSpec))!.document).toEqual(expected);
    const free = await account(db, 'free');
    expect((await getEntitlements(db, free)).features).toEqual(['tool.study', 'tool.color', 'tool.grid', 'tool.compare', 'export.image']);
  });

  it('saving the form unchanged writes the stored document back exactly', () => {
    const read = readCatalog(NEWER());
    if (read.status === 'unreadable') throw new Error('unreadable');
    expect(mergeKnown(read.stored, read.catalog)).toEqual(NEWER());
  });

  it('restoring an earlier version, and the operator tool, keep them too', async () => {
    const db = await freshDb();
    await publish(db, OWNER);
    const newer = await publishAsAnotherRelease(db, NEWER(), NEWER_PLANS);
    await publish(db, defaultCatalog());
    // Restore the newer release's version from the history, and publish it again.
    expect(await restoreAsDraft(db, catalogSpec, newer, 'admin:owner')).toMatchObject({ status: 'saved' });
    expect(await publishDraft(db, catalogSpec, 'admin:owner')).toMatchObject({ status: 'published' });
    const live = (await getPublished(db, catalogSpec))!;
    expect(live.document).toEqual(NEWER());
    await expectOwnerPlans(db);

    // The publication check (entitlement-test) changes only what it knows, and restores the stored document exactly.
    const read = readCatalog(live.document);
    if (read.status === 'unreadable') throw new Error('unreadable');
    const temporary = structuredClone(read.catalog);
    temporary.disabled = ['tool.grid'];
    const published = await publishIfUnchanged(db, catalogSpec, mergeKnown(read.stored, temporary), { version: live.version }, 'cli', 'temporary');
    expect(published).toMatchObject({ status: 'published' });
    expect((await getPublished(db, catalogSpec))!.document).toEqual({ ...NEWER(), disabled: ['learn.color', 'tool.grid'] });
    expect((await getPlanOffer(db)).free).not.toContain('tool.grid');
    if (published.status !== 'published') return;
    expect(await publishIfUnchanged(db, catalogSpec, read.stored, { version: published.version }, 'cli', 'restore')).toMatchObject({ status: 'published' });
    expect((await getPublished(db, catalogSpec))!.document).toEqual(NEWER());
    await expectOwnerPlans(db);
  });

  it('the editor cannot add an id this release does not know, nor a section', async () => {
    const db = await freshDb();
    await publish(db, OWNER);
    const withUnknownId = structuredClone(OWNER) as unknown as { plans: { free: { features: string[] } } };
    withUnknownId.plans.free.features.push('learn.curriculum');
    expect(await saveCatalogEdit(db, withUnknownId, 'admin:owner')).toMatchObject({ status: 'invalid' });
    expect(await saveCatalogEdit(db, { ...structuredClone(OWNER), learn: { anything: true } }, 'admin:owner')).toMatchObject({ status: 'saved' });
    expect((await collections(db).configVersions.findOne({ kind: 'catalog', status: 'draft' }))!.document).toEqual(OWNER);
  });
});

describe('a catalog this release cannot read is never replaced by the defaults', () => {
  const BROKEN = { plans: { free: { features: 'everything' }, pro: [] }, disabled: [] };

  it('the migration leaves `plans` exactly as it was, publishes nothing and says why', async () => {
    const db = await freshDb();
    await publish(db, OWNER);
    const before = await plansDocs(db);
    const broken = await publishAsAnotherRelease(db, BROKEN);

    const report = await migrate(db);
    expect(report.catalog).toMatchObject({ version: broken, status: 'unreadable' });
    expect(report.catalog.notes.length).toBeGreaterThan(0);
    expect(report).toMatchObject({ configSeeded: 0, plansInserted: 0, plansUpdated: 0 });
    // Byte for byte, update times included.
    expect(await plansDocs(db)).toEqual(before);
    expect((await listVersions(db, 'catalog')).map((v) => v.version)).toEqual([3, 2, 1]);
    await expectOwnerPlans(db);
  });

  it('nor anything that is not a catalog at all', async () => {
    for (const document of [null, 'catalog', 42, [], {}, { plans: {} }, { plans: { free: { features: [] } } }, { plans: { free: { features: [1] }, pro: { features: [] } } }]) {
      expect(readCatalog(document).status).toBe('unreadable');
    }
    const db = await freshDb();
    await publish(db, OWNER);
    const before = await plansDocs(db);
    await publishAsAnotherRelease(db, null);
    expect((await migrate(db)).catalog.status).toBe('unreadable');
    expect(await plansDocs(db)).toEqual(before);
  });

  it('publishedDocument throws rather than return the defaults (also for prices)', async () => {
    const db = await freshDb();
    await publishAsAnotherRelease(db, BROKEN);
    await expect(publishedDocument(db, catalogSpec)).rejects.toBeInstanceOf(UnreadableConfigError);
    const { configVersions } = collections(db);
    await configVersions.updateOne({ kind: 'pricing', status: 'published' }, { $set: { document: { prices: 'all free' } } });
    await expect(publishedDocument(db, pricingSpec)).rejects.toBeInstanceOf(UnreadableConfigError);
  });

  it('it cannot be edited, restored or published from here; an earlier version can be restored and published', async () => {
    const db = await freshDb();
    await publish(db, OWNER);
    const broken = await publishAsAnotherRelease(db, BROKEN);
    expect((await saveDraft(db, catalogSpec, BROKEN, 'admin:owner')).status).toBe('invalid');
    expect((await saveCatalogEdit(db, OWNER, 'admin:owner')).status).toBe('invalid');
    expect((await restoreAsDraft(db, catalogSpec, broken, 'admin:owner')).status).toBe('invalid');
    expect((await publishIfUnchanged(db, catalogSpec, BROKEN, { version: broken }, 'cli', 'test')).status).toBe('invalid');
    expect(await collections(db).configVersions.countDocuments({ kind: 'catalog', status: 'draft' })).toBe(0);

    // The way back: the owner's version 2, restored and published.
    expect(await restoreAsDraft(db, catalogSpec, 2, 'admin:owner')).toMatchObject({ status: 'saved' });
    expect(await publishDraft(db, catalogSpec, 'admin:owner')).toMatchObject({ status: 'published' });
    expect((await getPublished(db, catalogSpec))!.document).toEqual(OWNER);
    await expectOwnerPlans(db);
  });
});

describe('a setting this release knows but cannot apply withholds that feature (fail closed)', () => {
  const UNAPPLIABLE = () => ({
    plans: {
      free: { features: [...OWNER.plans.free.features], quotas: { 'export.image': { limit: 5, period: 'week' } } },
      pro: {
        features: [...PLAN_FEATURES.pro],
        quotas: { 'export.gif': { limit: 'ten', period: 'month' }, 'tool.measure': { limit: 3, period: 'day' }, 'export.gif_large': { limit: 2, period: 'month', rollover: true } },
      },
    },
    disabled: [],
  });

  it('a quota with a period it does not know, a malformed one, a quota on a tool, or one with settings it does not know', () => {
    const read = readCatalog(UNAPPLIABLE());
    expect(read.status).toBe('partial');
    if (read.status === 'unreadable') return;
    expect(read.withheld.map((w) => `${w.plan}:${w.feature}`)).toEqual(['free:export.image', 'pro:tool.measure', 'pro:export.gif', 'pro:export.gif_large']);
    expect(read.catalog.plans.free.features).toEqual(['tool.study', 'tool.color', 'tool.grid']);
    expect(read.catalog.plans.pro.features).toEqual(['tool.study', 'tool.color', 'tool.grid', 'tool.compare', 'export.image', 'export.gif_difference']);
    expect(catalogReadNotes(read)[0]).toBe('Free: Saved images is withheld here, because it has a quota this version of the app cannot apply ({"limit":5,"period":"week"}).');
  });

  it('after a rollback, those features are not available at all, rather than without their limits', async () => {
    const db = await freshDb();
    await publish(db, OWNER);
    await publishAsAnotherRelease(db, UNAPPLIABLE());
    expect((await migrate(db)).catalog.status).toBe('partial');
    const free = await account(db, 'free');
    expect(await authorizeToolUse(db, free, { tool: 'tool.study', features: ['export.image'] })).toEqual({ status: 'denied', reason: 'not_included', missing: ['export.image'] });
    const pro = await account(db, 'pro');
    expect(await authorizeToolUse(db, pro, { tool: 'tool.measure', features: [] })).toMatchObject({ status: 'denied' });
    expect(await authorizeToolUse(db, pro, { tool: 'tool.compare', features: ['export.gif'] })).toMatchObject({ status: 'denied' });
    // And it is not written or published from here.
    expect((await saveDraft(db, catalogSpec, UNAPPLIABLE(), 'admin:owner')).status).toBe('invalid');
    expect((await saveCatalogEdit(db, OWNER, 'admin:owner')).status).toBe('invalid');
  });
});

describe('`plans` documents never grant more than they say', () => {
  it('ignores ids this release does not know; a cap it cannot read allows nothing; a plan it cannot read includes nothing', () => {
    expect(
      planStateOf({ _id: 'free', active: true, features: ['tool.study', 'learn.curriculum', 'tool.study'], limits: { 'export.image': 'lots', 'learn.x': 5 }, dailyLimits: { 'export.gif': -1, 'export.gif_large': 2.5 } }),
    ).toEqual({ active: true, features: ['tool.study'], limits: { 'export.image': 0 }, dailyLimits: { 'export.gif': 0, 'export.gif_large': 0 } });
    expect(planStateOf({ _id: 'pro', active: true, features: 'all' })).toEqual({ active: false, features: [], limits: {}, dailyLimits: {} });
    expect(planStateOf({ _id: 'pro', active: true, features: ['tool.measure'], limits: [1, 2] }).active).toBe(false);
    expect(planStateOf({ _id: 'pro', active: 'yes', features: ['tool.measure'] }).active).toBe(false);
    expect(planStateOf({ _id: 'pro', active: true, features: ['tool.measure'] })).toEqual({ active: true, features: ['tool.measure'], limits: {}, dailyLimits: {} });
  });

  it('end to end: a corrupted Pro plan falls back to Free, a corrupted cap allows no use', async () => {
    const db = await freshDb();
    await publish(db, OWNER);
    await db.collection('plans').updateOne({ _id: 'pro' as never }, { $set: { features: 'everything' } });
    const pro = await account(db, 'pro');
    expect((await getEntitlements(db, pro)).features).toEqual(OWNER.plans.free.features);
    await db.collection('plans').updateOne({ _id: 'free' as never }, { $set: { limits: { 'export.image': 'NaN' } } });
    const free = await account(db, 'free');
    expect(await authorizeToolUse(db, free, { tool: 'tool.study', features: ['export.image'] })).toEqual({ status: 'denied', reason: 'limit_reached', missing: ['export.image'] });
    // The next release (or rollback) migration puts them back in step with the published catalog.
    await migrate(db);
    await expectOwnerPlans(db);
  });
});

describe('restoring a database', () => {
  async function copyInto(from: Db): Promise<Db> {
    const to = mongo.client.db(`restored_${Math.random().toString(36).slice(2, 10)}`);
    for (const { name } of await from.listCollections().toArray()) {
      const docs = await from.collection(name).find({}).toArray();
      if (docs.length > 0) await to.collection(name).insertMany(docs);
    }
    return to;
  }

  it('a dump restored onto this release applies its published catalog exactly, also one a newer release wrote', async () => {
    const source = await freshDb();
    await publish(source, OWNER);
    await publishAsAnotherRelease(source, NEWER(), NEWER_PLANS);
    const restored = await copyInto(source);
    const report = await migrate(restored);
    expect(report).toMatchObject({ configSeeded: 0, plansInserted: 0 });
    expect((await getPublished(restored, catalogSpec))!.document).toEqual(NEWER());
    await expectOwnerPlans(restored);
  });

  it('a database whose catalog history was lost starts from the plans in force, never from the defaults', async () => {
    const db = await freshDb();
    await publish(db, OWNER);
    const before = known(await plansDocs(db));
    await collections(db).configVersions.deleteMany({ kind: 'catalog' });

    const report = await migrate(db);
    expect(report.configSeeded).toBe(1);
    const seeded = (await getPublished(db, catalogSpec))!;
    expect(seeded).toMatchObject({ version: 1, note: 'From the plans in force (no catalog had been published)' });
    expect(seeded.document).toEqual(OWNER);
    expect(known(await plansDocs(db))).toEqual(before);
    await expectOwnerPlans(db);
  });

  it('a new database still starts from the code defaults', async () => {
    const db = await freshDb();
    expect((await getPublished(db, catalogSpec))!).toMatchObject({ version: 1, note: 'Defaults from the code', document: defaultCatalog() });
    expect(await getPlanOffer(db)).toEqual({ free: PLAN_FEATURES.free, pro: PLAN_FEATURES.pro });
  });
});

describe('compatibility with the releases before this one (be6890c and earlier)', () => {
  // Their feature ids (src/lib/plans.ts at be6890c), and their catalog schema, copied verbatim
  // (src/server/config/catalog.ts at be6890c).
  const BE6890C_FEATURES = ['tool.measure', 'tool.study', 'tool.color', 'tool.grid', 'tool.compare', 'export.image', 'export.gif', 'export.gif_large', 'export.gif_difference'] as const;
  const Feature = z.enum(BE6890C_FEATURES);
  const Quota = z.object({ limit: z.number().int().min(1).max(1_000_000), period: z.enum(['day', 'month']) });
  const PlanEntry = z.object({
    features: z.array(Feature).max(BE6890C_FEATURES.length),
    quotas: z
      .record(Feature, Quota)
      .default({})
      .transform((quotas) => Object.fromEntries(Object.entries(quotas).filter(([feature]) => !isToolFeature(feature as FeatureId))) as typeof quotas),
  });
  const BE6890C_SCHEMA = z
    .object({ plans: z.object({ free: PlanEntry, pro: PlanEntry }), disabled: z.array(Feature).default([]) })
    .superRefine((catalog, ctx) => {
      for (const planId of PLAN_IDS) {
        const plan = catalog.plans[planId];
        if (new Set(plan.features).size !== plan.features.length) ctx.addIssue({ code: 'custom', path: ['plans', planId, 'features'], message: 'lists a feature twice' });
        for (const feature of Object.keys(plan.quotas) as (typeof BE6890C_FEATURES)[number][]) {
          if (!plan.features.includes(feature)) ctx.addIssue({ code: 'custom', path: ['plans', planId, 'quotas', feature], message: 'has a quota but is not included' });
        }
      }
    });

  const EARLIER: Catalog[] = [
    defaultCatalog(),
    OWNER,
    {
      plans: {
        free: { features: ['tool.measure', 'tool.study', 'export.image', 'export.gif'], quotas: { 'export.image': { limit: 50, period: 'month' }, 'export.gif': { limit: 3, period: 'day' } } },
        pro: { features: [...PLAN_FEATURES.pro], quotas: { 'export.gif_large': { limit: 100, period: 'month' } } },
      },
      disabled: ['export.gif_difference', 'tool.grid'],
    },
  ];

  it('reads every catalog they wrote exactly as they did, knowing all of it', () => {
    for (const input of EARLIER) {
      const stored = BE6890C_SCHEMA.parse(input); // what they stored
      const read = readCatalog(stored);
      expect(read.status).toBe('ok');
      if (read.status === 'unreadable') return;
      expect(catalogReadNotes(read)).toEqual([]);
      expect(read.catalog).toEqual(stored);
      expect(read.stored).toEqual(stored);
    }
  });

  it('writes catalogs they read exactly, so rolling back to them stays safe', async () => {
    const db = await freshDb();
    for (const input of EARLIER) {
      await publish(db, input);
      const stored = (await getPublished(db, catalogSpec))!.document;
      expect(BE6890C_SCHEMA.parse(stored)).toEqual(stored);
      // And through the editor's path.
      expect((await saveDraft(db, catalogSpec, stored, 'admin:owner')).status).toBe('saved');
      expect((await saveCatalogEdit(db, input, 'admin:owner')).status).toBe('saved');
      expect((await publishDraft(db, catalogSpec, 'admin:owner')).status).toBe('published');
      const edited = (await getPublished(db, catalogSpec))!.document;
      expect(BE6890C_SCHEMA.parse(edited)).toEqual(edited);
      expect(edited).toEqual(stored);
    }
  });

  it('writes the same `plans` documents as they did', async () => {
    const db = await freshDb();
    for (const input of EARLIER) {
      await publish(db, input);
      const docs = await plansDocs(db);
      for (const planId of PLAN_IDS) {
        const doc = docs.find((p) => p._id === planId)!;
        const wanted = planDocsFor(input)[planId];
        expect({ name: doc.name, active: doc.active, features: doc.features, limits: doc.limits, dailyLimits: doc.dailyLimits }).toEqual(wanted);
        // be6890c's syncPlans: features in the canonical order minus switched-off ones; monthly caps in `limits`, daily in `dailyLimits`.
        expect(doc.features).toEqual(BE6890C_FEATURES.filter((f) => input.plans[planId].features.includes(f) && !input.disabled.includes(f)));
      }
    }
  });
});
