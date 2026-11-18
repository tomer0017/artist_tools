import type { Metadata } from 'next';
import { signInMethods } from '@/server/account-management';
import { catalogFromPlans, catalogReadNotes, defaultCatalog, describeCatalogChanges, readCatalog, catalogSpec, type Catalog } from '@/server/config/catalog';
import { getDraft, getPublished, listVersions } from '@/server/config/versions';
import { getDb } from '@/server/db/client';
import { getPlanStates } from '@/server/entitlements';
import { requireAdmin } from '@/server/session';
import { AdminShell } from '../AdminShell';
import { DraftBar, VersionHistory } from '../ConfigControls';
import { publishedByLabel } from '../format';
import { CatalogEditor, type CatalogForm } from './CatalogEditor';
import { CatalogReadNotice } from './CatalogReadNotice';

// Plans and features (docs/adr/0006): what each plan includes, quotas, and
// features switched off, as versioned drafts an admin publishes. A version
// written by a newer release is shown with what this release keeps without
// applying; one it cannot apply in full is read-only here (ADR-0014).

export const metadata: Metadata = { title: 'Plans · Studio Companion admin', robots: { index: false, follow: false } };
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
});

export default async function AdminPlansPage() {
  const admin = await requireAdmin('/admin/plans');
  const db = getDb();
  const [published, draft, versions, methods] = await Promise.all([getPublished(db, catalogSpec), getDraft(db, catalogSpec), listVersions(db, 'catalog'), signInMethods(db, admin.id)]);
  const liveRead = readCatalog(published ? published.document : defaultCatalog());
  const draftRead = draft ? readCatalog(draft.document) : null;
  // What applies now: the published catalog as this release reads it, or the plans in force when it cannot.
  const live: Catalog = liveRead.status === 'unreadable' ? catalogFromPlans(await getPlanStates(db)) : liveRead.catalog;
  const working = draftRead && draftRead.status !== 'unreadable' ? draftRead.catalog : live;
  const liveLabel = `version ${published?.version ?? '—'} (live)`;
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
          changes={draft ? describeCatalogChanges(live, working) : []}
          blocked={blocked}
          viewer={{ email: admin.user.email, hasPassword: methods.password !== null, returnTo: '/admin/plans' }}
        />
      </div>
      <CatalogEditor key={draft ? `draft-${draft.version}` : `live-${published?.version ?? 0}`} catalog={toForm(working)} editable={draft !== null && blocked === null} />
      <VersionHistory
        kind="catalog"
        versions={versions.map((v) => ({ version: v.version, status: v.status as 'published' | 'archived', publishedAt: v.publishedAt?.toISOString() ?? null, publishedBy: publishedByLabel(v.publishedBy, admin.id.toHexString()), note: v.note }))}
      />
    </AdminShell>
  );
}
