import 'server-only';
import type { CheckoutSessionDoc, PlanId, SubscriptionStatus } from '@/server/db/collections';
import type { Price } from '@/server/config/pricing';

// ─── The payment provider contract (docs/adr/0008, docs/billing/) ─────────────
// What any provider (Paddle, Lemon Squeezy, an Israeli PSP… once one is
// chosen, docs/billing/01-provider-research.md) must offer. None is connected
// yet. Provider-specific code stays in its adapter; the rest of the app sees
// only these normalised shapes.
//
// Rules for an implementation:
// - `verifyWebhook` checks the provider's signature over the exact raw request
//   body and throws on any mismatch. An unverified body is never trusted.
// - The account comes from data the server attached when it created the
//   checkout (our checkout session id / user id) — never from the browser.
// - Card details never touch this app: checkout and payment-method changes
//   happen on the provider's hosted pages.

/** A subscription's state as reported by the provider, normalised. */
export interface ProviderSubscription {
  userId: string;
  planId: PlanId;
  providerCustomerId: string;
  providerSubscriptionId: string;
  status: SubscriptionStatus;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  priceId?: string | null;
  interval?: 'month' | 'year' | null;
  currency?: string | null;
  amountMinor?: number | null;
  trialEndsAt?: Date | null;
  couponCode?: string | null;
  endedAt?: Date | null;
}

/** Money that moved, as reported by the provider. */
export interface ProviderPayment {
  providerPaymentId: string;
  providerSubscriptionId: string | null;
  userId: string;
  kind: 'charge' | 'refund' | 'chargeback';
  status: 'succeeded' | 'failed';
  amountMinor: number;
  currency: string;
  occurredAt: Date;
  receiptUrl: string | null;
}

/** A webhook event that passed signature verification. */
export interface VerifiedPaymentEvent {
  provider: string;
  /** The provider's unique event id; processing is idempotent on it. */
  eventId: string;
  type: string;
  /** When the provider says it happened (orders events that arrive out of order). */
  occurredAt?: Date;
  /** Our checkout session, echoed back by the provider when the event completes one. */
  checkoutSessionId?: string | null;
  /** Present when the event changes a subscription (created, renewed, cancelled, failed, expired). */
  subscription?: ProviderSubscription;
  /** Present when money moved (charge, refund, chargeback). */
  payment?: ProviderPayment;
}

export interface CheckoutCoupon {
  code: string;
  kind: 'percent' | 'fixed';
  percentOff: number | null;
  amountOffMinor: number | null;
}

export interface PaymentProvider {
  id: string;
  /** The provider's hosted checkout for a session this server created. */
  createCheckout(input: {
    session: CheckoutSessionDoc;
    price: Price;
    user: { id: string; email: string };
    coupon: CheckoutCoupon | null;
    returnUrl: string;
  }): Promise<{ url: string }>;
  verifyWebhook(rawBody: string, headers: Headers): Promise<VerifiedPaymentEvent>;
  /** The provider's current view of a subscription (reconciliation). */
  fetchSubscription(providerSubscriptionId: string): Promise<ProviderSubscription | null>;
  cancelSubscription(providerSubscriptionId: string, mode: 'period_end' | 'now'): Promise<void>;
  resumeSubscription(providerSubscriptionId: string): Promise<void>;
  changePrice(providerSubscriptionId: string, price: Price): Promise<void>;
  refundPayment(providerPaymentId: string): Promise<void>;
  /** The provider's customer portal (payment method, receipts, cancellation). */
  portalUrl(providerCustomerId: string, returnUrl: string): Promise<string>;
}
