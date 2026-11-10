# Risk register

Likelihood (L) and impact (I): 1 low … 3 high. Reviewed at the end of every
phase. "Owner" is who has to act: **eng** (implementation), **owner** (business,
accounts, approvals), **legal** (qualified counsel).

| # | Risk | L | I | Mitigation | Owner | Status |
|---|---|---|---|---|---|---|
| R1 | Backups silently not running | 3 | 3 | Found in the audit: cron refused the job file (group-writable). Fixed 2026-11-10; verify the 02:40 run; release script dumps before migrating (P1); failure alerting (P5) | eng | fixed, verifying |
| R2 | All backups on the same VPS (provider incident, compromise, deletion) | 2 | 3 | Encrypted off-site copies with provider-enforced retention (`deploy/offsite-backups-plan.md`) | owner (storage account), eng | planned P5 |
| R3 | Outage or errors go unnoticed | 2 | 2 | Uptime check on `/api/health?ready=1`, error tracking, alerting | owner (accounts), eng | planned P5 |
| R4 | No domain → email undeliverable; billing and production OAuth blocked | 3 | 3 | Owner registers a domain; until then the staging mail outbox (ADR-0004) | owner | open |
| R5 | Account takeover by automatic email-based merging | 2 | 3 | `disableImplicitLinking`; link only from a signed-in session to the same verified address (ADR-0003) | eng | P1 |
| R6 | Pre-registration of someone else's address with a password | 2 | 2 | Verification required before any access; unverified accounts purged after 24 h; reset revokes every session; "this wasn't me" guidance in the email | eng | P1 |
| R7 | Credential stuffing / brute force | 2 | 3 | Per-IP limits (persistent) + per-address failure throttle; scrypt; 12-character minimum + blocklist | eng | P1 |
| R8 | Account enumeration | 2 | 2 | Generic sign-up/reset responses (library), same work for unknown users, per-address throttles without revealing existence | eng | P1 |
| R9 | Email bombing a victim through sign-up/reset | 2 | 2 | Per-address send limits (3/h, 10/day), per-IP limits | eng | P1 |
| R10 | Admin account compromise | 1 | 3 | Fresh-session re-authentication for sensitive admin actions, audit of every change, last-admin guard; 2FA for admins | eng | P2/P5 |
| R11 | Payment provider unavailable to an Israeli merchant, or terms change | 2 | 3 | Verified research before integration; provider-neutral design (ADR-0008); mock provider until approved | owner, eng | P4 |
| R12 | Pro granted without payment (redirect/client tampering) | 2 | 3 | Entitlements only from server-written subscriptions from verified, idempotent webhooks + reconciliation | eng | P4 |
| R13 | Browser-side enforcement of Pro options | 3 | 1 | Accepted: options without server cost; the server counts and authorises; nothing costly depends on the browser copy (documented) | — | accepted |
| R14 | Shared device shows the previous person's local work | 2 | 2 | Offer "remove this device's work" at sign-out and on deletion (P1); per-account local namespaces with saved projects (P6) | eng | P1 partial |
| R15 | Privacy obligations (Israeli Privacy Protection Law incl. Amendment 13, GDPR for EU visitors) | 2 | 3 | Data inventory, retention, export/deletion, consent records, processor list; drafts reviewed by counsel; no compliance claims | eng, legal | P1/P5 |
| R16 | Accessibility obligations (Israeli accessibility regulations / IS 5568; WCAG 2.2 AA target) | 2 | 3 | Audit with automation + manual testing; fix; statement from verified results only | eng, legal | P5 |
| R17 | Consumer rules on subscriptions (cancellation, renewal notices, refunds) | 2 | 3 | Terms drafted for review; cancellation in the product; provider capabilities checked in P4 | legal, owner | P4/P5 |
| R18 | RTL breaks canvas tools (mirrored geometry, gestures) | 2 | 3 | Canvas surfaces stay `dir="ltr"`; visual-parity and tool e2e suites run in both locales | eng | P3 |
| R19 | Runtime dependency advisories (`zod` 3.x memory, `lodash` via recharts) | 2 | 2 | Body-size caps on JSON routes (P1); upgrade plan with tests; scanning in CI (P5) | eng | P1/P5 |
| R20 | Services bound to all interfaces behind ufw only (FTP, SMTP, MySQL, Varnish); CloudPanel :8443 public | 1 | 3 | Recommend: restrict :8443 to known IPs or 2FA, bind unused services to localhost, `X11Forwarding no` — server-wide, needs approval | owner | proposed |
| R21 | Single VPS is a single point of failure | 2 | 2 | Accepted for validation; documented recovery (rebuild from repo + off-site backup) | owner | accepted |
| R22 | Secret exposure or rotation pain | 1 | 3 | Secrets only in root-owned env files, never logged; rotation runbook (rotating `BETTER_AUTH_SECRET` signs everyone out) | eng | P5 |
| R23 | Google OAuth consent screen still in testing / unverified brand | 2 | 2 | Owner publishes the app for the real domain before public launch; scopes are non-sensitive (`openid email profile`) | owner | open |
| R24 | Scope: roadmap far larger than one release | 3 | 2 | Phase gates; each phase deployable on its own; flags default off | eng | ongoing |
| R25 | Analytics collecting more than needed | 1 | 2 | Allow-listed events, ids only, no artwork, test accounts excluded; marketing attribution only with consent | eng | P2/P6 |
| R26 | Owner's home network drops SSH/HTTPS to the VPS (ISP path) | 3 | 1 | Known; check the path before assuming a server problem; keep a lifeline session during server changes | — | known |
