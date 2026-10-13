#!/usr/bin/env bash
# Offline proof of supabase/migrations/20261013120000_contact_intake.sql on a throwaway local PostgreSQL 16 with Supabase-like
# roles (postgres NOSUPERUSER + BYPASSRLS; anon, authenticated, service_role, authenticator). No Supabase, no network, no
# Docker: the cluster lives in a temp dir on 127.0.0.1 and is removed afterwards. Applies the migration twice, under the 2026
# no-grant defaults and under the old permissive defaults, runs live_checks.sql (all PASS) and offline_checks.sql, proves that
# live_checks.sql reports FAIL after a deliberate sabotage, proves the guard, and compares the whole output with
# offline-expected.txt. Exit 0 = identical.
# Usage: bash supabase/verify/offline-pg16.sh            (PG_BIN=/usr/lib/postgresql/16/bin by default)
#        UPDATE_EXPECTED=1 bash supabase/verify/offline-pg16.sh   (rewrite the expected output after a reviewed change)
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
migdir=$(cd "$here/../migrations" && pwd)
migration="$migdir/20261013120000_contact_intake.sql"
B=${PG_BIN:-/usr/lib/postgresql/16/bin}
PORT=${PG_PORT:-55442}
T=$(mktemp -d)
trap 'nice -n 15 "$B/pg_ctl" -D "$T/data" stop -m fast >/dev/null 2>&1 || true; rm -rf "$T"' EXIT
nice -n 15 "$B/initdb" -D "$T/data" -U supabase_admin --auth=trust -E UTF8 --locale=C.UTF-8 >/dev/null
nice -n 15 "$B/pg_ctl" -D "$T/data" -o "-c unix_socket_directories='' -c listen_addresses=127.0.0.1 -p $PORT -c shared_buffers=16MB -c wal_level=logical" \
  -l "$T/log" start >/dev/null
q() { PGOPTIONS="-c client_min_messages=warning" psql -X -q -h 127.0.0.1 -p "$PORT" "$@"; }
q -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -f "$here/fixtures/00_roles.sql"

run() {
  for mode in new-defaults old-defaults; do
    echo "################ $mode ################"
    q -U supabase_admin -d postgres -c "drop database if exists t" -c "create database t owner postgres" >/dev/null
    q -U supabase_admin -d t -v ON_ERROR_STOP=1 -f "$here/fixtures/01_database.sql"
    if [ "$mode" = old-defaults ]; then q -U postgres -d t -v ON_ERROR_STOP=1 -f "$here/fixtures/02_old_defaults.sql"; fi
    echo "--- migration as postgres (NOSUPERUSER, BYPASSRLS): expect no errors"
    q -U postgres -d t -v ON_ERROR_STOP=1 -f "$migration" 2>&1
    echo "--- live_checks.sql right after the migration (n|result): expect PASS for 1-13, INFO for 14-16"
    q -U postgres -d t -v ON_ERROR_STOP=1 -A -t -F '|' -f "$here/live_checks.sql" 2>&1 | cut -d'|' -f1,2
    q -U postgres -d t -f "$here/offline_checks.sql" 2>&1
    if [ "$mode" = new-defaults ]; then
      echo "--- negative control: live_checks.sql after fixtures/03_sabotage.sql (expect FAIL for 2-13)"
      q -U postgres -d t -v ON_ERROR_STOP=1 -f "$here/fixtures/03_sabotage.sql" 2>&1
      q -U postgres -d t -v ON_ERROR_STOP=1 -A -t -F '|' -f "$here/live_checks.sql" 2>&1 | cut -d'|' -f1,2
    fi
  done
  for role in owner_nobypass cli_login_stub; do
    echo "################ guard: migration as $role (expect one ERROR from the guard, and no intake schema) ################"
    q -U supabase_admin -d postgres -c "drop database if exists g" -c "create database g owner $role" >/dev/null
    q -U "$role" -d g -v ON_ERROR_STOP=1 -v VERBOSITY=terse -f "$migration" 2>&1 | grep -m1 ERROR || true
    q -U supabase_admin -d g -tAc "select 'intake schemas: ' || count(*) from pg_namespace where nspname = 'intake'"
  done
}

run | sed -e "s|$migdir/||g" -e "s|$here/||g" > "$T/out.txt"
if [ "${UPDATE_EXPECTED:-}" = 1 ]; then cp "$T/out.txt" "$here/offline-expected.txt"; echo "offline-expected.txt rewritten"; exit 0; fi
if diff -u "$here/offline-expected.txt" "$T/out.txt"; then
  echo "PASS: output identical to offline-expected.txt ($(grep -c 'ERROR:  enquiry rejected' "$T/out.txt") rejections, $(grep -c 'ERROR:  permission denied' "$T/out.txt") permission denials, $(grep -c 'ERROR:  contact_intake' "$T/out.txt") guard refusals)"
else
  echo "FAIL: output differs from offline-expected.txt"; exit 1
fi
