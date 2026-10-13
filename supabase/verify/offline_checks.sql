-- Offline checks for supabase/migrations/20261013120000_contact_intake.sql on a throwaway Postgres 16 with Supabase-like roles.
-- Run by offline-pg16.sh as postgres after the migration; its output is compared with offline-expected.txt.
\set ON_ERROR_STOP 0
\set VERBOSITY terse
\pset footer off

\echo '=== A. service_role: the Worker path ==='
set role service_role;
\echo '--- A1 submit twice with one request_id (expect ok, ok; one row later, the first version kept)'
select public.submit_enquiry('21f5d5dc-0896-4c55-9b85-fd756e532ea2', 'Jane Example', 'jane@example.com', 'I would love to discuss a new website.', 'www.twentynineeleven.net');
select public.submit_enquiry('21f5d5dc-0896-4c55-9b85-fd756e532ea2', 'Jane Changed', 'other@example.com', 'An edited resubmit with the same id.', null);
\echo '--- A2 Worker-valid edge inputs accepted (expect 7 x ok): ZWJ emoji name, 60 astral emoji = 120 UTF-16 units, IDN emails,'
\echo '    5 astral emoji as the whole message, 5000 x é, apostrophe and comma names, ZWNJ name, CRLF + tab message'
select public.submit_enquiry('31f5d5dc-0896-4c55-9b85-fd756e532ea2', E'Sam 👨\u200D👩\u200D👧', 'li@example.xn--fiqs8s', '😀😀😀😀😀', 'ottotheautonomous.github.io');
select public.submit_enquiry('32f5d5dc-0896-4c55-9b85-fd756e532ea2', repeat('😀', 60), 'ivan@xn--e1afmkfd.xn--p1ai', repeat('é', 5000), null);
select public.submit_enquiry('33f5d5dc-0896-4c55-9b85-fd756e532ea2', 'Siobhán O''Brien-Ng', 'a+tag@mail.example.co.uk', E'line one\nline two\ttabbed', null);
select public.submit_enquiry('34f5d5dc-0896-4c55-9b85-fd756e532ea2', E'علی\u200Cرضا', 'x@example.com', 'ten chars.', null);
select public.submit_enquiry('35f5d5dc-0896-4c55-9b85-fd756e532ea2', 'Smith, John', 'john@example.com', E'Two lines\r\nand an emoji 🙂', 'twentynineeleven.net');
select public.submit_enquiry('36f5d5dc-0896-4c55-9b85-fd756e532ea2', repeat('x', 120), 'y@example.com', repeat('m', 5000), 'michaeljameshofer.github.io');
select public.submit_enquiry('37f5d5dc-0896-4c55-9b85-fd756e532ea2', E'ශ්\u200Dරී', 'z@example.com', '<script>alert(1)</script> — café', null);
\echo '--- A3 invalid inputs rejected with one constant message and no echo of the input (expect 11 x "enquiry rejected")'
\set VERBOSITY default
select public.submit_enquiry('41f5d5dc-0896-4c55-9b85-fd756e532ea2', 'Bank Support" <security@bank.example>', 'e@example.com', 'long enough message', null);
\set VERBOSITY terse
select public.submit_enquiry('42f5d5dc-0896-4c55-9b85-fd756e532ea2', E'Jane\u202Eevil', 'e@example.com', 'long enough message', null);
select public.submit_enquiry('43f5d5dc-0896-4c55-9b85-fd756e532ea2', 'Eve', 'a,b@evil.example', 'long enough message', null);
select public.submit_enquiry('44f5d5dc-0896-4c55-9b85-fd756e532ea2', 'Eve', 'e@example.com', E'has a vertical tab \x0B here', null);
select public.submit_enquiry('45f5d5dc-0896-4c55-9b85-fd756e532ea2', 'Eve', 'e@example.com', '', null);
select public.submit_enquiry('46f5d5dc-0896-4c55-9b85-fd756e532ea2', 'Eve', 'e@example.com', 'long enough message', 'Evil.Example');
select public.submit_enquiry('47f5d5dc-0896-4c55-9b85-fd756e532ea2', null, 'e@example.com', 'long enough message', null);
select public.submit_enquiry('48f5d5dc-0896-4c55-9b85-fd756e532ea2', E'Jane\U000E0041\U000E0042', 'e@example.com', 'long enough message', null);
select public.submit_enquiry('49f5d5dc-0896-4c55-9b85-fd756e532ea2', repeat('x', 121), 'e@example.com', 'long enough message', null);
select public.submit_enquiry('4af5d5dc-0896-4c55-9b85-fd756e532ea2', 'Eve', 'e@example.com', repeat('m', 5001), null);
select public.submit_enquiry('4bf5d5dc-0896-4c55-9b85-fd756e532ea2', 'Eve', 'e@example.com', 'long enough message', '127.0.0.1:5173');
\echo '--- A4 service_role cannot read, write, count, drain or alter intake directly (expect 42501 x7, then "must be owner" x1)'
select count(*) from intake.contact_submissions;
insert into intake.contact_submissions (request_id, name, email, message) values (gen_random_uuid(), 'A', 'a@b.co', 'long enough message');
update intake.contact_submissions set name = 'x';
delete from intake.contact_submissions;
select nextval('intake.contact_submissions_id_seq');
select * from intake.keepalive;
truncate intake.contact_submissions;
drop function public.submit_enquiry(uuid, text, text, text, text);
\echo '--- A5 keep-alive works (expect ok)'
select public.contact_keepalive();
reset role;

