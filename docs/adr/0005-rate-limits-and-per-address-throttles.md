# 0005 — Per-IP rate limits plus per-address throttles

**Status:** Accepted (2026-11-10)

## Context
Better Auth limits requests per IP in memory; limits reset on every deploy and
cannot stop an attacker rotating IPs against one account or one inbox.

## Decision
- Better Auth limits stay the first layer, keyed on `X-Real-IP` (set by nginx
  from the connecting address), moved to database storage (`rateLimits`) so
  they survive restarts, with explicit rules for sign-up, sign-in,
  verification, reset and password change.
- A second layer in `auth_throttles`, keyed on a SHA-256 of the lowercased
  address (no address stored): failed password sign-ins (10 per 15 minutes,
  then a generic "try again later" for that address whether or not it has an
  account) and emails sent to one address (3 per hour, 10 per day per kind).
  A TTL index removes expired windows.
- Throttling is audited (`auth.throttled`) without the address.
- JSON request bodies on app routes are size-capped before parsing.

## Consequences
- A locked-out address affects only password sign-in for that address; Google
  sign-in keeps working, and the limit expires on its own (no permanent
  lockout an attacker could trigger).
- Two small database writes per authentication attempt; negligible at this
  scale.

## Alternatives considered
- nginx `limit_req` only: coarse, per-IP, no per-address view.
- Permanent account lockout: lets anyone lock anyone out.
