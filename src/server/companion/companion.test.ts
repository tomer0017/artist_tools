// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ObjectId, type Db } from 'mongodb';
import { MONGO_STARTUP_TIMEOUT, MONGO_STOP_TIMEOUT, startTestMongo, type TestMongo } from '@/test/mongo';
import { DEFAULT_TIPS, defaultConfig } from '@/lib/companion/defaults';
import { ACTION_TYPES, COMPANION_FEATURES, TRIGGERS, type CompanionTip } from '@/lib/companion/model';
import { getPublished, listVersions, publishIfUnchanged } from '@/server/config/versions';
import { collections } from '@/server/db/collections';
import { migrate } from '@/server/db/migrate';
import { getEntitlements } from '@/server/entitlements';
import { getAccountSummary, setCompanionPrefs } from '@/server/account';
import { companionSpec, configIssues, publishedCompanion } from './config';
import { companionForEdit, duplicateTip, moveTip, restoreCompanionVersion, saveAccess, saveSettings, saveTip, setTipArchived, tipHash } from './editor';
import { companionViewFor, stateOf } from './live';

// Sketchy's configuration on a real database (ADR-0024): the defaults are a
// valid configuration; every edit in Admin → Companion is published at once
// as a new version, never over someone else's change; IDs are never reused;
// and each account gets only the capabilities and tips its access opens.

let mongo: TestMongo;
let db: Db;
const ADMIN = 'admin:test';

beforeAll(async () => {
  mongo = await startTestMongo();
}, MONGO_STARTUP_TIMEOUT);

afterAll(async () => {
  await mongo?.stop();
}, MONGO_STOP_TIMEOUT);

beforeEach(async () => {
  db = mongo.client.db(`companion_${Math.random().toString(36).slice(2, 10)}`);
  await migrate(db);
});

