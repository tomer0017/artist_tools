// Operator commands for Learn content (ADR-0017), run by scripts/db.ts:
//
//   learn-import <folder>   store the folder's assets and save its content as a draft (never over a draft)
//   learn-status            read only: the published and draft content, every asset's file, what each plan opens
//   learn-publish           publish the content draft (audited, actor "cli"); prints what it changes first
//   learn-discard           discard the content draft
//   learn-access status                          read only: every item's access mode and what Free and Pro open (ADR-0023)
//   learn-access write-modes [--apply]           write each item's mode as it is decided now (access unchanged)
//   learn-access set <mode> --all [--apply]      give every item (archived ones aside) one mode, e.g. free
//   learn-access align-catalog [--apply]         the catalog's old Learn rules → All, so releases before modes follow each item's flag
//   learn-export                                 read only: every content version and asset record as JSON (for a backup kept elsewhere)
// Without --apply nothing is written: what would change is printed, checked
// and the command exits 0 only if the change is safe.
//
// Content and images never go into the repository (it is public): the folder
// is kept elsewhere, and the database and the asset directory, both backed
// up, are their home.
import { createHash } from 'node:crypto';
import { accessModeOf, learnAccess, legacyLearnOf, type LegacyLearn } from '@/lib/learn/access';
import { ACCESS_LABELS, ACCESS_MODES, LEARN_COLLECTIONS, LEARN_MODULE, COLLECTION_LABELS, isAccessMode, itemsOf, publishedFlagFor, ruleText, type LearnContent } from '@/lib/learn/model';
import { PLAN_IDS, PLAN_NAMES, type PlanId } from '@/lib/plans';
import { catalogSpec, defaultCatalog, describeCatalogChanges, learnSectionOf, mergeKnown, planDocsFor, planOpens, readCatalog, type Catalog } from '@/server/config/catalog';
import { discardDraft, getDraft, getPublished, publishDraft, listVersions, publishIfUnchanged } from '@/server/config/versions';
import { getPlanStates } from '@/server/entitlements';
import { setAccessMany, writeModes } from '@/server/learn/editor';
import type { getDb } from '@/server/db/client';
import { collections } from '@/server/db/collections';
import { learnAssetsDir } from '@/server/env';
import { checkAssetFile } from '@/server/learn/assets';
import { contentIssues, contentIssuesWithDb, describeContentChanges, learnContentSpec, publishedLearnContent } from '@/server/learn/content';
import { importSeed } from '@/server/learn/import';

type Database = ReturnType<typeof getDb>;

const when = (date: Date | null | undefined) => (date ? date.toISOString().replace('T', ' ').slice(0, 16) + 'Z' : '—');

function fingerprint(value: unknown): string {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' && !(v instanceof Date) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])])) : v;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex').slice(0, 16);
}

function assetsDirOrExit(): string {
  const dir = learnAssetsDir();
  if (!dir) throw new Error('LEARN_ASSETS_DIR is not set here: the asset directory is needed (deploy/install-learn-assets.sh).');
  return dir;
}

export async function learnImportCommand(db: Database, folder: string | undefined): Promise<number> {
  if (!folder) throw new Error('Usage: npm run db -- learn-import <folder with seed.json>');
  const result = await importSeed(db, assetsDirOrExit(), folder, 'cli');
  if (result.status === 'draft_exists') {
    console.log(`A content draft exists (version ${result.version}): nothing was imported. Publish or discard it first (learn-publish, learn-discard).`);
    return 1;
  }
  if (result.status === 'invalid') {
    console.log('Nothing was saved as a draft:');
    for (const issue of result.issues) console.log(`  - ${issue}`);
    return 1;
  }
  for (const a of result.assets) console.log(`  ${a.stored === 'stored' ? 'stored' : 'exists'}  ${a.key}: ${a.assetId}`);
  console.log(`Saved as draft version ${result.version}. Nothing is visible until it is published (learn-publish, or Admin → Learn).`);
  return 0;
}

