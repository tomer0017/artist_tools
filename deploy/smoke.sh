#!/usr/bin/env bash
# Read-only smoke test of a deployed environment over HTTPS, run from any
# machine after a release:
#
#   deploy/smoke.sh https://staging.185-176-255-3.sslip.io <expected-commit>
#
# Checks: health reports the expected commit; public pages answer in English
# and Hebrew; signed-out visitors are sent to sign-in from the studio and the
# admin; the security headers are present once each. It never signs in and
# never changes anything.
set -uo pipefail
BASE="${1:?usage: smoke.sh <base-url> <expected-commit>}"
COMMIT="${2:?usage: smoke.sh <base-url> <expected-commit>}"
failures=0
ok() { printf '  ok    %s\n' "$*"; }
bad() { printf '  FAIL  %s\n' "$*"; failures=$((failures + 1)); }

# GET a page: status code, headers and body into temporary files.
fetch() {
  curl -s -m 20 -o "$TMP/body" -D "$TMP/headers" -w '%{http_code}' "$BASE$1"
}
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Smoke test of $BASE (expecting $COMMIT)"

health="$(curl -s -m 20 "$BASE/api/health")"
case "$health" in
  *"\"status\":\"ok\""*"\"commit\":\"$COMMIT\""*) ok "health: ok, running $COMMIT" ;;
  *) bad "health: $health" ;;
esac

for page in / /pricing /sign-in /sign-up /forgot-password; do
  code="$(fetch "$page")"
  if [ "$code" = 200 ] && grep -q '<html lang="en" dir="ltr"' "$TMP/body"; then ok "$page: 200, English"; else bad "$page: $code"; fi
done
for page in /he /he/pricing /he/sign-in /he/sign-up; do
  code="$(fetch "$page")"
  if [ "$code" = 200 ] && grep -q '<html lang="he" dir="rtl"' "$TMP/body"; then ok "$page: 200, Hebrew, right to left"; else bad "$page: $code"; fi
done

for page in /app /app/measure /admin /admin/billing; do
  code="$(fetch "$page")"
  location="$(grep -i '^location:' "$TMP/headers" | tr -d '\r' | cut -d' ' -f2-)"
  case "$code $location" in
    30[1278]\ */sign-in*) ok "$page: signed-out visitors go to sign-in" ;;
    *) bad "$page: $code ${location:-(no redirect)}" ;;
  esac
done

code="$(fetch /)"
csp_count="$(grep -ci '^content-security-policy:' "$TMP/headers")"
csp="$(grep -i '^content-security-policy:' "$TMP/headers" | tr -d '\r')"
if [ "$csp_count" = 1 ] && [[ "$csp" == *"'nonce-"* ]] && [[ "$csp" == *"'strict-dynamic'"* ]] && [[ "$csp" == *"frame-ancestors 'self'"* ]]; then
  ok "one Content-Security-Policy, with a nonce, strict-dynamic and no framing by other sites"
else
  bad "Content-Security-Policy ($csp_count header(s)): ${csp:0:160}"
fi
second="$(curl -s -m 20 -D - -o /dev/null "$BASE/" | grep -i '^content-security-policy:' | grep -o "'nonce-[^']*'")"
first="$(grep -o "'nonce-[^']*'" <<<"$csp")"
if [ -n "$first" ] && [ "$first" != "$second" ]; then ok "a new nonce on every request"; else bad "nonce reused or missing"; fi

session="$(curl -s -m 20 "$BASE/api/auth/get-session")"
if [ "$session" = null ]; then ok "auth API answers (no session)"; else bad "get-session: ${session:0:120}"; fi

big="$(head -c 40000 /dev/zero | tr '\0' 'a')"
code="$(curl -s -m 20 -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -H "origin: $BASE" --data "{\"x\":\"$big\"}" "$BASE/api/auth/sign-in/email")"
if [ "$code" = 413 ]; then ok "oversized request body refused (413)"; else bad "oversized body answered $code"; fi

echo
if [ "$failures" -eq 0 ]; then echo "All checks passed."; else echo "$failures check(s) failed."; fi
exit "$failures"
