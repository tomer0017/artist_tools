# Billing architecture (provider-neutral)

**Written:** 2026-11-11. **State:** the provider-neutral core is built and
tested locally. **No payment provider is connected, and nobody can pay.**
Decisions are in [ADR-0007](../adr/0007-money-and-currencies.md) (money) and
[ADR-0008](../adr/0008-provider-neutral-billing.md) (billing). The provider
comparison is in [01-provider-research.md](01-provider-research.md).

## Rules

1. **The payment provider's records are the source of truth for money and
   subscription state.** This app stores what the provider's *verified*
   notifications (webhooks) say. When the two disagree, reconciliation
   corrects our copy.
2. **Pro from billing comes only from `subscriptions` rows written by the
   server** from verified events or reconciliation. A browser returning from
   checkout grants nothing. It can only read the checkout's status.
3. **No card data here.** Checkout, payment-method changes and receipts happen
   on the provider's hosted pages.
4. **Every notification is applied at most once, and older state never
   overwrites newer state.** Every change is audited.
5. **Money is stored as integers in minor units, per currency.** Nothing is
   converted between currencies. MRR and ARR are reported separately for
   each currency.

## Parts

| Part | Where | State |
|---|---|---|
| Provider contract (checkout, webhook verification, fetch/cancel/resume/change price, refund, portal) | `src/server/billing/provider.ts` | Done |
| Generic webhook signature check (`t=<unix>,v1=<HMAC-SHA256>`; 5-minute window; constant-time compare) | `src/server/billing/signature.ts` | Done, tested. An adapter uses its provider's own scheme where that differs |
| Event processor: idempotent, safe when events arrive out of order, records payments, links the provider's customer, redeems coupons, completes checkouts | `src/server/billing/process.ts` | Done, tested |
| Checkout sessions: a published active price; a verified, active account with no live subscription; an eligible coupon | `src/server/billing/checkout.ts` | Done, tested (server side) |
| Revenue figures: MRR/ARR per currency, live counts, 30-day churn, refunds, failed payments, disputes | `src/server/billing/metrics.ts` | Done, tested; also feeds `/admin/analytics` |
| Reconciliation against the provider | `src/server/billing/reconcile.ts` | Done, tested |
| Admin view (read-only) | `/admin/billing` | Done |
| Entitlements from subscriptions (active, trialing; past due within the grace period; cancelled until the period ends) | `src/server/entitlements.ts` | Done (Phase 2) |
| **Provider adapter** | — | Not started: needs the owner's choice and a sandbox account |
| Webhook route `POST /api/billing/webhook/<provider>` | — | Not started (needs an adapter) |
| Checkout route, return page ("confirming your payment…"), buttons on the plans page | — | Not started |
| Customer-portal link and cancellation on the account page | — | Not started |
| Scheduled reconciliation (daily) | — | Not started |
| Payment-failure and renewal emails | — | Decision: the provider's own, or ours |
| Invoices, receipts, VAT | Provider (merchant of record) or an Israeli invoicing service (direct payment processor) | Owner and accountant decision |

## Data

| Collection | What | Key indexes |
|---|---|---|
| `subscriptions` | One per provider subscription: status, period, cancel-at-period-end, price, interval, currency, amount, trial end, coupon, `endedAt`, `lastEventAt` | unique `(provider, providerSubscriptionId)`; by user; by `updatedAt` |
| `payment_events` | Every notification received: its type and processing status (`processing`, `processed`, `ignored`, `failed`) and any error | unique `(provider, eventId)`; by time |
| `payments` | Charges, refunds and chargebacks (succeeded or failed), with amount, currency and the provider's receipt link | unique `(provider, providerPaymentId)`; by user; by time |
| `billing_customers` | The provider's customer id for each account | unique `(provider, userId)` |
| `checkout_sessions` | Checkouts started by the server (`open` → `completed`; read as `expired` after one hour) | TTL: deleted 7 days after expiry |
| `reconciliation_runs` | Each check against the provider: what was checked, corrected, and not found | by time |
| `coupon_redemptions` | One per coupon use, written when the subscription it started is created | by `(couponId, userId)` |

All of these collections are new and empty, and nothing in them is
destructive. Rolling back the code leaves them in place, unused.

## Subscription states

`incomplete → trialing | active → past_due → active | canceled → expired`

| State | Pro access |
|---|---|
| `trialing`, `active` | Yes, until 3 days after the period ends (grace period while a renewal is being processed) |
| `past_due` (payment failed) | Yes, during those 3 days; after that, no |
| `canceled` | Until the end of the paid period |
| `expired`, `incomplete` | No |

