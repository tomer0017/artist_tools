import type { Metadata } from 'next';
import { formatMoney } from '@/lib/money';
import { listCoupons } from '@/server/coupons';
import { getDb } from '@/server/db/client';
import { requireAdmin } from '@/server/session';
import { AdminShell } from '../AdminShell';
import { dateOnly } from '../format';
import { CouponForm, CouponStatusButton } from './CouponControls';

// Discount codes for paid plans: defined here now, redeemed at checkout once
// paid plans launch (Phase 4). Never deleted, only switched off.

export const metadata: Metadata = { title: 'Coupons · Studio Companion admin', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function AdminCouponsPage() {
  await requireAdmin('/admin/coupons');
  const coupons = await listCoupons(getDb());
  const now = new Date();
  return (
    <AdminShell active="coupons">
      <h1 className="mt-6 text-2xl font-bold tracking-tight text-foreground">Coupons</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Discount codes for Pro. They can be created and tested now; customers can use them once paid plans launch. A code can be switched off, never
        deleted, so its history stays readable.
      </p>
      <div className="mt-4">
        <CouponForm />
      </div>
      <section aria-label="All coupons" className="mt-6 rounded-2xl border border-border bg-card p-4 md:p-5">
        <h2 className="text-base font-semibold text-foreground">All coupons</h2>
        {coupons.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">None yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {coupons.map((c) => {
              const discount = c.kind === 'percent' ? `${c.percentOff}% off` : `${formatMoney(c.amountOffMinor ?? 0, c.currency ?? 'USD')} off`;
              const live = c.status === 'active' && c.startsAt <= now && (!c.endsAt || c.endsAt > now);
              return (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-mono font-semibold text-foreground">{c.code}</p>
                    <p className="text-xs text-muted-foreground">
                      {discount} · {c.appliesTo.length ? c.appliesTo.join(', ') : 'every Pro price'} · from {dateOnly(c.startsAt)}
                      {c.endsAt ? ` to ${dateOnly(c.endsAt)}` : ''} · used {c.redemptions}
                      {c.maxRedemptions ? ` of ${c.maxRedemptions}` : ''} · {c.maxPerUser} per person
                      {c.note ? ` · ${c.note}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${live ? 'bg-primary/15 text-primary' : 'border border-border text-muted-foreground'}`}>
                      {c.status === 'disabled' ? 'Off' : live ? 'Active' : c.startsAt > now ? 'Scheduled' : 'Ended'}
                    </span>
                    <CouponStatusButton couponId={c.id} status={c.status} code={c.code} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </AdminShell>
  );
}
