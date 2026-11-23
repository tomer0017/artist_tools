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
| Sign-in | Cookies `sc.session_token`, `sc.session_data` (a 5-minute cache), plus short-lived cookies during Google sign-in | Keep the person signed in | Session: 30 days, renewed at most daily while in use (by the studio and admin pages calling `/api/auth/get-session`); ends on sign-out |
| Trusted admin device (administrators only, when they choose it after a 2FA code) | Cookie `__Host-sc.admin_device` (`sc.admin_device` on local http): a random token, HttpOnly | Skip the 2FA code on this device | 90 days at most; the server ends the trust after 30 days unused, at 90 days, or when the admin forgets the device |

There are no advertising, analytics or third-party cookies.

## Kept on the server (MongoDB, on the staging VPS today)

| Collection | Personal data | Purpose | Retention (mechanism) | Proposed lawful basis |
|---|---|---|---|---|
| `users` | Name, email, email verified, profile picture URL (from Google), language, currency, plan, role, status, suspension reason, marketing consent (with time and source), introductions seen, created and last-login times, test flag, and (one administrator) the owner flag, set from the server command line. Accounts an admin creates for testers (ADR-0012): a username, and a placeholder address under `.invalid` instead of an email (no email is collected) | The account | Until the account is deleted. Unconfirmed password sign-ups are removed after 24 hours (nightly job); username accounts never are. | Contract |
| `accounts` | Sign-in methods: Google account id, or a password hash (scrypt) | Signing in | With the account | Contract |
| `password_handoffs` | An initial password made on the server command line for a username account, sealed (AES-256-GCM) until an admin reveals it once | Handing the password to the owner or tester without printing it | Removed when revealed, when the password is reset or changed, or after 72 hours (TTL index) | Contract; security |
| `admin_mfa`, `admin_mfa_sessions`, `admin_trusted_devices` | Administrators only: the encrypted authenticator secret and hashed recovery codes; which sessions passed the second factor; SHA-256 hashes of trusted-device tokens with a browser-and-system label and dates | Two-factor verification for admin access (docs/security/admin-2fa.md) | Verified sessions expire after 12 hours at most and trusted devices after 30 days unused or 90 days (TTL indexes); all of it is removed when 2FA is turned off, reset, or the admin role ends | Legitimate interest (security) |
| `sessions` | Session token, IP address, browser user agent, times | Signing in, and the "Signed-in devices" list (shown with the IP partly hidden) | Removed when expired (TTL index; 30 days), on sign-out, and with the account | Contract; security |
| `verifications` | Hashed tokens for email confirmation (24 h) and password reset (30 min, single use) | Confirming addresses, resetting passwords | Removed when expired (TTL index) | Contract; security |
| `rateLimits` | IP address with request counts (Better Auth) | Stopping abuse of sign-in | Removed after 1 day idle (nightly job) | Legitimate interest (security) |
| `auth_throttles` | SHA-256 hash of an email address or a username, with a count | Limiting emails and attempts per address or username | Removed at the end of the window (TTL index) | Legitimate interest (security) |
| `consent_events` | Marketing-consent changes (granted or withdrawn, source, time) | Proof of consent | With the account | Legal obligation / proof of consent |
| `usage` | Counts of feature use per day or month (each saved image and GIF, since ADR-0013) | Plan limits; the admin's usage figures | With the account | Contract |
| `analytics_events` | Account id with allow-listed event names (`active_day`, `tool_open`, registration, sign-in…) and small fixed properties. No IP, user agent, free text or image data. | Product analytics (ADR-0011) | **13 months** (*proposed*; nightly job, from 2026-11-11), and with the account | Legitimate interest (*to confirm*) |
| `audit_events` | Account id, actor, event type and small fixed metadata (e.g. what changed). No passwords or tokens. | Security and admin accountability | **24 months** (*proposed*; nightly job, from 2026-11-11). They outlive account deletion as a bare id that no longer resolves to anyone (ADR-0010). | Legitimate interest (security) |
| `access_grants` | Promotional plan given to an account, with dates and reason, and which admin gave, extended or ended it | Promotions | With the account | Contract |
| `mail_outbox` | Emails the app would have sent (address, text, links) | **Staging only**: testing without a mail provider. Refused in production. | 24 hours (TTL index) | — |
| `subscriptions`, `payments`, `billing_customers`, `checkout_sessions`, `payment_events`, `refund_requests` | PayPal (`docs/billing/03-paypal.md`): PayPal's subscription, plan, payer and payment ids; status; the agreed amount and currency, the Bank of Israel rate it was converted at, and the consent given at checkout (when, what amount); paid-through and next payment dates; payments, refunds and chargebacks (amount, currency, time); refund requests with the reason the customer typed. Never card data, and nothing PayPal sends about the payer (name, email, address) is stored. | Billing | Proposed: as long as tax law requires payment records, and at least 3 years for consent records (*counsel/accountant to set*). Checkout sessions: 7 days after expiry (TTL index). | Contract; legal obligation |
| `fx_rates`, `billing_plans`, `billing_settings` | No personal data: Bank of Israel rates with their dates; PayPal plan ids; who may subscribe (tester email addresses typed by the owner). | Billing | Kept while in use. | Legitimate interest |
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
| PayPal (payment provider) | Name, email and payment details the customer gives on PayPal's own pages; our subscription id and agreed price | Once billing is live (sandbox for tests) | The PayPal company named in the merchant's PayPal user agreement for Israel (*to confirm*) | Chosen 2026-11-23 |
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
