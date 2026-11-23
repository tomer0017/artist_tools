# 0022 — PayPal subscriptions: one USD price, locked per subscriber

**Status:** Accepted (2026-11-23). Amends [0007](0007-money-and-currencies.md)
and [0008](0008-provider-neutral-billing.md).

## Context
The owner chose PayPal (Subscriptions API v1) and decided:
- one monthly Pro price in USD;
- ILS charged at the Bank of Israel's latest representative rate;
- the currency is the customer's Profile preference;
- existing subscribers keep their agreed amount and currency;
- "stop renewal" keeps Pro until the paid-through date, separate from refund requests.

PayPal's documentation (v1.11 schema, read 2026-11-23) says:
- editing a plan's price applies to existing subscribers after 10 days;
- each plan has a single currency;
- a cancellation is immediate, with no end-of-term option;
- no payer country is exposed before approval.

## Decision
- **One PayPal plan per environment and currency.**
  - Every subscription is created with its own price ("plan override"): "once overridden, changes to plan resource will not impact subscription".
  - A rate or price change therefore needs no PayPal call, and existing subscriptions cannot change.
  - The server checks the price PayPal holds before sending the customer to approve, and reconciliation checks every charge against it.
- **ILS amounts.** ILS = the USD cents × the rate in millionths, rounded half up to the agora, with exact integer arithmetic.
  - This amends ADR-0007's "no conversion": the conversion happens once, at checkout, and is then fixed.
  - The rate, its date, the amount, the currency, the plan and the consent are stored on the subscription.
- **Access.** Access comes from `paidThrough`, which is mirrored into `currentPeriodEnd` so older releases still honour it.
  - It is set after every verified payment from PayPal's next billing time, and is never shortened except by a refund or chargeback.
  - Statuses map onto the existing ones: SUSPENDED → `past_due`, CANCELLED → `canceled`, and so on.
  - `GRACE_DAYS` becomes 7, covering PayPal's first retry.
- **Stopping renewal cancels at PayPal at once.** This amends ADR-0008's `cancel(period_end)`: PayPal has no equivalent.
  Pro lasts until `paidThrough`.
- **Refund requests** are recorded with a policy suggestion and decided by the owner. There are no automatic refunds.
- **Webhooks.**
  - They are verified by PayPal's own verify-webhook-signature call, with the raw body passed on unchanged.
  - Each is stored once and can be retried after a failure.
  - They are used only as a prompt to re-read the state from PayPal.
- **Checkout is a full-page redirect** to PayPal's approval link. No PayPal script is loaded on our pages and the CSP is unchanged.

## Consequences
- ILS subscribers' amounts drift from the USD price as the rate moves; changing them would need a separate, compliant process.
- `application_context` (return URL, brand, no shipping) is marked deprecated in v1.11, with no replacement for most of its fields.
  It is used for now; the adapter is small enough to move to PayPal's v6 JavaScript SDK if it is removed.
- The rest of the billing core (metrics per currency, admin views, entitlements) is reused unchanged in shape.

## Alternatives considered
- **A new PayPal plan per rate:** about 250 plans a year, all kept active forever. Rejected.
- **Separate regional prices with a declared country:** the owner chose the currency preference instead.
- **A scheduled cancellation at period end:** if the job missed, the customer would be charged. Rejected.
