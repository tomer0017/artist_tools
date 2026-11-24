// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ObjectId, type Db } from 'mongodb';
import { MONGO_STARTUP_TIMEOUT, MONGO_STOP_TIMEOUT, startTestMongo, type TestMongo } from '@/test/mongo';
import { writeLearnFixture } from '@/test/learn-fixture';
import { PLAN_FEATURES } from '@/lib/plans';
import { NO_LEGACY, learnAccess, legacyLearnOf } from '@/lib/learn/access';
import { defaultLearnSection, itemsOf, type LearnContent } from '@/lib/learn/model';
import { catalogSpec, type Catalog } from '@/server/config/catalog';
import { getPublished, listVersions, publishDraft, saveDraft } from '@/server/config/versions';
import { collections } from '@/server/db/collections';
import { migrate } from '@/server/db/migrate';
import { getEntitlements, getPlanStates } from '@/server/entitlements';
import { backfillLearnHistory, learnContentSpec, publishedLearnContent } from './content';
import {
  createItem,
  duplicateItem,
  itemForEdit,
  itemHistory,
  moveItem,
  parseFields,
  previewVersionRestore,
  restoreItemCopy,
  restoreVersion,
  saveItem,
  setAccess,
  setAccessMany,
  setArchived,
  writeModes,
  type ItemFields,
} from './editor';
import { importSeed } from './import';
import { liveLearn } from './live';
import { fieldsOf as formFields, formOf } from '@/app/admin/learn/form';

// Admin → Learn's editor on a real database (ADR-0023): every change is
// published at once as a new version, through the guarded publication;
// conflicts keep the admin's text; IDs are never reused; access modes decide
// alone, and the old flag stays in step for releases before modes.

let mongo: TestMongo;
let assetsDir: string;
let seedDir: string;
let db: Db;

beforeAll(async () => {
  mongo = await startTestMongo();
  assetsDir = mkdtempSync(path.join(tmpdir(), 'learn-editor-assets-'));
  seedDir = writeLearnFixture(mkdtempSync(path.join(tmpdir(), 'learn-editor-seed-')));
  process.env.LEARN_ASSETS_DIR = assetsDir;
}, MONGO_STARTUP_TIMEOUT);

afterAll(async () => {
  delete process.env.LEARN_ASSETS_DIR;
  rmSync(assetsDir, { recursive: true, force: true });
  rmSync(seedDir, { recursive: true, force: true });
  await mongo?.stop();
}, MONGO_STOP_TIMEOUT);

beforeEach(async () => {
  db = mongo.client.db(`editor_${Math.random().toString(36).slice(2, 10)}`);
  await migrate(db);
  expect((await importSeed(db, assetsDir, seedDir, 'cli')).status).toBe('saved');
  expect((await publishDraft(db, learnContentSpec, 'cli')).status).toBe('published');
});

const ADMIN = 'admin:test';
const live = async () => (await publishedLearnContent(db)) as LearnContent;
const item = async (id: string) => itemsOf(await live()).find((i) => i.id === id)!;
const version = async () => (await getPublished(db, learnContentSpec))!.version;

