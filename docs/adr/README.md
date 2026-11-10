# Architecture decision records

Short records of the choices that shape Studio Companion's SaaS platform: the
context, the decision, and what follows from it. A record is never edited to
change its decision; a new record supersedes it.

| # | Decision | Status |
|---|---|---|
| [0001](0001-extend-the-existing-stack.md) | Extend Next.js + Better Auth + MongoDB instead of replacing them | Accepted |
| [0002](0002-email-password-with-mandatory-verification.md) | Email/password through Better Auth, verification before access | Accepted |
| [0003](0003-explicit-account-linking-only.md) | Accounts are linked only explicitly, from a signed-in session | Accepted |
| [0004](0004-provider-neutral-transactional-email.md) | Provider-neutral mail with a staging outbox | Accepted |
| [0005](0005-rate-limits-and-per-address-throttles.md) | Per-IP limits plus per-address throttles | Accepted |
| [0006](0006-versioned-admin-configuration.md) | Admin configuration as versioned drafts and publications | Accepted |
| [0007](0007-money-and-currencies.md) | Integer minor units, per-currency price entries | Accepted |
| [0008](0008-provider-neutral-billing.md) | Provider-neutral billing; webhooks are the source of truth | Accepted |
| [0009](0009-internationalisation.md) | Internationalisation and RTL strategy | Proposed (library verified in Phase 3) |
| [0010](0010-account-deletion-export-and-audit-retention.md) | Account deletion, data export and audit retention | Accepted |
| [0011](0011-first-party-privacy-preserving-analytics.md) | First-party, privacy-preserving analytics | Accepted |

Format: Context · Decision · Consequences · Alternatives considered.
