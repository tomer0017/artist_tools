#!/usr/bin/env bash
# Server side: turn username sign-in on or off (AUTH_USERNAME_PASSWORD) in a
# Studio Companion environment file, and nothing else, so no secret is
# needed. Installed as /usr/local/sbin/studio-set-username-login.
#
#   studio-set-username-login <env> on|off
#
# Username sign-in is for accounts that administrators create for invited
# testers (ADR-0012): it never opens registration and needs no email. Off,
# those accounts simply cannot sign in (they and their data are kept), and the
# sign-in page shows Google alone again.
#
# Every other line, the file's owner and mode are kept; the previous version
# is saved as <env>.env.previous. The app reads the setting when it starts, so
# the service is restarted; if it does not come back healthy within a minute,
# the previous file is put back and it restarts again.
set -euo pipefail
umask 077

ENV_NAME="${1:?usage: studio-set-username-login <environment> on|off}"
VALUE="${2:?usage: studio-set-username-login <environment> on|off}"
[[ "$ENV_NAME" =~ ^[a-z0-9-]+$ ]] || { echo "Invalid environment name." >&2; exit 1; }
[[ "$VALUE" == on || "$VALUE" == off ]] || { echo "The value must be on or off." >&2; exit 1; }
CONFIG_DIR="${STUDIO_CONFIG_DIR:-/etc/studio-companion}"
FILE="$CONFIG_DIR/${ENV_NAME}.env"
[ -f "$FILE" ] || { echo "No such environment file: $FILE" >&2; exit 1; }

TMP="$(mktemp "${FILE}.new.XXXXXX")"
trap 'rm -f "$TMP"' EXIT
if grep -q '^AUTH_USERNAME_PASSWORD=' "$FILE"; then
  awk -v line="AUTH_USERNAME_PASSWORD=$VALUE" '/^AUTH_USERNAME_PASSWORD=/ { print line; next } { print }' "$FILE" > "$TMP"
else
  { cat "$FILE"; printf 'AUTH_USERNAME_PASSWORD=%s\n' "$VALUE"; } > "$TMP"
fi
chown --reference="$FILE" "$TMP"
chmod --reference="$FILE" "$TMP"
cp -p "$FILE" "${FILE}.previous"
mv -f "$TMP" "$FILE"
trap - EXIT

echo "Saved to $FILE ($(stat -c '%U:%G, mode %a' "$FILE")):"
echo "  AUTH_USERNAME_PASSWORD  $VALUE"
echo "  every other line kept unchanged (previous file: ${FILE}.previous)"

[ -n "${STUDIO_NO_RESTART:-}" ] && { echo "Not restarted (STUDIO_NO_RESTART)."; exit 0; }

PORT="$(. "$CONFIG_DIR/${ENV_NAME}.conf" && echo "${PORT:-3000}")"
healthy() {
  for _ in $(seq 1 30); do
    curl -fsS --max-time 3 "http://127.0.0.1:${PORT}/api/health?ready=1" >/dev/null 2>&1 && return 0
    sleep 2
  done
  return 1
}
echo "Restarting studio-companion-${ENV_NAME}…"
systemctl restart "studio-companion-${ENV_NAME}"
if healthy; then
  echo "Healthy: username sign-in is $VALUE."
else
  echo "Not healthy after a minute: putting the previous file back." >&2
  cp -p "${FILE}.previous" "$FILE"
  systemctl restart "studio-companion-${ENV_NAME}"
  healthy && echo "Restored and healthy; the setting is unchanged." >&2
  exit 1
fi
