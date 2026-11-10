#!/usr/bin/env bash
# Server side: replace who may create an account (AUTH_SIGNUP_ALLOWLIST) in a
# Studio Companion environment file, and nothing else, so no OAuth secret is
# needed. Installed as /usr/local/sbin/studio-set-invites; fed by
# deploy/set-invites.sh.
#
#   printf '%s\n' "$EMAILS" | studio-set-invites <env>
#
# The list arrives on stdin. Every other line, the file's owner and mode are
# kept; the previous version is saved as <env>.env.previous. The app reads the
# list when it starts, so the service is restarted; if it does not come back
# healthy within a minute, the previous file is put back and it restarts again.
# Existing accounts are never affected by the list.
set -euo pipefail
umask 077

ENV_NAME="${1:?usage: studio-set-invites <environment>}"
[[ "$ENV_NAME" =~ ^[a-z0-9-]+$ ]] || { echo "Invalid environment name." >&2; exit 1; }
CONFIG_DIR="${STUDIO_CONFIG_DIR:-/etc/studio-companion}"
FILE="$CONFIG_DIR/${ENV_NAME}.env"
[ -f "$FILE" ] || { echo "No such environment file: $FILE" >&2; exit 1; }

IFS= read -r EMAILS || true
EMAILS="$(printf '%s' "${EMAILS:-}" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')"
if [ -n "$EMAILS" ]; then
  IFS=',' read -r -a ADDRESSES <<< "$EMAILS"
  for address in "${ADDRESSES[@]}"; do
    [[ "$address" =~ ^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$ ]] || {
      echo "\"$address\" is not an email address. Nothing was changed." >&2
      exit 1
    }
  done
fi

TMP="$(mktemp "${FILE}.new.XXXXXX")"
trap 'rm -f "$TMP"' EXIT
if grep -q '^AUTH_SIGNUP_ALLOWLIST=' "$FILE"; then
  awk -v line="AUTH_SIGNUP_ALLOWLIST=\"$EMAILS\"" '/^AUTH_SIGNUP_ALLOWLIST=/ { print line; next } { print }' "$FILE" > "$TMP"
else
  { cat "$FILE"; printf 'AUTH_SIGNUP_ALLOWLIST="%s"\n' "$EMAILS"; } > "$TMP"
fi
chown --reference="$FILE" "$TMP"
chmod --reference="$FILE" "$TMP"
cp -p "$FILE" "${FILE}.previous"
mv -f "$TMP" "$FILE"
trap - EXIT

echo "Saved to $FILE ($(stat -c '%U:%G, mode %a' "$FILE")):"
if [ -n "$EMAILS" ]; then
  echo "  AUTH_SIGNUP_ALLOWLIST  ${EMAILS//,/, }"
else
  echo "  AUTH_SIGNUP_ALLOWLIST  empty: nobody new can create an account"
fi
echo "  every other line kept unchanged"

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
  echo "Healthy: the new list is in effect."
else
  echo "Not healthy after a minute: putting the previous file back." >&2
  cp -p "${FILE}.previous" "$FILE"
  systemctl restart "studio-companion-${ENV_NAME}"
  healthy && echo "Restored and healthy; the invite list is unchanged." >&2
  exit 1
fi
