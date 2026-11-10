# 0010 — Account deletion, data export and audit retention

**Status:** Accepted (2026-11-10)

## Context
People must be able to get a copy of their data and delete their account.
The security history (logins, admin changes) must survive a deletion without
keeping personal data. Artwork never reaches the server.

## Decision
- **Export:** a JSON file generated on request for the signed-in person:
  profile, preferences, consents with history, sign-in methods (provider and
  dates only), sessions (dates, device summary), plan and grants, usage
  counts, analytics events and audit events about them. Never tokens, password
  hashes, provider account ids or other people's data. Rate-limited, audited.
- **Deletion:** immediate and permanent, after a session younger than 10
  minutes (otherwise re-authenticate) and a typed confirmation. Refused for the
  last admin and, once billing exists, while a paid subscription is active
  (cancel first). Removes the user, sign-in methods, sessions, verifications,
  throttles, consents, usage, analytics events, outbox mail and grants.
- **Audit retention:** audit events keep the bare user id and enums; after
  deletion that id resolves to nothing, so no name or email remains. An
  `account.deleted` event records the deletion. Retention period (proposed 24
  months) is set in the Phase 5 retention policy.
- The device's local tool work is removed too if the person keeps the
  (default-on) option.
- A confirmation email goes to the address.

## Consequences
- No undo: support cannot restore a deleted account. Database backups still
  contain it until they expire (14 days locally; off-site retention in P5),
  which the privacy policy must state.

## Alternatives considered
- Soft delete with a grace period: allows undo, but keeps personal data and
  complicates every query; reconsider if support needs arise.
