import 'server-only';
import type { PlanId, SubscriptionStatus } from '@/server/db/collections';

// The contract a payment provider (Stripe, Paddle, …) will implement once one
// is chosen. Nothing is wired to HTTP yet and no real billing is active.
//
// Rules for an implementation:
// - `verifyWebhook` checks the provider's signature over the exact raw request
//   body and throws on any mismatch. An unverified body is never trusted.
// - The user id comes from metadata the server attached when it created the
//   checkout session — never from the browser.

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
}

/** A webhook event that passed signature verification. */
export interface VerifiedPaymentEvent {
  provider: string;
  /** The provider's unique event id; processing is idempotent on it. */
  eventId: string;
  type: string;
  /** Present when the event changes a subscription (created, renewed, cancelled, failed, expired). */
  subscription?: ProviderSubscription;
}

export interface PaymentProvider {
  id: string;
  verifyWebhook(rawBody: string, headers: Headers): Promise<VerifiedPaymentEvent>;
}
