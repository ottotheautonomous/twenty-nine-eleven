#!/usr/bin/env bash
# LIVE probes, run by the lead after setup (docs/CONTACT-SUPABASE.md section 7). Data API: no key, the publishable key (as apikey
# and as a Bearer token) and a made-up secret key must all fail to select, insert, update or delete the enquiry table and to
# call either function. Worker: the front door refuses foreign origins and is configured (answers 400, not 503, to bad JSON).
# Prints HTTP status codes only. Never asks for, uses or prints the real secret key; stores nothing; uses 1 of the Worker's
# 5-per-minute per-IP allowance.
# Usage: REF=<20-character project ref> bash supabase/verify/live_api_probe.sh   (asks for the publishable key, not echoed)
# Expected: every line "ok", exit 0.
set -u
: "${REF:?set REF to the 20-character project ref}"
[[ "$REF" =~ ^[a-z0-9]{20}$ ]] || { echo "REF must be the 20-character project ref"; exit 2; }
if [ -z "${PUB:-}" ]; then read -rs -p 'Publishable key (sb_publishable_..., not echoed): ' PUB; echo; fi
[[ "$PUB" =~ ^sb_publishable_[A-Za-z0-9_-]+$ ]] || { echo "PUB must be the publishable key (sb_publishable_...), never the secret key"; exit 2; }
B="https://$REF.supabase.co"
W="https://contact.twentynineeleven.net/api/contact"
WWW="https://www.twentynineeleven.net"
UA='twentynineeleven-live-probe/1'
BOGUS="sb_secret_$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)"
ROW='{"p_request_id":"11111111-1111-4111-8111-111111111111","p_name":"Probe","p_email":"probe@example.com","p_message":"probe probe probe","p_source":null}'
fail=0

# Header lines go to curl through stdin (curl -K -), so no key appears in this shared machine's process list.
hdr() { for h in "$@"; do printf 'header = "%s"\n' "$h"; done; }
NOKEY=''
ANON=$(hdr "apikey: $PUB")
BEARER=$(hdr "apikey: $PUB" "Authorization: Bearer $PUB")
FAKE=$(hdr "apikey: $BOGUS")

probe() { # label, expected-status-regex, header-lines, curl args...
  local label=$1 expect=$2 headers=$3; shift 3
  local code
  code=$(printf '%s' "$headers" | curl -s -o /dev/null -w '%{http_code}' --max-time 15 -A "$UA" -K - "$@")
  if [[ "$code" =~ ^($expect)$ ]]; then printf 'ok   %-66s %s\n' "$label" "$code"; else printf 'FAIL %-66s %s (expected %s)\n' "$label" "$code" "$expect"; fail=1; fi
}
J=(-H 'Content-Type: application/json')

for who in NOKEY ANON BEARER FAKE; do
  h=${!who}
  case $who in
    NOKEY)  echo "--- no key at all (expect 401)"; any='401' ;;
    ANON)   echo "--- publishable key (role anon): expect 401/403/404/406, never 2xx"; any='401|403|404|406' ;;
    BEARER) echo "--- publishable key also sent as a Bearer token: same"; any='401|403|404|406' ;;
    FAKE)   echo "--- a made-up sb_secret_ key (expect 401)"; any='401' ;;
  esac
  probe "$who GET    table via public"                   "$any"                "$h" "$B/rest/v1/contact_submissions?select=*"
  probe "$who GET    table via Accept-Profile: intake"   "$any"                "$h" -H 'Accept-Profile: intake' "$B/rest/v1/contact_submissions?select=*"
  probe "$who POST   insert via public"                  "$any"                "$h" "${J[@]}" -d '{"name":"x"}' "$B/rest/v1/contact_submissions"
  probe "$who POST   insert via Content-Profile: intake" "$any"                "$h" "${J[@]}" -H 'Content-Profile: intake' -d '{"name":"x"}' "$B/rest/v1/contact_submissions"
  probe "$who PATCH  update via Content-Profile: intake" "$any"                "$h" "${J[@]}" -H 'Content-Profile: intake' -X PATCH -d '{"name":"x"}' "$B/rest/v1/contact_submissions?id=gt.0"
  probe "$who DELETE via Content-Profile: intake"        "$any"                "$h" -H 'Content-Profile: intake' -X DELETE "$B/rest/v1/contact_submissions?id=gt.0"
  probe "$who GET    keepalive via Accept-Profile: intake" "$any"              "$h" -H 'Accept-Profile: intake' "$B/rest/v1/keepalive?select=*"
  probe "$who POST   rpc/submit_enquiry"                 "$any"                "$h" "${J[@]}" -d "$ROW" "$B/rest/v1/rpc/submit_enquiry"
  probe "$who POST   rpc/contact_keepalive"              "$any"                "$h" "${J[@]}" -d '{}' "$B/rest/v1/rpc/contact_keepalive"
  probe "$who GET    rpc/submit_enquiry"                 "$any|405"            "$h" "$B/rest/v1/rpc/submit_enquiry?p_request_id=11111111-1111-4111-8111-111111111111"
