-- Local stand-in for a Supabase project's role layout. Run as the throwaway cluster's superuser, who plays supabase_admin.
-- postgres: NOT a superuser, but BYPASSRLS (as on Supabase: "On Supabase the owner is postgres, which has bypassrls").
create role postgres nosuperuser createdb createrole login bypassrls;
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role authenticator login noinherit;
grant anon, authenticated, service_role to authenticator;
-- As on Supabase, postgres is a member of the API roles, so the SQL Editor can impersonate them (set role anon ...).
grant anon, authenticated, service_role, authenticator to postgres;
-- Stand-ins that prove the migration's guard: one without BYPASSRLS, and one with BYPASSRLS that is not postgres
-- (like a temporary CLI login role that never switched to postgres).
create role owner_nobypass nosuperuser login;
create role cli_login_stub nosuperuser login bypassrls;
