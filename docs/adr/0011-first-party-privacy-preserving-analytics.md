# 0011 — First-party, privacy-preserving analytics

**Status:** Accepted (2026-11-10)

## Context
The admin dashboard needs registrations, activation, active users, tool usage,
retention, conversion and churn. Third-party trackers would send personal
data abroad, need cookie consent, and could capture artwork.

## Decision
- Events go to our own database only (`analytics_events`): allow-listed names,
  user id or a random anonymous id, small enum/number properties. No artwork,
  file names, image data, free text, IP addresses or user agents.
- Server-side events where possible (registration, login, verified
  activation, feature use, subscription changes); browser events through one
  same-origin endpoint that validates names and properties.
- Metrics are computed by aggregate queries; test accounts are excluded.
- UTM attribution is stored only when the visitor has consented (Phase 5
  consent controls).
- Raw events retained 13 months (P5 policy); aggregates may be kept longer.

## Consequences
- No external dashboard; the admin pages compute what is needed.
- Some funnels (anonymous visitors) are approximate by design.

## Alternatives considered
- Google Analytics / product-analytics SaaS: richer, but personal data
  transfer, consent banners and artwork leakage risk.