export async function learnStatus(db: Database): Promise<number> {
  let failed = false;
  const live = await getPublished(db, learnContentSpec);
  const draft = await getDraft(db, learnContentSpec);
  const versions = await listVersions(db, 'learn_content');
  console.log(`Published content: ${live ? `version ${live.version}, published ${when(live.publishedAt)} by ${live.publishedBy ?? '—'}, content ${fingerprint(live.document)}` : '— (nothing published: no Learn item exists for anyone)'}`);
  console.log(`Draft: ${draft ? `version ${draft.version} (${draft.note ?? 'no note'})` : 'none'}; versions published so far: ${versions.length}`);
  let content: LearnContent;
  try {
    content = await publishedLearnContent(db);
  } catch (error) {
    console.log(`The published content cannot be read by this release: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  for (const collection of LEARN_COLLECTIONS) {
    const items = itemsOf(content).filter((i) => i.collection === collection);
    if (items.length === 0) continue;
    console.log(`  ${COLLECTION_LABELS[collection]}: ${items.map((i) => `${i.id}${i.published ? '' : ' (unpublished)'}`).join(', ')}`);
  }
  const issues = [...contentIssues(content), ...(live ? await contentIssuesWithDb(db, content) : [])];
  for (const issue of issues) console.log(`  PROBLEM  ${issue}`);
  failed ||= issues.length > 0;

  const dir = learnAssetsDir();
  const assets = await collections(db).learnAssets.find({}, { sort: { uploadedAt: 1 } }).toArray();
  console.log(`Assets: ${assets.length} recorded (${assets.filter((a) => a.role === 'reference').length} references, ${assets.filter((a) => a.role === 'thumbnail').length} thumbnails, ${assets.filter((a) => a.role === 'worksheet').length} worksheets); directory ${dir ?? 'NOT SET (LEARN_ASSETS_DIR)'}`);
  if (dir) {
    let ok = 0;
    for (const asset of assets) {
      const state = await checkAssetFile(dir, asset);
      if (state === 'ok') ok += 1;
      else {
        failed = true;
        console.log(`  PROBLEM  ${asset._id} (${asset.role}): file ${state}`);
      }
    }
    console.log(`  files: ${ok} of ${assets.length} present with exactly their recorded bytes`);
  } else if (assets.length > 0) failed = true;
  for (const asset of assets.filter((a) => a.licence)) console.log(`  ${asset._id.slice(0, 12)}…  ${asset.licence!.kind}  ${asset.licence!.author} — ${asset.licence!.title} (${asset.licence!.source ?? 'own work, no source page'})`);

  const catalog = await getPublished(db, catalogSpec);
  const read = readCatalog(catalog?.document ?? defaultCatalog());
  if (read.status === 'unreadable') {
    console.log('The published catalog cannot be read by this release: Learn opens nothing for anyone but admins.');
    return 1;
  }
  const section = learnSectionOf(read.catalog);
  console.log(`Learn access in catalog version ${catalog?.version ?? '—'}${read.catalog.learn ? '' : ' (no Learn section: nothing opens)'}; locked items show ${section.previews === 'thumbnail' ? 'a title and thumbnail' : 'titles only'}:`);
  const opens = planOpens(read.catalog, content);
  const docs = planDocsFor(read.catalog);
  for (const planId of PLAN_IDS) {
    const modules = docs[planId].features.filter((f) => f.startsWith('learn.'));
    console.log(`  ${PLAN_NAMES[planId]}: modules ${modules.join(', ') || 'none'}; ${LEARN_COLLECTIONS.map((c) => `${c} ${ruleText(section.access[planId][c])}`).join('; ')}`);
    console.log(`    opens: ${opens[planId].join(', ') || 'nothing'}`);
  }
  return failed ? 1 : 0;
}

export async function learnPublish(db: Database): Promise<number> {
  const draft = await getDraft(db, learnContentSpec);
  if (!draft) {
    console.log('There is no content draft to publish.');
    return 1;
  }
  const live = await publishedLearnContent(db);
  const parsed = learnContentSpec.schema.safeParse(draft.document);
  if (parsed.success) {
    console.log(`Publishing content draft version ${draft.version} would:`);
    for (const change of describeContentChanges(live, parsed.data)) console.log(`  - ${change}`);
  }
  const result = await publishDraft(db, learnContentSpec, 'cli');
  if (result.status === 'no_draft') {
    console.log('There is no content draft to publish.');
    return 1;
  }
  if (result.status === 'invalid') {
    console.log('Not published:');
    for (const issue of result.issues) console.log(`  - ${issue}`);
    return 1;
  }
  console.log(`Content version ${result.version} is live (recorded in the activity log). Who opens what is each item's access (Admin → Learn).`);
  return 0;
}

export async function learnDiscard(db: Database): Promise<number> {
  const discarded = await discardDraft(db, 'learn_content', 'cli');
  console.log(discarded ? 'Content draft discarded.' : 'There was no content draft.');
  return 0;
}

// ─── Access modes (ADR-0023) ──────────────────────────────────────────────────

const ACTOR = 'cli:learn-access';

/** What a release before modes opens for a plan: published items its old rules open (module, then All or the list). */
function olderReleaseOpens(content: LearnContent, legacy: LegacyLearn, planId: PlanId): Set<string> {
  const plan = legacy[planId];
  const opened = new Set<string>();
  for (const item of itemsOf(content)) {
    if (!item.published || !plan || !plan.modules.includes(LEARN_MODULE[item.collection])) continue;
    const rule = plan.rules[item.collection];
    if (rule.mode === 'all' || (rule.mode === 'selected' && rule.items.includes(item.id))) opened.add(item.id);
  }
  return opened;
}

const VIEWERS = { free: { active: true, admin: false, pro: false }, pro: { active: true, admin: false, pro: true }, admin: { active: true, admin: true, pro: true } } as const;

/** Every item's state for Free, Pro and admins, as this release decides. */
function statesOf(content: LearnContent, legacy: LegacyLearn): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [who, viewer] of Object.entries(VIEWERS)) {
    const view = learnAccess({ ...viewer, legacy }, content);
    for (const item of itemsOf(content)) out[`${who}:${item.id}`] = view.state(item.id).status;
  }
  return out;
}

