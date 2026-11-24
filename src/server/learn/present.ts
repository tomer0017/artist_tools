import 'server-only';
import type { Db } from 'mongodb';
import type { ItemState } from '@/lib/learn/access';
import { isLesson, isPublicMode, listPicture, type AccessMode, type AssetRef, type LearnItem, type LessonStep, type Localized, type ToolPreset, type WorksheetSpec } from '@/lib/learn/model';
import { collections, type LearnAssetDoc } from '@/server/db/collections';

// What the Learn routes send (ADR-0017). An open item: everything for its
// card. A locked item in a list: its ID, title, place and lock, and a
// thumbnail only where previews allow — never its instructions, guide or
// references. Built on the server from what the account may see, so locked
// content is absent from the response, not hidden in it.
//
// Content is read tolerantly (fields a newer release adds are kept), so an
// item is copied field by field, nested fields included: anything else it
// carries, such as a reviewer's note, never leaves the server (ADR-0018,
// ADR-0019).

export async function assetsFor(db: Db, ids: string[]): Promise<Map<string, LearnAssetDoc>> {
  if (ids.length === 0) return new Map();
  return new Map((await collections(db).learnAssets.find({ _id: { $in: [...new Set(ids)] } }).toArray()).map((doc) => [doc._id, doc]));
}

/** A text as learners receive it: its two languages, nothing else. */
const text = (value: Localized): Localized => ({ en: value.en, he: value.he });

/** A picture as learners receive it, with its thumbnail and size. */
function imageView(ref: AssetRef, assets: Map<string, LearnAssetDoc>) {
  const doc = assets.get(ref.assetId);
  return {
    assetId: ref.assetId,
    alt: text(ref.alt),
    ...(ref.credit ? { credit: text(ref.credit) } : {}),
    thumbnailAssetId: doc?.thumbnailAssetId ?? null,
    width: doc?.width ?? null,
    height: doc?.height ?? null,
  };
}

const worksheetView = (sheet: WorksheetSpec): WorksheetSpec => (sheet.kind === 'static' ? { kind: 'static', assetId: sheet.assetId } : { kind: sheet.kind });

const presetView = (preset: ToolPreset): ToolPreset => ({
  ...(preset.levels !== undefined ? { levels: preset.levels } : {}),
  ...(preset.squint !== undefined ? { squint: preset.squint } : {}),
  ...(preset.columns !== undefined ? { columns: preset.columns } : {}),
  ...(preset.rows !== undefined ? { rows: preset.rows } : {}),
});

function stepView(step: LessonStep, assets: Map<string, LearnAssetDoc>) {
  return {
    text: text(step.text),
    ...(step.image ? { image: imageView(step.image, assets) } : {}),
    ...(step.tool ? { tool: { tool: step.tool.tool, label: text(step.tool.label), ...(step.tool.preset ? { preset: presetView(step.tool.preset) } : {}) } } : {}),
    ...(step.worksheet ? { worksheet: true } : {}),
  };
}

/**
 * What admins are told of an item's access (ADR-0023): its mode, and
 * `published` as the course reads it (seen by learners: Free or Pro, not
 * archived), so an admin's course has the numbers learners see.
 */
const adminFields = (item: LearnItem, mode: AccessMode | null) => ({
  // An item without a mode of its own (written before modes) keeps its old flag, as before.
  published: mode && item.access !== undefined ? isPublicMode(mode) && !item.archived : item.published && !item.archived,
  ...(mode ? { access: mode } : {}),
  ...(item.archived ? { archived: true } : {}),
});

/** The whole item for an account that may open it: its known fields, its pictures with their thumbnails and sizes. */
export function fullItem(item: LearnItem, assets: Map<string, LearnAssetDoc>, admin: boolean, mode: AccessMode | null = null) {
  const common = {
    id: item.id,
    kind: item.kind,
    collection: item.collection,
    groupId: item.groupId,
    order: item.order,
    title: text(item.title),
    ...(admin ? adminFields(item, mode) : {}),
    references: item.references.map((ref) => imageView(ref, assets)),
    tools: [...item.tools],
  };
  if (item.kind === 'challenge') {
    return {
      ...common,
      prompt: text(item.prompt),
      level: item.level,
      skill: text(item.skill),
      skillArea: item.skillArea,
      reference: item.reference,
      medium: item.medium,
      quick: item.quick,
      ...(item.lessons ? { lessons: [...item.lessons] } : {}),
      ...(item.focus ? { focus: text(item.focus) } : {}),
      ...(item.twist ? { twist: text(item.twist) } : {}),
    };
  }
  return {
    ...common,
    objective: text(item.objective),
    materials: text(item.materials),
    instruction: text(item.instruction),
    ...(item.guide ? { guide: text(item.guide) } : {}),
    mistake: { mistake: text(item.mistake.mistake), fix: text(item.mistake.fix), ...(item.mistake.image ? { image: imageView(item.mistake.image, assets) } : {}) },
    success: text(item.success),
    worksheet: worksheetView(item.worksheet),
    ...(item.optional ? { optional: true } : {}),
    ...(item.skill ? { skill: text(item.skill) } : {}),
    ...(item.minutes !== undefined ? { minutes: item.minutes } : {}),
    ...(item.demo ? { demo: item.demo.map((frame) => ({ image: imageView(frame.image, assets), caption: text(frame.caption) })) } : {}),
    ...(item.steps ? { steps: item.steps.map((step) => stepView(step, assets)) } : {}),
    ...(item.checks ? { checks: item.checks.map(text) } : {}),
    ...(item.create ? { create: text(item.create) } : {}),
  };
}

/**
 * One row of a list: open or locked, with a thumbnail only when allowed (a
 * lesson's first demonstration frame, or the first reference). What lists may
 * show of any item, locked ones included (docs/learn/05 §5): its title and
 * place, a challenge's level and the lessons it builds on, a lesson's skill
 * line and whether it is optional.
 */
export function listEntry(item: LearnItem, state: ItemState, thumbnail: boolean, assets: Map<string, LearnAssetDoc>, admin: boolean, mode: AccessMode | null = null) {
  const picture = listPicture(item);
  return {
    id: item.id,
    kind: item.kind,
    collection: item.collection,
    groupId: item.groupId,
    order: item.order,
    title: text(item.title),
    ...(item.kind === 'challenge'
      ? { level: item.level, quick: item.quick, medium: item.medium, reference: item.reference, ...(item.lessons ? { lessons: [...item.lessons] } : {}) }
      : { ...(item.optional ? { optional: true } : {}), ...(item.skill ? { skill: text(item.skill) } : {}), ...(isLesson(item) ? { lesson: true } : {}) }),
    ...(admin ? adminFields(item, mode) : {}),
    open: state.status === 'open',
    lock: state.status === 'locked' ? state.reason : null,
    thumbnailAssetId: thumbnail && picture ? (assets.get(picture.assetId)?.thumbnailAssetId ?? null) : null,
  };
}
