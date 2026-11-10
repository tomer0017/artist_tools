# Proposed data model

MongoDB, one database per environment. `users`, `accounts`, `sessions`,
`verifications` and `rateLimits` belong to Better Auth (`input: false` on every
app-owned user field, so no auth endpoint can write them). Every other
collection belongs to the app and is written only by server code. User
references are ObjectIds. Money is always an integer amount in minor units
plus an ISO 4217 code (ADR-0007). Additions are introduced by the idempotent
migration (`src/server/db/migrate.ts`); nothing existing is renamed or removed.

Legend: **E** exists today · **P1…P6** phase that adds it.

## Identity and accounts

### `users` (Better Auth + app fields)
| Field | Type | Notes |
|---|---|---|
| `name`, `email`, `emailVerified`, `image`, `createdAt`, `updatedAt` | E | email unique, lowercase |
| `role` | E `'user' \| 'admin'` | independent of plan |
| `status` | E `'active' \| 'suspended'` | suspended → no sessions |
| `plan`, `planUpdatedAt`, `planUpdatedBy` | E | admin-assigned plan |
| `lastLoginAt`, `introsSeen` | E | |
| `marketingConsent`, `marketingConsentAt`, `marketingConsentSource` | E | current state; history in `consent_events` (P1) |
| `locale` | P1 `'en' \| 'he'` (later `es`, `fr`) | default from the sign-up page language, else `en` |
| `currency` | P1 `'USD' \| 'ILS'` | display/billing preference; default by locale |
| `suspendedAt`, `suspendedBy`, `suspendReason` | P2 | reason is an enum, never free text from users |
| `testAccount` | P2 boolean | excluded from analytics and revenue |

### `accounts` (Better Auth) — sign-in methods
| `providerId` | `accountId` | Secret material |
|---|---|---|
| `google` (E) | Google `sub` | none (OAuth tokens stripped) |
| `credential` (P1) | the user id | `password`: scrypt hash (library default); never leaves the server, never exported |

Unique `(providerId, accountId)` (E). Linking only from a signed-in session
(ADR-0003).

### `sessions` (Better Auth) — E
Token, `expiresAt` (TTL index), `ipAddress`, `userAgent`. The browser never
receives another session's token: device lists and revocation go through
server code by session id (P1).

### `verifications` (Better Auth) — E, hashed from P1
Reset/deletion tokens and OAuth state. P1 stores identifiers as SHA-256
(`verification.storeIdentifier: 'hashed'`), so a database read cannot be
turned into a password reset. TTL on `expiresAt` (E).

### `rateLimits` (Better Auth, P1)
Per-IP counters per endpoint (`key`, `count`, `lastRequest` in ms). Pruned by
the nightly maintenance task (rows idle for over a day).

### `auth_throttles` (P1)
| Field | Notes |
|---|---|
| `_id` | `<purpose>:<sha256(lowercase email)>`, e.g. `signin-fail:…`, `mail:reset:…` |
| `count`, `firstAt` | |
| `expiresAt` | TTL index; the window end |

Per-address limits that IP rotation cannot bypass (failed sign-ins, emails
sent to one address). Holds no email address, only its hash.

### `consent_events` (P1) — append-only
`userId`, `purpose` (`marketing_email`, later `analytics`, `terms`, `privacy`),
`granted` (bool), `policyVersion` (string, P5), `source` (`profile`,
`sign_up`, …), `at`. The user document keeps only the current state.

### `mail_outbox` (P1)
`template`, `to` (address), `userId`, `subject`, `text`, `html`, `links`
(array of URLs in the message), `transport` (`outbox`), `createdAt`,
`expiresAt` (TTL 24 h). Exists only while `MAIL_TRANSPORT=outbox`
(development and staging; refused in production). Real providers keep a
delivery log without bodies (`mail_log`, introduced with the provider).

## Configuration (admin-managed, P2)

### `config_versions`
| Field | Notes |
|---|---|
| `kind` | `'catalog'` (features, plan matrix, quotas) · `'pricing'` (products, prices) |
| `version` | integer, increasing per kind |
| `status` | `'draft' \| 'published' \| 'archived'`; exactly one published per kind |
| `document` | the full configuration (validated by zod before save and publish) |
| `createdBy`, `createdAt`, `publishedBy`, `publishedAt`, `note` | |

