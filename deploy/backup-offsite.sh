#!/usr/bin/env bash
# Copy the newest nightly MongoDB dump off this server, encrypted, after
# checking it can be read (docs/ops/backups.md). Run as root after the
# nightly dump (/etc/cron.d/studio-offsite-backup).
#
#   deploy/backup-offsite.sh               verify, encrypt, upload, check the upload
#   deploy/backup-offsite.sh --check-only  verify the dump and write its manifest only
#
# Configured by /etc/studio-companion/offsite.conf (root, mode 600):
#   RCLONE_REMOTE=b2-backups:studio-companion-backups-eu/daily   rclone remote and path
#   AGE_RECIPIENT=age1…            public key only: this server can encrypt, never decrypt
#   HEALTHCHECK_URL=https://hc-ping.com/<uuid>   optional: start/success/fail pings
# Without that file, uploading is skipped (off-site backups are not set up yet)
# and only the local check runs.
set -euo pipefail
umask 077

DIR=/var/backups/mongodb
CONF=/etc/studio-companion/offsite.conf
MONGO_AUTH=(--host=127.0.0.1 --port=27017 --username=admin --authenticationDatabase=admin --config=/root/.studio-secrets/mongodb-admin.yaml)
CHECK_ONLY=false
[ "${1:-}" = "--check-only" ] && CHECK_ONLY=true

log() { printf '[offsite %s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
HEALTHCHECK_URL=""
[ -f "$CONF" ] && . "$CONF"
ping_hc() { if [ -n "${HEALTHCHECK_URL:-}" ]; then curl -fsS -m 10 --retry 3 -o /dev/null "${HEALTHCHECK_URL}$1" || true; fi; }
fail() { log "FAILED: $*"; ping_hc /fail; exit 1; }
ping_hc /start

# 1. The newest dump: recent, complete gzip, and readable by mongorestore.
newest="$(ls -1t "$DIR"/mongodb-*.archive.gz 2>/dev/null | head -1 || true)"
[ -n "$newest" ] || fail "no dump in $DIR"
hours=$(( ($(date +%s) - $(stat -c %Y "$newest")) / 3600 ))
[ "$hours" -le 26 ] || fail "the newest dump is $hours hours old ($(basename "$newest"))"
gzip -t "$newest" || fail "$(basename "$newest") is not a complete gzip file"
mongorestore "${MONGO_AUTH[@]}" --dryRun --quiet --archive="$newest" --gzip --nsInclude='studio_companion_*.*' >/dev/null 2>&1 \
  || fail "mongorestore cannot read $(basename "$newest")"
log "dump ok: $(basename "$newest"), $(du -h "$newest" | cut -f1)"

# 2. Manifest (no data): sizes, hashes, and the live document counts per
#    collection of each app database, for the restore drill to compare.
name="$(basename "$newest" .archive.gz)"
manifest="$DIR/$name.manifest.json"
# mongosh reads the admin password from the root-only file itself, so it
# never appears in the process list.
counts="$(mongosh --nodb --quiet --eval '
  const pw = require("fs").readFileSync("/root/.studio-secrets/mongodb-admin.yaml", "utf8").match(/^password:\s*"?([^"\n]*)"?\s*$/m)[1];
  const conn = Mongo("mongodb://127.0.0.1:27017");
  conn.getDB("admin").auth("admin", pw);
  const out = {};
  for (const d of conn.getDB("admin").adminCommand({ listDatabases: 1, nameOnly: true }).databases) {
    if (!d.name.startsWith("studio_companion_")) continue;
    const s = conn.getDB(d.name);
    out[d.name] = Object.fromEntries(s.getCollectionNames().sort().map((c) => [c, s.getCollection(c).countDocuments({})]));
  }
  print(JSON.stringify(out));')"
jq -n --arg file "$(basename "$newest")" --arg sha256 "$(sha256sum "$newest" | cut -d' ' -f1)" \
  --argjson size "$(stat -c %s "$newest")" --arg checkedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --argjson counts "$counts" \
  '{file: $file, size: $size, sha256: $sha256, checkedAt: $checkedAt, countsAtCheck: $counts}' > "$manifest"
log "manifest written: $(basename "$manifest")"

if $CHECK_ONLY || [ ! -f "$CONF" ]; then
  $CHECK_ONLY || log "off-site upload not configured ($CONF missing): local backup only"
  ping_hc ""
  exit 0
fi

# 3. Encrypt with the public key, then upload and confirm the upload.
: "${RCLONE_REMOTE:?RCLONE_REMOTE missing in $CONF}" "${AGE_RECIPIENT:?AGE_RECIPIENT missing in $CONF}"
command -v age >/dev/null || fail "age is not installed (apt install age)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
age -r "$AGE_RECIPIENT" -o "$work/$name.archive.gz.age" "$newest" || fail "encryption failed"
age -r "$AGE_RECIPIENT" -o "$work/$name.manifest.json.age" "$manifest" || fail "encrypting the manifest failed"
rclone copy --immutable "$work" "$RCLONE_REMOTE" || fail "upload failed"
rclone check --one-way "$work" "$RCLONE_REMOTE" || fail "the uploaded files do not match"
log "uploaded $name (encrypted) to $RCLONE_REMOTE"
ping_hc ""
