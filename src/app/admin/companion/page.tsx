import type { Metadata } from 'next';
import { listVersions } from '@/server/config/versions';
import { companionForEdit } from '@/server/companion/editor';
import { getDb } from '@/server/db/client';
import { requireAdmin } from '@/server/session';
import { AdminShell } from '../AdminShell';
import { publishedByLabel } from '../format';
import { CompanionManager } from './CompanionManager';

// Admin → Companion (ADR-0024): Sketchy, the studio companion. Switch him on
// or off, his size and pace, each animation (with a preview of every one),
// who may use each of his capabilities (Free, Pro, Admin only, Blocked), and
// every tip he can show, in English and Hebrew: where, for whom, when, with
// which animation and which button. Each save is live at once as a new
// version of the configuration; any earlier version can be restored.

export const metadata: Metadata = { title: 'Companion · Studio Companion admin', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function AdminCompanionPage() {
  const admin = await requireAdmin('/admin/companion');
  const db = getDb();
  const [live, versions] = await Promise.all([companionForEdit(db), listVersions(db, 'companion', 60)]);
  return (
    <AdminShell active="companion">
      <h1 className="mt-6 text-2xl font-bold tracking-tight text-foreground">Sketchy, the studio companion</h1>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
        The fox artist who lives on the studio&apos;s Home and the Learn home. Everything here is live in the studio as soon as you save it (open studios
        follow within a minute), and every save is kept in the history below. He only ever offers what the person&apos;s own plan opens: a locked tool, a
        closed Learn module or missing worksheets mean the tip is not shown to them.
      </p>
      {'blocked' in live ? (
        <p role="alert" className="mt-4 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-foreground">
          {live.blocked}
        </p>
      ) : (
        <CompanionManager
          config={{ settings: live.config.settings, access: live.config.access, tips: live.config.tips }}
          hashes={live.hashes}
          liveVersion={live.version}
          versions={versions.map((v) => ({ version: v.version, live: v.status === 'published', at: v.publishedAt?.toISOString() ?? null, by: publishedByLabel(v.publishedBy, admin.id.toHexString()), note: v.note }))}
        />
      )}
    </AdminShell>
  );
}
