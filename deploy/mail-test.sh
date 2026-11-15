#!/usr/bin/env bash
# Checks an environment's email provider: connects and signs in over TLS,
# then sends one test message to the address given (nothing about any
# account is in it). Runs the live release as the site user with the
# environment file, like studio-maintenance; works before the app restarts.
#
#   install -m 755 deploy/mail-test.sh /usr/local/sbin/studio-mail-test
#   studio-mail-test staging you@example.com [en|he]
set -euo pipefail

USAGE="usage: studio-mail-test <environment> <email> [en|he]"
ENV_NAME="${1:?$USAGE}"
ADDRESS="${2:?$USAGE}"
LANGUAGE="${3:-en}"
[[ "$ENV_NAME" =~ ^[a-z0-9-]+$ ]] || { echo "Invalid environment name." >&2; exit 1; }
[[ "$ADDRESS" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$ ]] || { echo "That is not an email address." >&2; exit 1; }
[[ "$LANGUAGE" =~ ^(en|he)$ ]] || { echo "The language is en or he." >&2; exit 1; }

CONF="/etc/studio-companion/${ENV_NAME}.conf"
ENV_FILE="/etc/studio-companion/${ENV_NAME}.env"
# shellcheck source=/dev/null
source "$CONF"
: "${APP_USER:?} ${APP_DIR:?} ${NODE_BIN:?}"

cd "$APP_DIR/current"
# The address and language were checked above, so they are safe to quote here.
runuser -u "$APP_USER" -- env PATH="$NODE_BIN:/usr/bin:/bin" HOME="/home/$APP_USER" \
  bash -c "set -a; . '$ENV_FILE'; set +a; exec npm run --silent db -- mail-test '$ADDRESS' '$LANGUAGE'"
