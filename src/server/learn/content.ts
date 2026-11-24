import 'server-only';
import type { Db } from 'mongodb';
import { z } from 'zod';
import { TOOL_IDS } from '@/lib/account';
import {
  ACCESS_LABELS,
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
  isAccessMode,
  isLesson,
  isPublicMode,
  itemImages,
  itemsOf,
  publishedFlagFor,
  type AccessMode,
  type LearnExercise,
  type ToolLink,
  type LearnContent,
  type LearnItem,
  type Localized,
} from '@/lib/learn/model';
import { collections } from '@/server/db/collections';
import { learnAssetsDir } from '@/server/env';
import { checkAssetFile, checkAssetSize, licenceIssues } from './assets';
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
// are kept as they are. A published item is never deleted, only archived, so
// every ID that progress, links and older access lists name stays valid.
//
// Since ADR-0023 every item carries its access mode (Free, Pro, Admin only,
// Blocked) and may be archived; Admin → Learn edits items in place, each save
// published at once as a new version (src/server/learn/editor.ts). The old
// `published` flag is kept in step (true only for a Free item that is not
// archived), so a release before modes never opens anything more widely.

const Text = z.string().max(4000);
const LocalizedSchema = z.object({ en: Text, he: Text }).passthrough();
const AssetRefSchema = z.object({ assetId: z.string().regex(ASSET_ID), alt: LocalizedSchema, credit: LocalizedSchema.optional() }).passthrough();
const Tools = z.array(z.enum(TOOL_IDS)).max(TOOL_IDS.length);
const Order = z.number().int().min(0).max(100_000);
/** Read tolerantly: a mode a newer release adds is kept, and counts as Blocked here (src/lib/learn/access.ts). */
const AccessField = z.string().min(1).max(40).optional();

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
    access: AccessField,
    archived: z.boolean().optional(),
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
    create: LocalizedSchema.optional(),
  })
  .passthrough();

const ChallengeSchema = z
  .object({
    id: z.string().regex(CHALLENGE_ID),
    groupId: z.string().regex(GROUP_ID),
    order: Order,
    published: z.boolean(),
    access: AccessField,
    archived: z.boolean().optional(),
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
    twist: LocalizedSchema.optional(),
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

/** The localized fields an item must have in both languages before learners see it (Free or Pro). */
function textFields(item: LearnItem): Field[] {
  const refs = item.references.flatMap((ref, i) => imageFields(`references.${i}`, ref));
  if (item.kind === 'challenge') return [['title', item.title], ['prompt', item.prompt], ['skill', item.skill], ...(item.focus ? [['focus', item.focus] as Field] : []), ...(item.twist ? [['twist', item.twist] as Field] : []), ...refs];
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
    ...(item.create ? [['create', item.create] as Field] : []),
  ];
}

/** The longest of an English and a Hebrew text, in characters. */
const longest = (text: Localized | undefined) => (text ? Math.max([...text.en].length, [...text.he].length) : 0);

/** How long a lesson's parts may be, so a lesson stays short on a phone (ADR-0020). */
export const LESSON_LIMITS = { skill: 60, objective: 120, caption: 160, step: 160, create: 140, focus: 140, why: 400 } as const;
/** A challenge's twist: one line, like its focus (ADR-0021). */
export const CHALLENGE_LIMITS = { twist: 140 } as const;

/** A lesson's task on paper: one to three short lines (ADR-0020). */
export const LESSON_TASK_LINES = { min: 1, max: 3 } as const;

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
  if (!isLesson(item) && (item.demo?.length || item.checks?.length || item.create)) issues.push(`${item.id}: a picture, self-check or creative line needs the lesson's task`);
  return issues;
}

/**
 * What a published lesson must have, and how long its parts may be
 * (ADR-0020): exactly one picture, a task of one to three lines, no
 * self-check questions (the lesson page no longer shows them), every part
 * short enough for a phone.
 */
