// Operator commands for Learn content (ADR-0017), run by scripts/db.ts:
//
//   learn-import <folder>   store the folder's assets and save its content as a draft (never over a draft)
//   learn-status            read only: the published and draft content, every asset's file, what each plan opens
//   learn-publish           publish the content draft (audited, actor "cli"); prints what it changes first
//   learn-discard           discard the content draft
//
// Content and images never go into the repository (it is public): the folder
// is kept elsewhere, and the database and the asset directory, both backed
// up, are their home.
import { createHash } from 'node:crypto';
import { LEARN_COLLECTIONS, COLLECTION_LABELS, itemsOf, ruleText, type LearnContent } from '@/lib/learn/model';
import { PLAN_IDS, PLAN_NAMES, type PlanId } from '@/lib/plans';
import { catalogSpec, defaultCatalog, learnSectionOf, planDocsFor, planOpens, readCatalog } from '@/server/config/catalog';
import { discardDraft, getDraft, getPublished, publishDraft, listVersions } from '@/server/config/versions';
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
  for (const asset of assets.filter((a) => a.licence)) console.log(`  ${asset._id.slice(0, 12)}…  ${asset.licence!.kind}  ${asset.licence!.author} — ${asset.licence!.title} (${asset.licence!.source})`);

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
  const catalog = await getPublished(db, catalogSpec);
  const read = readCatalog(catalog?.document ?? defaultCatalog());
  const rules = read.status === 'unreadable' ? {} : Object.fromEntries(PLAN_IDS.map((p) => [p, learnSectionOf(read.catalog).access[p]]));
  const parsed = learnContentSpec.schema.safeParse(draft.document);
  if (parsed.success) {
    console.log(`Publishing content draft version ${draft.version} would:`);
    for (const change of describeContentChanges(live, parsed.data, rules)) console.log(`  - ${change}`);
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
  console.log(`Content version ${result.version} is live (recorded in the activity log). Who opens what is still decided by the published plan catalog.`);
  return 0;
}

export async function learnDiscard(db: Database): Promise<number> {
  const discarded = await discardDraft(db, 'learn_content', 'cli');
  console.log(discarded ? 'Content draft discarded.' : 'There was no content draft.');
  return 0;
}