\echo '=== B. anon / authenticated / authenticator (PUBLIC proxy): nothing (expect 42501 x9) ==='
set role anon;
select public.submit_enquiry(gen_random_uuid(), 'Eve', 'eve@example.com', 'spam spam spam spam', null);
select public.contact_keepalive();
select * from intake.contact_submissions;
reset role;
set role authenticated;
select public.submit_enquiry(gen_random_uuid(), 'Eve', 'eve@example.com', 'spam spam spam spam', null);
select public.contact_keepalive();
select * from intake.contact_submissions;
reset role;
set role authenticator;
select public.submit_enquiry(gen_random_uuid(), 'Eve', 'eve@example.com', 'spam spam spam spam', null);
select public.contact_keepalive();
select * from intake.contact_submissions;
reset role;

\echo '=== C. owner view (postgres, BYPASSRLS, not superuser): 8 rows, each stored once; the first version of #1 kept ==='
select id, request_id, left(name, 20) as name, email, char_length(message) as message_chars, source, created_at is not null as stamped
from intake.contact_submissions order by id;
select beat_at > now() - interval '1 minute' as beat_recent from intake.keepalive;

\echo '=== D. privilege matrix (expect every column f, except submit_exec and keepalive_exec = t for service_role) ==='
select r as role,
  has_schema_privilege(r, 'intake', 'usage')                                               as intake_usage,
  has_table_privilege(r, 'intake.contact_submissions', 'select')                          as tbl_select,
  has_table_privilege(r, 'intake.contact_submissions', 'insert')                          as tbl_insert,
  has_table_privilege(r, 'intake.contact_submissions', 'update')                          as tbl_update,
  has_table_privilege(r, 'intake.contact_submissions', 'delete')                          as tbl_delete,
  has_any_column_privilege(r, 'intake.contact_submissions', 'insert')                     as col_insert,
  has_sequence_privilege(r, 'intake.contact_submissions_id_seq', 'usage')                 as seq_usage,
  has_table_privilege(r, 'intake.keepalive', 'select')                                    as ka_select,
  has_function_privilege(r, 'public.submit_enquiry(uuid,text,text,text,text)', 'execute') as submit_exec,
  has_function_privilege(r, 'public.contact_keepalive()', 'execute')                      as keepalive_exec
from unnest(array['anon', 'authenticated', 'service_role', 'authenticator']) r;
\echo '--- explicit ACLs on the two functions (expect postgres + service_role only, no PUBLIC)'
select p.proname, coalesce(nullif(a.grantee, 0)::regrole::text, 'PUBLIC') as grantee, a.privilege_type
from pg_proc p, aclexplode(p.proacl) a
where p.oid in ('public.submit_enquiry(uuid,text,text,text,text)'::regprocedure, 'public.contact_keepalive()'::regprocedure)
order by 1, 2;
\echo '--- function owner, SECURITY DEFINER and pinned search_path (expect postgres, t, {search_path=""} for both)'
select proname, proowner::regrole as owner, prosecdef, proconfig from pg_proc
where oid in ('public.submit_enquiry(uuid,text,text,text,text)'::regprocedure, 'public.contact_keepalive()'::regprocedure) order by 1;
\echo '--- RLS flags and owners (expect t t postgres on both intake tables; 0 policies)'
select c.relname, c.relrowsecurity, c.relforcerowsecurity, c.relowner::regrole as owner
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'intake' and c.relkind = 'r' order by 1;
select count(*) as intake_policies from pg_policies where schemaname = 'intake';
\echo '--- tables in exposed schemas without RLS (expect no rows)'
select schemaname, tablename from pg_tables where schemaname in ('public', 'graphql_public') and not rowsecurity;

\echo '=== E. future objects: a later function in public and a later table, sequence and function in intake get no API access (expect all f) ==='
create function public.later_fn() returns int language sql as 'select 1';
create table intake.later_tbl (x int generated always as identity);
create function intake.later_fn() returns int language sql as 'select 1';
select has_function_privilege('anon', 'public.later_fn()', 'execute')                   as anon_exec_public_fn,
       has_function_privilege('authenticator', 'public.later_fn()', 'execute')          as public_exec_public_fn,
       has_function_privilege('service_role', 'public.later_fn()', 'execute')           as service_exec_public_fn,
       has_table_privilege('service_role', 'intake.later_tbl', 'select')                as service_select_intake_tbl,
       has_sequence_privilege('anon', 'intake.later_tbl_x_seq', 'usage')                as anon_intake_seq,
       has_function_privilege('authenticator', 'intake.later_fn()', 'execute')          as public_exec_intake_fn;
