'use server';

import { z } from 'zod';
import { CURRENCIES } from '@/lib/locale';
import { getRequestLocale, getT } from '@/i18n/server';
import { getPayPalClient, type PayPalClient } from '@/server/billing/paypal/client';
import { checkoutState, startCheckout, type CheckoutResult } from '@/server/billing/paypal/subscriptions';
import { getDb } from '@/server/db/client';
import { toObjectId } from '@/server/db/collections';
import { authConfig } from '@/server/env';
import { consumeThrottle } from '@/server/security/throttle';
import { getSession } from '@/server/session';

// Checkout's own actions (docs/billing/03-paypal.md). Next.js accepts them only
// from this site's pages (it compares Origin and Host); each takes the account
// from the verified session, never from its input. The input is only what
// the page showed, so the server can refuse when the price moved since.

export type BeginResult = { ok: true; url: string } | { ok: false; message: string; refresh?: boolean };

const BeginInput = z
  .object({
    amountMinor: z.number().int().positive().max(100_000_000),
    currency: z.enum(CURRENCIES),
    rateDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    consent: z.boolean(),
  })
  .strict();

function paypal(): PayPalClient | null {
  try {
    return getPayPalClient();
  } catch {
    return null;
  }
}

async function caller() {
  const session = await getSession();
  return session ? toObjectId(session.user.id) : null;
}

export async function beginCheckout(input: unknown): Promise<BeginResult> {
  const t = await getT('billing');
  const userId = await caller();
  if (!userId) return { ok: false, message: t('errors.signedOut') };
  const parsed = BeginInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: t('errors.invalid') };
  const db = getDb();
  if (!(await consumeThrottle(db, 'billing.checkout', userId.toHexString(), { limit: 10, windowSeconds: 60 * 60 })).allowed) {
    return { ok: false, message: t('errors.throttled') };
  }
  const client = paypal();
  if (!client) return { ok: false, message: t('unavailable.no_price') };
  const shown = { amountMinor: parsed.data.amountMinor!, currency: parsed.data.currency!, rateDate: parsed.data.rateDate ?? null };
  const result = await startCheckout(db, client, { userId, shown, consent: parsed.data.consent === true, baseUrl: authConfig().baseURL });
  if ('approveUrl' in result) return { ok: true, url: result.approveUrl };
  const failure = result as Extract<CheckoutResult, { ok: false }>;
  switch (failure.reason) {
    case 'price_changed':
      return { ok: false, message: t('errors.price_changed'), refresh: true };
    case 'consent_required':
      return { ok: false, message: t('errors.consent_required') };
    case 'paypal_unavailable':
      return { ok: false, message: t('errors.paypal_unavailable') };
    case 'paypal_refused':
      return { ok: false, message: t('errors.paypal_refused') };
    case 'paid_until': {
      const locale = await getRequestLocale();
      const date = new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(failure.until ?? new Date());
      return { ok: false, message: t('unavailable.paid_until', { date }), refresh: true };
    }
    case 'rate_unavailable':
      return { ok: false, message: t('unavailable.rate_unavailable'), refresh: true };
    case 'not_open':
      return { ok: false, message: t('unavailable.not_open'), refresh: true };
    case 'email_not_verified':
      return { ok: false, message: t('unavailable.email_not_verified'), refresh: true };
    case 'already_subscribed':
      return { ok: false, message: t('unavailable.already_subscribed'), refresh: true };
    case 'account_unavailable':
      return { ok: false, message: t('unavailable.account_unavailable'), refresh: true };
    default:
      return { ok: false, message: t('unavailable.no_price'), refresh: true };
  }
}

export type CheckoutStateResult = { state: 'not_found' | 'cancelled' | 'pending' | 'active' | 'duplicate' | 'payment_issue' | 'ended' | 'expired'; paidThrough?: string | null };

/** The return page asks while PayPal confirms: read from PayPal by the server, for the signed-in account's own checkout only. */
export async function checkCheckout(sessionId: unknown): Promise<CheckoutStateResult> {
  const userId = await caller();
  if (!userId || typeof sessionId !== 'string' || !/^cs_[A-Za-z0-9_-]{10,40}$/.test(sessionId)) return { state: 'not_found' };
  const db = getDb();
  if (!(await consumeThrottle(db, 'billing.checkout_state', userId.toHexString(), { limit: 240, windowSeconds: 10 * 60 })).allowed) return { state: 'pending' };
  const result = await checkoutState(db, paypal(), sessionId, userId);
  return { state: result.state, paidThrough: 'paidThrough' in result && result.paidThrough ? result.paidThrough.toISOString() : null };
}
