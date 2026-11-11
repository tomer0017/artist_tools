# 0008 — Provider-neutral billing; verified webhooks are the source of truth

**Status:** Accepted (2026-11-10), amended 2026-11-11

## Context
The payment provider is not chosen: eligibility for an Israel-based business,
currencies, tax handling and payouts must be verified first (Phase 4). The code
already has a provider contract (`verifyWebhook`) and an idempotent event
processor.

## Decision
- A `PaymentProvider` adapter: create checkout, open customer portal, verify
  webhook (raw body + signature), fetch subscription (for reconciliation).
  Provider-specific code stays inside its adapter.
- Subscription state machine owned by the server: `incomplete → trialing |
  active → past_due → active | canceled → expired`, plus refunds and
  chargebacks recorded as payments. Out-of-order events are resolved by the
  provider's event time/version.
- Pro access from billing comes only from `subscriptions` written by verified
  webhooks or reconciliation. A browser redirect only shows "processing".
- Every event is processed once (`(provider, eventId)` unique) and audited.
- No provider is enabled until the owner authorises one. There is no
  simulated provider in the app *(amended 2026-11-11; the first version
  planned a mock provider)*: the provider-neutral parts are tested with
  verified events built in the tests, and the full lifecycle in the chosen
  provider's sandbox.
- No card data ever touches our servers (hosted checkout/portal only).

## Consequences
- Switching or adding a provider is a new adapter plus price references.
- Reconciliation is required, because webhooks can be missed.

## Alternatives considered
- Integrating a specific provider now: premature until eligibility is verified.
