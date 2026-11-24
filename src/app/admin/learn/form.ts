import type { ToolId } from '@/lib/account';
import type { AccessMode, AssetRef, CHALLENGE_LEVELS, LearnChallenge, LearnCollection, LearnExercise, LearnItem, MEDIUMS, REFERENCE_KINDS } from '@/lib/learn/model';

// Admin → Learn's form (ADR-0023): an item as the editor shows it, and back
// to the fields the server takes (src/server/learn/editor.ts). Pure, so that
// opening an item and saving it unchanged is tested to change nothing
// (src/server/learn/editor.test.ts, and on real content with lab tools).

export type Loc = { en: string; he: string };
export const EMPTY: Loc = { en: '', he: '' };

export interface PictureForm {
  assetId: string;
  alt: Loc;
  credit: Loc;
  thumbnailAssetId: string | null;
  /** A local preview of a picture just uploaded. */
  previewUrl?: string;
}

/** What the editor knows of a picture's file (its thumbnail). */
export interface PictureInfo {
  thumbnailAssetId: string | null;
}

export interface StepForm {
  text: Loc;
  image: PictureForm | null;
  tool: ToolId | '';
  toolLabel: Loc;
  levels: string;
  squint: boolean;
  columns: string;
  rows: string;
  worksheet: boolean;
}

export interface ExerciseForm {
  kind: 'exercise';
  collection: 'curriculum' | 'color';
  groupId: string;
  access: AccessMode;
  title: Loc;
  skill: Loc;
  optional: boolean;
  minutes: string;
  objective: Loc;
  demo: { image: PictureForm; caption: Loc }[];
  steps: StepForm[];
  create: Loc;
  success: Loc;
  instruction: Loc;
  guide: Loc;
  mistake: Loc;
  fix: Loc;
  mistakeImage: PictureForm | null;
  materials: Loc;
  references: PictureForm[];
  worksheet: { kind: 'none' } | { kind: 'generated' } | { kind: 'static'; assetId: string; name?: string };
  tools: ToolId[];
}

export interface ChallengeForm {
  kind: 'challenge';
  groupId: string;
  access: AccessMode;
  title: Loc;
  prompt: Loc;
  focus: Loc;
  twist: Loc;
  skill: Loc;
  skillArea: number;
  level: (typeof CHALLENGE_LEVELS)[number];
  quick: boolean;
  medium: (typeof MEDIUMS)[number];
  reference: (typeof REFERENCE_KINDS)[number];
  references: PictureForm[];
  lessons: string[];
  tools: ToolId[];
}

export type Form = ExerciseForm | ChallengeForm;

const loc = (value: { en?: string; he?: string } | undefined): Loc => ({ en: value?.en ?? '', he: value?.he ?? '' });
const picture = (ref: AssetRef, images: Record<string, PictureInfo>): PictureForm => ({ assetId: ref.assetId, alt: loc(ref.alt), credit: loc(ref.credit), thumbnailAssetId: images[ref.assetId]?.thumbnailAssetId ?? null });
const pictureRef = (p: PictureForm) => ({ assetId: p.assetId, alt: p.alt, ...(p.credit.en.trim() || p.credit.he.trim() ? { credit: p.credit } : {}) });

export function formOf(item: LearnItem, images: Record<string, PictureInfo>, access: AccessMode): Form {
  if (item.kind === 'challenge') {
    const c = item as LearnChallenge & { kind: 'challenge' };
    return {
      kind: 'challenge',
      groupId: c.groupId,
      access,
      title: loc(c.title),
      prompt: loc(c.prompt),
      focus: loc(c.focus),
      twist: loc(c.twist),
      skill: loc(c.skill),
      skillArea: c.skillArea,
      level: c.level,
      quick: c.quick,
      medium: c.medium,
      reference: c.reference,
      references: c.references.map((r) => picture(r, images)),
      lessons: [...(c.lessons ?? [])],
      tools: [...c.tools],
    };
  }
  const e = item as LearnExercise & { kind: 'exercise' };
  return {
    kind: 'exercise',
    collection: e.collection,
    groupId: e.groupId,
    access,
    title: loc(e.title),
    skill: loc(e.skill),
    optional: e.optional === true,
    minutes: e.minutes !== undefined ? String(e.minutes) : '',
    objective: loc(e.objective),
    demo: (e.demo ?? []).map((frame) => ({ image: picture(frame.image, images), caption: loc(frame.caption) })),
    steps: (e.steps ?? []).map((step) => ({
      text: loc(step.text),
      image: step.image ? picture(step.image, images) : null,
      tool: step.tool?.tool ?? '',
      toolLabel: loc(step.tool?.label),
      levels: step.tool?.preset?.levels !== undefined ? String(step.tool.preset.levels) : '',
      squint: step.tool?.preset?.squint === true,
      columns: step.tool?.preset?.columns !== undefined ? String(step.tool.preset.columns) : '',
      rows: step.tool?.preset?.rows !== undefined ? String(step.tool.preset.rows) : '',
      worksheet: step.worksheet === true,
    })),
    create: loc(e.create),
    success: loc(e.success),
    instruction: loc(e.instruction),
    guide: loc(e.guide),
    mistake: loc(e.mistake.mistake),
    fix: loc(e.mistake.fix),
    mistakeImage: e.mistake.image ? picture(e.mistake.image, images) : null,
    materials: loc(e.materials),
    references: e.references.map((r) => picture(r, images)),
    worksheet: e.worksheet.kind === 'static' ? { kind: 'static', assetId: e.worksheet.assetId } : { kind: e.worksheet.kind },
    tools: [...e.tools],
  };
}

