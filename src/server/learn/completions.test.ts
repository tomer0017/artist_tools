// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ObjectId, type Db } from 'mongodb';
import { MONGO_STARTUP_TIMEOUT, startTestMongo, type TestMongo } from '@/test/mongo';
import { writeLearnFixture } from '@/test/learn-fixture';
import { PLAN_FEATURES } from '@/lib/plans';
import { defaultLearnSection, type LearnSection } from '@/lib/learn/model';
import { exportAccountData, deleteAccount } from '@/server/account-management';
import { getAccountSummary } from '@/server/account';
import { catalogSpec, type Catalog } from '@/server/config/catalog';
import { publishDraft, saveDraft } from '@/server/config/versions';
import { collections } from '@/server/db/collections';
import { migrate } from '@/server/db/migrate';
import { getEntitlements } from '@/server/entitlements';
import { learnContentSpec } from './content';
import { MAX_COMPLETIONS, completionHistory, completionSummary, historyTitles, parseCursor, recordCompletion, removeCompletion } from './completions';
import { importSeed } from './import';
import { learnSummaryOf, liveLearn } from './live';
import { fullItem } from './present';

// Learn's personal history (ADR-0018) on a real database: a completion only
// for an item open at that moment, newest-first pages, counts per item,
// removal of one's own entries only, the data download and account deletion;
// and what the studio is told about Learn (visible, and each module).

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
});

let db: Db;
beforeEach(async () => {
  db = mongo.client.db(`completions_${Math.random().toString(36).slice(2, 10)}`);
  await migrate(db);
  expect((await importSeed(db, assetsDir, seedDir, 'cli')).status).toBe('saved');
  expect(await publishDraft(db, learnContentSpec, 'cli')).toMatchObject({ status: 'published' });
});

const OWNER: Catalog = {
  plans: { free: { features: ['tool.study', 'tool.color', 'tool.grid', 'export.image'], quotas: {} }, pro: { features: [...PLAN_FEATURES.pro], quotas: {} } },
  disabled: [],
};

async function publishCatalog(catalog: unknown) {
  expect((await saveDraft(db, catalogSpec, catalog, 'admin:owner')).status).toBe('saved');
  expect(await publishDraft(db, catalogSpec, 'admin:owner')).toMatchObject({ status: 'published' });
}

/** Free gets the Challenges module with exactly CH-901. */
async function freeOpensCh901() {
  const learn: LearnSection = defaultLearnSection();
  learn.access.free.challenges = { mode: 'selected', items: ['CH-901'], made: { by: 'pick' } };
  const catalog = structuredClone({ ...OWNER, learn });
  catalog.plans.free.features.push('learn.challenges');
  await publishCatalog(catalog);
}

