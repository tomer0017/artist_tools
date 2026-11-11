import 'server-only';
import type { Db } from 'mongodb';
import type { ZodType } from 'zod';
import { recordAudit } from '@/server/audit';
import { collections, isDuplicateKeyError, type ConfigKind, type ConfigVersionDoc } from '@/server/db/collections';

// ─── Versioned admin configuration (docs/adr/0006) ────────────────────────────
// Each kind of configuration (the plan catalog, pricing) is a series of
// versions: admins edit a draft, review what it changes, and publish it.
// Exactly one version per kind is published (a unique index guarantees it)
// and at most one draft exists. Nothing is edited in place: going back means
// publishing an earlier version's content again. Every save, publish, discard
// and restore is audited with version numbers only.

export interface ConfigSpec<T> {
  kind: ConfigKind;
  schema: ZodType<T>;
  /** What applies when nothing was ever published (today's behaviour). */
  defaults: () => T;
  /** Runs after a version is published, e.g. to bring dependent data in step. */
  onPublish?: (db: Db, document: T) => Promise<void>;
}

export async function getPublished<T>(db: Db, spec: ConfigSpec<T>): Promise<ConfigVersionDoc<T> | null> {
  return (await collections(db).configVersions.findOne({ kind: spec.kind, status: 'published' })) as ConfigVersionDoc<T> | null;
}

/** The published document, or the defaults when none was ever published. */
export async function publishedDocument<T>(db: Db, spec: ConfigSpec<T>): Promise<T> {
  const published = await getPublished(db, spec);
  const parsed = published ? spec.schema.safeParse(published.document) : null;
  return parsed?.success ? parsed.data : spec.defaults();
}

export async function getDraft<T>(db: Db, spec: ConfigSpec<T>): Promise<ConfigVersionDoc<T> | null> {
  return (await collections(db).configVersions.findOne({ kind: spec.kind, status: 'draft' })) as ConfigVersionDoc<T> | null;
}

export async function listVersions(db: Db, kind: ConfigKind, limit = 20) {
  return collections(db)
    .configVersions.find({ kind, status: { $ne: 'draft' } }, { sort: { version: -1 }, limit, projection: { document: 0 } })
    .toArray();
}

async function nextVersion(db: Db, kind: ConfigKind): Promise<number> {
  const latest = await collections(db).configVersions.findOne({ kind }, { sort: { version: -1 }, projection: { version: 1 } });
  return (latest?.version ?? 0) + 1;
}

/** Publish the defaults as version 1 when this kind has never been published (migration). */
export async function seedDefaults<T>(db: Db, spec: ConfigSpec<T>, now = new Date()): Promise<boolean> {
  if (await collections(db).configVersions.findOne({ kind: spec.kind, status: 'published' }, { projection: { _id: 1 } })) return false;
  try {
    await collections(db).configVersions.insertOne({
      kind: spec.kind,
      version: await nextVersion(db, spec.kind),
      status: 'published',
      document: spec.defaults(),
      note: 'Defaults from the code',
      createdBy: 'system',
      createdAt: now,
      updatedAt: now,
      publishedBy: 'system',
      publishedAt: now,
    });
    return true;
  } catch (error) {
    if (isDuplicateKeyError(error)) return false; // another process seeded it first
    throw error;
  }
}

export type SaveResult = { status: 'saved'; version: number } | { status: 'invalid'; issues: string[] };

/** Create or replace the draft with `document` (validated). */
export async function saveDraft<T>(db: Db, spec: ConfigSpec<T>, document: unknown, actor: string, note: string | null = null, now = new Date()): Promise<SaveResult> {
  const parsed = spec.schema.safeParse(document);
  if (!parsed.success) return { status: 'invalid', issues: parsed.error.issues.map((i) => `${i.path.join('.') || 'document'}: ${i.message}`) };
  const { configVersions } = collections(db);
  const existing = await getDraft(db, spec);
  if (existing) {
    await configVersions.updateOne({ _id: existing._id, status: 'draft' }, { $set: { document: parsed.data, note, updatedAt: now } });
    await recordAudit(db, { type: 'admin.config_saved', userId: null, actor, metadata: { kind: spec.kind, version: existing.version } });
    return { status: 'saved', version: existing.version };
  }
  const version = await nextVersion(db, spec.kind);
  await configVersions.insertOne({ kind: spec.kind, version, status: 'draft', document: parsed.data, note, createdBy: actor, createdAt: now, updatedAt: now, publishedBy: null, publishedAt: null });
  await recordAudit(db, { type: 'admin.config_saved', userId: null, actor, metadata: { kind: spec.kind, version } });
  return { status: 'saved', version };
}

export async function discardDraft(db: Db, kind: ConfigKind, actor: string): Promise<boolean> {
  const draft = await collections(db).configVersions.findOneAndDelete({ kind, status: 'draft' });
  if (!draft) return false;
  await recordAudit(db, { type: 'admin.config_discarded', userId: null, actor, metadata: { kind, version: draft.version } });
  return true;
}

export type PublishResult = { status: 'published'; version: number } | { status: 'no_draft' } | { status: 'invalid'; issues: string[] };

/** Publish the draft: the current version is archived, the draft takes its place. */
export async function publishDraft<T>(db: Db, spec: ConfigSpec<T>, actor: string, now = new Date()): Promise<PublishResult> {
  const { configVersions } = collections(db);
  const draft = await getDraft(db, spec);
  if (!draft) return { status: 'no_draft' };
  const parsed = spec.schema.safeParse(draft.document);
  if (!parsed.success) return { status: 'invalid', issues: parsed.error.issues.map((i) => `${i.path.join('.') || 'document'}: ${i.message}`) };
  const previous = await getPublished(db, spec);
  if (previous) await configVersions.updateOne({ _id: previous._id, status: 'published' }, { $set: { status: 'archived', updatedAt: now } });
  try {
    const { modifiedCount } = await configVersions.updateOne(
      { _id: draft._id, status: 'draft' },
      { $set: { status: 'published', document: parsed.data, publishedBy: actor, publishedAt: now, updatedAt: now } },
    );
    if (modifiedCount === 0) throw new Error('draft changed while publishing');
  } catch (error) {
    // Put the previous version back rather than leave nothing published.
    if (previous) await configVersions.updateOne({ _id: previous._id }, { $set: { status: 'published', updatedAt: now } });
    throw error;
  }
  await spec.onPublish?.(db, parsed.data);
  await recordAudit(db, {
    type: 'admin.config_published',
    userId: null,
    actor,
    metadata: { kind: spec.kind, version: draft.version, previous: previous?.version ?? null },
  });
  return { status: 'published', version: draft.version };
}

/** Start a draft from an earlier version's content (going back is publishing it again). */
export async function restoreAsDraft<T>(db: Db, spec: ConfigSpec<T>, version: number, actor: string): Promise<SaveResult | { status: 'not_found' }> {
  const source = await collections(db).configVersions.findOne({ kind: spec.kind, version, status: { $ne: 'draft' } });
  if (!source) return { status: 'not_found' };
  return saveDraft(db, spec, source.document, actor, `Restored from version ${version}`);
}
