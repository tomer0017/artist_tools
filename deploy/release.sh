#!/usr/bin/env bash
# Build and release one commit of Studio Companion on this server, switching
# back automatically if the new release does not become healthy.
#
#   sudo deploy/release.sh <environment> <git-ref>
#   e.g. sudo deploy/release.sh staging migration/nextjs-saas-foundation
#
# Per environment (see deploy/README.md):
#   /etc/studio-companion/<env>.conf  APP_USER, APP_DIR, PORT, NODE_BIN, REPO_URL
#   /etc/studio-companion/<env>.env   secrets (root:<APP_USER>, mode 0640)
#   systemd unit studio-companion-<env>.service (deploy/studio-companion.service)
#
# Layout under APP_DIR: repo.git (mirror), releases/<sha>, current -> releases/<sha>
set -euo pipefail

ENV_NAME="${1:?usage: release.sh <environment> <git-ref>}"
REF="${2:?usage: release.sh <environment> <git-ref>}"
CONF="/etc/studio-companion/${ENV_NAME}.conf"
ENV_FILE="/etc/studio-companion/${ENV_NAME}.env"
SERVICE="studio-companion-${ENV_NAME}"
KEEP_RELEASES=5

# shellcheck source=/dev/null
source "$CONF"
: "${APP_USER:?} ${APP_DIR:?} ${PORT:?} ${NODE_BIN:?} ${REPO_URL:?}"

as_app() { runuser -u "$APP_USER" -- env PATH="$NODE_BIN:/usr/bin:/bin" HOME="/home/$APP_USER" "$@"; }
log() { printf '[release %s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }

# 1. Fetch the code (a local mirror keeps fetches small).
if [ ! -d "$APP_DIR/repo.git" ]; then as_app git clone --quiet --mirror "$REPO_URL" "$APP_DIR/repo.git"; fi
as_app git --git-dir="$APP_DIR/repo.git" fetch --quiet --prune origin '+refs/heads/*:refs/heads/*' '+refs/tags/*:refs/tags/*'
SHA="$(as_app git --git-dir="$APP_DIR/repo.git" rev-parse --verify "${REF}^{commit}")"
RELEASE="$APP_DIR/releases/$SHA"
log "releasing $ENV_NAME at ${SHA:0:7} ($REF)"

# 2. Build it, unless this exact commit is already built.
if [ ! -f "$RELEASE/.next/standalone/server.js" ]; then
  rm -rf "$RELEASE"
  as_app mkdir -p "$APP_DIR/releases"
  as_app git clone --quiet "$APP_DIR/repo.git" "$RELEASE"
  as_app git -C "$RELEASE" checkout --quiet --detach "$SHA"
  log "installing dependencies"
  (cd "$RELEASE" && as_app env MONGOMS_DISABLE_POSTINSTALL=1 npm ci --no-audit --no-fund --loglevel=error)
  log "building"
  (cd "$RELEASE" && as_app env NEXT_TELEMETRY_DISABLED=1 npm run build --silent)
fi

# 3. Back up the database, then bring its schema up to date (idempotent,
#    additive only). No dump, no release: a failed backup stops here.
if [ -x /usr/local/sbin/studio-mongo-backup ]; then
  log "backing up the database"
  /usr/local/sbin/studio-mongo-backup
fi
log "migrating database"
(cd "$RELEASE" && as_app bash -c "set -a; . '$ENV_FILE'; set +a; npm run --silent db -- migrate")

# 4. Switch atomically, restart, and verify; switch back on failure.
PREVIOUS="$(readlink -f "$APP_DIR/current" 2>/dev/null || true)"
switch_to() {
  ln -sfn "$1" "$APP_DIR/current.next"
  mv -T "$APP_DIR/current.next" "$APP_DIR/current"
  systemctl restart "$SERVICE"
}
healthy() {
  for _ in $(seq 1 60); do
    if curl -fsS --max-time 2 "http://127.0.0.1:${PORT}/api/health?ready=1" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}

switch_to "$RELEASE"
if healthy; then
  log "healthy: $ENV_NAME now runs ${SHA:0:7}"
else
  log "NOT healthy — recent logs:"
  journalctl -u "$SERVICE" -n 30 --no-pager || true
  if [ -n "$PREVIOUS" ] && [ "$PREVIOUS" != "$RELEASE" ]; then
    log "switching back to $(basename "$PREVIOUS" | cut -c1-7)"
    switch_to "$PREVIOUS"
    healthy && log "previous release restored" || log "previous release is not healthy either"
  fi
  exit 1
fi

# 5. Keep the newest releases for instant rollback; never delete the live one.
LIVE="$(readlink -f "$APP_DIR/current")"
ls -1dt "$APP_DIR"/releases/*/ 2>/dev/null | sed 's:/$::' | tail -n +$((KEEP_RELEASES + 1)) | while read -r old; do
  [ "$old" = "$LIVE" ] || rm -rf "$old"
done
