import type { Metadata } from 'next';
import Link from 'next/link';
import { PLAN_IDS, PLAN_NAMES } from '@/lib/plans';
import { COLLECTION_LABELS, LEARN_COLLECTIONS, emptyContent, itemsOf, orderedItems, ruleText, type LearnContent } from '@/lib/learn/model';
import { itemPath } from '@/lib/learn/routes';
import { signInMethods } from '@/server/account-management';
import { catalogSpec, defaultCatalog, learnSectionOf, planOpens, readCatalog } from '@/server/config/catalog';
import { UnreadableConfigError, getDraft, getPublished, listVersions } from '@/server/config/versions';
import { getDb } from '@/server/db/client';
import { collections } from '@/server/db/collections';
import { contentIssues, contentIssuesWithDb, describeContentChanges, learnContentSpec, publishedLearnContent } from '@/server/learn/content';
import { requireAdmin } from '@/server/session';
import { AdminShell } from '../AdminShell';
import { DraftBar, VersionHistory } from '../ConfigControls';
import { publishedByLabel } from '../format';

// Learn content (ADR-0017): the published version and its draft, what
// publishing the draft would change, every item and asset with its licence,
// and what each plan opens under the published catalog. Drafts come from the
// import command until the content editor exists (M6); here they are
// reviewed, published, discarded or restored. Admins see every item,
// unpublished ones too; who else sees what is decided in Plans.

