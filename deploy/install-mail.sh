#!/usr/bin/env bash
# Server side: give a Studio Companion environment its email provider (SMTP
# over TLS), so account emails reach people instead of the staging outbox.
# Installed as /usr/local/sbin/studio-set-mail. Run it in a terminal on the
# server and answer the questions (the password is not shown):
#
#   sudo studio-set-mail staging
#
# or feed the five values on stdin, one per line: server, port, username,
# sender, password. Values never appear as arguments, so they stay out of
# process lists, shell history and logs, and the password is never printed.
# Every other variable, the file's owner and mode are kept; the previous
# version is saved as <env>.env.previous with the same permissions.
# Registration is not opened and nothing is restarted: check delivery first
# with studio-mail-test (docs/ops/email.md).
set -euo pipefail
umask 077

ENV_NAME="${1:?usage: studio-set-mail <environment>}"
[[ "$ENV_NAME" =~ ^[a-z0-9-]+$ ]] || { echo "Invalid environment name." >&2; exit 1; }
CONFIG_DIR="${STUDIO_CONFIG_DIR:-/etc/studio-companion}"
FILE="${CONFIG_DIR}/${ENV_NAME}.env"
[ -f "$FILE" ] || { echo "No such environment file: $FILE" >&2; exit 1; }

fail() { echo "$1 Nothing was changed." >&2; exit 1; }

if [ -t 0 ]; then
  echo "Email provider for '$ENV_NAME': the SMTP details from the provider's dashboard (docs/ops/email.md)."
  read -r -p "SMTP server, e.g. smtp.resend.com: " HOST
  read -r -p "Port, 465 or 587 [465]: " PORT
  read -r -p "Username: " USERNAME
  read -r -p "Sender as people see it, e.g. Studio Companion <hello@your-domain.com>: " FROM
  read -r -s -p "Password or API key (not shown): " PASSWORD
  echo
else
  IFS= read -r HOST || true
  IFS= read -r PORT || true
  IFS= read -r USERNAME || true
  IFS= read -r FROM || true
  IFS= read -r PASSWORD || true
fi
HOST="$(printf '%s' "${HOST:-}" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')"
PORT="${PORT//[$'\r\t ']/}"
PORT="${PORT:-465}"
USERNAME="${USERNAME//[$'\r\t ']/}"
FROM="$(printf '%s' "${FROM:-}" | tr -d '\r' | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
# Some providers show passwords in groups ("abcd efgh ijkl mnop"); the spaces are not part of them.
PASSWORD="${PASSWORD//[$'\r\t ']/}"

# Values are written inside double quotes, so they must not contain a quote,
# backslash, dollar sign or backtick.
quotable() { case "$1" in *[\"\\\$\`]*) return 1 ;; *) [ -n "$1" ] ;; esac; }

[[ "$HOST" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] || fail "The SMTP server does not look like a host name."
[[ "$PORT" =~ ^(465|587|2525)$ ]] || fail "Use port 465 (TLS) or 587 (STARTTLS); some providers also offer 2525."
quotable "$USERNAME" || fail "The username does not look right."
ADDRESS="$(printf '%s' "$FROM" | sed -nE 's/.*<([^<>]+)>$/\1/p')"
ADDRESS="${ADDRESS:-$FROM}"
if ! quotable "$FROM" || ! [[ "$ADDRESS" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$ ]] || [[ "$ADDRESS" == *.invalid ]]; then
  fail "The sender must be an address the provider lets you send from, e.g. Studio Companion <hello@your-domain.com>."
fi
if ! quotable "$PASSWORD" || [ "${#PASSWORD}" -lt 8 ]; then
  fail "The password or API key does not look right."
fi

TMP="$(mktemp "${FILE}.new.XXXXXX")"
trap 'rm -f "$TMP"' EXIT
# Keep everything except earlier email lines (and their comment).
grep -v -E '^#? ?(MAIL_TRANSPORT|MAIL_FROM|SMTP_HOST|SMTP_PORT|SMTP_USER|SMTP_PASSWORD)=|^# Email provider' "$FILE" > "$TMP" || true
{
  echo '# Email provider (written by studio-set-mail).'
  echo 'MAIL_TRANSPORT="smtp"'
  printf 'SMTP_HOST="%s"\n' "$HOST"
  printf 'SMTP_PORT="%s"\n' "$PORT"
  printf 'SMTP_USER="%s"\n' "$USERNAME"
  printf 'SMTP_PASSWORD="%s"\n' "$PASSWORD"
  printf 'MAIL_FROM="%s"\n' "$FROM"
} >> "$TMP"
chown --reference="$FILE" "$TMP"
chmod --reference="$FILE" "$TMP"
cp -p "$FILE" "${FILE}.previous"
mv -f "$TMP" "$FILE"
trap - EXIT

echo "Saved to $FILE ($(stat -c '%U:%G, mode %a' "$FILE")):"
echo "  MAIL_TRANSPORT  smtp"
echo "  SMTP server     $HOST:$PORT (TLS)"
echo "  SMTP_USER       $USERNAME"
echo "  SMTP_PASSWORD   set (${#PASSWORD} characters, not shown)"
echo "  MAIL_FROM       $FROM"
echo "Nothing was restarted and registration is unchanged."
echo "Next:  studio-mail-test $ENV_NAME <your email address>   (connects, signs in, sends one test message)"
echo "Undo:  cp -p ${FILE}.previous $FILE"
PASSWORD=''
