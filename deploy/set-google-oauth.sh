#!/usr/bin/env bash
# Run on your own computer to give a Studio Companion server its Google OAuth
# client. It asks for the Client ID, the Client Secret (hidden while you type)
# and the Google account(s) allowed to create accounts, then sends them over
# SSH straight into the server's environment file. They never pass through
# the chat, the repository, a file on this computer or your shell history.
#
#   bash deploy/set-google-oauth.sh                     # staging on 185.176.255.3
#   STUDIO_SERVER=root@host bash deploy/set-google-oauth.sh production
set -euo pipefail

ENV_NAME="${1:-staging}"
SERVER="${STUDIO_SERVER:-root@185.176.255.3}"

echo "Google sign-in for '$ENV_NAME' on $SERVER"
read -r -p "Google Client ID: " CLIENT_ID
read -r -s -p "Google Client Secret (not shown): " CLIENT_SECRET
echo
read -r -p "Google account email(s) allowed to create accounts, comma-separated: " EMAILS
echo "Connecting to $SERVER (it may ask for the server password)…"
printf '%s\n%s\n%s\n' "$CLIENT_ID" "$CLIENT_SECRET" "$EMAILS" |
  ssh -o ConnectTimeout=15 "$SERVER" "/usr/local/sbin/studio-set-google-oauth $ENV_NAME"
CLIENT_SECRET=''
