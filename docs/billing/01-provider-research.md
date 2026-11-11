# Payment providers for an Israel-based merchant — research

**Researched:** 2026-11-11. **Status:** input for the owner's decision. No
provider is selected, no account was opened, nothing is connected.
Everything below must be re-checked when deciding: providers change
eligibility, fees and terms often. Items marked **unverified** come from
secondary sources only.

This is engineering research, not legal or tax advice. The tax and invoicing
consequences of each model must be confirmed with an Israeli accountant
(VAT status, export of services, invoices) before choosing.

## Two models

| | Merchant of Record (MoR) | Direct merchant (Israeli PSP) |
|---|---|---|
| Who sells to the customer | The provider (it resells your product) | Your business |
| Consumer taxes abroad (EU VAT, UK VAT, US sales tax…) | Provider calculates, collects, files and remits | Your responsibility (registrations, filings) |
| Customer receipts/invoices | Issued by the provider | You issue them (Israeli tax invoices via an invoicing service) |
| Chargebacks, fraud, payment disputes | Provider | You (with the acquirer) |
| Cost | Higher per transaction (≈4–5% + fixed) | Lower card fees, plus invoicing/accounting work |
| Payout | Provider pays you (often monthly or twice monthly, possibly not in ILS) | Acquirer settles to your Israeli bank account |

For a small team selling a digital subscription to consumers worldwide, an MoR
removes most international tax and compliance work; a direct Israeli PSP is
cheaper and natural for Israeli customers paying in ILS, but leaves foreign
consumer taxes and invoicing to the business. A hybrid (PSP for Israel, MoR
for the rest) is possible but doubles the integration and the bookkeeping.

## Candidates

| Provider | Model | Israel-based seller? | Fees (published) | Notes |
|---|---|---|---|---|
| **Paddle** | MoR | **Yes, not excluded**: "works with software businesses anywhere in the world with the exception of the unsupported countries listed" — Israel is not on that list (help centre, checked 2026-11-11). Israel is also a supported *buyer* country with ILS pricing. | 5% + 50¢ per transaction (pricing page) | Tax collection, filing and remittance included; chargebacks and fraud covered. Invoicing (B2B) is a paid add-on. Payout currencies/methods for Israel: **unverified** (a secondary source lists 13 payout currencies without ILS). Sandbox environment available. |
| **Lemon Squeezy** | MoR | **Yes**: Israel is on the bank-payout country list (docs, checked 2026-11-11) | 5% + 50¢, "transactions made outside of the US may encounter small additional fees" (pricing page) | Payouts twice a month (bank or PayPal). Owned by Stripe since 2024; its 2026 update says the goal is to help users move to Stripe Managed Payments — a product-direction risk. |
| **Polar** | MoR | **Yes**: Israel is on the payout country list; payouts go through Stripe Connect Express (docs, checked 2026-11-11) | 4% + 40¢; +1.5% international cards; +0.5% subscriptions (fee docs) | Developer-oriented, open source. Selling as an individual depends on Stripe Connect Express supporting individuals in Israel (docs explain how to check). |
| **Stripe** (direct) | Processor | **No**: Israel is not listed on stripe.com/global (checked 2026-11-11) | — | Using it would need a business entity in a supported country (not recommended without legal/tax advice). |
| **Stripe Managed Payments** | MoR (Stripe) | **Unverified, likely no**: generally available since April 2026, but it sits on a Stripe account, and Stripe accounts are not available to Israeli businesses | — | Re-check if Stripe adds Israel. |
| **FastSpring** | MoR | **Unverified**: no official statement found about Israeli sellers | Custom | Ask their sales team if shortlisted. |
| **Tranzila** | Israeli PSP | Yes (Israeli acquirer) | Quote | API V2; Hosted Fields / iFrame / hosted page (no card data on our servers); token billing for recurring charges; Masav direct debit (הוראת קבע); digital tax invoice. Its developer summary says it "operates exclusively in Israel (ILS currency)" — USD pricing to be confirmed. |
| **Cardcom** | Israeli PSP | Yes (Israeli acquirer) | Quote | API v11 with token-based recurring charges (**unverified** against official docs). Integrations with Israeli invoicing services exist. |
| **Grow (Meshulam)** | Israeli PSP | Yes | Quote | Offered through Morning (Green Invoice) with payment links, standing orders and automatic invoices. |
| **Hyp, PayPlus** | Israeli PSPs | Yes | Quote | Tokenization and recurring documented (Hyp developer docs); not evaluated further. |

## What each model means for Studio Companion

- **Taxes:** with an MoR, price entries can be tax-inclusive per currency and
  the provider handles VAT/sales tax. With a PSP, Israeli VAT applies to
  Israeli customers, and foreign consumer taxes are the business's own
  obligation (e.g. EU VAT on digital services to consumers) — accountant.
- **Invoices:** MoR receipts are the provider's; Israeli customers who need a
  tax invoice from an Israeli business would not get one from an MoR — check
  whether that matters for the customer mix.
- **Currencies:** our prices are per currency in minor units (ADR-0007), so
  USD and ILS entries map to either model; payout currency differs by
  provider.
- **Integration effort:** all candidates fit the provider adapter
  (`src/server/billing/`): hosted checkout, a customer portal or our own
  cancellation flow, signed webhooks, and a subscription read API for
  reconciliation. The Israeli PSPs need more of our own code (recurring
  schedule, dunning, invoices) because they charge tokens rather than run
  subscriptions.

## Decisions needed from the owner

1. The business entity and VAT status (עוסק פטור / מורשה / חברה), with an
   accountant — it decides how invoices and VAT work.
2. MoR or direct PSP (or both), given the expected customers (Israel vs
   abroad).
3. One or two providers to try in **sandbox/test mode** (opening a sandbox
   account is free but is an external account in the owner's name).
4. Prices, trial length and which features are Pro (business decisions; the
   admin dashboard already stores them as drafts).

Until then, the provider-neutral parts (docs/billing/02-architecture.md)
are built and tested with verified events constructed in the tests; there is
no simulated provider in the app. The whole lifecycle is then tested end to
end in the chosen provider's own sandbox, with its test cards and no real
money, before anything goes live.

## Sources (checked 2026-11-11)

- Paddle, which countries are supported: https://www.paddle.com/help/start/account-verification/which-countries-are-supported-by-paddle
- Paddle, supported countries and locales (buyers): https://developer.paddle.com/concepts/sell/supported-countries-locales
- Paddle pricing: https://www.paddle.com/pricing
- Lemon Squeezy supported countries: https://docs.lemonsqueezy.com/help/getting-started/supported-countries
- Lemon Squeezy pricing: https://www.lemonsqueezy.com/pricing
- Lemon Squeezy 2026 update: https://www.lemonsqueezy.com/blog/2026-update
- Polar supported countries: https://polar.sh/docs/merchant-of-record/supported-countries
- Polar fees: https://polar.sh/docs/fees
- Stripe global availability: https://stripe.com/global
- Stripe Managed Payments changelog: https://docs.stripe.com/changelog/dahlia/2026-04-22/managed-payments
- Tranzila developer summary: https://www.tranzila.com/llms.txt
- Hyp tokenization docs: https://developers.hyp.co.il/pay/common-use-cases/tokenization
- Morning (Green Invoice) payments: https://www.greeninvoice.co.il/market/clearing
- Secondary, unverified: https://www.lilachbullock.com/?p=148389 (Paddle payout currencies), https://skillselion.com/skills/skills-il/tax-and-finance/cardcom-payment-gateway (Cardcom tokens)