function lessonPublishIssues(item: LearnExercise): string[] {
  const issues: string[] = [];
  const over = (field: string, text: Localized | undefined, limit: number) => {
    if (longest(text) > limit) issues.push(`${item.id}: ${field} is longer than ${limit} characters`);
  };
  over('skill', item.skill, LESSON_LIMITS.skill);
  if (!isLesson(item)) return issues;
  if (item.demo?.length !== 1) issues.push(`${item.id}: a lesson needs exactly one picture`);
  if (item.steps!.length > LESSON_TASK_LINES.max) issues.push(`${item.id}: a lesson's task has ${LESSON_TASK_LINES.min} to ${LESSON_TASK_LINES.max} lines`);
  if (item.checks?.length) issues.push(`${item.id}: self-check questions are no longer shown; remove them before publishing`);
  over('objective', item.objective, LESSON_LIMITS.objective);
  over('guide ("Why it works")', item.guide, LESSON_LIMITS.why);
  over('create', item.create, LESSON_LIMITS.create);
  (item.demo ?? []).forEach((frame, i) => over(`demo.${i}.caption`, frame.caption, LESSON_LIMITS.caption));
  item.steps!.forEach((step, i) => over(`steps.${i}.text`, step.text, LESSON_LIMITS.step));
  return issues;
}

/**
 * Whether learners may see an item, so it must be complete: Free or Pro and
 * not archived; an item written before modes, when published.
 */
export function seenByLearners(item: { published: boolean; access?: string; archived?: boolean }): boolean {
  if (item.archived) return false;
  return item.access === undefined ? item.published : isAccessMode(item.access) && isPublicMode(item.access);
}

/** A mode this release can write, and the old flag in step with it (ADR-0023). */
function modeIssues(item: { id: string; published: boolean; access?: string; archived?: boolean }): string[] {
  if (item.access === undefined) return item.archived && item.published ? [`${item.id}: an archived item cannot be published`] : [];
  if (!isAccessMode(item.access)) return [`${item.id}: its access (${item.access.slice(0, 40)}) is one this version of the app does not know`];
  const expected = publishedFlagFor(item.access, item.archived === true);
  return item.published === expected ? [] : [`${item.id}: published must be ${expected} for ${ACCESS_LABELS[item.access]}${item.archived ? ', archived' : ''}`];
}

/**
 * What an item still needs before learners may see it (Free or Pro): every
 * text in English and Hebrew, a lesson's one picture and short parts, a
 * challenge's short focus and twist, and its picture when it provides one.
 */
