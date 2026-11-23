#!/usr/bin/env bash
# Enter PayPal credentials for one environment. Run it yourself, on your Mac,
# from the project folder:
#
#   bash deploy/set-paypal.sh sandbox local        this Mac (.env.local): sandbox only, for local tests
#   bash deploy/set-paypal.sh sandbox staging      the staging server: sandbox only
#   bash deploy/set-paypal.sh live production      the production server: live only (real money)
#
# Live credentials can only go to production, and staging can only take the
# sandbox: real money can never be charged from staging or from this Mac.
# The Client ID is typed visibly, the Secret hidden. Neither is passed as an
# argument (so neither appears in process lists or shell history), printed or
# logged. Locally they are written to .env.local, which git ignores, readable
# only by you; for a server they go over SSH straight into its root-only
# environment file, and the server then registers PayPal's webhook itself
# (deploy/install-paypal.sh).
set -euo pipefail
umask 077

MODE="${1:-}"
TARGET="${2:-}"
case "$MODE:$TARGET" in
  sandbox:local | sandbox:staging | live:production) ;;
  live:*)
    echo "Live credentials move real money: they go to production only (bash deploy/set-paypal.sh live production)." >&2
    exit 2
    ;;
  *:production)
    echo "Production takes live credentials only: bash deploy/set-paypal.sh live production" >&2
    exit 2
    ;;
  *)
    echo "Usage: bash deploy/set-paypal.sh sandbox local | sandbox staging | live production" >&2
    exit 2
    ;;
esac

if [ "$MODE" = sandbox ]; then SWITCH="Sandbox"; else SWITCH="Live"; fi
cat <<EOF
PayPal $MODE credentials for $TARGET.

In your browser:
  1. Open https://developer.paypal.com/dashboard/applications and log in.
  2. At the top, set the switch to "$SWITCH".
  3. Open your app (artist_tools_app), or create one with "Create App" if it is not listed under $SWITCH.
  4. Copy the "Client ID" and paste it below.
  5. Under "Secret key 1", press the copy button (or Show) and paste it below. It will not appear as you paste.

EOF

IFS= read -r -p "Client ID: " CLIENT_ID
IFS= read -r -s -p "Secret (hidden): " SECRET
echo
CLIENT_ID="$(printf '%s' "$CLIENT_ID" | tr -d '[:space:]')"
SECRET="$(printf '%s' "$SECRET" | tr -d '[:space:]')"

if ! [[ "$CLIENT_ID" =~ ^[A-Za-z0-9_.-]{20,200}$ ]]; then
  echo "That Client ID does not look right (letters, digits, - and _ only). Nothing was saved." >&2
  exit 1
fi
if ! [[ "$SECRET" =~ ^[A-Za-z0-9_.-]{20,200}$ ]] || [ "$SECRET" = "$CLIENT_ID" ]; then
  echo "That Secret does not look right. Nothing was saved." >&2
  exit 1
fi

if [ "$TARGET" = local ]; then
  # Optional: a sandbox buyer (Sandbox → Accounts → a Personal account), so the
  # automated sandbox test can approve a subscription on PayPal's sandbox page.
  echo
  echo "Optional, for the automated sandbox test: a sandbox Personal (buyer) account from developer.paypal.com → Sandbox → Accounts."
  IFS= read -r -p "Sandbox buyer email (press Enter to skip): " BUYER_EMAIL
  BUYER_EMAIL="$(printf '%s' "$BUYER_EMAIL" | tr -d '[:space:]')"
  BUYER_PASSWORD=''
  if [ -n "$BUYER_EMAIL" ]; then
    if ! [[ "$BUYER_EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]]; then
      echo "That is not an email address. Nothing was saved." >&2
      exit 1
    fi
    IFS= read -r -s -p "Sandbox buyer password (hidden): " BUYER_PASSWORD
    echo
    case "$BUYER_PASSWORD" in *[[:space:]]* | '') echo "That password does not look right. Nothing was saved." >&2; exit 1 ;; esac
  fi
  ROOT="$(cd "$(dirname "$0")/.." && pwd)"
  FILE="$ROOT/.env.local"
  # Never next to anything git would publish (the repository is public).
  if git -C "$ROOT" ls-files --error-unmatch .env.local >/dev/null 2>&1 || ! git -C "$ROOT" check-ignore -q .env.local; then
    echo ".env.local is not ignored by git here: refusing to write credentials into it." >&2
    exit 1
  fi
  TMP="$(mktemp "$ROOT/.env.local.XXXXXX")"
  trap 'rm -f "$TMP"' EXIT
  if [ -f "$FILE" ]; then
    grep -v -E '^(# PayPal|PAYPAL_ENV|PAYPAL_CLIENT_ID|PAYPAL_CLIENT_SECRET|PAYPAL_WEBHOOK_ID|PAYPAL_SANDBOX_BUYER_EMAIL|PAYPAL_SANDBOX_BUYER_PASSWORD)' "$FILE" > "$TMP" || true
  fi
  {
    echo '# PayPal sandbox (written by deploy/set-paypal.sh): test payments only.'
    echo 'PAYPAL_ENV=sandbox'
    printf 'PAYPAL_CLIENT_ID=%s\n' "$CLIENT_ID"
    printf 'PAYPAL_CLIENT_SECRET=%s\n' "$SECRET"
    if [ -n "$BUYER_EMAIL" ]; then
      printf 'PAYPAL_SANDBOX_BUYER_EMAIL=%s\n' "$BUYER_EMAIL"
      printf "PAYPAL_SANDBOX_BUYER_PASSWORD='%s'\n" "${BUYER_PASSWORD//\'/}"
    fi
  } >> "$TMP"
  chmod 600 "$TMP"
  mv -f "$TMP" "$FILE"
  trap - EXIT
  CLIENT_ID=''
  SECRET=''
  BUYER_PASSWORD=''
  echo "Saved in .env.local (readable only by you; git ignores it). Nothing secret was shown."
  exit 0
fi

SERVER="${STUDIO_SERVER:-root@185.176.255.3}"
echo "Connecting to $SERVER (it may ask for the server password)…"
printf '%s\n%s\n' "$CLIENT_ID" "$SECRET" | ssh -o ConnectTimeout=15 "$SERVER" "/usr/local/sbin/studio-set-paypal $TARGET $MODE"
CLIENT_ID=''
SECRET=''
