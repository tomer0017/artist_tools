import 'server-only';
import type { Db } from 'mongodb';
import { z } from 'zod';
import { TOOL_IDS } from '@/lib/account';
import { PLAN_IDS, PLAN_NAMES, type PlanId } from '@/lib/plans';
import {
  ASSET_ID,
  CHALLENGE_ID,
  CHALLENGE_LEVELS,
  COLLECTION_LABELS,
  EXERCISE_ID,
  GRID_DIVISIONS,
  GROUP_ID,
  LEARN_COLLECTIONS,
  MEDIUMS,
  REFERENCE_KINDS,
  STUDY_LEVELS,
  UNIT_LEVELS,
  collectionOfId,
  emptyContent,
  isLesson,
  itemImages,
  itemsOf,
  type LearnExercise,
  type ToolLink,
  type LearnContent,
  type LearnItem,
  type LearnRules,
  type Localized,
} from '@/lib/learn/model';
import { collections } from '@/server/db/collections';
import { learnAssetsDir } from '@/server/env';
import { checkAssetFile, licenceIssues } from './assets';
import { getPublished, publishedDocument, type ConfigSpec } from '@/server/config/versions';

// ─── Learn content: one versioned document (kind `learn_content`, ADR-0017) ───
// Exercises and challenges with their groups, in English and Hebrew, drafted
// and published like the plan catalog (ADR-0006): history, diff and restore
// come with it. Never committed to the repository, which is public: it is
// imported from a file kept elsewhere (`npm run db -- learn-import`) and
// lives in the database, backed up with it. Who may open what is the plan
// catalog's Learn section, decided by src/lib/learn/access.ts.
//
// Read tolerantly, like the catalog (ADR-0014): fields a newer release added
// are kept as they are. A published item is never deleted, only unpublished,
// so every ID an access list names stays valid.

const Text = z.string().max(4000);
const LocalizedSchema = z.object({ en: Text, he: Text }).passthrough();
const AssetRefSchema = z.object({ assetId: z.string().regex(ASSET_ID), alt: LocalizedSchema, credit: LocalizedSchema.optional() }).passthrough();
const Tools = z.array(z.enum(TOOL_IDS)).max(TOOL_IDS.length);
const Order = z.number().int().min(0).max(100_000);

const GroupSchema = z
  .object({ id: z.string().regex(GROUP_ID), collection: z.enum(LEARN_COLLECTIONS), order: Order, title: LocalizedSchema, summary: LocalizedSchema.optional(), level: z.enum(UNIT_LEVELS).optional() })
  .passthrough();

const WorksheetSchema = z.union([
  z.object({ kind: z.literal('none') }).passthrough(),
  z.object({ kind: z.literal('generated') }).passthrough(),
  z.object({ kind: z.literal('static'), assetId: z.string().regex(ASSET_ID) }).passthrough(),
]);

// Lessons (ADR-0019): additions only, every one optional, so content written
// for M6 is still read by M5 (which keeps unknown fields and ignores them).
const ToolPresetSchema = z.object({ levels: z.number().int().optional(), squint: z.boolean().optional(), columns: z.number().int().optional(), rows: z.number().int().optional() }).passthrough();
const ToolLinkSchema = z.object({ tool: z.enum(TOOL_IDS), label: LocalizedSchema, preset: ToolPresetSchema.optional() }).passthrough();
const DemoFrameSchema = z.object({ image: AssetRefSchema, caption: LocalizedSchema }).passthrough();
const StepSchema = z.object({ text: LocalizedSchema, image: AssetRefSchema.optional(), tool: ToolLinkSchema.optional(), worksheet: z.boolean().optional() }).passthrough();