export function blankForm(kind: 'exercise' | 'challenge', collection: LearnCollection, groupId: string): Form {
  if (kind === 'challenge') {
    return { kind, groupId, access: 'admin', title: EMPTY, prompt: EMPTY, focus: EMPTY, twist: EMPTY, skill: EMPTY, skillArea: 1, level: 'beginner', quick: true, medium: 'pencil', reference: 'memory', references: [], lessons: [], tools: [] };
  }
  return {
    kind,
    collection: collection === 'color' ? 'color' : 'curriculum',
    groupId,
    access: 'admin',
    title: EMPTY,
    skill: EMPTY,
    optional: false,
    minutes: '',
    objective: EMPTY,
    demo: [],
    steps: [{ text: EMPTY, image: null, tool: '', toolLabel: EMPTY, levels: '', squint: false, columns: '', rows: '', worksheet: false }],
    create: EMPTY,
    success: EMPTY,
    instruction: EMPTY,
    guide: EMPTY,
    mistake: EMPTY,
    fix: EMPTY,
    mistakeImage: null,
    materials: EMPTY,
    references: [],
    worksheet: { kind: 'none' },
    tools: [],
  };
}

const number = (text: string) => (text.trim() === '' ? undefined : Number(text));

/** The fields the server takes for this kind (src/server/learn/editor.ts). */
export function fieldsOf(form: Form) {
  if (form.kind === 'challenge') {
    return {
      groupId: form.groupId,
      access: form.access,
      title: form.title,
      prompt: form.prompt,
      level: form.level,
      skill: form.skill,
      skillArea: form.skillArea,
      reference: form.reference,
      references: form.references.map(pictureRef),
      medium: form.medium,
      quick: form.quick,
      tools: form.tools,
      ...(form.lessons.length ? { lessons: form.lessons } : {}),
      focus: form.focus,
      twist: form.twist,
    };
  }
  return {
    groupId: form.groupId,
    access: form.access,
    title: form.title,
    objective: form.objective,
    materials: form.materials,
    instruction: form.instruction,
    guide: form.guide,
    mistake: { mistake: form.mistake, fix: form.fix, ...(form.mistakeImage ? { image: pictureRef(form.mistakeImage) } : {}) },
    success: form.success,
    references: form.references.map(pictureRef),
    worksheet: form.worksheet.kind === 'static' ? { kind: 'static' as const, assetId: form.worksheet.assetId } : { kind: form.worksheet.kind },
    tools: form.tools,
    optional: form.optional,
    skill: form.skill,
    minutes: number(form.minutes) ?? null,
    demo: form.demo.map((frame) => ({ image: pictureRef(frame.image), caption: frame.caption })),
    steps: form.steps.map((step) => {
      const preset = step.tool === 'value' ? { ...(number(step.levels) !== undefined ? { levels: number(step.levels)!, ...(step.squint ? { squint: true } : {}) } : {}) } : step.tool === 'grid' ? { ...(number(step.columns) !== undefined ? { columns: number(step.columns)! } : {}), ...(number(step.rows) !== undefined ? { rows: number(step.rows)! } : {}) } : {};
      return {
        text: step.text,
        ...(step.image ? { image: pictureRef(step.image) } : {}),
        ...(step.tool ? { tool: { tool: step.tool, label: step.toolLabel, ...(Object.keys(preset).length ? { preset } : {}) } } : {}),
        ...(step.worksheet ? { worksheet: true } : {}),
      };
    }),
    create: form.create,
  };
}

