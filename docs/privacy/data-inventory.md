# Personal data inventory

**Written:** 2026-11-11, from the code at that date.

This is the engineering record of what personal data Studio Companion
handles: where it is kept, why, for how long, and who receives it. The
privacy policy draft (`docs/legal/privacy-policy.md`) is written from it. If
the code changes what is collected or kept, this page must change in the
same commit.

The proposed lawful bases and retention periods marked *proposed* need
confirmation by counsel. This page is a description of the system, not legal
advice.

## What never reaches the server

- **The artwork and reference photos people load into the tools.** Every tool
  processes images in the browser. Exports (PNG, GIF) are made on the device.
  No image, file name or image data is sent to the server or written to logs
  or analytics.
- **Card details.** Payments are not live. When they are, checkout happens on
  the payment provider's own pages (`docs/billing/02-architecture.md`).

## Kept in the browser (on the device only)

| What | Where | Why | How long |
|---|---|---|---|
| The current project (Measure, Grid and Study settings, the loaded reference) and the current comparison | `localStorage` | So work survives a reload | Until replaced, or removed by "Sign out and remove the work stored here" or by account deletion (the option is on by default) |
| Which tool introductions and tours were seen | `localStorage` | So they are not shown again | As above |
| A colour handed from one tool to another | `sessionStorage` | Moving between tools | The browser tab |
| Language choice | Cookie `sc_locale` | Show pages in the chosen language | 1 year |
| Sign-in | Cookies `sc.session_token`, `sc.session_data` (a 5-minute cache), plus short-lived cookies during Google sign-in | Keep the person signed in | Session: 30 days, renewed at most daily while in use; ends on sign-out |

There are no advertising, analytics or third-party cookies.

## Kept on the server (MongoDB, on the staging VPS today)

| Collection | Personal data | Purpose | Retention (mechanism) | Proposed lawful basis |
|---|---|---|---|---|
| `users` | Name, email, email verified, profile picture URL (from Google), language, currency, plan, role, status, suspension reason, marketing consent (with time and source), introductions seen, created and last-login times, test flag | The account | Until the account is deleted. Unconfirmed password sign-ups are removed after 24 hours (nightly job). | Contract |
| `accounts` | Sign-in methods: Google account id, or a password hash (scrypt) | Signing in | With the account | Contract |
| `sessions` | Session token, IP address, browser user agent, times | Signing in, and the "Signed-in devices" list (shown with the IP partly hidden) | Removed when expired (TTL index; 30 days), on sign-out, and with the account | Contract; security |
| `verifications` | Hashed tokens for email confirmation (24 h) and password reset (30 min, single use) | Confirming addresses, resetting passwords | Removed when expired (TTL index) | Contract; security |
| `rateLimits` | IP address with request counts (Better Auth) | Stopping abuse of sign-in | Removed after 1 day idle (nightly job) | Legitimate interest (security) |
| `auth_throttles` | SHA-256 hash of an email address, with a count | Limiting emails and attempts per address | Removed at the end of the window (TTL index) | Legitimate interest (security) |
| `consent_events` | Marketing-consent changes (granted or withdrawn, source, time) | Proof of consent | With the account | Legal obligation / proof of consent |
| `usage` | Counts of feature use per day or month (e.g. GIFs saved) | Plan limits; the admin's usage figures | With the account | Contract |
| `analytics_events` | Account id with allow-listed event names (`active_day`, `tool_open`, registration, sign-in…) and small fixed properties. No IP, user agent, free text or image data. | Product analytics (ADR-0011) | **13 months** (*proposed*; nightly job, from 2026-11-11), and with the account | Legitimate interest (*to confirm*) |
| `audit_events` | Account id, actor, event type and small fixed metadata (e.g. what changed). No passwords or tokens. | Security and admin accountability | **24 months** (*proposed*; nightly job, from 2026-11-11). They outlive account deletion as a bare id that no longer resolves to anyone (ADR-0010). | Legitimate interest (security) |
| `access_grants` | Promotional plan given to an account, with dates and reason | Promotions | With the account | Contract |
| `mail_outbox` | Emails the app would have sent (address, text, links) | **Staging only**: testing without a mail provider. Refused in production. | 24 hours (TTL index) | — |
| `subscriptions`, `payments`, `billing_customers`, `checkout_sessions`, `payment_events` | *Empty: billing is not live.* Later: the provider's ids, plan, status, amounts, receipt links. Never card data. | Billing | Proposed: as long as tax law requires invoices and payment records (*counsel/accountant to set*). Checkout sessions: 7 days after expiry (TTL index). | Contract; legal obligation |
| `coupon_redemptions` | Account id and coupon used | Coupon limits | With the account (*to confirm*) | Contract |

## Backups

The whole database is dumped nightly at 02:40 server time. The dumps are kept
14 days on the same server, under `/var/backups/mongodb`. A deleted account
therefore remains in backups for up to 14 days. **There are no off-site
backups yet** (`deploy/offsite-backups-plan.md`; the owner must choose a
storage provider).

## Who receives personal data (processors and recipients)

| Who | What | When | Location | State |
|---|---|---|---|---|
| Contabo (VPS hosting) | Everything on the server | Always | [Data-centre region: confirm in the Contabo account] | In use |
| Google | Google returns the name, email, verified flag, profile picture and account id to us. Google itself sees that the person signs in to Studio Companion. | Only for people who choose "Continue with Google" | Google's infrastructure | In use |
| Email provider | Name, email address, message content | Account emails, once a provider is chosen | [to be chosen] | Not chosen. Staging keeps emails in its outbox. |
| Payment provider | Name, email, billing details entered on its pages | Once billing is live | [to be chosen: `docs/billing/01-provider-research.md`] | Not chosen |
| GitHub | Source code only, no personal data | — | — | In use |

## Rights, as implemented

- **Access and portability:** "Download my data" on the account page gives
  a JSON file covering:
  - profile, preferences and consents;
  - sign-in methods and devices;
  - plan, grants and usage;
  - analytics and audit events.
- **Rectification:** the name, language and currency can be edited by the
  person. An email change is not built yet.
- **Erasure:** "Delete account" is immediate and permanent. Audit events stay
  as an unresolvable id; backups keep the account for up to 14 days.
- **Withdrawing consent:** the "News by email" switch, with history.
- **Objection and restriction:** no self-service; by contacting support
  (*process to define*).