const ExerciseSchema = z
  .object({
    id: z.string().regex(EXERCISE_ID),
    collection: z.enum(['curriculum', 'color']),
    groupId: z.string().regex(GROUP_ID),
    order: Order,
    published: z.boolean(),
    title: LocalizedSchema,
    objective: LocalizedSchema,
    materials: LocalizedSchema,
    instruction: LocalizedSchema,
    guide: LocalizedSchema.optional(),
    mistake: z.object({ mistake: LocalizedSchema, fix: LocalizedSchema, image: AssetRefSchema.optional() }).passthrough(),
    success: LocalizedSchema,
    references: z.array(AssetRefSchema).max(20),
    worksheet: WorksheetSchema,
    tools: Tools,
    optional: z.boolean().optional(),
    skill: LocalizedSchema.optional(),
    minutes: z.number().int().min(5).max(120).optional(),
    demo: z.array(DemoFrameSchema).max(6).optional(),
    steps: z.array(StepSchema).max(6).optional(),
    checks: z.array(LocalizedSchema).max(4).optional(),
  })
  .passthrough();

const ChallengeSchema = z
  .object({
    id: z.string().regex(CHALLENGE_ID),
    groupId: z.string().regex(GROUP_ID),
    order: Order,
    published: z.boolean(),
    title: LocalizedSchema,
    prompt: LocalizedSchema,
    level: z.enum(CHALLENGE_LEVELS),
    skill: LocalizedSchema,
    skillArea: z.number().int().min(1).max(10),
    reference: z.enum(REFERENCE_KINDS),
    references: z.array(AssetRefSchema).max(20),
    medium: z.enum(MEDIUMS),
    quick: z.boolean(),
    tools: Tools,
    lessons: z.array(z.string().regex(EXERCISE_ID)).max(3).optional(),
    focus: LocalizedSchema.optional(),
  })
  .passthrough();

export const LearnContentSchema = z
  .object({
    groups: z.array(GroupSchema).max(200),
    exercises: z.array(ExerciseSchema).max(500),
    challenges: z.array(ChallengeSchema).max(1000),
  })
  .passthrough();

const filled = (text: Localized | undefined) => Boolean(text && text.en.trim() && text.he.trim());

type Field = [string, Localized | undefined];

/** A picture's alternative text and credit. */
const imageFields = (at: string, ref: { alt: Localized; credit?: Localized }): Field[] => [[`${at}.alt`, ref.alt], ...(ref.credit ? [[`${at}.credit`, ref.credit] as Field] : [])];

/** The localized fields an item must have in both languages before it can be published. */
function textFields(item: LearnItem): Field[] {
  const refs = item.references.flatMap((ref, i) => imageFields(`references.${i}`, ref));
  if (item.kind === 'challenge') return [['title', item.title], ['prompt', item.prompt], ['skill', item.skill], ...(item.focus ? [['focus', item.focus] as Field] : []), ...refs];
  return [
    ['title', item.title],
    ['objective', item.objective],
    ['materials', item.materials],
    ['instruction', item.instruction],
    ...(item.guide ? [['guide', item.guide] as Field] : []),
    ['mistake.mistake', item.mistake.mistake],
    ['mistake.fix', item.mistake.fix],
    ...(item.mistake.image ? imageFields('mistake.image', item.mistake.image) : []),
    ['success', item.success],
    ...refs,
    ...(item.skill ? [['skill', item.skill] as Field] : []),
    ...(item.demo ?? []).flatMap((frame, i): Field[] => [[`demo.${i}.caption`, frame.caption], ...imageFields(`demo.${i}.image`, frame.image)]),
    ...(item.steps ?? []).flatMap((step, i): Field[] => [
      [`steps.${i}.text`, step.text],
      ...(step.image ? imageFields(`steps.${i}.image`, step.image) : []),
      ...(step.tool ? [[`steps.${i}.tool.label`, step.tool.label] as Field] : []),
    ]),
    ...(item.checks ?? []).map((check, i): Field => [`checks.${i}`, check]),
  ];
}

/** The longest of an English and a Hebrew text, in characters. */
const longest = (text: Localized | undefined) => (text ? Math.max([...text.en].length, [...text.he].length) : 0);

