import type { Metadata } from 'next';
import { signInMethods } from '@/server/account-management';
import { CatalogSchema, catalogSpec, describeCatalogChanges, type Catalog } from '@/server/config/catalog';
import { getDraft, getPublished, listVersions } from '@/server/config/versions';
import { getDb } from '@/server/db/client';
import { requireAdmin } from '@/server/session';
import { AdminShell } from '../AdminShell';
import { DraftBar, VersionHistory } from '../ConfigControls';
import { publishedByLabel } from '../format';
import { CatalogEditor, type CatalogForm } from './CatalogEditor';

// Plans and features (docs/adr/0006): what each plan includes, quotas, and
// features switched off, as versioned drafts an admin publishes.

export const metadata: Metadata = { title: 'Plans · Studio Companion admin', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

// Parsed by CatalogSchema, so every field is present (the optional types come
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
  const live: Catalog = published ? CatalogSchema.parse(published.document) : catalogSpec.defaults();
  const draftDoc = draft ? CatalogSchema.safeParse(draft.document) : null;
  const working = draftDoc?.success ? draftDoc.data : live;
  return (
    <AdminShell active="plans">
      <h1 className="mt-6 text-2xl font-bold tracking-tight text-foreground">Plans and features</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        What Free and Pro include, with optional quotas. Changes go into a draft and apply to everyone only when you publish them; earlier versions
        can be restored. Admins always have every feature.
      </p>
      <div className="mt-4">
        <DraftBar
          kind="catalog"
          draftVersion={draft?.version ?? null}
          publishedVersion={published?.version ?? null}
          changes={draft ? describeCatalogChanges(live, working) : []}
          viewer={{ email: admin.user.email, hasPassword: methods.password !== null, returnTo: '/admin/plans' }}
        />
      </div>
      <CatalogEditor key={`${draft?.version ?? 'live'}-${draft?.updatedAt?.getTime() ?? 0}`} catalog={toForm(working)} editable={draft !== null} />
      <VersionHistory
        kind="catalog"
        versions={versions.map((v) => ({ version: v.version, status: v.status as 'published' | 'archived', publishedAt: v.publishedAt?.toISOString() ?? null, publishedBy: publishedByLabel(v.publishedBy, admin.id.toHexString()), note: v.note }))}
      />
    </AdminShell>
  );
}