Access always takes the best of three sources: the plan an admin assigned, a
live promotional grant, and the subscription. Admins have every feature.

## Flows

1. **Checkout.**
   - `openCheckoutSession` checks the price, the account and the coupon, then
     records a session (`cs_…`, valid for one hour).
   - The adapter's `createCheckout` sends the person to the provider's hosted
     page, with the session id and account id attached as the provider's
     custom data.
   - The provider's verified notification echoes them back. The processor
     marks the checkout `completed` and writes the subscription.
   - The return page only reads `checkoutStatus` for the signed-in account.
2. **Renewal.** The provider charges and notifies. A payment is recorded and
   the subscription's period moves on.
3. **Failed payment.** A failed charge is recorded and the status becomes
   `past_due`. The provider retries. The outcome is either `active` again or,
   in the end, `canceled`/`expired`.
4. **Cancellation.**
   - The person cancels through the provider's portal, or through our button,
     which calls `cancelSubscription(…, 'period_end')`.
   - The provider sets cancel-at-period-end. When the period ends, it sends an
     expiry notification.
   - Resuming before then: `resumeSubscription`.
5. **Monthly ↔ yearly.** `changePrice`. The provider prorates the charge and
   its notification updates the price and amount.
6. **Refunds and chargebacks** are recorded as payments. Any change to the
   subscription comes as its own notification. What happens to access after
   a refund is a policy decision for the owner.
7. **Reconciliation.**
   - For live subscriptions and those changed in the last 90 days, the
     provider's current status, period end, cancel-at-period-end and price are
     compared with ours.
   - Where they differ, ours is corrected and audited (`billing.reconciled`).
   - Subscriptions the provider does not know are listed and left alone for an
     admin to look into.
   - A correction counts as the newest event, so a late, older notification
     cannot undo it.

## Ordering and duplicates

- **Each notification is processed once.** It is claimed by its
  `(provider, eventId)` before anything else happens, so a provider's retries
  are answered with "duplicate".
- **Older state never overwrites newer state.** The subscription is written
  only if its `lastEventAt` is no later than the event's time, and the
  database checks this in the same write as the update.
  - If two first notifications race to create the same subscription, the
    loser retries as an update.
  - A tested case: five simultaneous deliveries always end in the newest
    state.
- **Each payment is recorded once** by `(provider, providerPaymentId)`, even
  when two notifications report the same charge.
- **A coupon is redeemed once**, when its subscription is created. Renewals
  that still name the coupon do not count again.

## Security

- **Verifying the webhook** (`signature.ts`, done). The signature is checked
  over the exact raw body. Signatures older than five minutes are refused,
  and the comparison runs in constant time.
- **The webhook route** (not built yet) must:
  - verify before parsing the body, and cap the body's size;
  - take the webhook secret only from the environment, and never log it;
  - take no session and no CSRF token, because it is called server to
    server, and apply nothing that fails verification;
  - answer `400` for a bad signature, `200` only once the event is stored,
    and `5xx` if processing fails, so the provider retries.
- **The account comes from what the server attached at checkout.** A
  notification that names a checkout belonging to a different account grants
  nothing. It is recorded as `ignored` and logged.
- **The admin billing page is read-only.** Future admin actions (refund,
  cancel) will need a recent sign-in, confirmation and an audit record, like
  the other sensitive admin actions.

## Tests

- `src/server/billing/billing.test.ts`: 12 integration tests against a
  throwaway MongoDB, covering:
  - signatures;
  - order, including simultaneous deliveries;
  - recording payments once, and that money alone grants nothing;
  - linking the provider's customer;
  - coupon redemption;
  - checkout eligibility, completion and owner mismatch;
  - metrics, with test accounts excluded;
  - reconciliation.
- `src/server/saas.test.ts` (payment events): duplicates, expiry → Free,
  audit records.
- `e2e/admin.spec.ts`: `/admin/billing` renders and has no controls, and it
  fits a phone. `e2e/accounts.spec.ts`: it is a 404 for regular users.
- **With a provider (later):** its sandbox only, with its test cards and a
  test webhook secret, on staging. No live keys until the owner authorises
  production billing.

## Decisions for the owner

These are listed in [01-provider-research.md](01-provider-research.md#decisions-needed-from-the-owner):

- the provider and the business model;
- prices, trial length and which features are Pro;
- the refund policy;
- the grace period for failed payments (3 days in code, adjustable);
- invoices and VAT;
- whether the app or the provider sends payment-failure and renewal emails.