/** How long a lesson's parts may be, so a lesson stays short on a phone (docs/learn/08 §3.1). */
export const LESSON_LIMITS = { skill: 60, caption: 160, step: 220, check: 140, focus: 140, why: 400 } as const;

/** What is wrong with a tool link's preset: Study's values, or Create a Grid's columns and rows, each only for its own tool. */
function presetIssues(at: string, link: ToolLink): string[] {
  const preset = link.preset;
  if (!preset) return [];
  const issues: string[] = [];
  if (preset.levels !== undefined && (link.tool !== 'value' || !(STUDY_LEVELS as readonly number[]).includes(preset.levels))) {
    issues.push(`${at}: values (${preset.levels}) are for Study & Simplify only, one of ${STUDY_LEVELS.join(', ')}`);
  }
  if (preset.squint !== undefined && (link.tool !== 'value' || preset.levels === undefined)) issues.push(`${at}: Squint is for Study & Simplify's values only`);
  for (const key of ['columns', 'rows'] as const) {
    const value = preset[key];
    if (value !== undefined && (link.tool !== 'grid' || value < GRID_DIVISIONS.min || value > GRID_DIVISIONS.max)) {
      issues.push(`${at}: ${key} (${value}) are for Create a Grid only, ${GRID_DIVISIONS.min}–${GRID_DIVISIONS.max}`);
    }
  }
  if (link.tool === 'grid' && (preset.columns === undefined) !== (preset.rows === undefined)) issues.push(`${at}: a grid preset needs both columns and rows`);
  return issues;
}

/** A lesson's structure (ADR-0019): checked for every item, published or not. */
function lessonStructureIssues(item: LearnExercise): string[] {
  const issues: string[] = [];
  for (const [i, step] of (item.steps ?? []).entries()) {
    if (step.tool) issues.push(...presetIssues(`${item.id}: steps.${i}.tool`, step.tool));
    if (step.worksheet && item.worksheet.kind === 'none') issues.push(`${item.id}: steps.${i} offers the worksheet, but the lesson has none`);
  }
  if (!isLesson(item) && (item.demo?.length || item.checks?.length)) issues.push(`${item.id}: a demonstration or self-check needs the lesson's steps`);
  return issues;
}

/** What a published lesson must have, and how long its parts may be (docs/learn/08 §3.1). */
function lessonPublishIssues(item: LearnExercise): string[] {
  const issues: string[] = [];
  const over = (field: string, text: Localized | undefined, limit: number) => {
    if (longest(text) > limit) issues.push(`${item.id}: ${field} is longer than ${limit} characters`);
  };
  over('skill', item.skill, LESSON_LIMITS.skill);
  if (!isLesson(item)) return issues;
  if (!item.demo?.length) issues.push(`${item.id}: a lesson needs at least one "See it" picture`);
  if (item.steps!.length < 3) issues.push(`${item.id}: a lesson needs 3 to 6 steps`);
  if ((item.checks?.length ?? 0) < 2) issues.push(`${item.id}: a lesson needs 2 to 4 self-check questions`);
  over('guide ("Why it works")', item.guide, LESSON_LIMITS.why);
  (item.demo ?? []).forEach((frame, i) => over(`demo.${i}.caption`, frame.caption, LESSON_LIMITS.caption));
  item.steps!.forEach((step, i) => over(`steps.${i}.text`, step.text, LESSON_LIMITS.step));
  (item.checks ?? []).forEach((check, i) => over(`checks.${i}`, check, LESSON_LIMITS.check));
  return issues;
}

