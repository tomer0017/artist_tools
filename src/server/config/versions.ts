import 'server-only';
import type { Db } from 'mongodb';
import type { ZodType } from 'zod';
import { recordAudit } from '@/server/audit';
import { collections, isDuplicateKeyError, type ConfigKind, type ConfigVersionDoc } from '@/server/db/collections';

// ─── Versioned admin configuration (docs/adr/0006) ────────────────────────────
// Each kind of configuration (the plan catalog, pricing, Learn content) is a series of
// versions: admins edit a draft, review what it changes, and publish it.
// Exactly one version per kind is published (a unique index guarantees it)
// and at most one draft exists. Nothing is edited in place: going back means
// publishing an earlier version's content again. Every save, publish, discard
// and restore is audited with version numbers only.

export interface ConfigSpec<T> {
  kind: ConfigKind;
  /** The stored form: how a version is read and what is written. */
  schema: ZodType<T>;
  /** What applies when nothing was ever published (today's behaviour). */
  defaults: () => T;
  /**
   * Why a document that reads fine must still not be written or published by
   * this release (it could not apply it in full); empty when it may be.
   */
  check?: (document: T) => string[];
  /**
   * Checks that need the database (what another kind or collection holds),
   * before a draft is saved and again before anything is published; empty
   * when it may be written.
   */
  checkWithDb?: (db: Db, document: T, stage: 'save' | 'publish') => Promise<string[]>;
  /** What restoring an earlier version starts the draft from (default: that version as it was). */
  restoreDocument?: (db: Db, document: T, version: number) => Promise<{ document: T; note: string }>;
  /** Runs after a version is published, e.g. to bring dependent data in step. */
  onPublish?: (db: Db, document: T) => Promise<void>;
  /**
   * The keys (e.g. Learn item IDs) a publication changes against what was
   * live, recorded on the version as `items` so each one's history can be
   * listed without reading every version (ADR-0023).
   */
  changedKeys?: (previous: T | null, next: T) => string[];
}

/** The version's changed keys, from the spec: what was live (read by the spec's schema, or nothing) and what is published now. */
function changedKeysOf<T>(spec: ConfigSpec<T>, previous: ConfigVersionDoc<T> | null, next: T): { items?: string[] } {
  if (!spec.changedKeys) return {};
  const before = previous ? spec.schema.safeParse(previous.document) : null;
  return { items: spec.changedKeys(before?.success ? before.data : null, next) };
}

/** A published version this release cannot read. It is never replaced by the defaults (ADR-0014). */
export class UnreadableConfigError extends Error {
  constructor(
    readonly kind: ConfigKind,
    readonly version: number,
    readonly issues: string[],
  ) {
    super(`The published ${kind} (version ${version}) cannot be read by this release: ${issues.slice(0, 3).join('; ')}`);
    this.name = 'UnreadableConfigError';
  }
}

export async function getPublished<T>(db: Db, spec: ConfigSpec<T>): Promise<ConfigVersionDoc<T> | null> {
  return (await collections(db).configVersions.findOne({ kind: spec.kind, status: 'published' })) as ConfigVersionDoc<T> | null;
}

/**
 * The published document, or the defaults when none was ever published. A
 * published version that cannot be read throws UnreadableConfigError: it is
 * never silently replaced by the defaults, which can grant more (ADR-0014).
 */
export async function publishedDocument<T>(db: Db, spec: ConfigSpec<T>): Promise<T> {
  const published = await getPublished(db, spec);
  if (!published) return spec.defaults();
  const parsed = spec.schema.safeParse(published.document);
  if (!parsed.success) throw new UnreadableConfigError(spec.kind, published.version, issueList(parsed.error.issues));
  return parsed.data;
}

const issueList = (issues: { path: (string | number)[]; message: string }[]) => issues.map((i) => `${i.path.join('.') || 'document'}: ${i.message}`);

