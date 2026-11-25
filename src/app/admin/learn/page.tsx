import type { Metadata } from 'next';
import { accessModeOf, legacyLearnOf } from '@/lib/learn/access';
import { ACCESS_MODES, LEARN_COLLECTIONS, emptyContent, isPublicMode, itemImages, itemsOf, listPicture, orderedItems, type AccessMode, type LearnContent } from '@/lib/learn/model';
import { canMove, type Placed } from '@/lib/learn/placement';
import { signInMethods } from '@/server/account-management';
import { UnreadableConfigError, getDraft, getPublished, listVersions } from '@/server/config/versions';
import { getDb } from '@/server/db/client';
import { collections } from '@/server/db/collections';
import { getPlanStates } from '@/server/entitlements';
import { contentIssues, contentIssuesWithDb, describeContentChanges, learnContentSpec, publishedLearnContent, readinessIssues } from '@/server/learn/content';
import { requireAdmin } from '@/server/session';
import { AdminShell } from '../AdminShell';
import { DraftBar } from '../ConfigControls';
import { publishedByLabel } from '../format';
import { LearnManager } from './LearnManager';
import { LearnVersions } from './LearnVersions';
import type { GroupOption, LearnRow, LessonOption } from './types';

// Admin → Learn (ADR-0023): every lesson and challenge in tables, edited in
// place. Add, edit, copy, move, archive and restore; each row's Access
// (Free, Pro, Admin only, Blocked) is the only setting deciding who opens
// it. Every change is live at once, as a new version of the content, so the
// history below can bring any earlier state back. An imported draft (from
// the server's import command) is reviewed and published here first.