/** What stops a content document from being saved, from the document alone. */
export function contentIssues(content: LearnContent): string[] {
  const issues: string[] = [];
  const groups = new Map<string, LearnContent['groups'][number]>();
  for (const group of content.groups) {
    if (groups.has(group.id)) issues.push(`group ${group.id} is listed twice`);
    groups.set(group.id, group);
  }
  const seen = new Set<string>();
  for (const item of itemsOf(content)) {
    if (seen.has(item.id)) issues.push(`${item.id} is listed twice`);
    seen.add(item.id);
    if (item.kind === 'exercise' && collectionOfId(item.id) !== item.collection) issues.push(`${item.id}: its ID says ${COLLECTION_LABELS[collectionOfId(item.id) ?? 'curriculum']}, its collection says ${COLLECTION_LABELS[item.collection]}`);
    const group = groups.get(item.groupId);
    if (!group) issues.push(`${item.id}: group ${item.groupId} does not exist`);
    else if (group.collection !== item.collection) issues.push(`${item.id}: group ${item.groupId} belongs to the ${COLLECTION_LABELS[group.collection]}`);
    if (new Set(item.tools).size !== item.tools.length) issues.push(`${item.id}: a tool is listed twice`);
    if (item.kind === 'exercise') issues.push(...lessonStructureIssues(item));
    if (item.kind === 'challenge' && item.lessons) {
      if (new Set(item.lessons).size !== item.lessons.length) issues.push(`${item.id}: a lesson is linked twice`);
      for (const lesson of item.lessons) if (!content.exercises.some((exercise) => exercise.id === lesson)) issues.push(`${item.id}: it builds on ${lesson}, which is not in the content`);
    }
    if (!item.published) continue;
    for (const [field, text] of textFields(item)) if (!filled(text)) issues.push(`${item.id}: ${field} needs English and Hebrew before it can be published`);
    if (item.kind === 'exercise') issues.push(...lessonPublishIssues(item));
    if (item.kind === 'challenge' && longest(item.focus) > LESSON_LIMITS.focus) issues.push(`${item.id}: focus is longer than ${LESSON_LIMITS.focus} characters`);
    if (item.kind === 'challenge' && item.reference === 'provided' && item.references.length === 0) issues.push(`${item.id}: a challenge with a provided reference needs one`);
  }
  for (const group of content.groups) {
    if (!filled(group.title)) issues.push(`group ${group.id}: its title needs English and Hebrew`);
    if (group.summary && !filled(group.summary)) issues.push(`group ${group.id}: its summary needs English and Hebrew`);
    if (group.level && group.collection === 'challenges') issues.push(`group ${group.id}: a level belongs to course units only`);
  }
  return issues;
}

/** Every asset a content document uses: pictures (references, and a lesson's demonstration, step and mistake pictures) and static worksheets. */
export function assetIdsOf(content: LearnContent): { references: Set<string>; worksheets: Set<string> } {
  const references = new Set<string>();
  const worksheets = new Set<string>();
  for (const item of itemsOf(content)) {
    for (const ref of itemImages(item)) references.add(ref.assetId);
    if (item.kind === 'exercise' && item.worksheet.kind === 'static') worksheets.add(item.worksheet.assetId);
  }
  return { references, worksheets };
}

/** IDs that were published in some published version, with their kind: they can never be deleted or change kind. */
export async function everPublishedIds(db: Db): Promise<Map<string, 'exercise' | 'challenge'>> {
  const versions = await collections(db)
    .configVersions.find({ kind: 'learn_content', status: { $in: ['published', 'archived'] } }, { projection: { 'document.exercises.id': 1, 'document.exercises.published': 1, 'document.challenges.id': 1, 'document.challenges.published': 1 } })
    .toArray();
  const ids = new Map<string, 'exercise' | 'challenge'>();
  for (const version of versions) {
    const doc = version.document as { exercises?: { id?: unknown; published?: unknown }[]; challenges?: { id?: unknown; published?: unknown }[] } | null;
    for (const e of doc?.exercises ?? []) if (e.published === true && typeof e.id === 'string') ids.set(e.id, 'exercise');
    for (const c of doc?.challenges ?? []) if (c.published === true && typeof c.id === 'string') ids.set(c.id, 'challenge');
  }
  return ids;
}

