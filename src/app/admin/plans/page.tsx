import type { Metadata } from 'next';
import { signInMethods } from '@/server/account-management';
import { accessModeOf, legacyLearnOf } from '@/lib/learn/access';
import { ACCESS_MODES, emptyContent, itemsOf, type AccessMode, type LearnContent } from '@/lib/learn/model';
import { catalogFromPlans, catalogReadNotes, defaultCatalog, describeCatalogChanges, learnSectionOf, readCatalog, catalogSpec, type Catalog } from '@/server/config/catalog';
import { UnreadableConfigError, getDraft, getPublished, listVersions } from '@/server/config/versions';
import { learnContentSpec, publishedLearnContent } from '@/server/learn/content';
import { getDb } from '@/server/db/client';
import { getPlanStates } from '@/server/entitlements';
import { requireAdmin } from '@/server/session';
import { AdminShell } from '../AdminShell';
import { DraftBar, VersionHistory } from '../ConfigControls';
import { publishedByLabel } from '../format';
import { CatalogEditor, type CatalogForm, type LearnCounts } from './CatalogEditor';
import { CatalogReadNotice } from './CatalogReadNotice';

// Plans and features (docs/adr/0006): what each plan includes, quotas, and
// features switched off, as versioned drafts an admin publishes. Learn access
// is per item in Admin → Learn (ADR-0023); this page only sums it up. A version written by a newer release
// is shown with what this release keeps without applying; one it cannot apply
// in full is read-only here (ADR-0014).

export const metadata: Metadata = { title: 'Plans · SketchyArtLab admin', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

// Read by readCatalog, so every field is present (the optional types come
// from zod's inference without strictNullChecks).
type Quotas = CatalogForm['plans']['free']['quotas'];
const toForm = (c: Catalog): CatalogForm => ({
  plans: {
    free: { features: c.plans.free.features ?? [], quotas: (c.plans.free.quotas ?? {}) as Quotas },
    pro: { features: c.plans.pro.features ?? [], quotas: (c.plans.pro.quotas ?? {}) as Quotas },
  },
  disabled: c.disabled ?? [],
  learn: learnSectionOf(c),
});

export default async function AdminPlansPage() {
  const admin = await requireAdmin('/admin/plans');
  const db = getDb();
  const [published, draft, versions, methods, contentVersion] = await Promise.all([
    getPublished(db, catalogSpec),
    getDraft(db, catalogSpec),
    listVersions(db, 'catalog'),
    signInMethods(db, admin.id),
    getPublished(db, learnContentSpec).then((v) => v?.version ?? null),
  ]);
  // The published Learn content, for Selected lists and the items each plan gains and loses.
  let content: LearnContent = emptyContent();
  let contentNote: string | null = null;
  let learnCounts: LearnCounts | null = null;
  try {
    content = await publishedLearnContent(db);
    const legacy = legacyLearnOf(await getPlanStates(db));
    learnCounts = Object.fromEntries([...ACCESS_MODES, 'archived'].map((k) => [k, 0])) as Record<AccessMode | 'archived', number>;
    for (const item of itemsOf(content)) learnCounts[item.archived ? 'archived' : accessModeOf(item, legacy)] += 1;
  } catch (error) {
    if (!(error instanceof UnreadableConfigError)) throw error;
    contentNote = `The published Learn content (version ${error.version}) cannot be read by this version of the app.`;
  }
  const liveRead = readCatalog(published ? published.document : defaultCatalog());
  const draftRead = draft ? readCatalog(draft.document) : null;
  // What applies now: the published catalog as this release reads it, or the plans in force when it cannot.
  const live: Catalog = liveRead.status === 'unreadable' ? catalogFromPlans(await getPlanStates(db)) : liveRead.catalog;
  const working = draftRead && draftRead.status !== 'unreadable' ? draftRead.catalog : live;
  const liveLabel = `version ${published?.version ?? '—'} (live)`;
  // A draft this release can apply (an earlier version restored) may replace a live version it cannot: say so, even when the plans stay the same.
  const replaces = published && liveRead.status !== 'ok' ? [`Replaces version ${published.version}, which this version of the app ${liveRead.status === 'unreadable' ? 'cannot read' : 'cannot apply in full'}`] : [];
  const blocked =
    draftRead && draftRead.status !== 'ok'
      ? `Draft version ${draft!.version} has settings this version of the app cannot edit or publish. Discard it here, or finish it with the release that wrote it.`
      : !draft && liveRead.status !== 'ok'
        ? `A draft cannot be started here: ${liveLabel} has settings this version of the app cannot apply in full. To go back to an earlier version, restore it from the history below.`
        : null;
  return (
    <AdminShell active="plans">
      <h1 className="mt-6 text-2xl font-bold tracking-tight text-foreground">Plans and features</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        What Free and Pro include, with optional quotas. Changes go into a draft and apply to everyone only when you publish them; earlier versions
        can be restored. Admins always have every feature.
      </p>
      <CatalogReadNotice label={liveLabel} status={liveRead.status} notes={catalogReadNotes(liveRead)} />
      {draft && draftRead && <CatalogReadNotice label={`draft version ${draft.version}`} status={draftRead.status} notes={catalogReadNotes(draftRead)} />}
      <div className="mt-4">
        <DraftBar
          kind="catalog"
          draftVersion={draft?.version ?? null}
          publishedVersion={published?.version ?? null}
          changes={draft ? [...replaces, ...describeCatalogChanges(live, working, content)] : []}
          blocked={blocked}
          viewer={{ email: admin.user.email, hasPassword: methods.password !== null, returnTo: '/admin/plans' }}
        />
      </div>
      {contentNote && <p role="alert" className="mt-4 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-foreground">{contentNote}</p>}
      <CatalogEditor
        key={draft ? `draft-${draft.version}` : `live-${published?.version ?? 0}`}
        catalog={toForm(working)}
        editable={draft !== null && blocked === null}
        learnCounts={learnCounts}
        contentVersion={contentVersion}
      />
      <VersionHistory
        kind="catalog"
        versions={versions.map((v) => ({ version: v.version, status: v.status as 'published' | 'archived', publishedAt: v.publishedAt?.toISOString() ?? null, publishedBy: publishedByLabel(v.publishedBy, admin.id.toHexString()), note: v.note }))}
      />
    </AdminShell>
  );
}
