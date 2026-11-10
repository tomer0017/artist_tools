# 0007 — Integer minor units and per-currency price entries

**Status:** Accepted (2026-11-10)

## Context
Prices will be shown and charged in USD and ILS first, more currencies later.
Floating-point money accumulates rounding errors, and converting prices with
exchange rates at display time produces odd amounts and disagreements with
what the provider charges.

## Decision
- Every amount is `{ amountMinor: integer, currency: ISO 4217 code }`
  (cents, agorot). No floats anywhere in money code.
- Each price is an explicit entry per currency and interval (e.g. Pro monthly
  USD 900, Pro monthly ILS 3290); there is no automatic conversion.
- Display uses `Intl.NumberFormat(locale, { style: 'currency', currency })`
  with the currency's minor-unit digits.
- The person's currency preference picks the entry; if no entry exists for
  it, the default currency (USD) is shown.
- Tax handling depends on the provider (merchant of record vs. own invoices)
  and is decided in Phase 4.

## Consequences
- Adding a currency is adding price entries, not code.
- Amounts in webhooks are stored as received, in minor units, with their
  currency.

## Alternatives considered
- One base price with live FX conversion: unpredictable prices and mismatches
  with charges.