/** What stops a document from being saved or published, given the database: assets, their licences and files, and published IDs. */
export async function contentIssuesWithDb(db: Db, content: LearnContent): Promise<string[]> {
  const issues: string[] = [];
  const kinds = new Map(itemsOf(content).map((item) => [item.id, item.kind]));
  for (const [id, kind] of await everPublishedIds(db)) {
    const now = kinds.get(id);
    if (!now) issues.push(`${id} was published, so it cannot be removed (unpublish it instead)`);
    else if (now !== kind) issues.push(`${id} was published as ${kind === 'exercise' ? 'an exercise' : 'a challenge'}, so it cannot change kind`);
  }
  const { references, worksheets } = assetIdsOf(content);
  const wanted = [...new Set([...references, ...worksheets])];
  if (wanted.length === 0) return issues;
  const docs = new Map((await collections(db).learnAssets.find({ _id: { $in: wanted } }).toArray()).map((doc) => [doc._id, doc]));
  const dir = learnAssetsDir();
  if (!dir) issues.push('the asset directory is not set up (LEARN_ASSETS_DIR), so the references cannot be checked');
  for (const id of wanted) {
    const doc = docs.get(id);
    const short = id.slice(0, 12);
    if (!doc) {
      issues.push(`asset ${short}… does not exist`);
      continue;
    }
    if (references.has(id) && doc.role !== 'reference') issues.push(`asset ${short}… is not a reference image`);
    if (worksheets.has(id) && doc.role !== 'worksheet') issues.push(`asset ${short}… is not a static worksheet (a PDF)`);
    for (const issue of licenceIssues(doc.licence)) issues.push(`asset ${short}…: ${issue}`);
    if (dir) {
      const file = await checkAssetFile(dir, doc);
      if (file !== 'ok') issues.push(`asset ${short}…: its file is ${file === 'missing' ? 'missing' : 'not the one recorded'}`);
    }
  }
  return issues;
}

/** The latest published or archived copy of each item, for a restore that must keep published IDs. */
async function latestCopies(db: Db, ids: Set<string>): Promise<Map<string, LearnItem>> {
  const found = new Map<string, LearnItem>();
  const versions = collections(db).configVersions.find({ kind: 'learn_content', status: { $in: ['published', 'archived'] } }, { sort: { version: -1 } });
  for await (const version of versions) {
    const parsed = LearnContentSchema.safeParse(version.document);
    if (!parsed.success) continue;
    for (const item of itemsOf(parsed.data as LearnContent)) if (ids.has(item.id) && !found.has(item.id)) found.set(item.id, item);
    if (found.size === ids.size) break;
  }
  return found;
}

export const learnContentSpec: ConfigSpec<LearnContent> = {
  kind: 'learn_content',
  schema: LearnContentSchema as unknown as z.ZodType<LearnContent>,
  defaults: emptyContent,
  check: contentIssues,
  checkWithDb: (db, content) => contentIssuesWithDb(db, content),
  // Going back keeps every item published since, unpublished: a published ID is never deleted.
  restoreDocument: async (db, content, version) => {
    const present = new Set(itemsOf(content).map((item) => item.id));
    const missing = new Set([...(await everPublishedIds(db)).keys()].filter((id) => !present.has(id)));
    if (missing.size === 0) return { document: content, note: `Restored from version ${version}` };
    const copies = await latestCopies(db, missing);
    const restored: LearnContent = structuredClone(content);
    const groupIds = new Set(restored.groups.map((g) => g.id));
    for (const item of copies.values()) {
      if (!groupIds.has(item.groupId)) {
        const group = (await latestGroup(db, item.groupId)) ?? null;
        if (group) {
          restored.groups.push(group);
          groupIds.add(group.id);
        }
      }
      const { kind, ...rest } = item;
      if (kind === 'exercise') restored.exercises.push({ ...(rest as LearnContent['exercises'][number]), published: false });
      else {
        const { collection: _collection, ...challenge } = rest as LearnContent['challenges'][number] & { collection: 'challenges' };
        restored.challenges.push({ ...challenge, published: false });
      }
    }
    return { document: restored, note: `Restored from version ${version}; kept unpublished: ${[...copies.keys()].sort().join(', ')}` };
  },
};

