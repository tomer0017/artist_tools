// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Db } from 'mongodb';
import { z } from 'zod';
import { TOOL_IDS } from '@/lib/account';
import { MONGO_STARTUP_TIMEOUT, MONGO_STOP_TIMEOUT, startTestMongo, type TestMongo } from '@/test/mongo';
import { FIXTURE_LICENCE, fixtureSeed, writeLearnFixture } from '@/test/learn-fixture';
import {
  ASSET_ID,
  CHALLENGE_ID,
  CHALLENGE_LEVELS,
  EXERCISE_ID,
  GROUP_ID,
  LEARN_COLLECTIONS,
  MEDIUMS,
  REFERENCE_KINDS,
  itemAssetIds,
  itemsOf,
  listPicture,
  type LearnContent,
  type LearnItem,
} from '@/lib/learn/model';
import { learnAccess, type LearnViewer } from '@/lib/learn/access';
import { publishDraft } from '@/server/config/versions';
import { migrate } from '@/server/db/migrate';
import { licenceIssues } from './assets';
import { LESSON_LIMITS, assetIdsOf, contentIssues, learnContentSpec, publishedLearnContent } from './content';
import { importSeed } from './import';
import { fullItem, listEntry } from './present';

// Lessons (ADR-0019, docs/learn/08 §3) on a real database and in the checks
// every draft and publication passes: a lesson's parts and their limits, the
// tool presets, the lessons a challenge builds on, what learners receive (the
// known fields only, nested ones included), the pictures the asset route
// serves for an item, and — for rollback safety — M6 content read by M5.

let mongo: TestMongo;
let assetsDir: string;
let seedDir: string;

beforeAll(async () => {
  mongo = await startTestMongo();
  assetsDir = mkdtempSync(path.join(tmpdir(), 'lesson-assets-'));
  seedDir = writeLearnFixture(mkdtempSync(path.join(tmpdir(), 'lesson-seed-')));
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
  db = mongo.client.db(`lessons_${Math.random().toString(36).slice(2, 10)}`);
  await migrate(db);
});

async function published(): Promise<LearnContent> {
  expect((await importSeed(db, assetsDir, seedDir, 'cli')).status).toBe('saved');
  expect(await publishDraft(db, learnContentSpec, 'cli')).toMatchObject({ status: 'published' });
  return publishedLearnContent(db);
}

/** The fixture's content with made-up asset IDs, for the checks that need no database. */
function content(): LearnContent {
  const ids = new Map<string, string>();
  const idOf = (key: unknown) => {
    if (!ids.has(String(key))) ids.set(String(key), String(ids.size).padStart(64, 'a'));
    return ids.get(String(key))!;
  };
  const swap = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(swap);
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, inner] of Object.entries(value)) {
        if (key === 'asset') out.assetId = idOf(inner);
        else out[key] = swap(inner);
      }
      return out;
    }
    return value;
  };
  return swap(fixtureSeed().content) as LearnContent;
}

const lessonOf = (doc: LearnContent, id = 'D-LESSON-01') => doc.exercises.find((e) => e.id === id)!;

