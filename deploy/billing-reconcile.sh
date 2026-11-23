#!/usr/bin/env bash
# Hourly: re-read from PayPal every subscription that can still change, close
# stale checkouts and refresh the Bank of Israel rate (scripts/paypal-commands.ts).
# Webhooks can be missed; this cannot. Runs the live release, as the site user.
#
#   install -m 755 deploy/billing-reconcile.sh /usr/local/sbin/studio-billing-reconcile
#   echo '7 * * * * root /usr/local/sbin/studio-billing-reconcile staging' > /etc/cron.d/studio-billing-reconcile-staging
#   chmod 0644 /etc/cron.d/studio-billing-reconcile-staging
set -euo pipefail

ENV_NAME="${1:?usage: studio-billing-reconcile <environment>}"
CONF="/etc/studio-companion/${ENV_NAME}.conf"
ENV_FILE="/etc/studio-companion/${ENV_NAME}.env"
# shellcheck source=/dev/null
source "$CONF"
: "${APP_USER:?} ${APP_DIR:?} ${NODE_BIN:?}"

cd "$APP_DIR/current"
runuser -u "$APP_USER" -- env PATH="$NODE_BIN:/usr/bin:/bin" HOME="/home/$APP_USER" \
  bash -c "set -a; . '$ENV_FILE'; set +a; npm run --silent db -- billing-reconcile" 2>&1 | logger -t "studio-billing-${ENV_NAME}"