async function account(plan: 'free' | 'pro', role: 'user' | 'admin' = 'user') {
  const _id = new ObjectId();
  await collections(db).users.insertOne({ _id, name: plan, email: `${_id.toHexString()}@learn.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date(), role, status: 'active', plan } as never);
  return _id;
}

describe('recording a completion', () => {
  it('only for an item open to the account at that moment, with the content version', async () => {
    const free = await account('free');
    // Dark launch: locked (the module is in no plan), unknown and unpublished items: nothing is written.
    expect(await recordCompletion(db, free, await getEntitlements(db, free), 'CH-901')).toEqual({ status: 'locked', reason: 'module_off' });
    expect(await recordCompletion(db, free, await getEntitlements(db, free), 'CH-999')).toEqual({ status: 'not_found' });
    expect(await recordCompletion(db, free, await getEntitlements(db, free), 'CH-903')).toEqual({ status: 'not_found' });

    await freeOpensCh901();
    const recorded = await recordCompletion(db, free, await getEntitlements(db, free), 'CH-901', new Date('2026-11-20T09:00:00Z'));
    expect(recorded).toMatchObject({ status: 'recorded', completion: { itemId: 'CH-901', completedAt: '2026-11-20T09:00:00.000Z' } });
    expect(await recordCompletion(db, free, await getEntitlements(db, free), 'CH-902')).toEqual({ status: 'locked', reason: 'not_in_plan' });
    const docs = await collections(db).learnCompletions.find({ userId: free }).toArray();
    expect(docs.map((d) => [d.itemId, d.contentVersion])).toEqual([['CH-901', 1]]);

    // Admins open everything, unpublished items too.
    const admin = await account('free', 'admin');
    expect(await recordCompletion(db, admin, await getEntitlements(db, admin), 'D-TEST-03')).toMatchObject({ status: 'recorded' });
  });

  it('several per item; a summary per item and the history newest first, a page at a time', async () => {
    const admin = await account('free', 'admin');
    const entitlements = await getEntitlements(db, admin);
    const at = (minute: number) => new Date(Date.UTC(2026, 10, 20, 9, minute));
    // 53 completions: one page of 50, then 3; two of them at the very same moment.
    for (let i = 0; i < 52; i++) await recordCompletion(db, admin, entitlements, i % 2 ? 'CH-901' : 'D-TEST-01', at(i));
    await recordCompletion(db, admin, entitlements, 'C-TEST-01', at(51));

    const summary = await completionSummary(db, admin);
    expect(summary.total).toBe(53);
    expect(summary.items['CH-901']).toEqual({ count: 26, last: at(51).toISOString() });
    expect(summary.items['D-TEST-01']).toEqual({ count: 26, last: at(50).toISOString() });
    expect(summary.items['C-TEST-01']).toEqual({ count: 1, last: at(51).toISOString() });

    const first = await completionHistory(db, admin);
    expect(first.completions).toHaveLength(50);
    expect(first.completions[0].completedAt).toBe(at(51).toISOString());
    expect(first.next).not.toBeNull();
    const second = await completionHistory(db, admin, { after: parseCursor(first.next) });
    expect(second.completions).toHaveLength(3);
    expect(second.next).toBeNull();
    const all = [...first.completions, ...second.completions];
    expect(new Set(all.map((c) => c.id)).size).toBe(53);
    expect(all.map((c) => c.completedAt)).toEqual([...all.map((c) => c.completedAt)].sort().reverse());

    // Titles as lists name items: none while no plan offers the module, none for an unpublished or unknown item.
    const free = await account('free');
    expect(await historyTitles(db, await getEntitlements(db, free), ['CH-901', 'D-TEST-03', 'CH-999'])).toEqual({ 'CH-901': null, 'D-TEST-03': null, 'CH-999': null });
    // Once a plan offers the module, a locked item is named, as in its list.
    const catalog = structuredClone(OWNER);
    catalog.plans.pro.features.push('learn.challenges');
    await publishCatalog(catalog);
    expect(await historyTitles(db, await getEntitlements(db, free), ['CH-901', 'D-TEST-03'])).toEqual({
      'CH-901': { title: { en: 'Test challenge one', he: 'אתגר בדיקה one' }, kind: 'challenge' },
      'D-TEST-03': null,
    });
  });

  it('a history holds at most MAX_COMPLETIONS entries', async () => {
    const admin = await account('free', 'admin');
    const entitlements = await getEntitlements(db, admin);
    await collections(db).learnCompletions.insertMany(
      Array.from({ length: MAX_COMPLETIONS - 1 }, (_, i) => ({ _id: new ObjectId(), userId: admin, itemId: 'CH-901', completedAt: new Date(Date.UTC(2026, 0, 1) + i * 1000), contentVersion: 1 })),
    );
    expect((await recordCompletion(db, admin, entitlements, 'CH-901')).status).toBe('recorded');
    expect(await recordCompletion(db, admin, entitlements, 'CH-901')).toEqual({ status: 'full' });
    expect(await collections(db).learnCompletions.countDocuments({ userId: admin })).toBe(MAX_COMPLETIONS);
  });

  it('cursors from the browser are checked', () => {
    expect(parseCursor('1763629200000.0123456789abcdef01234567')).toEqual({ at: new Date(1763629200000), id: new ObjectId('0123456789abcdef01234567') });
    for (const bad of [null, '', 'abc', '1.2', '1763629200000.xyz', '1763629200000.0123456789abcdef01234567.1', '{"$gt":1}']) expect(parseCursor(bad)).toBeNull();
  });

  it('removes only the person’s own entries', async () => {
    const admin = await account('free', 'admin');
    const other = await account('pro', 'admin');
    const mine = await recordCompletion(db, admin, await getEntitlements(db, admin), 'CH-901');
    const theirs = await recordCompletion(db, other, await getEntitlements(db, other), 'CH-901');
    if (mine.status !== 'recorded' || theirs.status !== 'recorded') throw new Error('not recorded');
    expect(await removeCompletion(db, admin, new ObjectId(theirs.completion.id))).toBe(false);
    expect(await removeCompletion(db, admin, new ObjectId(mine.completion.id))).toBe(true);
    expect(await removeCompletion(db, admin, new ObjectId(mine.completion.id))).toBe(false);
    expect(await collections(db).learnCompletions.countDocuments({})).toBe(1);
  });
});

describe('the person’s data', () => {
  it('completions are in the data download and removed with the account', async () => {
    const admin = await account('free', 'admin');
    await account('pro', 'admin'); // not the last admin: the account may be deleted
    await recordCompletion(db, admin, await getEntitlements(db, admin), 'CH-901', new Date('2026-11-20T10:00:00Z'));
    await recordCompletion(db, admin, await getEntitlements(db, admin), 'D-TEST-01', new Date('2026-11-20T11:00:00Z'));
    const data = await exportAccountData(db, admin);
    expect(data?.learnCompletions).toEqual([
      { item: 'CH-901', completedAt: '2026-11-20T10:00:00.000Z', contentVersion: 1 },
      { item: 'D-TEST-01', completedAt: '2026-11-20T11:00:00.000Z', contentVersion: 1 },
    ]);
    expect((await deleteAccount(db, admin)).status).toBe('deleted');
    expect(await collections(db).learnCompletions.countDocuments({ userId: admin })).toBe(0);
  });
});

describe('what an open item sends', () => {
  it('only the fields learners use: anything else an item carries never leaves the server', async () => {
    const admin = await account('free', 'admin');
    const { content } = await liveLearn(db, await getEntitlements(db, admin));
    const exercise = { ...content.exercises[0], kind: 'exercise' as const, reviewerNote: 'internal: check the Hebrew' };
    const sent = fullItem(exercise as never, new Map(), false);
    expect(Object.keys(sent).sort()).toEqual(['collection', 'groupId', 'guide', 'id', 'instruction', 'kind', 'materials', 'mistake', 'objective', 'order', 'references', 'success', 'title', 'tools', 'worksheet']);
    expect(JSON.stringify(sent)).not.toContain('internal');
    const challenge = { ...content.challenges[0], kind: 'challenge' as const, collection: 'challenges' as const, draftNote: 'internal' };
    const sentChallenge = fullItem(challenge as never, new Map(), true);
    expect(Object.keys(sentChallenge).sort()).toEqual(['collection', 'groupId', 'id', 'kind', 'level', 'medium', 'order', 'prompt', 'published', 'quick', 'reference', 'references', 'skill', 'skillArea', 'title', 'tools']);
  });
});

describe('what the studio is told about Learn', () => {
  it('nothing for Free and Pro while no plan offers a module; admins see it all', async () => {
    const free = await account('free');
    const summary = learnSummaryOf(await getEntitlements(db, free));
    expect(summary).toMatchObject({ visible: false, modules: { curriculum: null, color: null, challenges: null } });
    const admin = learnSummaryOf(await getEntitlements(db, await account('free', 'admin')));
    expect(admin).toMatchObject({ visible: true, modules: { curriculum: 'open', color: 'open', challenges: 'open' } });
    // The account copy the studio receives carries it.
    expect((await getAccountSummary(db, free))?.account.learn).toEqual(summary);
  });

  it('a module one plan offers shows, locked, to the other; the key changes with the access', async () => {
    const free = await account('free');
    const pro = await account('pro');
    const before = learnSummaryOf(await getEntitlements(db, pro));
    const catalog = structuredClone(OWNER);
    catalog.plans.pro.features.push('learn.challenges');
    await publishCatalog(catalog);
    expect(learnSummaryOf(await getEntitlements(db, free))).toMatchObject({ visible: true, modules: { curriculum: null, color: null, challenges: 'locked' } });
    const after = learnSummaryOf(await getEntitlements(db, pro));
    expect(after).toMatchObject({ visible: true, modules: { challenges: 'open' } });
    expect(after.key).not.toBe(before.key);
    // A rule change alone (same modules) changes the key too, so open Learn screens ask again.
    const learn = defaultLearnSection();
    learn.access.pro.challenges = { mode: 'all' };
    await publishCatalog({ ...catalog, learn });
    const ruled = learnSummaryOf(await getEntitlements(db, pro));
    expect(ruled.modules).toEqual(after.modules);
    expect(ruled.key).not.toBe(after.key);
  });
});