export const metadata: Metadata = { title: 'Learn · Studio Companion admin', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const bytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

export default async function AdminLearnPage() {
  const admin = await requireAdmin('/admin/learn');
  const db = getDb();
  const [published, draft, versions, methods, catalog, assets] = await Promise.all([
    getPublished(db, learnContentSpec),
    getDraft(db, learnContentSpec),
    listVersions(db, 'learn_content'),
    signInMethods(db, admin.id),
    getPublished(db, catalogSpec),
    collections(db).learnAssets.find({}, { sort: { uploadedAt: -1 } }).toArray(),
  ]);
  let live: LearnContent = emptyContent();
  let unreadable: string | null = null;
  try {
    live = await publishedLearnContent(db);
  } catch (error) {
    if (!(error instanceof UnreadableConfigError)) throw error;
    unreadable = `The published content (version ${error.version}) cannot be read by this version of the app, so no Learn item opens for anyone but admins: ${error.issues.slice(0, 3).join('; ')}`;
  }
  const parsedDraft = draft ? learnContentSpec.schema.safeParse(draft.document) : null;
  const working = parsedDraft?.success ? parsedDraft.data : live;
  const catalogRead = readCatalog(catalog?.document ?? defaultCatalog());
  const section = catalogRead.status === 'unreadable' ? null : learnSectionOf(catalogRead.catalog);
  const rules = section ? Object.fromEntries(PLAN_IDS.map((p) => [p, section.access[p]])) : {};
  const issues = draft ? (parsedDraft?.success ? [...contentIssues(working), ...(await contentIssuesWithDb(db, working))] : ['the draft cannot be read by this version of the app']) : [];
  const changes = draft && parsedDraft?.success ? describeContentChanges(live, working, rules) : [];
  const opens = planOpens(catalogRead.status === 'unreadable' ? defaultCatalog() : catalogRead.catalog, live);
  const assetById = new Map(assets.map((a) => [a._id, a]));
  const originals = assets.filter((a) => a.role !== 'thumbnail');
  const shown = draft ? `draft version ${draft.version}` : `version ${published?.version ?? '—'} (live)`;
  // Items of the live version open in the studio (a draft's new items do not exist there yet).
  const liveIds = new Set(itemsOf(live).map((item) => item.id));

  return (
    <AdminShell active="learn">
      <h1 className="mt-6 text-2xl font-bold tracking-tight text-foreground">Learn content</h1>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
        Exercises and challenges, in English and Hebrew, as versioned drafts you publish. Publishing content opens nothing by itself: who sees which
        items is set per plan in <Link href="/admin/plans" className="underline">Plans</Link> (the Learn modules and the Learn access section). Admins
        see everything, unpublished items included.
      </p>
      {unreadable && <p role="alert" className="mt-4 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-foreground">{unreadable}</p>}
      <div className="mt-4">
        <DraftBar
          kind="learn_content"
          draftVersion={draft?.version ?? null}
          publishedVersion={published?.version ?? null}
          changes={changes}
          blocked={issues.length > 0 ? `Draft version ${draft!.version} cannot be published yet: ${issues.slice(0, 5).join('; ')}${issues.length > 5 ? ` (and ${issues.length - 5} more)` : ''}.` : null}
          viewer={{ email: admin.user.email, hasPassword: methods.password !== null, returnTo: '/admin/learn' }}
          startHint="Drafts come from the import command on the server (npm run db -- learn-import <folder>) until the content editor exists. Restoring an earlier version below also starts one."
        />
      </div>

      <section aria-labelledby="learn-access" className="mt-6 rounded-2xl border border-border bg-card p-4">
        <h2 id="learn-access" className="text-sm font-semibold text-foreground">What each plan opens now (catalog version {catalog?.version ?? '—'}, content version {published?.version ?? '—'})</h2>
        {section ? (
          <ul className="mt-2 space-y-1 text-sm text-foreground">
            {PLAN_IDS.map((planId) => (
              <li key={planId}>
                <strong>{PLAN_NAMES[planId]}:</strong> {opens[planId].length > 0 ? opens[planId].join(', ') : 'nothing'}
                <span className="text-muted-foreground"> — {LEARN_COLLECTIONS.map((c) => `${COLLECTION_LABELS[c]} ${ruleText(section.access[planId][c])}`).join('; ')}</span>
              </li>
            ))}
            <li className="text-muted-foreground">Locked items in lists show {section.previews === 'thumbnail' ? 'their title and a thumbnail' : 'their title only'}.</li>
          </ul>
        ) : (
          <p className="mt-2 text-sm text-foreground">The published catalog cannot be read by this version of the app: no Learn item opens for anyone but admins.</p>
        )}
      </section>

      <section aria-labelledby="learn-items" className="mt-6">
        <h2 id="learn-items" className="text-lg font-semibold text-foreground">Items in {shown}</h2>
        {itemsOf(working).length === 0 && <p className="mt-2 text-sm text-muted-foreground">No items yet.</p>}
        {LEARN_COLLECTIONS.map((collection) => {
          const items = orderedItems(working, collection);
          if (items.length === 0) return null;
          return (
            <div key={collection} className="mt-3 overflow-x-auto rounded-2xl border border-border bg-card">
              <table className="w-full min-w-[44rem] text-left text-sm">
                <caption className="px-4 pt-3 text-left text-sm font-semibold text-foreground">{COLLECTION_LABELS[collection]}</caption>
                <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2">#</th>
                    <th className="px-4 py-2">ID</th>
                    <th className="px-4 py-2">Title (English · Hebrew)</th>
                    <th className="px-4 py-2">Group</th>
                    <th className="px-4 py-2">State</th>
                    <th className="px-4 py-2">References</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, index) => (
                    <tr key={item.id} className="border-t border-border align-top">
                      <td className="px-4 py-2 text-muted-foreground">{index + 1}</td>
                      <td className="px-4 py-2 font-mono text-xs text-foreground">
                        {item.id}
                        {/* The live version as learners see it (ADR-0018); admins open unpublished items too. */}
                        {liveIds.has(item.id) && (
                          <Link href={itemPath(item.id)} className="mt-1 block font-sans text-xs text-primary underline-offset-2 hover:underline">
                            Open in the studio
                          </Link>
                        )}
                      </td>
                      <td className="px-4 py-2 text-foreground">
                        {item.title.en}
                        <span className="block text-muted-foreground" dir="rtl" lang="he">{item.title.he}</span>
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">{item.groupId}</td>
                      <td className="px-4 py-2 text-foreground">{item.published ? 'Published' : 'Unpublished (admins only)'}</td>
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap gap-2">
                          {item.references.length === 0 && <span className="text-muted-foreground">{item.kind === 'challenge' ? `none (${item.reference.replace('_', ' ')})` : 'none'}</span>}
                          {item.references.map((ref) => {
                            const doc = assetById.get(ref.assetId);
                            const thumb = doc?.thumbnailAssetId;
                            return thumb ? (
                              // eslint-disable-next-line @next/next/no-img-element -- served by the authorized asset route, never from public/
                              <img key={ref.assetId} src={`/api/learn/assets/${thumb}`} alt={ref.alt.en} className="h-16 w-16 rounded-lg border border-border object-cover" />
                            ) : (
                              <span key={ref.assetId} className="font-mono text-xs text-destructive">{ref.assetId.slice(0, 12)}… missing</span>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </section>

      <section aria-labelledby="learn-assets" className="mt-6">
        <h2 id="learn-assets" className="text-lg font-semibold text-foreground">Assets ({originals.length})</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Files on the server, outside the app and outside public/, named by their SHA-256; served only to accounts allowed to open an item that uses
          them. Every reference carries where it comes from and on what terms; each has a thumbnail ({assets.length - originals.length} in all).
        </p>
        <ul className="mt-3 grid gap-3 md:grid-cols-2">
          {originals.map((asset) => (
            <li key={asset._id} className="flex gap-3 rounded-2xl border border-border bg-card p-3 text-sm">
              {asset.thumbnailAssetId && (
                // eslint-disable-next-line @next/next/no-img-element -- served by the authorized asset route, never from public/
                <img src={`/api/learn/assets/${asset.thumbnailAssetId}`} alt="" className="h-20 w-20 shrink-0 rounded-lg border border-border object-cover" />
              )}
              <div className="min-w-0">
                <p className="font-semibold text-foreground">{asset.licence?.title ?? '—'}</p>
                <p className="text-muted-foreground">
                  {asset.licence?.author ?? '—'} · {asset.licence?.kind === 'cc0' ? 'CC0' : asset.licence?.kind ?? 'no licence'}
                  {asset.licence?.licenceUrl && (
                    <>
                      {' '}
                      (<a href={asset.licence.licenceUrl} className="underline" rel="noreferrer" target="_blank">licence</a>)
                    </>
                  )}
                </p>
                {asset.licence && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    <a href={asset.licence.source} className="underline" rel="noreferrer" target="_blank">Source</a> · rights checked {asset.licence.checkedAt}: {asset.licence.rights}
                    {asset.licence.attribution ? ` · Credit: ${asset.licence.attribution}` : ''}
                  </p>
                )}
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  {asset._id.slice(0, 16)}… · {asset.contentType} · {asset.width ?? '?'}×{asset.height ?? '?'} · {bytes(asset.bytes)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <VersionHistory
        kind="learn_content"
        versions={versions.map((v) => ({ version: v.version, status: v.status as 'published' | 'archived', publishedAt: v.publishedAt?.toISOString() ?? null, publishedBy: publishedByLabel(v.publishedBy, admin.id.toHexString()), note: v.note }))}
      />
    </AdminShell>
  );
}
