# Migration and rollback strategy

## Principles

1. **Additive and idempotent.** `npm run db -- migrate` runs on every release
   (`deploy/release.sh` step 3) and only creates indexes, inserts missing
   documents and backfills missing fields. Running it twice changes nothing.
2. **The previous release must run on the new schema.** Rollback is a symlink
   switch, so a release may add fields and collections but never rename,
   repurpose or delete them. Removing something takes two releases: stop
   using it, then (after the rollback window) remove it.
3. **Back up before anything risky.** From Phase 1 the release script takes a
   `mongodump` before migrating (`studio-mongo-backup`, the same job as the
   nightly one) and aborts the release if the dump fails.
4. **Risky behaviour sits behind configuration, defaulting to off.** Examples:
   `AUTH_EMAIL_PASSWORD` (P1), `MAIL_TRANSPORT` (P1), `BILLING_PROVIDER` (P4).
   Turning a feature off is an env change + restart, no deploy.
5. **Admin configuration is versioned** (P2): rollback is publishing the
   previous version; nothing is edited in place.
6. **Every migration has a test** against a real MongoDB (mongodb-memory-server
   replica set): first run, second run (no changes), and a database shaped
   like the previous release.

## Rollback levels

| Level | When | How | Time |
|---|---|---|---|
| Feature flag | a new capability misbehaves | set the flag off in `/etc/studio-companion/<env>.env`, restart, check `/api/health?ready=1` | 1 min |
| Release | a deploy is broken | automatic if unhealthy; manual: point `current` at a kept release and restart (`deploy/README.md`) | 1 min |
| Configuration | an admin change is wrong | publish the previous `config_versions` entry | seconds |
| Data | data was damaged | stop the app, `mongorestore --drop` the latest good archive (command in the backup script header), start, verify | ~5 min at today's size |

A data restore loses writes since the archive, so it is the last resort and
always preceded by a fresh dump of the damaged state for analysis.

## Per-phase migration notes

### Phase 1
- New fields `users.locale` / `users.currency`: backfilled to `en` / `USD`
  where missing. The old release ignores them.
- New collections `auth_throttles`, `consent_events`, `mail_outbox`,
  `rateLimits` with TTL/lookup indexes. The old release ignores them.
- `verifications` switch to hashed identifiers: rows written before the switch
  (OAuth states with a 10-minute life) stop matching, so a Google sign-in that
  is in flight during the deploy has to be retried. No other data uses them
  today.
- Account linking changes from "disabled" to "explicit only": no data change.
- **Rollback caveat:** accounts created with a password on the new release
  cannot sign in on the old one (it has email/password off) until it is
  re-released; their data is untouched. Google accounts are unaffected.

### Phase 2
- `config_versions` seeded with today's plan matrix as published version 1
  (equal to `src/lib/plans.ts`), so entitlements are unchanged by the deploy.
  The migration stops overwriting `plans` from code once version 1 exists;
  the old release keeps reading `plans`, which the new release keeps in step
  with the published catalog.
- `access_grants`, `coupons`, `coupon_redemptions`: new, empty.

### Phase 3
- No schema change beyond `users.locale` (P1). Locale routes are additive;
  existing URLs keep working.

### Phase 4
- New billing collections, empty. `subscriptions` gains fields; existing
  documents (none today) are read with defaults. The mock provider is the only
  one enabled until a real provider is authorised.

## Restore drill (to run before Phase 2's first configuration migration)

1. Copy the latest archive to a scratch directory on the server.
2. `mongorestore --nsFrom='studio_companion_staging.*' --nsTo='restore_check.*'`
   into a scratch database (never over the live one).
3. Compare document counts per collection with the live database.
4. Drop the scratch database. Record the date and result in `deploy/README.md`.