Code keeps the defaults (today's matrix); the first migration publishes them as
version 1, so behaviour does not change until an admin publishes a new
version. Rollback = publish a previous version. Every save/publish is audited.

`catalog` document shape:
```ts
features: { id: FeatureId; name: string; tool: ToolId | null; status: 'available' | 'hidden' | 'beta' }[]
plans: { id: PlanId; name: string; features: FeatureId[];
         quotas: Partial<Record<FeatureId, { limit: number; period: 'day' | 'month' }>> }[]
```

`pricing` document shape:
```ts
products: { id: string; planId: PlanId; name: string }[]
prices: { id: string; productId: string; interval: 'month' | 'year';
          currency: 'USD' | 'ILS' | string; amountMinor: number; trialDays: number | null;
          active: boolean; providerRefs: Record<string, string> }[]
```

### `access_grants` (P2) — promotional and trial access
`userId`, `planId`, `startsAt`, `endsAt`, `reason` (`promotion`, `trial`,
`support`, `test`), `grantedBy`, `revokedAt`, `revokedBy`. Entitlements take the
best of: assigned plan, active subscription, active grant. Expiry needs no job
(checked at read time).

### `coupons` / `coupon_redemptions` (P2 definitions, P4 redemption at checkout)
Coupon: `code` (unique, uppercase), `kind` (`percent` | `fixed`),
`percentOff` or `amountOffMinor` + `currency`, `eligiblePriceIds`, `startsAt`,
`endsAt`, `maxRedemptions`, `maxPerUser`, `status`, `createdBy`.
Redemption: `couponId`, `userId`, `subscriptionId`, `at`, unique
`(couponId, userId)` when `maxPerUser = 1`. Redemption counts come from
`coupon_redemptions`, not a counter on the coupon.

## Billing (P4, provider-neutral)

| Collection | Key fields |
|---|---|
| `billing_customers` | `userId`, `provider`, `providerCustomerId` (unique per provider) |
| `subscriptions` (E, extended) | + `priceId`, `interval`, `currency`, `amountMinor`, `trialEndsAt`, `couponId`, `state` (state machine, ADR-0008), `lastEventAt` |
| `payments` | `provider`, `providerPaymentId` (unique), `userId`, `subscriptionId`, `kind` (`charge` \| `refund` \| `chargeback`), `amountMinor`, `currency`, `status`, `occurredAt` |
| `payment_events` (E) | + `payloadSha256`, `signatureVerified: true` (only verified events are stored) |
| `reconciliation_runs` | `provider`, `startedAt`, `finishedAt`, `checked`, `mismatches[]`, `fixed[]` |

Pro access from billing comes only from `subscriptions` written by verified
webhooks or reconciliation, never from a redirect or a client claim.

## Analytics and usage

- `usage` (E): per user/feature/period counters; periods extend to `day` when a
  daily quota is configured (P2).
- `analytics_events` (E): allow-listed names, ids only. P2 adds aggregate
  queries; P6 wires browser events (`tool_open`, `first_tool_use`,
  `first_export`) through one same-origin endpoint, without artwork, file names
  or free text.
- `analytics_daily` (P2, optional): pre-aggregated counts per day if the raw
  queries become slow.

## Audit (E, extended in P1–P4)
`audit_events`: `type`, `userId`, `actor`, `at`, `metadata` (ids, enums and
counts only). New types: `user.email_verified`,
`user.password_changed`, `user.password_reset`, `user.profile_updated`,
`user.consent_changed`, `user.session_revoked`, `user.sessions_revoked`,
`account.linked` (Google connected or a password added, by `provider`),
`account.unlinked`, `account.data_exported`,
`account.deleted`, `auth.login_failed`, `auth.throttled`, and in P2
`admin.account_suspended`, `admin.account_reactivated`, `admin.grant_*`,
`admin.config_*`, `admin.coupon_*`.

Retention (P5 policy): audit events kept 24 months; after an account is
deleted its events keep the bare user id (no email or name), so the security
history survives without personal data.

## Future (P6, architecture only)
`projects` (saved artwork projects: metadata in MongoDB, images in object
storage, owner-only access) and `feedback` (`userId`, `kind`, `message`,
`page`, `createdAt`, `status`). Not built without approval.