export const metadata: Metadata = { title: 'Learn · SketchyArtLab admin', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const bytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

export default async function AdminLearnPage() {
  const admin = await requireAdmin('/admin/learn');
  const db = getDb();
  const [published, draft, versions, methods, planStates, assets] = await Promise.all([
    getPublished(db, learnContentSpec),
    getDraft(db, learnContentSpec),
    listVersions(db, 'learn_content', 60),
    signInMethods(db, admin.id),
    getPlanStates(db),
    collections(db).learnAssets.find({}, { sort: { uploadedAt: -1 } }).toArray(),
  ]);
  let live: LearnContent = emptyContent();
  let unreadable: string | null = null;
  try {
    live = await publishedLearnContent(db);
  } catch (error) {
    if (!(error instanceof UnreadableConfigError)) throw error;
    unreadable = `The published content (version ${error.version}) cannot be read by this version of the app, so no Learn item opens for anyone and nothing can be edited here: ${error.issues.slice(0, 3).join('; ')}`;
  }
  const legacy = legacyLearnOf(planStates);
  const assetById = new Map(assets.map((a) => [a._id, a]));

  // An imported draft waits for review: what publishing it would change, and what stops it.
  const parsedDraft = draft ? learnContentSpec.schema.safeParse(draft.document) : null;
  const draftIssues = draft ? (parsedDraft?.success ? [...contentIssues(parsedDraft.data), ...(await contentIssuesWithDb(db, parsedDraft.data))] : ['the draft cannot be read by this version of the app']) : [];
  const draftChanges = draft && parsedDraft?.success ? describeContentChanges(live, parsedDraft.data) : [];

  const items = itemsOf(live);
  const placed: Placed[] = items.filter((i) => !i.archived).map(({ id, collection, groupId, order }) => ({ id, collection, groupId, order }));
  const rows: LearnRow[] = [];
  const counts = Object.fromEntries([...ACCESS_MODES, 'archived'].map((k) => [k, 0])) as Record<AccessMode | 'archived', number>;
  for (const collection of LEARN_COLLECTIONS) {
    let next = 1;
    for (const item of orderedItems(live, collection)) {
      const access = accessModeOf(item, legacy);
      const archived = item.archived === true;
      const optional = item.kind === 'exercise' && item.optional === true;
      // Numbered as a learner's course numbers it: lessons learners see, the optional baseline left out.
      const number = item.kind === 'exercise' && collection !== 'challenges' && !archived && isPublicMode(access) && !optional ? next++ : null;
      const picture = listPicture(item);
      if (archived) counts.archived += 1;
      else counts[access] += 1;
      rows.push({
        id: item.id,
        kind: item.kind,
        collection,
        groupId: item.groupId,
        order: item.order,
        title: { en: item.title.en, he: item.title.he },
        access,
        explicit: item.access !== undefined,
        archived,
        number,
        optional,
        thumbnailAssetId: picture ? (assetById.get(picture.assetId)?.thumbnailAssetId ?? null) : null,
        pictures: itemImages(item).length,
        missing: readinessIssues(item).map((issue) => issue.replace(`${item.id}: `, '')),
        canMove: archived ? { up: false, down: false } : canMove(placed, collection, item.id),
      });
    }
  }
  const groups: GroupOption[] = live.groups.map(({ id, collection, order, title }) => ({ id, collection, order, title: { en: title.en, he: title.he } }));
  const lessons: LessonOption[] = rows.filter((r) => r.collection === 'curriculum').map((r) => ({ id: r.id, title: r.title, number: r.number }));
  const originals = assets.filter((a) => a.role !== 'thumbnail');

  return (
    <AdminShell active="learn">
      <h1 className="mt-6 text-2xl font-bold tracking-tight text-foreground">Learn content</h1>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
        Every lesson and challenge, in English and Hebrew. Changes are live in the studio as soon as you save them, and every change is kept in the
        history below. <strong className="font-semibold text-foreground">Access</strong> on each row is the only setting that decides who opens an
        item: Free (everyone signed in), Pro (Pro accounts), Admin only (for checking), Blocked (nobody in the studio).
      </p>
      {unreadable && (
        <p role="alert" className="mt-4 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-foreground">
          {unreadable}
        </p>
      )}
      {draft && (
        <div className="mt-4">
          <DraftBar
            kind="learn_content"
            draftVersion={draft.version}
            publishedVersion={published?.version ?? null}
            changes={draftChanges}
            blocked={draftIssues.length > 0 ? `Draft version ${draft.version} cannot be published yet: ${draftIssues.slice(0, 5).join('; ')}${draftIssues.length > 5 ? ` (and ${draftIssues.length - 5} more)` : ''}.` : null}
            viewer={{ email: admin.user.email, hasPassword: methods.password !== null, returnTo: '/admin/learn' }}
            startHint="An imported draft (from the server's import command). Publish or discard it; the tables are read-only until then."
          />
        </div>
      )}

      {!unreadable && (
        <LearnManager
          rows={rows}
          groups={groups}
          lessons={lessons}
          counts={counts}
          liveVersion={published?.version ?? null}
          locked={draft ? `An imported draft (version ${draft.version}) is waiting above: publish or discard it first. Until then nothing is saved from the tables.` : null}
        />
      )}

      <details className="mt-6 rounded-2xl border border-border bg-card p-4">
        <summary className="cursor-pointer text-base font-semibold text-foreground">All pictures and sheets ({originals.length})</summary>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Files on the server, outside the app and outside public/, named by their SHA-256 and never changed: replacing a picture stores a new file,
          so every earlier version keeps its own. Served only to accounts allowed to open an item that uses them. Each records where it comes from
          and on what terms.
        </p>
        <ul className="mt-3 grid gap-3 md:grid-cols-2">
          {originals.map((asset) => (
            <li key={asset._id} className="flex gap-3 rounded-2xl border border-border bg-background p-3 text-sm">
              {asset.thumbnailAssetId && (
                // eslint-disable-next-line @next/next/no-img-element -- served by the authorized asset route, never from public/
                <img src={`/api/learn/assets/${asset.thumbnailAssetId}`} alt="" loading="lazy" className="h-16 w-16 shrink-0 rounded-lg border border-border object-cover" />
              )}
              <div className="min-w-0">
                <p className="truncate font-semibold text-foreground">{asset.licence?.title ?? '—'}</p>
                <p className="text-muted-foreground">
                  {asset.licence?.author ?? '—'} · {asset.licence?.kind === 'cc0' ? 'CC0' : (asset.licence?.kind ?? 'no licence')}
                  {asset.licence?.licenceUrl && (
                    <>
                      {' '}
                      (
                      <a href={asset.licence.licenceUrl} className="underline" rel="noreferrer" target="_blank">
                        licence
                      </a>
                      )
                    </>
                  )}
                </p>
                {asset.licence && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {asset.licence.source ? (
                      <a href={asset.licence.source} className="underline" rel="noreferrer" target="_blank">
                        Source
                      </a>
                    ) : (
                      'Own work, no source page'
                    )}{' '}
                    · rights checked {asset.licence.checkedAt}
                  </p>
                )}
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  {asset._id.slice(0, 12)}… · {asset.contentType} · {asset.width ?? '?'}×{asset.height ?? '?'} · {bytes(asset.bytes)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </details>

      <LearnVersions
        versions={versions.map((v) => ({ version: v.version, live: v.status === 'published', at: v.publishedAt?.toISOString() ?? null, by: publishedByLabel(v.publishedBy, admin.id.toHexString()), note: v.note }))}
        locked={draft !== null}
      />
    </AdminShell>
  );
}
