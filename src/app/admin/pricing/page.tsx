import type { Metadata } from 'next';
import { formatMoney } from '@/lib/money';
import { signInMethods } from '@/server/account-management';
import { PricingSchema, pricingSpec, type Pricing } from '@/server/config/pricing';
import { getDraft, getPublished, listVersions } from '@/server/config/versions';
import { getDb } from '@/server/db/client';
import { requireAdmin } from '@/server/session';
import { AdminShell } from '../AdminShell';
import { DraftBar, VersionHistory } from '../ConfigControls';
import { publishedByLabel } from '../format';
import { PricingEditor, type PriceRow } from './PricingEditor';

// Pro prices per interval and currency (docs/adr/0007), as versioned drafts.
// Not shown to customers until paid plans launch.

export const metadata: Metadata = { title: 'Pricing · Studio Companion admin', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const label = (p: PriceRow) => `${p.interval === 'month' ? 'Monthly' : 'Yearly'} ${p.currency} ${formatMoney(p.amountMinor, p.currency)}${p.trialDays ? `, ${p.trialDays}-day trial` : ''}${p.active ? '' : ' (not offered)'}`;

function changes(live: Pricing, next: Pricing): string[] {
  const before = new Map((live.prices ?? []).map((p) => [p.id, label(p as PriceRow)]));
  const after = new Map((next.prices ?? []).map((p) => [p.id, label(p as PriceRow)]));
  const out: string[] = [];
  for (const [id, text] of after) if (!before.has(id)) out.push(`Adds ${text}`);
  for (const [id, text] of before) if (!after.has(id)) out.push(`Removes ${text}`);
  for (const [id, text] of after) if (before.has(id) && before.get(id) !== text) out.push(`Changes ${before.get(id)} → ${text}`);
  return out;
}

export default async function AdminPricingPage() {
  const admin = await requireAdmin('/admin/pricing');
  const db = getDb();
  const [published, draft, versions, methods] = await Promise.all([getPublished(db, pricingSpec), getDraft(db, pricingSpec), listVersions(db, 'pricing'), signInMethods(db, admin.id)]);
  const live: Pricing = published ? PricingSchema.parse(published.document) : pricingSpec.defaults();
  const parsedDraft = draft ? PricingSchema.safeParse(draft.document) : null;
  const working = parsedDraft?.success ? parsedDraft.data : live;
  return (
    <AdminShell active="pricing">
      <h1 className="mt-6 text-2xl font-bold tracking-tight text-foreground">Pricing</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Pro prices, one per billing interval and currency, kept as exact amounts in cents/agorot. Nothing here is shown to customers or charged
        until paid plans launch with a payment provider.
      </p>
      <div className="mt-4">
        <DraftBar
          kind="pricing"
          draftVersion={draft?.version ?? null}
          publishedVersion={published?.version ?? null}
          changes={draft ? changes(live, working) : []}
          viewer={{ email: admin.user.email, hasPassword: methods.password !== null, returnTo: '/admin/pricing' }}
        />
      </div>
      <PricingEditor key={draft ? `draft-${draft.version}` : `live-${published?.version ?? 0}`} prices={(working.prices ?? []) as PriceRow[]} editable={draft !== null} />
      <VersionHistory
        kind="pricing"
        versions={versions.map((v) => ({ version: v.version, status: v.status as 'published' | 'archived', publishedAt: v.publishedAt?.toISOString() ?? null, publishedBy: publishedByLabel(v.publishedBy, admin.id.toHexString()), note: v.note }))}
      />
    </AdminShell>
  );
}
