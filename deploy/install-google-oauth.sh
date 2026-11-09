#!/usr/bin/env bash
# Server side: put a Google OAuth client (and who may create accounts) into a
# Studio Companion environment file. Installed as
# /usr/local/sbin/studio-set-google-oauth; fed by deploy/set-google-oauth.sh.
#
#   printf '%s\n%s\n%s\n' "$CLIENT_ID" "$CLIENT_SECRET" "$EMAILS" | studio-set-google-oauth <env>
#
# Values arrive on stdin, never as arguments, so they do not appear in process
# lists, shell history or logs, and the secret is never printed. Every other
# variable, the file's owner and mode are kept; the previous version is saved
# as <env>.env.previous with the same permissions. Nothing is restarted.
set -euo pipefail
umask 077

ENV_NAME="${1:?usage: studio-set-google-oauth <environment>}"
[[ "$ENV_NAME" =~ ^[a-z0-9-]+$ ]] || { echo "Invalid environment name." >&2; exit 1; }
FILE="/etc/studio-companion/${ENV_NAME}.env"
[ -f "$FILE" ] || { echo "No such environment file: $FILE" >&2; exit 1; }

IFS= read -r CLIENT_ID || true
IFS= read -r CLIENT_SECRET || true
IFS= read -r EMAILS || true
CLIENT_ID="${CLIENT_ID//[$'\r\t ']/}"
CLIENT_SECRET="${CLIENT_SECRET//[$'\r\t ']/}"
EMAILS="$(printf '%s' "${EMAILS:-}" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')"

# Values are written inside double quotes, so they must not contain a quote,
# backslash, dollar sign or backtick.
quotable() { case "$1" in *[\"\\\$\`]*) return 1 ;; *) [ -n "$1" ] ;; esac; }

if ! quotable "$CLIENT_ID" || [[ "$CLIENT_ID" != *.apps.googleusercontent.com ]]; then
  echo "The Client ID does not look right (it ends with .apps.googleusercontent.com). Nothing was changed." >&2
  exit 1
fi
if ! quotable "$CLIENT_SECRET" || [ "${#CLIENT_SECRET}" -lt 10 ]; then
  echo "The Client Secret does not look right. Nothing was changed." >&2
  exit 1
fi
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
# Keep everything except earlier Google / sign-up lines (and their comments).
grep -v -E '^#? ?(GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|AUTH_SIGNUP_ALLOWLIST)=|^# Google sign-in' "$FILE" > "$TMP" || true
{
  echo '# Google sign-in and who may create an account (written by studio-set-google-oauth).'
  printf 'GOOGLE_CLIENT_ID="%s"\n' "$CLIENT_ID"
  printf 'GOOGLE_CLIENT_SECRET="%s"\n' "$CLIENT_SECRET"
  printf 'AUTH_SIGNUP_ALLOWLIST="%s"\n' "$EMAILS"
} >> "$TMP"
chown --reference="$FILE" "$TMP"
chmod --reference="$FILE" "$TMP"
cp -p "$FILE" "${FILE}.previous"
mv -f "$TMP" "$FILE"
trap - EXIT

echo "Saved to $FILE ($(stat -c '%U:%G, mode %a' "$FILE")):"
echo "  GOOGLE_CLIENT_ID       set (…apps.googleusercontent.com)"
echo "  GOOGLE_CLIENT_SECRET   set (${#CLIENT_SECRET} characters, not shown)"
if [ -n "$EMAILS" ]; then
  echo "  AUTH_SIGNUP_ALLOWLIST  ${EMAILS//,/, }"
else
  echo "  AUTH_SIGNUP_ALLOWLIST  empty: nobody new can create an account"
fi
echo "  kept unchanged:        $(grep -E '^[A-Z_]+=' "$FILE" | cut -d= -f1 | grep -v -E '^(GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|AUTH_SIGNUP_ALLOWLIST)$' | tr '\n' ' ')"
echo "Nothing was restarted yet."
