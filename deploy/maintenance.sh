#!/usr/bin/env bash
# Nightly housekeeping for one environment: removes password sign-ups never
# confirmed within 24 hours and prunes idle rate-limit rows
# (src/server/maintenance.ts). Runs the release that is live, as the site user.
#
#   install -m 755 deploy/maintenance.sh /usr/local/sbin/studio-maintenance
#   echo '20 3 * * * root /usr/local/sbin/studio-maintenance staging' > /etc/cron.d/studio-maintenance
#   chmod 0644 /etc/cron.d/studio-maintenance      # cron ignores group/world-writable files
set -euo pipefail

ENV_NAME="${1:?usage: studio-maintenance <environment>}"
CONF="/etc/studio-companion/${ENV_NAME}.conf"
ENV_FILE="/etc/studio-companion/${ENV_NAME}.env"
# shellcheck source=/dev/null
source "$CONF"
: "${APP_USER:?} ${APP_DIR:?} ${NODE_BIN:?}"

cd "$APP_DIR/current"
runuser -u "$APP_USER" -- env PATH="$NODE_BIN:/usr/bin:/bin" HOME="/home/$APP_USER" \
  bash -c "set -a; . '$ENV_FILE'; set +a; npm run --silent db -- maintenance" 2>&1 | logger -t "studio-maintenance-${ENV_NAME}"
