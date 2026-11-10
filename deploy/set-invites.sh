#!/usr/bin/env bash
# Run on your own computer to choose which Google accounts may create a Studio
# Companion account on a server (registration is invite-only). It replaces the
# whole list: addresses left out can no longer sign up, but existing accounts
# always keep working. The app restarts for a few seconds. No secret is asked
# for or sent.
#
#   bash deploy/set-invites.sh                     # staging on 185.176.255.3
#   STUDIO_SERVER=root@host bash deploy/set-invites.sh production
set -euo pipefail

ENV_NAME="${1:-staging}"
SERVER="${STUDIO_SERVER:-root@185.176.255.3}"

echo "Who may create an account on '$ENV_NAME' ($SERVER)."
echo "Enter the complete list. Addresses left out can no longer sign up; existing accounts keep working."
read -r -p "Google account email(s), comma-separated: " EMAILS
printf '%s\n' "$EMAILS" | ssh -o ConnectTimeout=15 "$SERVER" "/usr/local/sbin/studio-set-invites $ENV_NAME"