async function account(plan: 'free' | 'pro', role: 'user' | 'admin' = 'user') {
  const _id = new ObjectId();
  await collections(db).users.insertOne({ _id, name: plan, email: `${_id.toHexString()}@editor.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date(), role, status: 'active', plan } as never);
  return _id;
}

/** The form's fields for an item as it is now (what the editor sends back unchanged). */
async function fieldsOf(id: string): Promise<ItemFields> {
  const stored = await item(id);
  const { kind, ...raw } = stored as unknown as Record<string, unknown> & { kind: string };
  const keep = (keys: string[]) => Object.fromEntries(keys.filter((k) => raw[k] !== undefined).map((k) => [k, raw[k]]));
  const access = (raw.access as string | undefined) ?? 'admin';
  if (kind === 'challenge') {
    const fields = { ...keep(['groupId', 'title', 'prompt', 'level', 'skill', 'skillArea', 'reference', 'references', 'medium', 'quick', 'tools', 'lessons', 'focus', 'twist']), access };
    const parsed = parseFields('challenge', 'challenges', JSON.parse(JSON.stringify(fields)));
    if ('issues' in parsed) throw new Error(parsed.issues.join('; '));
    return parsed;
  }
  const steps = (raw.steps as Record<string, unknown>[] | undefined)?.map((s) => Object.fromEntries(Object.entries(s).filter(([k]) => ['text', 'image', 'tool', 'worksheet'].includes(k))));
  const fields = { ...keep(['groupId', 'title', 'objective', 'materials', 'instruction', 'guide', 'mistake', 'success', 'references', 'worksheet', 'tools', 'optional', 'skill', 'minutes', 'demo', 'create']), ...(steps ? { steps } : {}), access };
  const parsed = parseFields('exercise', raw.collection, JSON.parse(JSON.stringify(fields)));
  if ('issues' in parsed) throw new Error(parsed.issues.join('; '));
  return parsed;
}

describe('saving one item', () => {
  it('publishes the change at once as a new version, keeps every field it does not edit, and records it in the item’s history', async () => {
    const before = await version();
    const loaded = (await itemForEdit(db, 'CH-901'))!;
    const fields = await fieldsOf('CH-901');
    if (fields.kind !== 'challenge') throw new Error('kind');
    fields.fields.title = { en: 'A new title', he: 'כותרת חדשה' };
    fields.fields.access = 'free';
    const saved = await saveItem(db, ADMIN, { id: 'CH-901', baseHash: loaded.hash, data: fields, legacy: NO_LEGACY });
    expect(saved).toMatchObject({ status: 'saved', version: before + 1, id: 'CH-901' });
    if (saved.status === 'saved') expect(saved.message).toBe('Edited CH-901: title; access Admin only → Free');
    const now = await item('CH-901');
    expect(now).toMatchObject({ title: { en: 'A new title', he: 'כותרת חדשה' }, access: 'free', published: true, prompt: { en: 'Secret prompt CH-901' } });
    // Live for learners on their next request.
    const free = await account('free');
    expect((await liveLearn(db, await getEntitlements(db, free))).view.state('CH-901')).toEqual({ status: 'open' });
    expect((await itemHistory(db, 'CH-901')).map((h) => h.version)).toEqual([before + 1, 1]);
    const audit = await collections(db).auditEvents.findOne({ type: 'admin.learn_item_changed' });
    expect(audit?.metadata).toMatchObject({ itemId: 'CH-901', action: 'edit', version: before + 1, access: 'free' });
  });

  it('refuses when the item changed since the editor opened it (nothing written), but merges a change to another item', async () => {
    const opened = (await itemForEdit(db, 'CH-901'))!;
    // Someone else changes another item meanwhile: no conflict.
    expect((await setAccess(db, 'admin:other', { id: 'CH-902', access: 'pro', legacy: NO_LEGACY })).status).toBe('saved');
    const fields = await fieldsOf('CH-901');
    if (fields.kind !== 'challenge') throw new Error('kind');
    fields.fields.prompt = { en: 'Mine', he: 'שלי' };
    expect((await saveItem(db, ADMIN, { id: 'CH-901', baseHash: opened.hash, data: fields, legacy: NO_LEGACY })).status).toBe('saved');
    expect((await item('CH-902')).access).toBe('pro');
    // Now someone changes CH-901 itself: the old fingerprint no longer matches.
    const stale = opened.hash;
    const count = (await listVersions(db, 'learn_content', 100)).length;
    const again = await saveItem(db, ADMIN, { id: 'CH-901', baseHash: stale, data: fields, legacy: NO_LEGACY });
    expect(again.status).toBe('conflict');
    expect((await listVersions(db, 'learn_content', 100)).length).toBe(count);
  });

  it('Free and Pro need both languages; Admin only may be unfinished', async () => {
    const loaded = (await itemForEdit(db, 'CH-903'))!;
    const fields = await fieldsOf('CH-903');
    if (fields.kind !== 'challenge') throw new Error('kind');
    fields.fields.prompt = { en: 'English only', he: '' };
    fields.fields.access = 'pro';
    const refused = await saveItem(db, ADMIN, { id: 'CH-903', baseHash: loaded.hash, data: fields, legacy: NO_LEGACY });
    expect(refused).toEqual({ status: 'invalid', issues: ['CH-903: prompt needs English and Hebrew before it can be Free or Pro'] });
    fields.fields.access = 'admin';
    expect((await saveItem(db, ADMIN, { id: 'CH-903', baseHash: loaded.hash, data: fields, legacy: NO_LEGACY })).status).toBe('saved');
    expect(await item('CH-903')).toMatchObject({ access: 'admin', published: false, prompt: { en: 'English only', he: '' } });
  });

  it('moving to another group puts the item at that group’s end', async () => {
    const loaded = (await itemForEdit(db, 'CH-901'))!;
    const fields = await fieldsOf('CH-901');
    fields.fields.groupId = 'nature';
    expect((await saveItem(db, ADMIN, { id: 'CH-901', baseHash: loaded.hash, data: fields, legacy: NO_LEGACY })).status).toBe('saved');
    const ordered = itemsOf(await live()).filter((i) => i.collection === 'challenges').sort((a, b) => a.order - b.order).map((i) => `${i.id}:${i.groupId}`);
    expect(ordered).toEqual(['CH-902:nature', 'CH-903:nature', 'CH-901:nature']);
  });
});

describe('adding, copying, ordering, archiving', () => {
  it('a new challenge takes the next ID never used, starts where asked (Admin only by default), at its group’s end', async () => {
    const data = parseFields('challenge', 'challenges', {
      groupId: 'objects', access: 'admin', title: { en: 'Kettle', he: 'קומקום' }, prompt: { en: 'Draw a kettle', he: 'לרשום קומקום' }, level: 'beginner', skill: { en: 'Shapes', he: 'צורות' }, skillArea: 2, reference: 'life', references: [], medium: 'pencil', quick: true, tools: [],
    });
    if ('issues' in data) throw new Error(data.issues.join());
    const created = await createItem(db, ADMIN, { data });
    expect(created).toMatchObject({ status: 'saved', id: 'CH-904' });
    expect(await item('CH-904')).toMatchObject({ access: 'admin', published: false, groupId: 'objects' });
    expect((await item('CH-904')).order).toBeGreaterThan((await item('CH-901')).order);
    // Only admins see it.
    expect((await liveLearn(db, await getEntitlements(db, await account('pro')))).view.state('CH-904').status).toBe('hidden');
    expect((await liveLearn(db, await getEntitlements(db, await account('free', 'admin')))).view.state('CH-904').status).toBe('open');
  });

  it('a new lesson takes its unit’s code; a copy goes right after its original, Admin only, with the next free number', async () => {
    const lesson = parseFields('exercise', 'curriculum', {
      groupId: 'shapes', access: 'admin', title: { en: 'Ovals', he: 'אליפסות' }, objective: { en: '', he: '' }, materials: { en: '', he: '' }, instruction: { en: '', he: '' }, mistake: { mistake: { en: '', he: '' }, fix: { en: '', he: '' } }, success: { en: '', he: '' }, references: [], worksheet: { kind: 'none' }, tools: [],
    });
    if ('issues' in lesson) throw new Error(lesson.issues.join());
    const created = await createItem(db, ADMIN, { data: lesson });
    // The shapes unit holds D-BASE-01 and D-LESSON-01: the newest one's code.
    expect(created).toMatchObject({ status: 'saved', id: 'D-LESSON-02' });
    const copy = await duplicateItem(db, ADMIN, { id: 'D-TEST-01' });
    expect(copy).toMatchObject({ status: 'saved', id: 'D-TEST-04' });
    const after = itemsOf(await live()).filter((i) => i.collection === 'curriculum').sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)).map((i) => i.id);
    expect(after.indexOf('D-TEST-04')).toBe(after.indexOf('D-TEST-01') + 1);
    expect(await item('D-TEST-04')).toMatchObject({ access: 'admin', published: false, title: { en: 'Test exercise one (copy)' } });
    // An ID any kept version held is never taken again, even one removed since (never seen by learners, so removable).
    const withIt = structuredClone(await live());
    withIt.challenges.push({ ...structuredClone(withIt.challenges[0]), id: 'CH-950', published: false, access: 'admin' });
    for (const doc of [withIt, await live()]) {
      expect((await saveDraft(db, learnContentSpec, doc, 'cli')).status).toBe('saved');
      expect((await publishDraft(db, learnContentSpec, 'cli')).status).toBe('published');
    }
    expect(itemsOf(await live()).some((i) => i.id === 'CH-950')).toBe(false);
    expect(await duplicateItem(db, ADMIN, { id: 'CH-901' })).toMatchObject({ id: 'CH-951' });
  });

  it('moves up and down within its group only, with as few new numbers as possible', async () => {
    const order = async () => itemsOf(await live()).filter((i) => i.groupId === 'basics').sort((a, b) => a.order - b.order).map((i) => i.id);
    expect(await order()).toEqual(['D-TEST-01', 'D-TEST-02', 'D-TEST-03']);
    expect((await moveItem(db, ADMIN, { id: 'D-TEST-02', direction: 'up' })).status).toBe('saved');
    expect(await order()).toEqual(['D-TEST-02', 'D-TEST-01', 'D-TEST-03']);
    expect(await moveItem(db, ADMIN, { id: 'D-TEST-02', direction: 'up' })).toMatchObject({ status: 'invalid' });
    // The move is in the moved item's history; the other's number changed, but its history only shows its own changes.
    expect((await itemHistory(db, 'D-TEST-02'))[0].note).toBe('Moved D-TEST-02 up');
  });

  it('archives (nobody sees it, admins included) and restores with the access it had', async () => {
    expect((await setAccess(db, ADMIN, { id: 'CH-901', access: 'pro', legacy: NO_LEGACY })).status).toBe('saved');
    expect((await setArchived(db, ADMIN, { id: 'CH-901', archived: true, legacy: NO_LEGACY })).status).toBe('saved');
    expect(await item('CH-901')).toMatchObject({ archived: true, access: 'pro', published: false });
    const admin = await account('free', 'admin');
    expect((await liveLearn(db, await getEntitlements(db, admin))).view.state('CH-901').status).toBe('hidden');
    expect((await setArchived(db, ADMIN, { id: 'CH-901', archived: false, legacy: NO_LEGACY })).status).toBe('saved');
    expect(await item('CH-901')).toMatchObject({ access: 'pro', published: false });
    expect((await item('CH-901')).archived).toBeUndefined();
    expect((await liveLearn(db, await getEntitlements(db, await account('pro')))).view.state('CH-901').status).toBe('open');
  });

  it('nothing is saved from the tables while an imported draft waits', async () => {
    expect((await saveDraft(db, learnContentSpec, await live(), 'cli')).status).toBe('saved');
    expect(await setAccess(db, ADMIN, { id: 'CH-901', access: 'free', legacy: NO_LEGACY })).toMatchObject({ status: 'blocked' });
  });
});

describe('history and restore', () => {
  it('restores an item’s texts from an earlier version, keeping its access, place and group', async () => {
    const original = await item('CH-902');
    const loaded = (await itemForEdit(db, 'CH-902'))!;
    const fields = await fieldsOf('CH-902');
    if (fields.kind !== 'challenge') throw new Error('kind');
    fields.fields.prompt = { en: 'Changed prompt', he: 'הנחיה ששונתה' };
    expect((await saveItem(db, ADMIN, { id: 'CH-902', baseHash: loaded.hash, data: fields, legacy: NO_LEGACY })).status).toBe('saved');
    expect((await setAccess(db, ADMIN, { id: 'CH-902', access: 'pro', legacy: NO_LEGACY })).status).toBe('saved');
    const restored = await restoreItemCopy(db, ADMIN, { id: 'CH-902', version: 1 });
    expect(restored).toMatchObject({ status: 'saved' });
    expect(await item('CH-902')).toMatchObject({ prompt: (original as { prompt: unknown }).prompt, access: 'pro', groupId: original.groupId, order: original.order });
  });

  it('restores the whole content as an earlier version, live at once; items added since stay, archived', async () => {
    const data = parseFields('challenge', 'challenges', {
      groupId: 'objects', access: 'free', title: { en: 'Cup', he: 'ספל' }, prompt: { en: 'A cup', he: 'ספל' }, level: 'beginner', skill: { en: 'S', he: 'ס' }, skillArea: 1, reference: 'memory', references: [], medium: 'pencil', quick: true, tools: [],
    });
    if ('issues' in data) throw new Error(data.issues.join());
    expect((await createItem(db, ADMIN, { data })).status).toBe('saved');
    const preview = await previewVersionRestore(db, 1);
    expect(preview).toEqual({ changes: ['Archives CH-904: in the studio for nobody until it is restored'] });
    expect((await restoreVersion(db, ADMIN, { version: 1 })).status).toBe('saved');
    expect(await item('CH-904')).toMatchObject({ archived: true, published: false });
    expect(itemsOf(await live()).length).toBe(10);
  });

  it('the migration gives versions published before histories the items each changed, once', async () => {
    await collections(db).configVersions.updateMany({ kind: 'learn_content' }, { $unset: { items: '' } });
    expect((await setAccess(db, ADMIN, { id: 'CH-901', access: 'free', legacy: NO_LEGACY })).status).toBe('saved');
    await collections(db).configVersions.updateMany({ kind: 'learn_content' }, { $unset: { items: '' } });
    expect(await backfillLearnHistory(db)).toBe(2);
    expect(await backfillLearnHistory(db)).toBe(0);
    expect((await itemHistory(db, 'CH-901')).map((h) => h.version)).toEqual([2, 1]);
    expect((await itemHistory(db, 'CH-902')).map((h) => h.version)).toEqual([1]);
  });
});

describe('the switch-over to modes (production, 2026-11)', () => {
  const OWNER: Catalog = { plans: { free: { features: ['tool.study', 'tool.color', 'tool.grid', 'export.image', 'learn.curriculum', 'learn.challenges'], quotas: {} }, pro: { features: [...PLAN_FEATURES.pro, 'learn.curriculum', 'learn.challenges'], quotas: {} } }, disabled: [] };

  it('writing each item’s mode keeps everyone’s access exactly; then every item Free; the old rules never decide again', async () => {
    // As on production in catalog v8: Free has one lesson and every challenge; Pro has everything.
    const learn = defaultLearnSection();
    learn.access.free = { curriculum: { mode: 'selected', items: ['D-TEST-01'] }, color: { mode: 'none' }, challenges: { mode: 'all' } };
    learn.access.pro = { curriculum: { mode: 'all' }, color: { mode: 'none' }, challenges: { mode: 'all' } };
    expect((await saveDraft(db, catalogSpec, { ...OWNER, learn }, 'cli')).status).toBe('saved');
    expect((await publishDraft(db, catalogSpec, 'cli')).status).toBe('published');
    const legacy = legacyLearnOf(await getPlanStates(db));
    const viewers = { free: await account('free'), pro: await account('pro'), admin: await account('free', 'admin') };
    const states = async () => {
      const out: Record<string, string> = {};
      for (const [who, id] of Object.entries(viewers)) {
        const { view, content } = await liveLearn(db, await getEntitlements(db, id));
        for (const i of itemsOf(content)) out[`${who}:${i.id}`] = view.state(i.id).status;
      }
      return out;
    };
    const before = await states();
    expect(before['free:D-TEST-02']).toBe('locked');
    expect((await writeModes(db, 'cli:learn-access', { legacy, note: 'modes' })).status).toBe('saved');
    expect(await states()).toEqual(before);
    const modes = Object.fromEntries(itemsOf(await live()).map((i) => [i.id, `${i.access}:${i.published}`]));
    expect(modes).toMatchObject({ 'D-TEST-01': 'free:true', 'D-TEST-02': 'pro:false', 'D-TEST-03': 'admin:false', 'CH-901': 'free:true', 'C-TEST-01': 'admin:false' });

    // Every item Free (the owner's request): Free opens them all.
    const ids = itemsOf(await live()).map((i) => i.id);
    expect((await setAccessMany(db, 'cli:learn-access', { ids, access: 'free', legacy, note: 'all free' })).status).toBe('saved');
    const free = (await liveLearn(db, await getEntitlements(db, viewers.free))).view;
    expect(ids.every((id) => free.state(id).status === 'open')).toBe(true);
    // The old rules can no longer close (or open) anything.
    expect((await saveDraft(db, catalogSpec, OWNER, 'cli')).status).toBe('saved');
    expect((await publishDraft(db, catalogSpec, 'cli')).status).toBe('published');
    const after = (await liveLearn(db, await getEntitlements(db, viewers.free))).view;
    expect(ids.every((id) => after.state(id).status === 'open')).toBe(true);
    // A release before modes reads the flags: every Free item published, nothing else.
    expect(itemsOf(await live()).every((i) => i.published === true)).toBe(true);
    expect(learnAccess({ active: true, admin: false, pro: false, legacy: NO_LEGACY }, await live()).opens('curriculum')).toHaveLength(5);
  });
});

describe('the editor’s form', () => {
  it('opening any item and saving it unchanged changes nothing: every field round-trips', async () => {
    const legacy = NO_LEGACY;
    for (const stored of itemsOf(await live())) {
      const loaded = (await itemForEdit(db, stored.id))!;
      const view = learnAccess({ active: true, admin: true, pro: true, legacy }, await live());
      const form = formOf(loaded.item, {}, view.mode(stored.id)!);
      const data = parseFields(stored.kind, stored.collection, JSON.parse(JSON.stringify(formFields(form))));
      if ('issues' in data) throw new Error(`${stored.id}: ${data.issues.join('; ')}`);
      const result = await saveItem(db, ADMIN, { id: stored.id, baseHash: loaded.hash, data, legacy });
      expect(result, stored.id).toEqual({ status: 'invalid', issues: ['Nothing changed.'] });
    }
  });
});