function printModes(content: LearnContent, legacy: LegacyLearn) {
  const view = learnAccess({ ...VIEWERS.admin, legacy }, content);
  const counts: Record<string, number> = {};
  for (const collection of LEARN_COLLECTIONS) {
    const items = itemsOf(content).filter((i) => i.collection === collection);
    if (items.length === 0) continue;
    console.log(`  ${COLLECTION_LABELS[collection]}:`);
    for (const mode of [...ACCESS_MODES, 'archived'] as const) {
      const ids = items.filter((i) => (mode === 'archived' ? i.archived : !i.archived && view.mode(i.id) === mode)).map((i) => `${i.id}${i.access === undefined ? '*' : ''}`);
      counts[mode] = (counts[mode] ?? 0) + ids.length;
      if (ids.length) console.log(`    ${mode === 'archived' ? 'Archived' : ACCESS_LABELS[mode]} (${ids.length}): ${ids.join(', ')}`);
    }
  }
  console.log(`  In all: ${[...ACCESS_MODES, 'archived'].map((m) => `${m} ${counts[m] ?? 0}`).join(', ')}${itemsOf(content).some((i) => i.access === undefined) ? '  (* no mode of its own yet: from the old plan rules)' : ''}`);
}

export async function learnAccessCommand(db: Database, args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  const apply = rest.includes('--apply');
  const published = await getPublished(db, learnContentSpec);
  const content = await publishedLearnContent(db);
  const legacy = legacyLearnOf(await getPlanStates(db));
  console.log(`Learn content version ${published?.version ?? '—'} (${fingerprint(published?.document ?? null)}); ${itemsOf(content).length} items.`);

  if (sub === 'status') {
    printModes(content, legacy);
    for (const planId of PLAN_IDS) {
      const view = learnAccess({ ...VIEWERS[planId], legacy }, content);
      const opens = LEARN_COLLECTIONS.flatMap((c) => view.opens(c));
      const older = olderReleaseOpens(content, legacy, planId);
      const more = [...older].filter((id) => !opens.includes(id));
      console.log(`  ${PLAN_NAMES[planId]} opens ${opens.length}; a release before modes would open ${older.size}${more.length ? ` — MORE: ${more.join(', ')}` : ' (never more)'}`);
    }
    return 0;
  }

  if (sub === 'write-modes') {
    const before = statesOf(content, legacy);
    const next: LearnContent = structuredClone(content);
    let written = 0;
    for (const item of [...next.exercises, ...next.challenges]) {
      if (item.access !== undefined) continue;
      const collection = 'collection' in item ? item.collection : 'challenges';
      item.access = accessModeOf({ id: item.id, collection, published: item.published }, legacy);
      item.published = publishedFlagFor(item.access, item.archived === true);
      written += 1;
    }
    const after = statesOf(next, legacy);
    const differ = Object.keys(before).filter((key) => before[key] !== after[key]);
    console.log(`Writing each item's mode: ${written} items get one.`);
    printModes(next, legacy);
    console.log(`  Access unchanged for Free, Pro and admins: ${differ.length === 0 ? 'yes' : `NO (${differ.slice(0, 10).join(', ')})`}`);
    for (const planId of PLAN_IDS) {
      const now = new Set(LEARN_COLLECTIONS.flatMap((c) => learnAccess({ ...VIEWERS[planId], legacy }, next).opens(c)));
      const more = [...olderReleaseOpens(next, legacy, planId)].filter((id) => !now.has(id));
      console.log(`  ${PLAN_NAMES[planId]}: a release before modes would open ${more.length ? `MORE: ${more.join(', ')}` : 'nothing more'}`);
      if (more.length) return 1;
    }
    if (differ.length > 0 || written === 0) return written === 0 ? 0 : 1;
    if (!apply) {
      console.log('Dry run: nothing written. Run again with --apply.');
      return 0;
    }
    const result = await writeModes(db, ACTOR, { legacy, note: 'Access modes written per item (ADR-0023); access unchanged' });
    console.log(result.status === 'saved' ? `Content version ${result.version} is live: every item has its mode.` : `Not written: ${JSON.stringify(result)}`);
    return result.status === 'saved' ? 0 : 1;
  }

  if (sub === 'set') {
    const mode = rest[0];
    const named = rest.slice(1).filter((arg) => !arg.startsWith('--') && rest[rest.indexOf(arg) - 1] !== '--note');
    if (!isAccessMode(mode) || (!rest.includes('--all') && named.length === 0)) throw new Error('Usage: npm run db -- learn-access set <free|pro|admin|blocked> --all|<ID…> [--apply] [--note "…"]');
    const known = new Set(itemsOf(content).map((i) => i.id));
    const unknown = named.filter((id) => !known.has(id));
    if (unknown.length > 0) throw new Error(`Not in the live content: ${unknown.join(', ')}`);
    const ids = rest.includes('--all') ? itemsOf(content).filter((i) => !i.archived).map((i) => i.id) : named;
    const view = learnAccess({ ...VIEWERS.admin, legacy }, content);
    const changes = ids.filter((id) => view.mode(id) !== mode || itemsOf(content).find((i) => i.id === id)!.access === undefined);
    console.log(`${rest.includes('--all') ? 'Giving every item (archived ones aside)' : `Giving ${ids.join(', ')}`} ${ACCESS_LABELS[mode]}: ${changes.length} change.`);
    for (const id of changes) console.log(`  ${id}: ${ACCESS_LABELS[view.mode(id)!]} → ${ACCESS_LABELS[mode]}`);
    if (changes.length === 0) return 0;
    if (!apply) {
      console.log('Dry run: nothing written. Run again with --apply.');
      return 0;
    }
    const note = rest.includes('--note') ? rest[rest.indexOf('--note') + 1] : `${rest.includes('--all') ? 'Every item' : changes.join(', ')}: ${ACCESS_LABELS[mode]} (operator)`;
    const result = await setAccessMany(db, ACTOR, { ids: changes, access: mode, legacy, note });
    console.log(result.status === 'saved' ? `Content version ${result.version} is live.` : `Not written: ${JSON.stringify(result)}`);
    return result.status === 'saved' ? 0 : 1;
  }

  if (sub === 'align-catalog') {
    const live = await getPublished(db, catalogSpec);
    const read = readCatalog(live?.document ?? defaultCatalog());
    if (read.status !== 'ok') {
      console.log(`The published catalog cannot be edited safely here (${read.status}).`);
      return 1;
    }
    const section = learnSectionOf(read.catalog);
    const all = { mode: 'all' as const };
    const edited: Catalog = {
      ...read.catalog,
      learn: { ...section, access: { free: { ...section.access.free, curriculum: all, challenges: all }, pro: { ...section.access.pro, curriculum: all, challenges: all } } },
    };
    const changes = describeCatalogChanges(read.catalog, edited, content);
    console.log(`Catalog version ${live?.version ?? '—'} (${fingerprint(live?.document ?? null)}): its old Learn rules decide nothing for items with a mode; a release before modes still reads them.`);
    for (const change of changes) console.log(`  - ${change}`);
    if (changes.length === 0) {
      console.log('  Nothing to change.');
      return 0;
    }
    // With the rules at All, a release before modes opens exactly the items whose flag says so (Free ones): never more than this one.
    const aligned = legacyLearnOf({ free: { active: true, features: planDocsFor(edited).free.features, learn: planDocsFor(edited).free.learn }, pro: { active: true, features: planDocsFor(edited).pro.features, learn: planDocsFor(edited).pro.learn } });
    for (const planId of PLAN_IDS) {
      const now = new Set(LEARN_COLLECTIONS.flatMap((c) => learnAccess({ ...VIEWERS[planId], legacy }, content).opens(c)));
      const more = [...olderReleaseOpens(content, aligned, planId)].filter((id) => !now.has(id));
      console.log(`  ${PLAN_NAMES[planId]}: a release before modes would then open ${more.length ? `MORE: ${more.join(', ')}` : 'nothing more than this one'}`);
      if (more.length) return 1;
    }
    if (!apply) {
      console.log('Dry run: nothing written. Run again with --apply.');
      return 0;
    }
    const result = await publishIfUnchanged(db, catalogSpec, mergeKnown(read.stored, edited), { version: live?.version ?? null }, ACTOR, 'Learn rules to All: each item’s access decides (ADR-0023)');
    console.log(result.status === 'published' ? `Catalog version ${result.version} is live; plans are in step.` : `Not published: ${JSON.stringify(result)}`);
    return result.status === 'published' ? 0 : 1;
  }

  throw new Error('Usage: npm run db -- learn-access status | write-modes [--apply] | set <mode> --all|<ID…> [--apply] | align-catalog [--apply]');
}

/**
 * Every Learn content version (drafts included) and every asset's record, as
 * JSON on standard output: a copy of what Admin → Learn edits, for a backup
 * kept elsewhere (the asset files are copied separately). Read only.
 */
export async function learnExport(db: Database): Promise<number> {
  const versions = await collections(db).configVersions.find({ kind: 'learn_content' }, { sort: { version: 1 } }).toArray();
  const assets = await collections(db).learnAssets.find({}, { sort: { _id: 1 } }).toArray();
  process.stdout.write(JSON.stringify({ exportedAt: new Date().toISOString(), versions, assets }));
  process.stdout.write('\n');
  return 0;
}