async function account(plan: 'free' | 'pro', role: 'user' | 'admin' = 'user') {
  const _id = new ObjectId();
  await collections(db).users.insertOne({ _id, name: plan, email: `${_id.toHexString()}@companion.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date(), role, status: 'active', plan, marketingConsent: false } as never);
  return _id;
}

const tipForm = (extra: Record<string, unknown> = {}) => ({
  category: 'tools',
  text: { en: 'Try the grid.', he: 'כדאי לנסות את הרשת.' },
  screens: ['home'],
  audience: [],
  trigger: 'idle',
  animation: 'point',
  action: { type: 'openTool', label: { en: 'Open the grid', he: 'לפתוח את הרשת' }, tool: 'grid' },
  access: 'free',
  weight: 5,
  ...extra,
});

describe('the defaults', () => {
  it('are a configuration this release can write, with every tip complete in both languages', () => {
    const config = defaultConfig();
    expect(configIssues(config)).toEqual([]);
    expect(new Set(config.tips.map((t) => t.id)).size).toBe(config.tips.length);
    for (const tip of config.tips) {
      expect(tip.text.en.trim().length, tip.id).toBeGreaterThan(0);
      expect(tip.text.he.trim().length, tip.id).toBeGreaterThan(0);
      expect(tip.text.he, tip.id).toMatch(/[֐-׿]/);
    }
    expect(COMPANION_FEATURES.every((f) => config.access[f] === 'free')).toBe(true);
  });

  it('cover the brief: an introduction, every moment, the roulette, practice, comparison, proportions, values, color and teachers', () => {
    const triggers = new Set(DEFAULT_TIPS.map((t) => t.trigger));
    for (const trigger of TRIGGERS) expect(triggers.has(trigger), trigger).toBe(true);
    const actions = new Set(DEFAULT_TIPS.map((t) => t.action.type));
    for (const type of ['openTool', 'roulette', 'classRoulette', 'nextLesson', 'worksheets', 'chooseTool'] as const) expect(actions.has(type), type).toBe(true);
    const tools = new Set(DEFAULT_TIPS.flatMap((t) => (t.action.tool ? [t.action.tool] : [])));
    for (const tool of ['measure', 'value', 'color', 'grid', 'compare'] as const) expect(tools.has(tool), tool).toBe(true);
    expect(DEFAULT_TIPS.some((t) => t.audience.includes('teacher'))).toBe(true);
    expect(DEFAULT_TIPS.filter((t) => t.category === 'drawing').length).toBeGreaterThanOrEqual(15);
    for (const type of ACTION_TYPES) expect(typeof type).toBe('string');
  });

  it('apply until the first save (version 1 is then written)', async () => {
    expect(await getPublished(db, companionSpec)).toBeNull();
    expect((await publishedCompanion(db)).tips).toHaveLength(DEFAULT_TIPS.length);
    const saved = await saveSettings(db, ADMIN, { ...defaultConfig().settings, size: 120 });
    expect(saved).toMatchObject({ status: 'saved', version: 1 });
    expect((await publishedCompanion(db)).settings.size).toBe(120);
  });
});

describe('editing in Admin → Companion', () => {
  it('saves settings and access live, each as a new version with a note, and audits them', async () => {
    await saveSettings(db, ADMIN, { ...defaultConfig().settings, enabled: false });
    const access = await saveAccess(db, ADMIN, { companion: 'free', tips: 'pro', roulette: 'free', guide: 'admin', classroom: 'blocked' });
    expect(access).toMatchObject({ status: 'saved', version: 2 });
    const live = await publishedCompanion(db);
    expect(live.settings.enabled).toBe(false);
    expect(live.access).toMatchObject({ tips: 'pro', guide: 'admin', classroom: 'blocked' });
    const versions = await listVersions(db, 'companion');
    expect(versions.map((v) => v.note)).toEqual(['Access saved', 'Settings saved']);
    expect(await collections(db).auditEvents.countDocuments({ type: 'admin.companion_changed' })).toBe(2);
  });

  it('refuses settings out of range and unknown access modes, changing nothing', async () => {
    expect((await saveSettings(db, ADMIN, { ...defaultConfig().settings, size: 500 })).status).toBe('invalid');
    expect((await saveAccess(db, ADMIN, { companion: 'everyone', tips: 'free', roulette: 'free', guide: 'free', classroom: 'free' })).status).toBe('invalid');
    expect(await getPublished(db, companionSpec)).toBeNull();
  });

  it('adds a tip with the next ID, edits it only from what was opened, and keeps the admin text on a conflict', async () => {
    const added = await saveTip(db, ADMIN, { id: null, fields: tipForm() });
    const firstNew = `T-${String(DEFAULT_TIPS.length + 1).padStart(3, '0')}`;
    expect(added).toMatchObject({ status: 'saved', id: firstNew });
    const edit = await companionForEdit(db);
    if ('blocked' in edit) throw new Error(edit.blocked);
    const hash = edit.hashes[firstNew];
    const edited = await saveTip(db, ADMIN, { id: firstNew, baseHash: hash, fields: tipForm({ text: { en: 'Grid time!', he: 'זמן רשת!' } }) });
    expect(edited.status).toBe('saved');
    // The same old fingerprint again: someone (this admin) changed it since.
    const stale = await saveTip(db, ADMIN, { id: firstNew, baseHash: hash, fields: tipForm({ text: { en: 'Lost?', he: 'אבד?' } }) });
    expect(stale.status).toBe('conflict');
    expect((await publishedCompanion(db)).tips.find((t) => t.id === firstNew)!.text.en).toBe('Grid time!');
  });

  it('refuses a tip people would see without both languages, or with a button missing its target', async () => {
    expect(await saveTip(db, ADMIN, { id: null, fields: tipForm({ text: { en: 'English only', he: '' } }) })).toMatchObject({ status: 'invalid' });
    expect(await saveTip(db, ADMIN, { id: null, fields: tipForm({ action: { type: 'openItem', label: { en: 'Go', he: 'קדימה' } } }) })).toMatchObject({ status: 'invalid' });
    expect(await saveTip(db, ADMIN, { id: null, fields: tipForm({ action: { type: 'openTool', label: { en: 'Go', he: 'קדימה' }, tool: 'photoshop' } }) })).toMatchObject({ status: 'invalid' });
    // A button that runs code or opens an address cannot even be described.
    expect(await saveTip(db, ADMIN, { id: null, fields: tipForm({ action: { type: 'url', label: { en: 'Go', he: 'קדימה' }, href: 'https://evil.example' } }) })).toMatchObject({ status: 'invalid' });
    expect(await getPublished(db, companionSpec)).toBeNull();
  });

  it('copies a tip as Admin only, archives and restores, moves, and never reuses an ID after a restore', async () => {
    const copy = await duplicateTip(db, ADMIN, { id: 'T-004' });
    expect(copy.status).toBe('saved');
    const copyId = copy.status === 'saved' ? copy.id! : '';
    let live = await publishedCompanion(db);
    expect(live.tips.find((t) => t.id === copyId)).toMatchObject({ access: 'admin', text: live.tips.find((t) => t.id === 'T-004')!.text });
    expect((await setTipArchived(db, ADMIN, { id: 'T-004', archived: true })).status).toBe('saved');
    expect((await publishedCompanion(db)).tips.find((t) => t.id === 'T-004')!.archived).toBe(true);
    expect((await setTipArchived(db, ADMIN, { id: 'T-004', archived: false })).status).toBe('saved');
    expect((await moveTip(db, ADMIN, { id: 'T-002', direction: 'up' })).status).toBe('saved');
    live = await publishedCompanion(db);
    const order = [...live.tips].filter((t) => !t.archived).sort((a, b) => a.order - b.order).map((t) => t.id);
    expect(order.indexOf('T-002')).toBe(0);
    // Back to version 1 (before the copy): the copy's number is still never given again.
    expect((await restoreCompanionVersion(db, ADMIN, { version: 1 })).status).toBe('saved');
    const again = await saveTip(db, ADMIN, { id: null, fields: tipForm() });
    expect(again.status === 'saved' && again.id).not.toBe(copyId);
    expect(again.status === 'saved' && Number(again.id!.slice(2))).toBeGreaterThan(Number(copyId.slice(2)));
  });

  it('never overwrites a configuration published meanwhile (the change is applied again on top of it)', async () => {
    await saveSettings(db, ADMIN, { ...defaultConfig().settings, size: 90 });
    // Someone else publishes behind the editor's back (an operator tool).
    const other = structuredClone(await publishedCompanion(db));
    other.settings.speed = 150;
    expect((await publishIfUnchanged(db, companionSpec, other, { version: 1 }, 'cli', 'operator')).status).toBe('published');
    await saveSettings(db, ADMIN, { ...other.settings, size: 110 });
    const live = await publishedCompanion(db);
    expect(live.settings).toMatchObject({ size: 110, speed: 150 });
  });

  it('keeps a tip a newer release wrote (unknown values) out of the studio and blocks writing over it', async () => {
    const config = defaultConfig() as ReturnType<typeof defaultConfig> & { tips: (CompanionTip & { trigger: string })[] };
    const future = { ...config.tips[0], id: 'T-900', trigger: 'onFullMoon' } as unknown as CompanionTip;
    await collections(db).configVersions.insertOne({ kind: 'companion', version: 1, status: 'published', document: { ...config, tips: [...config.tips, future] }, note: 'newer release', createdBy: 'cli', createdAt: new Date(), updatedAt: new Date(), publishedBy: 'cli', publishedAt: new Date() });
    const user = await account('free');
    const view = companionViewFor(await publishedCompanion(db), 1, await getEntitlements(db, user));
    expect(view.tips.some((t) => t.id === 'T-900')).toBe(false);
    expect(view.tips.length).toBe(DEFAULT_TIPS.length);
    expect((await saveSettings(db, ADMIN, config.settings)).status).toBe('invalid');
  });
});

describe('what each account gets', () => {
  it('access modes decide like Learn: Free everyone, Pro locked for Free, Admin only for admins, Blocked for nobody', () => {
    const free = { active: true, admin: false, pro: false };
    const pro = { active: true, admin: false, pro: true };
    const admin = { active: true, admin: true, pro: false };
    expect([stateOf('free', free), stateOf('pro', free), stateOf('admin', free), stateOf('blocked', free)]).toEqual(['open', 'locked', 'hidden', 'hidden']);
    expect([stateOf('free', pro), stateOf('pro', pro), stateOf('admin', pro), stateOf('blocked', pro)]).toEqual(['open', 'open', 'hidden', 'hidden']);
    expect([stateOf('free', admin), stateOf('pro', admin), stateOf('admin', admin), stateOf('blocked', admin)]).toEqual(['open', 'open', 'open', 'hidden']);
    expect(stateOf('free', { active: false, admin: true, pro: true })).toBe('hidden');
    expect(stateOf('somethingNew', admin)).toBe('hidden');
  });

  it('the studio receives only the tips an account may see, and nothing when Sketchy is off for it', async () => {
    await saveTip(db, ADMIN, { id: null, fields: tipForm({ access: 'admin', text: { en: 'Admins only', he: 'למנהלים' } }) });
    await saveTip(db, ADMIN, { id: null, fields: tipForm({ access: 'pro', text: { en: 'Pro only', he: 'ל-Pro' } }) });
    const live = await publishedCompanion(db);
    const version = (await getPublished(db, companionSpec))!.version;
    const free = companionViewFor(live, version, await getEntitlements(db, await account('free')));
    const pro = companionViewFor(live, version, await getEntitlements(db, await account('pro')));
    const admin = companionViewFor(live, version, await getEntitlements(db, await account('free', 'admin')));
    const has = (view: typeof free, text: string) => view.tips.some((t) => t.text.en === text);
    expect([has(free, 'Admins only'), has(free, 'Pro only')]).toEqual([false, false]);
    expect([has(pro, 'Admins only'), has(pro, 'Pro only')]).toEqual([false, true]);
    expect([has(admin, 'Admins only'), has(admin, 'Pro only')]).toEqual([true, true]);
    await saveAccess(db, ADMIN, { companion: 'pro', tips: 'free', roulette: 'free', guide: 'free', classroom: 'free' });
    const lockedFree = companionViewFor(await publishedCompanion(db), version + 1, await getEntitlements(db, await account('free')));
    expect(lockedFree.features.companion).toBe('locked');
    expect(lockedFree.features.tips).toBe('hidden');
    expect(lockedFree.tips).toEqual([]);
  });

  it('the account summary says whether he shows, keeps the person’s choices, and changes its key when an admin saves', async () => {
    const user = await account('free');
    const before = (await getAccountSummary(db, user))!.account.companion;
    expect(before).toMatchObject({ show: true, available: true, hidden: false, audience: null });
    await setCompanionPrefs(db, user, { hidden: true, audience: 'teacher' });
    const hidden = (await getAccountSummary(db, user))!.account.companion;
    expect(hidden).toMatchObject({ show: false, available: true, hidden: true, audience: 'teacher' });
    await saveSettings(db, ADMIN, { ...defaultConfig().settings, size: 80 });
    const after = (await getAccountSummary(db, user))!.account.companion;
    expect(after.key).not.toBe(before.key);
    await saveSettings(db, ADMIN, { ...defaultConfig().settings, enabled: false });
    await setCompanionPrefs(db, user, { hidden: false });
    expect((await getAccountSummary(db, user))!.account.companion).toMatchObject({ show: false, available: false });
  });

  it('tip fingerprints change with the tip', () => {
    const tip = DEFAULT_TIPS[0];
    expect(tipHash(tip)).toBe(tipHash(structuredClone(tip)));
    expect(tipHash({ ...tip, weight: 9 })).not.toBe(tipHash(tip));
  });
});