done

echo "--- OpenAPI description as anon: unavailable, or lists nothing of the contact intake"
out=$(printf '%s' "$ANON" | curl -s --max-time 15 -A "$UA" -K - -w '\n%{http_code}' "$B/rest/v1/")
code=${out##*$'\n'}; body=${out%$'\n'*}
if [[ "$code" =~ ^(401|403|404)$ ]]; then echo "ok   openapi not available to the publishable key                        $code"
elif [ "$code" = 200 ] && printf '%s' "$body" | python3 -I -c '
import sys, json, re
try: d = json.load(sys.stdin)
except Exception: print("     openapi answer is not JSON"); sys.exit(1)
names = list(d.get("paths", {})) + list(d.get("definitions", {})) + list(d.get("components", {}).get("schemas", {}))
bad = [n for n in names if re.search(r"contact|enquir|submit|keepalive|intake", n, re.I)]
print("     openapi entries:", ", ".join(sorted(names)) or "none"); sys.exit(1 if bad else 0)'; then echo "ok   openapi lists no contact paths                                         200"
else echo "FAIL openapi as anon                                                         $code"; fail=1; fi

echo "--- GraphQL as anon: no contact type, query or mutation"
out=$(printf '%s' "$ANON" | curl -s --max-time 15 -A "$UA" -K - -w '\n%{http_code}' "${J[@]}" \
  -d '{"query":"{ __schema { types { name } queryType { fields { name } } mutationType { fields { name } } } }"}' "$B/graphql/v1")
code=${out##*$'\n'}; body=${out%$'\n'*}
if printf '%s' "$body" | python3 -I -c '
import sys, json, re
try: d = json.load(sys.stdin)
except Exception: sys.exit(0 if sys.argv[1] != "200" else 1)   # a non-JSON error page is fine; a non-JSON 200 is not
s = json.dumps(d.get("data") or {}) if isinstance(d, dict) else json.dumps(d)
sys.exit(1 if re.search(r"contact|enquir|submit|keepalive|intake", s, re.I) else 0)' "$code"; then echo "ok   graphql exposes nothing of the contact intake                          $code"
else echo "FAIL graphql exposes contact objects                                         $code"; fail=1; fi

echo "--- the Worker's front door (stores nothing)"
probe 'Worker POST without Origin'                     '403' "$NOKEY" "${J[@]}" -d '{}' "$W"
probe 'Worker POST from a foreign Origin'              '403' "$NOKEY" "${J[@]}" -H 'Origin: https://evil.example' -d '{}' "$W"
probe 'Worker CORS preflight from www'                 '204' "$NOKEY" -X OPTIONS -H "Origin: $WWW" -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: content-type' "$W"
probe 'Worker bad JSON from www (400 = configured; 503 = secrets missing)' '400' "$NOKEY" "${J[@]}" -H "Origin: $WWW" -d '{' "$W"

echo "--- the secret-key path is proved by one real enquiry from $WWW (the Worker is the only holder of the key)"
unset PUB
exit $fail
