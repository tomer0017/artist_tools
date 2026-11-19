#!/usr/bin/env bash
# Learn's asset directory for one environment (ADR-0017), and its nightly
# backup. Idempotent: run it again any time, it only adds what is missing.
#
#   sudo deploy/install-learn-assets.sh <environment>      e.g. staging
#
# - /var/lib/studio-companion/<env>/learn-assets: the files, outside every
#   release (a deployment or rollback never touches them) and outside
#   public/ (nothing serves them but the app's authorized route); owned by
#   the site's user, mode 0750. The app writes each file once, named by its
#   SHA-256, mode 0640.
# - LEARN_ASSETS_DIR in /etc/studio-companion/<env>.env (the previous file is
#   kept in /root/backups/). The next release, or a restart, applies it.
# - /var/backups/learn-assets/<env>: the backup copy beside the database
#   dumps, root only (0700), made by studio-learn-assets-backup at 02:50,
#   ten minutes after the nightly database dump (docs/ops/backups.md).
set -euo pipefail
umask 022

ENV_NAME="${1:?usage: install-learn-assets.sh <environment>}"
case "$ENV_NAME" in *[!a-z0-9-]*|'') echo "the environment is a lowercase name, e.g. staging" >&2; exit 2 ;; esac
CONF="/etc/studio-companion/${ENV_NAME}.conf"
ENV_FILE="/etc/studio-companion/${ENV_NAME}.env"
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "$CONF"
: "${APP_USER:?}"

ASSETS="/var/lib/studio-companion/${ENV_NAME}/learn-assets"
BACKUP="/var/backups/learn-assets/${ENV_NAME}"
log() { printf '[learn-assets %s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }

install -d -m 0755 -o root -g root /var/lib/studio-companion
install -d -m 0750 -o root -g "$APP_USER" "/var/lib/studio-companion/${ENV_NAME}"
install -d -m 0750 -o "$APP_USER" -g "$APP_USER" "$ASSETS"
install -d -m 0700 -o root -g root /var/backups/learn-assets "$BACKUP"
log "asset directory $ASSETS ($(stat -c '%U:%G %a' "$ASSETS")), backup copy $BACKUP ($(stat -c '%a' "$BACKUP"))"

if grep -q '^LEARN_ASSETS_DIR=' "$ENV_FILE"; then
  log "LEARN_ASSETS_DIR is already set in $ENV_FILE: $(grep '^LEARN_ASSETS_DIR=' "$ENV_FILE")"
else
  install -d -m 0700 /root/backups
  kept="/root/backups/${ENV_NAME}.env.$(date -u +%Y%m%dT%H%M%SZ)"
  cp -p "$ENV_FILE" "$kept"
  printf '\n# Learn reference images and worksheets (ADR-0017, deploy/install-learn-assets.sh)\nLEARN_ASSETS_DIR=%s\n' "$ASSETS" >> "$ENV_FILE"
  log "added LEARN_ASSETS_DIR to $ENV_FILE (previous file kept as $kept); it applies from the next restart"
fi

install -m 0755 "$HERE/backup-learn-assets.sh" /usr/local/sbin/studio-learn-assets-backup
install -m 0755 "$HERE/restore-drill.sh" /usr/local/sbin/studio-restore-drill
cron="/etc/cron.d/studio-learn-assets-backup-${ENV_NAME}"
printf '# Nightly copy of Learn assets (%s), ten minutes after the database dump at 02:40 (docs/ops/backups.md).\n50 2 * * * root /usr/local/sbin/studio-learn-assets-backup %s 2>&1 | logger -t studio-learn-assets-backup\n' "$ENV_NAME" "$ENV_NAME" > "$cron.tmp"
chmod 0644 "$cron.tmp"
mv "$cron.tmp" "$cron"
log "backup job $cron and /usr/local/sbin/studio-learn-assets-backup installed"