export function readinessIssues(item: LearnItem): string[] {
  const issues: string[] = [];
  for (const [field, text] of textFields(item)) if (!filled(text)) issues.push(`${item.id}: ${field} needs English and Hebrew before it can be Free or Pro`);
  if (item.kind === 'exercise') issues.push(...lessonPublishIssues(item));
  if (item.kind === 'challenge' && longest(item.focus) > LESSON_LIMITS.focus) issues.push(`${item.id}: focus is longer than ${LESSON_LIMITS.focus} characters`);
  if (item.kind === 'challenge' && longest(item.twist) > CHALLENGE_LIMITS.twist) issues.push(`${item.id}: twist is longer than ${CHALLENGE_LIMITS.twist} characters`);
  if (item.kind === 'challenge' && item.reference === 'provided' && item.references.length === 0) issues.push(`${item.id}: a challenge with a provided reference needs one`);
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
    issues.push(...modeIssues(item));
    if (seenByLearners(item)) issues.push(...readinessIssues(item));
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

/**
 * IDs that learners could see in some published version (published, or
 * Free or Pro), with their kind: they can never be deleted or change kind,
 * since progress and links name them. Archiving is how such an item goes.
 */
export async function everPublishedIds(db: Db): Promise<Map<string, 'exercise' | 'challenge'>> {
  const versions = await collections(db)
    .configVersions.find(
      { kind: 'learn_content', status: { $in: ['published', 'archived'] } },
      { projection: { 'document.exercises.id': 1, 'document.exercises.published': 1, 'document.exercises.access': 1, 'document.challenges.id': 1, 'document.challenges.published': 1, 'document.challenges.access': 1 } },
    )
    .toArray();
  const ids = new Map<string, 'exercise' | 'challenge'>();
  const seen = (item: { published?: unknown; access?: unknown }) => item.published === true || item.access === 'free' || item.access === 'pro';
  for (const version of versions) {
    const doc = version.document as { exercises?: { id?: unknown; published?: unknown; access?: unknown }[]; challenges?: { id?: unknown; published?: unknown; access?: unknown }[] } | null;
    for (const e of doc?.exercises ?? []) if (seen(e) && typeof e.id === 'string') ids.set(e.id, 'exercise');
    for (const c of doc?.challenges ?? []) if (seen(c) && typeof c.id === 'string') ids.set(c.id, 'challenge');
  }
  return ids;
}

/** Every ID any version ever held (drafts too): a new item never takes one, so no old link or history entry can point at it. */
export async function everUsedIds(db: Db): Promise<Set<string>> {
  const versions = await collections(db).configVersions.find({ kind: 'learn_content' }, { projection: { 'document.exercises.id': 1, 'document.challenges.id': 1 } }).toArray();
  const ids = new Set<string>();
  for (const version of versions) {
    const doc = version.document as { exercises?: { id?: unknown }[]; challenges?: { id?: unknown }[] } | null;
    for (const item of [...(doc?.exercises ?? []), ...(doc?.challenges ?? [])]) if (typeof item.id === 'string') ids.add(item.id);
  }
  return ids;
}

/**
 * What stops a document from being saved or published, given the database:
 * assets, their licences and files, and published IDs. Files of `trusted`
 * assets (those the live version already uses, checked byte for byte when
 * they went live) are checked by their size only, so a save that changes one
 * item does not read every file again.
 */
export async function contentIssuesWithDb(db: Db, content: LearnContent, options: { trusted?: ReadonlySet<string> } = {}): Promise<string[]> {
  const issues: string[] = [];
  const kinds = new Map(itemsOf(content).map((item) => [item.id, item.kind]));
  for (const [id, kind] of await everPublishedIds(db)) {
    const now = kinds.get(id);
    if (!now) issues.push(`${id} was published, so it cannot be removed (archive it instead)`);
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
      const file = options.trusted?.has(id) ? await checkAssetSize(dir, doc) : await checkAssetFile(dir, doc);
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
  changedKeys: (previous, next) => changedItemIds(previous, next),
  checkWithDb: async (db, content) => {
    // Assets the live version already uses were checked byte for byte when it went live.
    const live = await getPublished(db, learnContentSpec);
    const parsed = live ? LearnContentSchema.safeParse(live.document) : null;
    const trusted = new Set<string>();
    if (parsed?.success) {
      const used = assetIdsOf(parsed.data as LearnContent);
      for (const id of [...used.references, ...used.worksheets]) trusted.add(id);
    }
    return contentIssuesWithDb(db, content, { trusted });
  },
  // Going back never loses an ID: items added since (and any item learners
  // ever saw) are kept, archived. A version written before access modes
  // keeps each item's current mode, so restoring old text never changes who
  // may open it (ADR-0023).
  restoreDocument: async (db, content, version) => {
    const restored: LearnContent = structuredClone(content);
    const live = await getPublished(db, learnContentSpec);
    const parsedLive = live ? LearnContentSchema.safeParse(live.document) : null;
    const now = parsedLive?.success ? (parsedLive.data as LearnContent) : emptyContent();
    const nowById = new Map(itemsOf(now).map((item) => [item.id, item]));
    for (const item of [...restored.exercises, ...restored.challenges]) {
      const current = nowById.get(item.id);
      if (item.access === undefined && current?.access !== undefined) {
        item.access = current.access;
        item.published = publishedFlagFor(current.access, item.archived === true);
      }
    }
    const present = new Set(itemsOf(restored).map((item) => item.id));
    const kept: LearnItem[] = itemsOf(now).filter((item) => !present.has(item.id));
    const missingPublished = new Set([...(await everPublishedIds(db)).keys()].filter((id) => !present.has(id) && !nowById.has(id)));
    if (missingPublished.size > 0) kept.push(...(await latestCopies(db, missingPublished)).values());
    if (kept.length === 0) return { document: restored, note: `Restored from version ${version}` };
    const groupIds = new Set(restored.groups.map((g) => g.id));
    for (const item of kept) {
      if (!groupIds.has(item.groupId)) {
        const group = now.groups.find((g) => g.id === item.groupId) ?? (await latestGroup(db, item.groupId));
        if (group) {
          restored.groups.push(group);
          groupIds.add(group.id);
        }
      }
      const { kind, ...rest } = item;
      if (kind === 'exercise') restored.exercises.push({ ...(rest as LearnContent['exercises'][number]), published: false, archived: true });
      else {
        const { collection: _collection, ...challenge } = rest as LearnContent['challenges'][number] & { collection: 'challenges' };
        restored.challenges.push({ ...challenge, published: false, archived: true });
      }
    }
    return { document: restored, note: `Restored from version ${version}; kept, archived: ${kept.map((item) => item.id).sort().join(', ')}` };
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

/** An item's access as a change list says it: its mode, or for an item written before modes, its old state. */
const accessText = (item: LearnItem) =>
  item.access !== undefined ? (isAccessMode(item.access) ? ACCESS_LABELS[item.access] : item.access) : item.published ? 'published (old plan rules)' : 'unpublished (admins only)';

/** The fields of an item a change list names (its place, access and archive state are said separately). */
export function changedFields(was: LearnItem, now: LearnItem): string[] {
  return Object.keys({ ...was, ...now }).filter(
    (key) => !['published', 'order', 'kind', 'access', 'archived'].includes(key) && !sameJson((was as unknown as Record<string, unknown>)[key], (now as unknown as Record<string, unknown>)[key]),
  );
}

/** What publishing `next` would change compared with `live`, in words. */
export function describeContentChanges(live: LearnContent, next: LearnContent): string[] {
  const changes: string[] = [];
  const before = new Map(itemsOf(live).map((item) => [item.id, item]));
  const after = new Map(itemsOf(next).map((item) => [item.id, item]));
  // Places among the items that are in both and archived in neither: adding or archiving one moves nobody else.
  const common = new Set([...before.keys()].filter((id) => after.has(id) && !before.get(id)!.archived && !after.get(id)!.archived));
  const order = (content: LearnContent) =>
    new Map(LEARN_COLLECTIONS.flatMap((c) => itemsOf(content).filter((i) => i.collection === c && common.has(i.id)).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)).map((item, index) => [item.id, index + 1] as const)));
  const positionBefore = order(live);
  const positionAfter = order(next);
  for (const item of after.values()) {
    const was = before.get(item.id);
    if (!was) {
      changes.push(`Adds ${describeItem(item)}: ${accessText(item)}${item.archived ? ', archived' : ''}`);
      continue;
    }
    if (accessText(was) !== accessText(item)) changes.push(`${item.id}: access ${accessText(was)} → ${accessText(item)}`);
    if (!was.archived && item.archived) changes.push(`Archives ${item.id}: in the studio for nobody until it is restored`);
    if (was.archived && !item.archived) changes.push(`Restores ${item.id} from the archive`);
    const fields = changedFields(was, item);
    if (fields.length > 0) changes.push(`Changes ${item.id}: ${fields.join(', ')}`);
    if (common.has(item.id) && positionBefore.get(item.id) !== positionAfter.get(item.id)) changes.push(`Moves ${item.id} from position ${positionBefore.get(item.id)} to ${positionAfter.get(item.id)}`);
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

/**
 * The IDs of the items that differ between two documents: what a version
 * changed, for each item's history. A new number alone (others renumbered
 * around a move) does not count; the moved item is added by the editor.
 */
export function changedItemIds(live: LearnContent | null, next: LearnContent): string[] {
  const unordered = (item: LearnItem | undefined) => {
    if (!item) return undefined;
    const { order: _order, ...rest } = item;
    return rest;
  };
  const before = new Map(itemsOf(live ?? emptyContent()).map((item) => [item.id, item]));
  const after = new Map(itemsOf(next).map((item) => [item.id, item]));
  const ids = new Set<string>();
  for (const [id, item] of after) if (!sameJson(unordered(before.get(id)), unordered(item))) ids.add(id);
  for (const id of before.keys()) if (!after.has(id)) ids.add(id);
  return [...ids].sort();
}

/**
 * Give Learn versions published before item histories existed the item IDs
 * each changed (against the version live before it), once: what an item's
 * history lists (ADR-0023). Returns how many were given them.
 */
export async function backfillLearnHistory(db: Db): Promise<number> {
  const { configVersions } = collections(db);
  const filter = { kind: 'learn_content' as const, status: { $in: ['published' as const, 'archived' as const] } };
  if (!(await configVersions.findOne({ ...filter, items: { $exists: false } }, { projection: { _id: 1 } }))) return 0;
  let previous: LearnContent | null = null;
  let filled = 0;
  for await (const version of configVersions.find(filter, { sort: { version: 1 } })) {
    const parsed = LearnContentSchema.safeParse(version.document);
    const current = parsed.success ? (parsed.data as LearnContent) : null;
    if (version.items === undefined && current) {
      const { modifiedCount } = await configVersions.updateOne({ _id: version._id, items: { $exists: false } }, { $set: { items: changedItemIds(previous, current) } });
      filled += modifiedCount;
    }
    if (current) previous = current;
  }
  return filled;
}
