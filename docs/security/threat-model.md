# Threat model

**Written:** 2026-11-11, from the code at commit c41c978. It should be
reviewed when billing goes live, when anything starts storing user images, or
when an external service is added.

## What is worth protecting

- **Accounts:** their sessions and passwords, and admin access in particular.
- **Personal data:** see `docs/privacy/data-inventory.md`.
- **Plan entitlements** (Pro) and, later, billing state and money movements.
- **The integrity of the configuration:** plans, prices, coupons.
- **Availability** of the service and of people's in-browser work. The
  server never holds that work; it lives only in the browser.

Artwork is not an asset on the server: images never leave the device. That
removes whole classes of risk (storage leaks, malicious uploads, content
moderation).

## Trust boundaries

1. **Browser → app (HTTPS, behind nginx).** Everything the browser sends is
   untrusted. This covers bodies, headers and cookies, and also any claim
   about plan, payment, email or role.
2. **App → MongoDB.** Local to the server and not exposed publicly.
3. **App → Google.** OAuth: identity comes from Google's verified response,
   never from the browser.
4. **Provider → app.** Payment webhooks, once billing is live. Only
   signature-verified notifications are accepted.
5. **Operator → server.** SSH with keys, root access and the release
   script.

## Threats and what addresses them

| Threat (STRIDE) | Where | What is in place | Gaps |
|---|---|---|---|
| Spoofing: taking over an account | Sign-in | Scrypt password hashes and a 12-character policy against common passwords; per-IP rate limits and per-address throttles; email must be confirmed; single-use, hashed reset tokens that sign out every device; no automatic account merging (ADR-0003); sessions checked in the database on every request | No 2FA. No breach-password check. |
| Spoofing: becoming an admin | Admin | Admin role is given only by user id, by an existing admin or the server CLI, never by email; `requireAdmin()` re-reads the role from the database; a sign-in within 10 minutes is needed for role and status changes; the last admin cannot be removed; everything is audited | No 2FA for admins (**priority**) |
| Tampering: plan or payment claims | Entitlements, billing | Plans come only from the server (assigned plan, grants, subscriptions written by verified events); the return from checkout grants nothing; webhook signatures are checked; events are idempotent and cannot overwrite newer state (`docs/billing/02-architecture.md`) | Not exercised against a real provider yet |
| Tampering: cross-site requests | All changes | Server actions check Origin; JSON APIs refuse cross-site requests; SameSite=Lax cookies | — |
| Information disclosure: XSS | All pages | React escaping; a CSP with a fresh nonce per request and `'strict-dynamic'`; no `dangerouslySetInnerHTML` with user data | CSP violation reports are not collected |
| Information disclosure: enumerating accounts | Sign-up, reset | Identical answers whether an address exists or not (tested) | Timing is not measured |
| Information disclosure: data of other accounts | APIs, export | Every query is scoped to the session's user id; the export contains only that account's data, with no tokens or hashes | — |
| Denial of service | All endpoints | Request bodies capped while they stream in (413); rate limits on sign-in; atomic quotas | No edge rate limiting or WAF; a single VPS |
| Repudiation | Admin and security actions | Audit log with actor, time and what changed; CSV export is itself audited; kept 24 months | Logs are on the same server (no off-site copy) |
| Elevation through dependencies | Supply chain | Versions pinned; new versions must be at least two weeks old; lock file | `npm audit`: 15 production-tree findings, mostly build tools; zod and lodash are reachable at runtime but mitigated (see the launch checklist). No CI scanning. |
| Data loss | Database | Nightly dump (14 days); dump before every release migration; migrations are additive only | **No off-site backup, no restore drill yet** |
| Server compromise | VPS | SSH keys only; fail2ban; MongoDB on localhost; secrets in root-only environment files | No intrusion detection or monitoring. CloudPanel and other sites share the server. |

## Highest-priority gaps before launch

1. Off-site encrypted backups, and a restore drill.
2. 2FA for admin accounts, at least.
3. Uptime monitoring and error reporting.
4. The dependency upgrades: zod 4, vitest 4, and patch updates of build
   tools, each at least two weeks old.
5. CI running type-check, lint, tests and an audit on every push.
