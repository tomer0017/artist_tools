import 'server-only';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Db } from 'mongodb';
import { z } from 'zod';
import { getDraft, saveDraft } from '@/server/config/versions';
import { storeAsset } from './assets';
import { learnContentSpec } from './content';

// ─── Importing Learn content from a folder kept outside the repository ────────
// `npm run db -- learn-import <folder>` (ADR-0017). The folder holds
// `seed.json` and the files it names: each asset with its licence, already
// re-encoded (no embedded metadata) with its thumbnail, and the content,
// whose references name assets by a key. Assets are stored first (checked by
// their bytes, licence required), then the content is saved as a draft
// with the assets' IDs — validated like any draft, published only by an
// admin (or `learn-publish`). An existing draft is never overwritten.

const Seed = z
  .object({
    note: z.string().trim().min(1).max(200),
    assets: z
      .array(
        z
          .object({
            key: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/),
            role: z.enum(['reference', 'worksheet']).default('reference'),
            file: z.string().min(1).max(200),
            thumbnail: z.string().min(1).max(200).nullable(),
            licence: z.unknown(),
          })
          .strict(),
      )
      .max(500),
    content: z.object({ groups: z.array(z.unknown()), exercises: z.array(z.record(z.unknown())), challenges: z.array(z.record(z.unknown())) }).passthrough(),
  })
  .strict();

export type ImportResult =
  | { status: 'saved'; version: number; assets: { key: string; assetId: string; stored: 'stored' | 'exists' }[] }
  | { status: 'draft_exists'; version: number }
  | { status: 'invalid'; issues: string[] };

/** A file named by the seed, which must stay inside the seed folder. */
async function seedFile(folder: string, name: string): Promise<Uint8Array> {
  const root = path.resolve(folder);
  const file = path.resolve(root, name);
  if (!file.startsWith(root + path.sep)) throw new Error(`${name} is outside the seed folder`);
  return new Uint8Array(await readFile(file));
}

/** References name assets by key in the seed; the content stores their IDs. */
function withAssetIds(item: Record<string, unknown>, ids: Map<string, string>, issues: string[]): Record<string, unknown> {
  const id = String(item.id ?? '?');
  const resolve = (key: unknown) => {
    const assetId = typeof key === 'string' ? ids.get(key) : undefined;
    if (!assetId) issues.push(`${id}: no asset with the key ${String(key)}`);
    return assetId ?? '';
  };
  const references = Array.isArray(item.references)
    ? item.references.map((ref) => {
        const { asset, ...rest } = (ref ?? {}) as Record<string, unknown>;
        return { assetId: resolve(asset), ...rest };
      })
    : item.references;
  const worksheet = item.worksheet as Record<string, unknown> | undefined;
  const sheet = worksheet?.kind === 'static' ? { kind: 'static', assetId: resolve(worksheet.asset) } : worksheet;
  return { ...item, references, ...(worksheet ? { worksheet: sheet } : {}) };
}

export async function importSeed(db: Db, assetsDir: string, folder: string, actor: string): Promise<ImportResult> {
  const draft = await getDraft(db, learnContentSpec);
  if (draft) return { status: 'draft_exists', version: draft.version };
  const raw = JSON.parse(new TextDecoder().decode(await seedFile(folder, 'seed.json')));
  const seed = Seed.safeParse(raw);
  if (!seed.success) return { status: 'invalid', issues: seed.error.issues.map((i) => `seed.json ${i.path.join('.')}: ${i.message}`) };

  const ids = new Map<string, string>();
  const stored: { key: string; assetId: string; stored: 'stored' | 'exists' }[] = [];
  const issues: string[] = [];
  for (const asset of seed.data.assets) {
    if (ids.has(asset.key)) {
      issues.push(`the asset key ${asset.key} is used twice`);
      continue;
    }
    const result = await storeAsset(db, assetsDir, {
      role: asset.role,
      bytes: await seedFile(folder, asset.file),
      thumbnail: asset.thumbnail ? await seedFile(folder, asset.thumbnail) : null,
      licence: asset.licence,
      actor,
    });
    if (result.status === 'invalid') {
      issues.push(...result.issues.map((i) => `${asset.key}: ${i}`));
      continue;
    }
    ids.set(asset.key, result.asset._id);
    stored.push({ key: asset.key, assetId: result.asset._id, stored: result.status });
  }
  if (issues.length > 0) return { status: 'invalid', issues };

  const { content } = seed.data;
  const document = {
    ...content,
    exercises: content.exercises.map((item) => withAssetIds(item, ids, issues)),
    challenges: content.challenges.map((item) => withAssetIds(item, ids, issues)),
  };
  if (issues.length > 0) return { status: 'invalid', issues };
  const saved = await saveDraft(db, learnContentSpec, document, actor, seed.data.note);
  if (saved.status === 'invalid') return saved;
  return { status: 'saved', version: saved.version, assets: stored };
}