/** Parse a document to store, then the spec's own checks: the issues that stop it from being written. */
async function validate<T>(db: Db, spec: ConfigSpec<T>, document: unknown, stage: 'save' | 'publish'): Promise<{ data: T } | { issues: string[] }> {
  const parsed = spec.schema.safeParse(document);
  if (!parsed.success) return { issues: issueList(parsed.error.issues) };
  const blocked = spec.check?.(parsed.data) ?? [];
  if (blocked.length > 0) return { issues: blocked };
  const live = (await spec.checkWithDb?.(db, parsed.data, stage)) ?? [];
  return live.length > 0 ? { issues: live } : { data: parsed.data };
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

/**
 * Publish version 1 when this kind has never been published (migration): the
 * defaults, or `seed` (the catalog starts from the plans in force when its
 * history was lost, never from more generous defaults).
 */
export async function seedDefaults<T>(db: Db, spec: ConfigSpec<T>, seed?: { document: T; note: string }, now = new Date()): Promise<boolean> {
  if (await collections(db).configVersions.findOne({ kind: spec.kind, status: 'published' }, { projection: { _id: 1 } })) return false;
  try {
    await collections(db).configVersions.insertOne({
      kind: spec.kind,
      version: await nextVersion(db, spec.kind),
      status: 'published',
      document: seed?.document ?? spec.defaults(),
      note: seed?.note ?? 'Defaults from the code',
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
  const parsed = await validate(db, spec, document, 'save');
  if ('issues' in parsed) return { status: 'invalid', issues: parsed.issues };
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
  const parsed = await validate(db, spec, draft.document, 'publish');
  if ('issues' in parsed) return { status: 'invalid', issues: parsed.issues };
  const previous = await getPublished(db, spec);
  const changed = changedKeysOf(spec, previous, parsed.data);
  if (previous) await configVersions.updateOne({ _id: previous._id, status: 'published' }, { $set: { status: 'archived', updatedAt: now } });
  try {
    const { modifiedCount } = await configVersions.updateOne(
      { _id: draft._id, status: 'draft' },
      { $set: { status: 'published', document: parsed.data, publishedBy: actor, publishedAt: now, updatedAt: now, ...changed } },
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

export type GuardedPublishResult =
  | { status: 'published'; version: number }
  /** What is live is no longer the version expected (someone published meanwhile): nothing was written. */
  | { status: 'changed'; live: number | null }
  /** Someone has a draft open: it was not touched, and nothing was published. */
  | { status: 'draft_exists' }
  | { status: 'invalid'; issues: string[] };

/**
 * Publish `document` as a new version only if what is live is still exactly
 * version `expected` and no draft exists — a compare-and-swap for operator
 * tools, which must never overwrite an admin's draft or publication. Its own
 * draft is inserted (the one-draft index refuses it if a draft appeared
 * meanwhile, where saveDraft would have taken that draft over), and the
 * expected version is archived only if it is still the published one;
 * otherwise everything is undone and nothing changes. Audited like a publish
 * from the dashboard.
 */
export async function publishIfUnchanged<T>(
  db: Db,
  spec: ConfigSpec<T>,
  document: unknown,
  expected: { version: number | null },
  actor: string,
  note: string,
  now = new Date(),
  /** Keys this publication is about beyond what changed (Learn: the item an admin moved), added to `items`. */
  extra: { keys?: string[] } = {},
): Promise<GuardedPublishResult> {
  const parsed = await validate(db, spec, document, 'publish');
  if ('issues' in parsed) return { status: 'invalid', issues: parsed.issues };
  const { configVersions } = collections(db);
  const live = await getPublished(db, spec);
  if ((live?.version ?? null) !== expected.version) return { status: 'changed', live: live?.version ?? null };
  if (await getDraft(db, spec)) return { status: 'draft_exists' };

  const version = await nextVersion(db, spec.kind);
  const changed = changedKeysOf(spec, live, parsed.data);
  if (extra.keys?.length) changed.items = [...new Set([...(changed.items ?? []), ...extra.keys])].sort();
  let draftId;
  try {
    draftId = (
      await configVersions.insertOne({
        kind: spec.kind,
        version,
        status: 'draft',
        document: parsed.data,
        note,
        createdBy: actor,
        createdAt: now,
        updatedAt: now,
        publishedBy: null,
        publishedAt: null,
        ...changed,
      })
    ).insertedId;
  } catch (error) {
    // A draft (or this version number) appeared since the check: leave it alone.
    if (isDuplicateKeyError(error)) return { status: 'draft_exists' };
    throw error;
  }
  await recordAudit(db, { type: 'admin.config_saved', userId: null, actor, metadata: { kind: spec.kind, version } });
  if (live) {
    const { modifiedCount } = await configVersions.updateOne({ _id: live._id, status: 'published' }, { $set: { status: 'archived', updatedAt: now } });
    if (modifiedCount === 0) {
      await configVersions.deleteOne({ _id: draftId, status: 'draft' });
      return { status: 'changed', live: (await getPublished(db, spec))?.version ?? null };
    }
  }
  try {
    // Only this draft as written here: if anyone edited it meanwhile, nothing is published.
    const { modifiedCount } = await configVersions.updateOne(
      { _id: draftId, status: 'draft', updatedAt: now },
      { $set: { status: 'published', publishedBy: actor, publishedAt: new Date(), updatedAt: new Date() } },
    );
    if (modifiedCount === 0) throw new Error('draft changed while publishing');
  } catch (error) {
    // Put the previous version back rather than leave nothing published.
    if (live) await configVersions.updateOne({ _id: live._id }, { $set: { status: 'published', updatedAt: now } });
    throw error;
  }
  await spec.onPublish?.(db, parsed.data);
  await recordAudit(db, { type: 'admin.config_published', userId: null, actor, metadata: { kind: spec.kind, version, previous: live?.version ?? null } });
  return { status: 'published', version };
}

/** Start a draft from an earlier version's content (going back is publishing it again). */
export async function restoreAsDraft<T>(db: Db, spec: ConfigSpec<T>, version: number, actor: string): Promise<SaveResult | { status: 'not_found' }> {
  const source = await collections(db).configVersions.findOne({ kind: spec.kind, version, status: { $ne: 'draft' } });
  if (!source) return { status: 'not_found' };
  if (spec.restoreDocument) {
    const parsed = spec.schema.safeParse(source.document);
    if (!parsed.success) return { status: 'invalid', issues: issueList(parsed.error.issues) };
    const restored = await spec.restoreDocument(db, parsed.data, version);
    return saveDraft(db, spec, restored.document, actor, restored.note);
  }
  return saveDraft(db, spec, source.document, actor, `Restored from version ${version}`);
}
