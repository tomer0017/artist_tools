#!/usr/bin/env bash
# Restore drill: prove a backup restores (docs/ops/backups.md). Restores one
# app database from a dump into a throwaway database, compares every
# collection's document count with the manifest (or, without one, with the
# live database), checks the unique indexes came back, then drops the
# throwaway database. Never touches the live database.
#
#   deploy/restore-drill.sh <dump.archive.gz | dump.archive.gz.age> [options]
#     --db NAME          app database inside the dump (default studio_companion_staging)
#     --identity FILE    age private key, for an encrypted (.age) dump
#     --manifest FILE    the dump's manifest (.json, or .json.age with --identity)
#   MONGO_URI          where the throwaway database is created; on the server
#                      the local admin connection is used when it is unset
set -euo pipefail
umask 077

ARCHIVE="${1:?usage: restore-drill.sh <dump.archive.gz|dump.archive.gz.age> [--db NAME] [--identity FILE] [--manifest FILE]}"
shift
DB=studio_companion_staging
IDENTITY=""
MANIFEST=""
while [ $# -gt 0 ]; do
  case "$1" in
    --db) DB="$2"; shift 2 ;;
    --identity) IDENTITY="$2"; shift 2 ;;
    --manifest) MANIFEST="$2"; shift 2 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done

log() { printf '[drill %s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
work="$(mktemp -d)"
SCRATCH="restore_drill_$(date -u +%Y%m%d%H%M%S)"
cleanup() {
  mongosh_run "conn.getDB('$SCRATCH').dropDatabase()" >/dev/null 2>&1 || true
  rm -rf "$work"
}

# Every mongosh call starts from a `conn` (the server connection). On the
# server, mongosh reads the admin password from the root-only file itself, so
# it never appears in the process list.
if [ -n "${MONGO_URI:-}" ]; then
  mongosh_run() { mongosh "$MONGO_URI" --quiet --eval "const conn = db.getMongo(); $1"; }
  restore_auth=(--uri="$MONGO_URI")
else
  mongosh_run() {
    mongosh --nodb --quiet --eval "
      const pw = require('fs').readFileSync('/root/.studio-secrets/mongodb-admin.yaml', 'utf8').match(/^password:\\s*\"?([^\"\\n]*)\"?\\s*$/m)[1];
      const conn = Mongo('mongodb://127.0.0.1:27017');
      conn.getDB('admin').auth('admin', pw);
      $1"
  }
  restore_auth=(--host=127.0.0.1 --port=27017 --username=admin --authenticationDatabase=admin --config=/root/.studio-secrets/mongodb-admin.yaml)
fi
trap cleanup EXIT

decrypt() { age -d -i "$IDENTITY" -o "$2" "$1"; }

started=$(date +%s)
plain="$ARCHIVE"
if [[ "$ARCHIVE" == *.age ]]; then
  [ -n "$IDENTITY" ] || { echo "an encrypted dump needs --identity" >&2; exit 2; }
  plain="$work/dump.archive.gz"
  decrypt "$ARCHIVE" "$plain"
  log "decrypted $(basename "$ARCHIVE")"
fi
if [[ "$MANIFEST" == *.age ]]; then
  decrypt "$MANIFEST" "$work/manifest.json"
  MANIFEST="$work/manifest.json"
fi
gzip -t "$plain"

log "restoring $DB from $(basename "$ARCHIVE") into $SCRATCH"
mongorestore "${restore_auth[@]}" --quiet --archive="$plain" --gzip \
  --nsInclude="$DB.*" --nsFrom="$DB.*" --nsTo="$SCRATCH.*"

restored="$(mongosh_run "
  const s = conn.getDB('$SCRATCH');
  print(JSON.stringify(Object.fromEntries(s.getCollectionNames().sort().map((c) => [c, s.getCollection(c).countDocuments({})]))));")"
if [ -n "$MANIFEST" ]; then
  expected="$(jq -c --arg db "$DB" '.countsAtCheck[$db] // {}' "$MANIFEST")"
  source_label="manifest"
else
  expected="$(mongosh_run "
    const s = conn.getDB('$DB');
    print(JSON.stringify(Object.fromEntries(s.getCollectionNames().sort().map((c) => [c, s.getCollection(c).countDocuments({})]))));")"
  source_label="live database now"
fi

# Collections that change on their own (sessions, rate limits, throttles,
# outbox mail, events) may differ a little between the dump and the
# comparison; everything else must match exactly.
report="$(jq -rn --argjson got "$restored" --argjson want "$expected" '
  def volatile: test("^(sessions|rateLimits|rate_limits|auth_throttles|mail_outbox|verifications|analytics_events|audit_events|admin_mfa_sessions|error_reports|checkout_sessions)$");
  [$want | keys[] as $c | {c: $c, want: $want[$c], got: ($got[$c] // null)}] as $rows
  | ($rows | map(select((.got == null and .want > 0) or (.got != null and .got != .want and (.c | volatile | not))))) as $bad
  | ($rows[] | "\(.c): restored \(.got // "none (created after this dump)"), expected \(.want)\(if .got != null and .got != .want and (.c | volatile) then " (changes on its own)" else "" end)"),
    (if ($bad | length) == 0 then "RESULT: OK" else "RESULT: MISMATCH in " + ($bad | map(.c) | join(", ")) end)')"
printf '%s\n' "$report"

indexes="$(mongosh_run "
  const s = conn.getDB('$SCRATCH');
  const unique = (c) => s.getCollection(c).getIndexes().filter((i) => i.unique).map((i) => i.name).join(',') || '(none)';
  print(['users', 'accounts', 'sessions'].map((c) => c + ': ' + unique(c)).join('  '));")"
log "unique indexes restored: $indexes"
log "compared with: $source_label; took $(( $(date +%s) - started ))s"
grep -q '^RESULT: OK$' <<<"$report"