describe('a lesson in the content', () => {
  it('imports and publishes with its pictures stored as assets; every picture it shows is one the asset route serves for it', async () => {
    const doc = await published();
    const lesson = lessonOf(doc);
    expect(lesson.demo).toHaveLength(2);
    expect(lesson.steps).toHaveLength(4);
    expect(lesson.steps![1].tool).toEqual({ tool: 'value', label: { en: 'See three values', he: 'לראות שלושה ערכים' }, preset: { levels: 3 } });
    for (const ref of [lesson.demo![0].image, lesson.demo![1].image, lesson.steps![0].image!, lesson.mistake.image!]) expect(ref.assetId).toMatch(ASSET_ID);
    // The asset route serves an asset to whoever may open an item using it: these are those assets.
    const item = itemsOf(doc).find((i) => i.id === 'D-LESSON-01')!;
    expect(itemAssetIds(item).sort()).toEqual([...new Set([lesson.references[0].assetId, lesson.demo![0].image.assetId, lesson.demo![1].image.assetId, lesson.mistake.image!.assetId])].sort());
    // A static worksheet is one of an item's assets too.
    const sheet = itemsOf(doc).find((i) => i.id === 'D-TEST-02')!;
    expect(sheet.kind === 'exercise' && sheet.worksheet.kind).toBe('static');
    expect(itemAssetIds(sheet)).toHaveLength(1);
    // Every picture is checked as a reference image when content is saved or published.
    const used = assetIdsOf(doc);
    expect(used.references.size).toBe(6);
    expect(used.worksheets.size).toBe(1);
    // A lesson's list picture is its first demonstration frame.
    expect(listPicture(item)?.assetId).toBe(lesson.demo![0].image.assetId);
  });

  it('a seed naming an asset it does not hold, in a demonstration, is refused and nothing is saved', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'lesson-bad-seed-'));
    writeLearnFixture(dir);
    const seed = fixtureSeed();
    const lesson = seed.content.exercises.find((e) => e.id === 'D-LESSON-01') as unknown as { demo: { image: { asset: string } }[] };
    lesson.demo[0].image.asset = 'missing';
    writeFileSync(path.join(dir, 'seed.json'), JSON.stringify(seed));
    const result = await importSeed(db, assetsDir, dir, 'cli');
    expect(result).toMatchObject({ status: 'invalid' });
    expect(JSON.stringify(result)).toContain('D-LESSON-01: no asset with the key missing');
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('what a published lesson must have', () => {
  it('the fixture passes', () => {
    expect(contentIssues(content())).toEqual([]);
  });

  it('a demonstration, 3–6 steps, 2–4 checks, both languages, and short parts', () => {
    const doc = content();
    const lesson = lessonOf(doc);
    lesson.demo = [];
    lesson.steps = lesson.steps!.slice(0, 2);
    lesson.checks = lesson.checks!.slice(0, 1);
    lesson.steps[0].text = { en: 'x'.repeat(LESSON_LIMITS.step + 1), he: 'ש' };
    lesson.steps[1].text = { en: 'Only English', he: ' ' };
    lesson.guide = { en: 'y'.repeat(LESSON_LIMITS.why + 1), he: 'ל' };
    lesson.skill = { en: 'A skill line far longer than sixty characters, which a list cannot show', he: 'מיומנות' };
    expect(contentIssues(doc)).toEqual(
      expect.arrayContaining([
        'D-LESSON-01: steps.1.text needs English and Hebrew before it can be published',
        'D-LESSON-01: skill is longer than 60 characters',
        'D-LESSON-01: a lesson needs at least one "See it" picture',
        'D-LESSON-01: a lesson needs 3 to 6 steps',
        'D-LESSON-01: a lesson needs 2 to 4 self-check questions',
        'D-LESSON-01: guide ("Why it works") is longer than 400 characters',
        `D-LESSON-01: steps.0.text is longer than ${LESSON_LIMITS.step} characters`,
      ]),
    );
    // A draft (unpublished) lesson may be unfinished: only its structure is checked.
    lesson.published = false;
    expect(contentIssues(doc).filter((issue) => issue.startsWith('D-LESSON-01'))).toEqual([]);
  });

  it('presets only for their own tool and within its steps; the worksheet step needs a worksheet; no demonstration without steps', () => {
    const doc = content();
    const lesson = lessonOf(doc);
    lesson.steps![1].tool = { tool: 'value', label: { en: 'x', he: 'x' }, preset: { levels: 4 } };
    lesson.steps![2].tool = { tool: 'grid', label: { en: 'x', he: 'x' }, preset: { columns: 20 } };
    lesson.steps![0].tool = { tool: 'measure', label: { en: 'x', he: 'x' }, preset: { levels: 3 } };
    lesson.worksheet = { kind: 'none' };
    const plain = doc.exercises.find((e) => e.id === 'D-TEST-01')!;
    plain.checks = [{ en: 'A check', he: 'בדיקה' }];
    expect(contentIssues(doc)).toEqual(
      expect.arrayContaining([
        'D-LESSON-01: steps.1.tool: values (4) are for Study & Simplify only, one of 3, 5, 7, 9, 11, 13',
        'D-LESSON-01: steps.2.tool: columns (20) are for Create a Grid only, 1–16',
        'D-LESSON-01: steps.2.tool: a grid preset needs both columns and rows',
        'D-LESSON-01: steps.0.tool: values (3) are for Study & Simplify only, one of 3, 5, 7, 9, 11, 13',
        'D-LESSON-01: steps.3 offers the worksheet, but the lesson has none',
        "D-TEST-01: a demonstration or self-check needs the lesson's steps",
      ]),
    );
  });

  it('a challenge builds on lessons that exist, each once; a level belongs to course units only', () => {
    const doc = content();
    const challenge = doc.challenges.find((c) => c.id === 'CH-901')!;
    challenge.lessons = ['D-LESSON-01', 'D-LESSON-01', 'D-NONE-01'];
    doc.groups.find((g) => g.id === 'objects')!.level = 'beginner';
    expect(contentIssues(doc)).toEqual(
      expect.arrayContaining(['CH-901: a lesson is linked twice', 'CH-901: it builds on D-NONE-01, which is not in the content', 'group objects: a level belongs to course units only']),
    );
  });
});

describe('what learners receive', () => {
  const OPEN_TO_ALL: LearnViewer = {
    active: true,
    admin: false,
    modules: ['learn.curriculum', 'learn.color', 'learn.challenges'],
    offered: ['learn.curriculum', 'learn.color', 'learn.challenges'],
    access: { rules: { curriculum: { mode: 'all' }, color: { mode: 'all' }, challenges: { mode: 'all' } }, previews: 'title' },
  };

  it('an open lesson: its parts, by name only — anything else it carries, at any depth, never leaves the server', () => {
    const doc = content();
    const lesson = lessonOf(doc) as unknown as Record<string, unknown> & { steps: Record<string, unknown>[]; demo: Record<string, unknown>[]; checks: Record<string, unknown>[] };
    lesson.review = { hebrew: { by: 'reviewer', at: '2026-11-19' } };
    lesson.steps[1] = { ...lesson.steps[1], note: 'internal' };
    (lesson.steps[1].tool as Record<string, unknown>).secretPreset = 'internal';
    lesson.demo[0] = { ...lesson.demo[0], draftCaption: 'internal' };
    lesson.checks[0] = { ...lesson.checks[0], comment: 'internal' };
    (lesson.title as Record<string, unknown>).comment = 'internal';
    const item = itemsOf(doc).find((i) => i.id === 'D-LESSON-01')! as LearnItem;
    const sent = fullItem(item, new Map(), false) as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(
      ['checks', 'collection', 'demo', 'groupId', 'guide', 'id', 'instruction', 'kind', 'materials', 'minutes', 'mistake', 'objective', 'order', 'references', 'skill', 'steps', 'success', 'title', 'tools', 'worksheet'].sort(),
    );
    expect(JSON.stringify(sent)).not.toContain('internal');
    expect(JSON.stringify(sent)).not.toContain('reviewer');
    expect((sent.steps as unknown[])[1]).toEqual({ text: { en: 'Secret step two D-LESSON-01', he: 'שלב סודי ב D-LESSON-01' }, tool: { tool: 'value', label: { en: 'See three values', he: 'לראות שלושה ערכים' }, preset: { levels: 3 } } });
    // The optional baseline says so.
    expect(fullItem(itemsOf(doc).find((i) => i.id === 'D-BASE-01')!, new Map(), false)).toMatchObject({ optional: true });
    // A challenge: the lessons it builds on and its focus.
    const challenge = fullItem(itemsOf(doc).find((i) => i.id === 'CH-901')!, new Map(), false);
    expect(challenge).toMatchObject({ lessons: ['D-LESSON-01'], focus: { en: 'Secret focus CH-901' } });
  });

  it('a list row of a locked lesson: its title, skill line and place, never its steps, demonstration or checks', () => {
    const doc = content();
    const view = learnAccess({ ...OPEN_TO_ALL, access: { ...OPEN_TO_ALL.access, rules: { ...OPEN_TO_ALL.access.rules, curriculum: { mode: 'none' } } } }, doc);
    const item = itemsOf(doc).find((i) => i.id === 'D-LESSON-01')!;
    const row = listEntry(item, view.state(item.id), view.thumbnail(item.id), new Map(), false);
    expect(row).toEqual({
      id: 'D-LESSON-01',
      kind: 'exercise',
      collection: 'curriculum',
      groupId: 'shapes',
      order: 5,
      title: { en: 'Test lesson one', he: 'שיעור בדיקה one' },
      skill: { en: 'Skill line one', he: 'שורת מיומנות one' },
      lesson: true,
      open: false,
      lock: 'not_in_plan',
      thumbnailAssetId: null,
    });
    expect(JSON.stringify(row)).not.toContain('Secret');
    const baseline = itemsOf(doc).find((i) => i.id === 'D-BASE-01')!;
    expect(listEntry(baseline, view.state(baseline.id), false, new Map(), false)).toMatchObject({ optional: true, lesson: true });
    // A challenge row names the lessons it builds on (their IDs: the Skill filter), nothing of its prompt.
    const challenge = itemsOf(doc).find((i) => i.id === 'CH-901')!;
    expect(listEntry(challenge, view.state(challenge.id), false, new Map(), false)).toMatchObject({ lessons: ['D-LESSON-01'] });
  });
});

describe('rights records', () => {
  it('own work may have no source page; every other kind needs one', () => {
    expect(licenceIssues({ ...FIXTURE_LICENCE, source: null })).toEqual([]);
    expect(licenceIssues({ ...FIXTURE_LICENCE, kind: 'commissioned', source: null })).toEqual([]);
    expect(licenceIssues({ ...FIXTURE_LICENCE, kind: 'cc0', source: null, licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' })).toEqual(['licence.source: is required for this licence']);
    expect(licenceIssues({ ...FIXTURE_LICENCE, kind: 'public-domain', source: null })).toEqual(['licence.source: is required for this licence']);
  });
});

// ─── Rollback safety: M5 (ab42467) reads M6 content ──────────────────────────
// A frozen copy of M5's content schema (src/server/learn/content.ts at
// ab42467). Content written for M6 must stay readable by it: after a rollback
// to M5, Learn then shows plainer cards instead of refusing everything.

const Text = z.string().max(4000);
const M5Localized = z.object({ en: Text, he: Text }).passthrough();
const M5AssetRef = z.object({ assetId: z.string().regex(ASSET_ID), alt: M5Localized, credit: M5Localized.optional() }).passthrough();
const M5Tools = z.array(z.enum(TOOL_IDS)).max(TOOL_IDS.length);
const M5Order = z.number().int().min(0).max(100_000);
const M5_CONTENT = z
  .object({
    groups: z.array(z.object({ id: z.string().regex(GROUP_ID), collection: z.enum(LEARN_COLLECTIONS), order: M5Order, title: M5Localized, summary: M5Localized.optional() }).passthrough()).max(200),
    exercises: z
      .array(
        z
          .object({
            id: z.string().regex(EXERCISE_ID),
            collection: z.enum(['curriculum', 'color']),
            groupId: z.string().regex(GROUP_ID),
            order: M5Order,
            published: z.boolean(),
            title: M5Localized,
            objective: M5Localized,
            materials: M5Localized,
            instruction: M5Localized,
            guide: M5Localized.optional(),
            mistake: z.object({ mistake: M5Localized, fix: M5Localized }).passthrough(),
            success: M5Localized,
            references: z.array(M5AssetRef).max(20),
            worksheet: z.union([
              z.object({ kind: z.literal('none') }).passthrough(),
              z.object({ kind: z.literal('generated') }).passthrough(),
              z.object({ kind: z.literal('static'), assetId: z.string().regex(ASSET_ID) }).passthrough(),
            ]),
            tools: M5Tools,
          })
          .passthrough(),
      )
      .max(500),
    challenges: z
      .array(
        z
          .object({
            id: z.string().regex(CHALLENGE_ID),
            groupId: z.string().regex(GROUP_ID),
            order: M5Order,
            published: z.boolean(),
            title: M5Localized,
            prompt: M5Localized,
            level: z.enum(CHALLENGE_LEVELS),
            skill: M5Localized,
            skillArea: z.number().int().min(1).max(10),
            reference: z.enum(REFERENCE_KINDS),
            references: z.array(M5AssetRef).max(20),
            medium: z.enum(MEDIUMS),
            quick: z.boolean(),
            tools: M5Tools,
          })
          .passthrough(),
      )
      .max(1000),
  })
  .passthrough();

describe('rolling back to M5', () => {
  it('M5’s schema reads published M6 content (lessons, the baseline, challenge links, unit levels), every M5 field in place', async () => {
    const doc = await published();
    const read = M5_CONTENT.safeParse(doc);
    expect(read.success, read.success ? '' : JSON.stringify(read.error.issues.slice(0, 3))).toBe(true);
    // What M5 shows of a lesson is complete: its instruction, mistake and success are there.
    const lesson = lessonOf(doc);
    for (const text of [lesson.instruction, lesson.mistake.mistake, lesson.mistake.fix, lesson.success, lesson.objective]) {
      expect(text.en.trim()).not.toBe('');
      expect(text.he.trim()).not.toBe('');
    }
  });
});