async function latestGroup(db: Db, groupId: string): Promise<LearnContent['groups'][number] | null> {
  const versions = collections(db).configVersions.find({ kind: 'learn_content', status: { $in: ['published', 'archived'] } }, { sort: { version: -1 } });
  for await (const version of versions) {
    const parsed = LearnContentSchema.safeParse(version.document);
    const group = parsed.success ? (parsed.data as LearnContent).groups.find((g) => g.id === groupId) : undefined;
    if (group) return group;
  }
  return null;
}

/**
 * The published content, or none when nothing was ever published. A
 * published version this release cannot read throws (UnreadableConfigError):
 * every Learn route then refuses, never falls back to anything else.
 */
export async function publishedLearnContent(db: Db): Promise<LearnContent> {
  return publishedDocument(db, learnContentSpec);
}

/** The published version's number, or null. */
export async function publishedContentVersion(db: Db): Promise<number | null> {
  return (await getPublished(db, learnContentSpec))?.version ?? null;
}

const describeItem = (item: LearnItem) => `${item.id} (${COLLECTION_LABELS[item.collection]})`;
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * What publishing `next` would change compared with `live`, in words, with
 * a warning for every item it unpublishes that a plan's live list names.
 */
export function describeContentChanges(live: LearnContent, next: LearnContent, liveRules: Partial<Record<PlanId, LearnRules>> = {}): string[] {
  const changes: string[] = [];
  const before = new Map(itemsOf(live).map((item) => [item.id, item]));
  const after = new Map(itemsOf(next).map((item) => [item.id, item]));
  const order = (content: LearnContent) => new Map(LEARN_COLLECTIONS.flatMap((c) => itemsOf(content).filter((i) => i.collection === c).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)).map((item, index) => [item.id, index + 1] as const)));
  const positionBefore = order(live);
  const positionAfter = order(next);
  for (const item of after.values()) {
    const was = before.get(item.id);
    if (!was) {
      changes.push(`Adds ${describeItem(item)}${item.published ? ', published' : ', unpublished (admins only)'}`);
      continue;
    }
    if (!was.published && item.published) changes.push(`Publishes ${item.id}`);
    if (was.published && !item.published) {
      changes.push(`Unpublishes ${item.id}: hidden from everyone but admins`);
      for (const planId of PLAN_IDS) {
        const rule = liveRules[planId]?.[item.collection];
        if (rule?.mode === 'selected' && rule.items.includes(item.id)) {
          changes.push(`Warning: ${PLAN_NAMES[planId]}'s ${COLLECTION_LABELS[item.collection]} list names ${item.id}; ${PLAN_NAMES[planId]} loses it until it is published again`);
        }
      }
    }
    const fields = Object.keys({ ...was, ...item }).filter((key) => !['published', 'order', 'kind'].includes(key) && !sameJson((was as unknown as Record<string, unknown>)[key], (item as unknown as Record<string, unknown>)[key]));
    if (fields.length > 0) changes.push(`Changes ${item.id}: ${fields.join(', ')}`);
    if (positionBefore.get(item.id) !== positionAfter.get(item.id)) changes.push(`Moves ${item.id} from position ${positionBefore.get(item.id)} to ${positionAfter.get(item.id)} (access lists do not change)`);
  }
  for (const item of before.values()) if (!after.has(item.id)) changes.push(`Removes ${describeItem(item)}`);
  const groupsBefore = new Map(live.groups.map((g) => [g.id, g]));
  for (const group of next.groups) {
    const was = groupsBefore.get(group.id);
    if (!was) changes.push(`Adds the group ${group.id} (${COLLECTION_LABELS[group.collection]})`);
    else if (!sameJson(was, group)) changes.push(`Changes the group ${group.id}`);
  }
  for (const group of live.groups) if (!next.groups.some((g) => g.id === group.id)) changes.push(`Removes the group ${group.id}`);
  return changes;
}
