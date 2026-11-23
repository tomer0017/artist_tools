#!/usr/bin/env bash
# Server side: put PayPal credentials into a Studio Companion environment file,
# create the PayPal plans and register the webhook, and store its ID. Nothing
# is saved unless PayPal accepts the credentials in the chosen mode.
# Installed as /usr/local/sbin/studio-set-paypal; fed by deploy/set-paypal.sh.
#
#   printf '%s\n%s\n' "$CLIENT_ID" "$SECRET" | studio-set-paypal <env> sandbox|live
#
# Live credentials (real money) are refused unless the environment file says
# APP_ENV=production; production takes nothing but live ones. Values arrive on
# stdin, never as arguments, and the secret is never printed. Every other
# variable, the file's owner and mode are kept; the previous version is saved
# as <env>.env.previous. The app is not restarted here: it picks the
# credentials up at its next restart (deploy/release.sh or systemctl).
set -euo pipefail
umask 077

ENV_NAME="${1:?usage: studio-set-paypal <environment> sandbox|live}"
MODE="${2:?usage: studio-set-paypal <environment> sandbox|live}"
[[ "$ENV_NAME" =~ ^[a-z0-9-]+$ ]] || { echo "Invalid environment name." >&2; exit 1; }
[[ "$MODE" == sandbox || "$MODE" == live ]] || { echo "The mode is sandbox or live." >&2; exit 1; }
FILE="/etc/studio-companion/${ENV_NAME}.env"
CONF="/etc/studio-companion/${ENV_NAME}.conf"
[ -f "$FILE" ] && [ -f "$CONF" ] || { echo "No such environment: $ENV_NAME" >&2; exit 1; }

APP_ENV="$(grep -E '^APP_ENV=' "$FILE" | tail -1 | cut -d= -f2- | tr -d '"'"'" || true)"
if [ "$MODE" = live ] && [ "$APP_ENV" != production ]; then
  echo "Refused: live PayPal credentials (real money) go only to an environment with APP_ENV=production; $ENV_NAME has APP_ENV=${APP_ENV:-unset}. Nothing was changed." >&2
  exit 1
fi
if [ "$MODE" = sandbox ] && [ "$APP_ENV" = production ]; then
  echo "Refused: production takes live credentials only. Nothing was changed." >&2
  exit 1
fi

IFS= read -r CLIENT_ID || true
IFS= read -r SECRET || true
CLIENT_ID="${CLIENT_ID//[$'\r\t ']/}"
SECRET="${SECRET//[$'\r\t ']/}"
[[ "$CLIENT_ID" =~ ^[A-Za-z0-9_.-]{20,200}$ ]] || { echo "The Client ID does not look right. Nothing was changed." >&2; exit 1; }
[[ "$SECRET" =~ ^[A-Za-z0-9_.-]{20,200}$ ]] || { echo "The Secret does not look right. Nothing was changed." >&2; exit 1; }

write_env() {
  # $1: the target file, $2: the webhook ID or empty. Everything but the PayPal lines is kept.
  local target="$1" tmp
  tmp="$(mktemp "${FILE}.new.XXXXXX")"
  grep -v -E '^(# PayPal|PAYPAL_ENV|PAYPAL_CLIENT_ID|PAYPAL_CLIENT_SECRET|PAYPAL_WEBHOOK_ID)' "$FILE" > "$tmp" || true
  {
    echo "# PayPal $MODE (written by studio-set-paypal)."
    printf 'PAYPAL_ENV="%s"\n' "$MODE"
    printf 'PAYPAL_CLIENT_ID="%s"\n' "$CLIENT_ID"
    printf 'PAYPAL_CLIENT_SECRET="%s"\n' "$SECRET"
    if [ -n "$2" ]; then printf 'PAYPAL_WEBHOOK_ID="%s"\n' "$2"; fi
  } >> "$tmp"
  chown --reference="$FILE" "$tmp"
  chmod --reference="$FILE" "$tmp"
  mv -f "$tmp" "$target"
}

# First a trial copy of the environment file with the new credentials: PayPal
# must accept them in this mode (sandbox or live) before anything is saved, so
# credentials from the wrong side of PayPal's Sandbox/Live switch change nothing.
TRIAL="$(mktemp "${FILE}.trial.XXXXXX")"
trap 'rm -f "$TRIAL"' EXIT
write_env "$TRIAL" ""

# With the trial file: the plans and the webhook, from the live release.
# shellcheck source=/dev/null
source "$CONF"
: "${APP_USER:?} ${APP_DIR:?} ${NODE_BIN:?}"
OUT="$(cd "$APP_DIR/current" && runuser -u "$APP_USER" -- env PATH="$NODE_BIN:/usr/bin:/bin" HOME="/home/$APP_USER" \
  bash -c "set -a; . '$TRIAL'; set +a; npm run --silent db -- paypal-setup" 2>&1)" || {
  echo "PayPal did not accept these credentials for $MODE, or setting it up failed. Nothing was changed." >&2
  if [ "$MODE" = live ]; then echo "Check that the switch at the top of developer.paypal.com says Live (not Sandbox) when you copy them." >&2; fi
  printf '%s\n' "$OUT" | grep -v -i secret | tail -5 >&2
  exit 1
}
printf '%s\n' "$OUT" | grep -v '^PAYPAL_WEBHOOK_ID='
WEBHOOK_ID="$(printf '%s\n' "$OUT" | sed -n 's/^PAYPAL_WEBHOOK_ID=\([A-Z0-9]\{8,40\}\)$/\1/p' | tail -1)"

cp -p "$FILE" "${FILE}.previous"
write_env "$FILE" "$WEBHOOK_ID"
rm -f "$TRIAL"
trap - EXIT
CLIENT_ID=''
SECRET=''

echo "Saved to $FILE ($(stat -c '%U:%G, mode %a' "$FILE")):"
echo "  PAYPAL_ENV            $MODE"
echo "  PAYPAL_CLIENT_ID      set"
echo "  PAYPAL_CLIENT_SECRET  set (not shown)"
echo "  PAYPAL_WEBHOOK_ID     ${WEBHOOK_ID:-not set (no https address yet)}"
echo "The app uses them after its next restart."
