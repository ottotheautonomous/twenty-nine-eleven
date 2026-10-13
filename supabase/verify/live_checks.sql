-- Read-only checks for the LIVE project after the migration: one query, one row per check, result PASS / FAIL / INFO.
-- Nothing here writes or shows enquiry contents (check 17 shows counts only).
-- Run: Dashboard -> SQL Editor (runs as postgres) -> paste -> Run;
--  or, only on the optional CLI path with a short-lived scoped token (runbook appendix A): npx supabase@2.120.0 db query --linked -f supabase/verify/live_checks.sql
-- Acceptance: no FAIL row. The INFO rows are read by a person (docs/CONTACT-SUPABASE.md section 7).
with
api_roles(r) as (values ('anon'), ('authenticated'), ('service_role'), ('authenticator')),
fns(oid) as (values ('public.submit_enquiry(uuid,text,text,text,text)'::regprocedure::oid), ('public.contact_keepalive()'::regprocedure::oid)),
intake_rels as (
  select c.oid, c.relname, c.relkind, c.relowner, c.relacl, c.relrowsecurity, c.relforcerowsecurity
  from pg_class c where c.relnamespace = 'intake'::regnamespace and c.relkind in ('r', 'p', 'S', 'v', 'm', 'f')
),
checks(n, check_name, expected, actual, result) as (
  select 1, 'postgres and service_role have BYPASSRLS', 'postgres=t, service_role=t',
    (select string_agg(rolname || '=' || rolbypassrls, ', ' order by rolname) from pg_roles where rolname in ('postgres', 'service_role')),
    case when (select count(*) filter (where rolbypassrls) from pg_roles where rolname in ('postgres', 'service_role')) = 2 then 'PASS' else 'FAIL' end
  union all
  select 2, 'intake schema ACL: postgres only', 'postgres',
    (select string_agg(distinct coalesce(nullif(a.grantee, 0)::regrole::text, 'PUBLIC') || ':' || a.privilege_type, ', ')
       from pg_namespace s, aclexplode(coalesce(s.nspacl, acldefault('n', s.nspowner))) a where s.nspname = 'intake'),
    case when (select bool_and(a.grantee = 'postgres'::regrole) from pg_namespace s, aclexplode(coalesce(s.nspacl, acldefault('n', s.nspowner))) a
               where s.nspname = 'intake') then 'PASS' else 'FAIL' end
  union all
  select 3, 'intake tables, sequences, views: every ACL entry is postgres; no column grants', 'no other grantee',
    coalesce((select string_agg(distinct r.relname || ' -> ' || coalesce(nullif(a.grantee, 0)::regrole::text, 'PUBLIC') || ':' || a.privilege_type, ', ')
              from intake_rels r, aclexplode(coalesce(r.relacl, acldefault((case when r.relkind = 'S' then 's' else 'r' end)::"char", r.relowner))) a
              where a.grantee <> 'postgres'::regrole), 'no other grantee')
      || coalesce('; column grants: ' || (select string_agg(r.relname || '.' || att.attname, ', ') from intake_rels r join pg_attribute att
              on att.attrelid = r.oid where att.attacl is not null), ''),
    case when not exists (select 1 from intake_rels r, aclexplode(coalesce(r.relacl, acldefault((case when r.relkind = 'S' then 's' else 'r' end)::"char", r.relowner))) a
                          where a.grantee <> 'postgres'::regrole)
          and not exists (select 1 from intake_rels r join pg_attribute att on att.attrelid = r.oid where att.attacl is not null)
         then 'PASS' else 'FAIL' end
  union all
  select 4, 'API roles: no USAGE on intake, no table, column or sequence right', 'none',
    coalesce((select string_agg(x, ', ') from (
      select r || ':intake usage' as x from api_roles where has_schema_privilege(r, 'intake', 'usage')
      union all select a.r || ':' || t.relname || ' table right' from api_roles a, intake_rels t
        where t.relkind <> 'S' and has_table_privilege(a.r, t.oid, 'select,insert,update,delete,truncate,references,trigger')
      union all select a.r || ':' || t.relname || ' column right' from api_roles a, intake_rels t
        where t.relkind <> 'S' and has_any_column_privilege(a.r, t.oid, 'select,insert,update,references')
      union all select a.r || ':' || t.relname || ' sequence right' from api_roles a, intake_rels t
        where t.relkind = 'S' and has_sequence_privilege(a.r, t.oid, 'usage,select,update')) v), 'none'),
    case when exists (select 1 from api_roles where has_schema_privilege(r, 'intake', 'usage'))
           or exists (select 1 from api_roles a, intake_rels t where t.relkind <> 'S'
                      and (has_table_privilege(a.r, t.oid, 'select,insert,update,delete,truncate,references,trigger')
                           or has_any_column_privilege(a.r, t.oid, 'select,insert,update,references')))
           or exists (select 1 from api_roles a, intake_rels t where t.relkind = 'S' and has_sequence_privilege(a.r, t.oid, 'usage,select,update'))
         then 'FAIL' else 'PASS' end
  union all
  select 5, 'EXECUTE on both functions: service_role only', 'service_role',
    coalesce((select string_agg(distinct a.r, ', ') from api_roles a, fns f where has_function_privilege(a.r, f.oid, 'execute')), 'nobody'),
    case when (select bool_and(has_function_privilege(a.r, f.oid, 'execute') = (a.r = 'service_role')) from api_roles a, fns f)
         then 'PASS' else 'FAIL' end
  union all
  select 6, 'function ACLs: postgres and service_role only (no PUBLIC)', 'postgres, service_role (each function)',
    (select string_agg(p.proname || ' -> ' || coalesce(nullif(a.grantee, 0)::regrole::text, 'PUBLIC'), ', ' order by p.proname, a.grantee)
       from pg_proc p join fns f on f.oid = p.oid, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a),
    case when (select bool_and(a.grantee in ('postgres'::regrole, 'service_role'::regrole)) and count(*) = 4
               from pg_proc p join fns f on f.oid = p.oid, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a)
         then 'PASS' else 'FAIL' end
  union all
  select 7, 'functions: owned by postgres, SECURITY DEFINER, search_path pinned to ''''', 'postgres, definer, {search_path=""}',
    (select string_agg(p.proname || ': ' || p.proowner::regrole || ', ' || case when p.prosecdef then 'definer' else 'invoker' end
                       || ', ' || coalesce(p.proconfig::text, 'no config'), '; ' order by p.proname) from pg_proc p join fns f on f.oid = p.oid),
    case when (select bool_and(p.proowner = 'postgres'::regrole and p.prosecdef and p.proconfig = array['search_path=""']) from pg_proc p join fns f on f.oid = p.oid)
         then 'PASS' else 'FAIL' end
  union all
  select 8, 'intake tables: RLS enabled and forced, owned by postgres', 'contact_submissions, keepalive: on, forced, postgres',
    (select string_agg(relname || ': ' || case when relrowsecurity then 'on' else 'OFF' end || ', '
                       || case when relforcerowsecurity then 'forced' else 'NOT FORCED' end || ', ' || relowner::regrole, '; ' order by relname)
       from intake_rels where relkind in ('r', 'p')),
    case when (select bool_and(relrowsecurity and relforcerowsecurity and relowner = 'postgres'::regrole) and count(*) >= 2
               from intake_rels where relkind in ('r', 'p')) then 'PASS' else 'FAIL' end
  union all
  select 9, 'no RLS policies in intake (default deny)', '0',
    (select count(*)::text from pg_policies where schemaname = 'intake'),
    case when (select count(*) from pg_policies where schemaname = 'intake') = 0 then 'PASS' else 'FAIL' end
  union all
  select 10, 'every table in public / graphql_public has RLS enabled', 'none without RLS',
    coalesce((select string_agg(n.nspname || '.' || c.relname, ', ') from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname in ('public', 'graphql_public') and c.relkind in ('r', 'p') and not c.relrowsecurity), 'none without RLS'),
    case when exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                      where n.nspname in ('public', 'graphql_public') and c.relkind in ('r', 'p') and not c.relrowsecurity) then 'FAIL' else 'PASS' end
  union all
  select 11, 'no SECURITY DEFINER function in an exposed schema is executable by anon or authenticated', 'none',
    coalesce((select string_agg(n.nspname || '.' || p.proname, ', ') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname in ('public', 'graphql_public') and p.prosecdef
                and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))), 'none'),
    case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname in ('public', 'graphql_public') and p.prosecdef
                        and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')))
         then 'FAIL' else 'PASS' end
  union all
  select 12, 'default privileges of postgres grant nothing to PUBLIC or the API roles (global, public, intake)', 'none',
    coalesce((select string_agg(coalesce(nullif(d.defaclnamespace, 0)::regnamespace::text, 'global') || '/' || d.defaclobjtype::text || ' -> '
                                || coalesce(nullif(a.grantee, 0)::regrole::text, 'PUBLIC'), ', ')
              from pg_default_acl d, aclexplode(d.defaclacl) a
              where d.defaclrole = 'postgres'::regrole
                and (d.defaclnamespace = 0 or d.defaclnamespace in ('public'::regnamespace, 'intake'::regnamespace))
                and (a.grantee = 0 or a.grantee in ('anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole))), 'none'),
    case when exists (select 1 from pg_default_acl d, aclexplode(d.defaclacl) a
                      where d.defaclrole = 'postgres'::regrole
                        and (d.defaclnamespace = 0 or d.defaclnamespace in ('public'::regnamespace, 'intake'::regnamespace))
                        and (a.grantee = 0 or a.grantee in ('anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole)))
              or not exists (select 1 from pg_default_acl d where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 0 and d.defaclobjtype = 'f')
         then 'FAIL' else 'PASS' end
  union all
  select 13, 'intake tables are in no publication (Realtime cannot stream them)', 'none',
    coalesce((select string_agg(pubname || ':' || tablename, ', ') from pg_publication_tables where schemaname = 'intake'), 'none'),
    case when exists (select 1 from pg_publication_tables where schemaname = 'intake') then 'FAIL' else 'PASS' end
  union all
  select 14, 'submit_enquiry refuses new enquiries beyond its daily cap (SQLSTATE PT429)', 'daily_cap between 1 and 1000 (300 as shipped), PT429',
    coalesce((select 'daily_cap=' || coalesce(substring(p.prosrc from 'daily_cap\s+constant\s+integer\s*:=\s*(\d+)'), 'none')
                     || case when p.prosrc ~ '''PT429''' then ', PT429' else ', no PT429' end
              from pg_proc p where p.oid = 'public.submit_enquiry(uuid,text,text,text,text)'::regprocedure), 'no function'),
    case when (select p.prosrc ~ '''PT429''' and p.prosrc ~ '>=\s*daily_cap'
                      and substring(p.prosrc from 'daily_cap\s+constant\s+integer\s*:=\s*(\d+)')::int between 1 and 1000
               from pg_proc p where p.oid = 'public.submit_enquiry(uuid,text,text,text,text)'::regprocedure)
         then 'PASS' else 'FAIL' end
  union all
  select 15, 'exposed schemas recorded on the authenticator role (the Dashboard setting is authoritative)', 'public, graphql_public; never intake',
    coalesce((select string_agg(s, '; ') from pg_db_role_setting rs, unnest(rs.setconfig) s
              where rs.setrole = 'authenticator'::regrole and s like 'pgrst.db_schemas=%'), 'not recorded on the role: read the Dashboard setting'),
    case when exists (select 1 from pg_db_role_setting rs, unnest(rs.setconfig) s
                      where rs.setrole = 'authenticator'::regrole and s like 'pgrst.db_schemas=%' and s ~ '(=|,)\s*"?intake"?\s*(,|$)')
         then 'FAIL' else 'INFO' end
  union all
  select 16, 'for the record: roles that bypass RLS or are superusers', 'postgres, service_role and platform-internal roles',
    (select string_agg(rolname || case when rolsuper then ' (superuser)' else '' end, ', ' order by rolname) from pg_roles where rolsuper or rolbypassrls),
    'INFO'
  union all
  select 17, 'counts only, no contents', 'enquiries = 1 after the smoke test; last_beat moves after each cron run',
    'enquiries=' || (select count(*) from intake.contact_submissions)
      || ', last_24h=' || (select count(*) from intake.contact_submissions where created_at > now() - interval '24 hours')
      || ', last_beat=' || coalesce((select beat_at::text from intake.keepalive), 'none'),
    'INFO'
)
select n, result, check_name, expected, actual from checks order by n;
