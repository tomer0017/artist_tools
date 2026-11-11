# Studio Companion — commercial SaaS roadmap

From a working studio with Google sign-in and Free/Pro accounts to a
multilingual, multi-currency SaaS that is technically ready for commercial
validation. Launch stays gated on billing-provider approval, legal review,
security checks and the owner's authorisation.

| Document | Contents |
|---|---|
| [00-audit.md](00-audit.md) | Current state (code and server), five-tool persistence, gap analysis, external blockers |
| [01-data-model.md](01-data-model.md) | Proposed collections and fields per phase |
| [02-migration-and-rollback.md](02-migration-and-rollback.md) | Migration rules, rollback levels, per-phase notes, restore drill |
| [03-risk-register.md](03-risk-register.md) | Risks, mitigations, owners |
| [04-plan-and-backlog.md](04-plan-and-backlog.md) | Quality gates, backlog with acceptance criteria, approvals needed |
| [../adr/](../adr/README.md) | Architecture decision records |

## Status

| Phase | Scope | Status |
|---|---|---|
| 0 | Audit and architecture | Done 2026-11-10 |
| 1 | Authentication and account management | Built and tested 2026-11-11; on staging with the mail outbox (real email needs a domain + provider) |
| 2 | Commercial admin dashboard | Built and tested 2026-11-11 (users, grants, suspension, audit export, versioned plans/pricing, coupons, analytics) |
| 3 | Internationalisation (English, Hebrew) | 3a built 2026-11-11 (public pages, sign-in, emails, RTL, /he); 3b next (studio, account page, tools) |
| 4 | Billing infrastructure (research, provider-neutral core, mock provider) | Planned |
| 5 | Security, privacy, accessibility, operations, legal drafts | Planned |
| 6 | Retention and growth foundations | Planned |

Deploy rules: only tested phases go to staging
(`https://staging.185-176-255-3.sslip.io`); GitHub Pages production is not
touched; public registration, real payments, real email campaigns and paid
services stay off until the owner approves them.
