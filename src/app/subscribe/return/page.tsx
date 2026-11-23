import type { Metadata } from 'next';
import Link from 'next/link';
import { BrandMark } from '@/components/shell/BrandMark';
import { getT } from '@/i18n/server';
import { getPayPalClient, type PayPalClient } from '@/server/billing/paypal/client';
import { cancelCheckout, checkoutState } from '@/server/billing/paypal/subscriptions';
import { getDb } from '@/server/db/client';
import { toObjectId } from '@/server/db/collections';
import { requireStudioAccount } from '@/server/studio-account';
import type { CheckoutStateResult } from '../actions';
import { CheckoutStatus } from './CheckoutStatus';

// Where PayPal sends the customer back. Arriving here grants nothing: the
// server reads the subscription from PayPal (src/server/billing/paypal/) and
// shows what PayPal says, for the signed-in account's own checkout only.

export const metadata: Metadata = { title: 'Subscription · Studio Companion', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

function paypal(): PayPalClient | null {
  try {
    return getPayPalClient();
  } catch {
    return null;
  }
}

export default async function SubscribeReturnPage({ searchParams }: { searchParams: Promise<{ checkout?: string | string[]; cancelled?: string | string[] }> }) {
  const params = await searchParams;
  const raw = typeof params.checkout === 'string' ? params.checkout : '';
  const sessionId = /^cs_[A-Za-z0-9_-]{10,40}$/.test(raw) ? raw : null;
  const { account } = await requireStudioAccount(sessionId ? `/subscribe/return?checkout=${sessionId}` : '/subscribe/return');
  const t = await getT('billing');
  const db = getDb();
  const userId = toObjectId(account.id)!;

  let initial: CheckoutStateResult = { state: 'not_found' };
  if (sessionId) {
    if (params.cancelled) await cancelCheckout(db, sessionId, userId);
    const state = await checkoutState(db, paypal(), sessionId, userId);
    initial = { state: state.state, paidThrough: 'paidThrough' in state && state.paidThrough ? state.paidThrough.toISOString() : null };
  }

  return (
    <main className="min-h-[100dvh] bg-background" style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="mx-auto w-full max-w-xl px-4 pb-12 pt-5 md:px-6 md:pt-8">
        <header className="flex items-center justify-between gap-4">
          <Link href="/app" aria-label={t('result.openStudio')} className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <BrandMark />
          </Link>
        </header>
        <h1 className="mt-8 text-[28px] font-bold leading-tight tracking-tight text-foreground">{t('result.title')}</h1>
        <CheckoutStatus sessionId={sessionId} initial={initial} />
      </div>
    </main>
  );
}
