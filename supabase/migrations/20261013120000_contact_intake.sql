-- Twenty Nine Eleven: private intake for contact-form enquiries.
-- Run once, as the project's `postgres` role: Dashboard -> SQL Editor (runs as postgres), or `supabase db push --linked`
-- (its temporary login role switches to postgres). The guard in step 0 refuses any other role. Runbook: docs/CONTACT-SUPABASE.md.
--
-- Model:
--   * intake.*                    private schema, never listed under Data API "Exposed schemas"; RLS ENABLED and FORCED with no
--                                 policies; no grant for PUBLIC, anon, authenticated or service_role, now or by default later.
--   * public.submit_enquiry()     the only write path: SECURITY DEFINER, search_path = '', re-validates every field, stores once
--                                 per request_id, returns void. EXECUTE only for service_role (the role an sb_secret_ key maps to).
--   * public.contact_keepalive()  a harmless heartbeat on a one-row table, same grant rule.
--   Nothing in the API can read, change or delete a stored enquiry. The owner reads rows in the Dashboard (role postgres).

begin;

-- 0. Guard. The intake tables are FORCE ROW LEVEL SECURITY with no policies, so only a role with BYPASSRLS (or a superuser)
--    can touch their rows. PostgreSQL: "Superusers and roles with the BYPASSRLS attribute always bypass the row security
--    system"; Supabase: "On Supabase the owner is postgres, which has bypassrls". The objects must also belong to postgres,
--    because the Dashboard reads as postgres and the default-privilege rules below are written for postgres. Run by anyone else,
--    this would install a letterbox nobody can open, or one owned by a temporary role. Fail loudly instead.
do $guard$
begin
  if current_user <> 'postgres'
     or not exists (select 1 from pg_catalog.pg_roles where rolname = current_user and (rolbypassrls or rolsuper)) then
    raise exception 'contact_intake: run this migration as postgres with BYPASSRLS (current role: %). The intake tables are '
                    'FORCE RLS with no policies, so any other owner could never store or read an enquiry.', current_user;
  end if;
end
$guard$;

-- 1. Private schema. Never add "intake" to Integrations -> Data API -> Settings -> Exposed schemas.
create schema intake;
revoke all on schema intake from public, anon, authenticated, service_role;
comment on schema intake is
  'Private. Contact-form enquiries. Not exposed to the Data API; written only by public.submit_enquiry(); read only in the Dashboard.';

-- Anything postgres creates in intake later is granted to nobody. (Tables and sequences have no built-in PUBLIC default;
-- functions do, and that default can only be removed project-wide: see step 5b.)
alter default privileges for role postgres in schema intake revoke all on tables    from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema intake revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema intake revoke all on routines  from public, anon, authenticated, service_role;

-- 2. The submissions table: exactly what the form sends, the browser's request id, a timestamp and the sending page's host.
--    No IP address, no user agent, no headers. Lengths mirror the Worker, which counts UTF-16 units; char_length counts code
--    points, so every Worker-accepted value fits. The message lower bound is 1, not 10: five astral emoji are 10 units but
--    5 code points.
create table intake.contact_submissions (
  id          bigint      generated always as identity primary key,
  request_id  uuid        not null unique,
  created_at  timestamptz not null default now(),
  name        text        not null check (char_length(name)    between 1 and 120),
  email       text        not null check (char_length(email)   between 3 and 254 and position('@' in email) > 1),
  message     text        not null check (char_length(message) between 1 and 5000),
  source      text                 check (source is null or source ~ '^[a-z0-9.-]{1,100}$')
);
comment on table  intake.contact_submissions is
  'Contact enquiries from the website form, written by the Cloudflare Worker through public.submit_enquiry(). Personal data: name, email, message.';
comment on column intake.contact_submissions.id         is 'Owner-facing running number (refer to an enquiry as #id).';
comment on column intake.contact_submissions.request_id is 'crypto.randomUUID() chosen by the browser per enquiry; a retry with the same id is ignored, so each enquiry is stored once.';
comment on column intake.contact_submissions.created_at is 'Server time the enquiry was stored.';
comment on column intake.contact_submissions.source     is 'Host of the allow-listed page the form was on (one of a few known hosts). Never an IP address or user agent.';
create index contact_submissions_created_at_idx on intake.contact_submissions (created_at desc);

alter table intake.contact_submissions enable row level security;
alter table intake.contact_submissions force  row level security;    -- even the owner is subject to RLS unless it has BYPASSRLS
revoke all on table intake.contact_submissions from public, anon, authenticated, service_role;

-- 3. Keep-alive target: one constant row, no personal data. The Worker's Cron Trigger rewrites beat_at so the Free project sees
--    database activity every day and is not paused.
create table intake.keepalive (
  id      smallint    primary key default 1 check (id = 1),
  beat_at timestamptz not null default now()
);
comment on table intake.keepalive is 'One row. public.contact_keepalive() stamps beat_at; nothing else lives here.';
insert into intake.keepalive (id) values (1);
alter table intake.keepalive enable row level security;
alter table intake.keepalive force  row level security;
revoke all on table intake.keepalive from public, anon, authenticated, service_role;

-- The identity sequence and anything else in the schema.
revoke all on all sequences in schema intake from public, anon, authenticated, service_role;
revoke all on all tables    in schema intake from public, anon, authenticated, service_role;

-- 4. The single write path. SECURITY DEFINER, so the caller (service_role) holds no privilege on intake at all; search_path ''
--    and schema-qualified names, so nothing on the caller's path can be substituted; every field re-validated (the Worker has
--    already validated it: this is defence in depth, and never stricter than the Worker, so a Worker-valid enquiry is never
--    refused here); a constant error that never echoes the input; returns void (PostgREST answers 204 with no body).
--    ON CONFLICT DO NOTHING: a retried request_id is a no-op, and nothing reachable from the API can read or change a stored row.
create function public.submit_enquiry(
  p_request_id uuid,
  p_name       text,
  p_email      text,
  p_message    text,
  p_source     text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if p_request_id is null or p_name is null or p_email is null or p_message is null
     -- name: 1-120 characters; no C0/C1 controls or DEL; no quote, angle brackets or backslash; no line/paragraph separators;
     -- no soft hyphen, bidi, zero-width, word-joiner, BOM, interlinear or tag characters. (All of these are Unicode Cc/Cf/Zl/Zp,
     -- which the Worker already refuses; the joiners U+200C/U+200D stay allowed, as in the Worker.)
     or char_length(p_name) not between 1 and 120
     or p_name ~ '[\x01-\x1F\x7F-\x9F\u00AD\u061C\u180E\u200B\u200E\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\uFFF9-\uFFFB\U000E0001\U000E0020-\U000E007F"<>\\]'
     -- email: the Worker's addr-spec grammar (plain local part, dotted hostname labels, alphabetic or punycode TLD)
     or char_length(p_email) not between 3 and 254
     or p_email !~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]{1,64}@([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+([A-Za-z]{2,63}|xn--[A-Za-z0-9-]{1,59})$'
     -- message: 1-5000 code points; tab, LF and CR allowed, other C0 controls and DEL refused
     or char_length(p_message) not between 1 and 5000
     or p_message ~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]'
     -- source: a lower-case hostname, or nothing
     or (p_source is not null and p_source !~ '^[a-z0-9.-]{1,100}$')
  then
    raise exception 'enquiry rejected' using errcode = 'check_violation';   -- 23514 -> HTTP 400 at PostgREST; the Worker answers 503
  end if;

  insert into intake.contact_submissions (request_id, name, email, message, source)
  values (p_request_id, p_name, p_email, p_message, p_source)
  on conflict (request_id) do nothing;
end
$fn$;
comment on function public.submit_enquiry(uuid, text, text, text, text) is
  'Store one contact enquiry (write-once per request_id). Callable only by service_role, i.e. the contact Worker''s secret key.';

-- Postgres grants EXECUTE on a new function to PUBLIC. Remove it, then allow only the Worker's role.
revoke all on function public.submit_enquiry(uuid, text, text, text, text) from public, anon, authenticated;
grant  execute on function public.submit_enquiry(uuid, text, text, text, text) to service_role;

-- Keep-alive: touches one non-personal row, returns nothing.
create function public.contact_keepalive() returns void
language sql
security definer
set search_path = ''
as $fn$
  update intake.keepalive set beat_at = pg_catalog.now() where id = 1;
$fn$;
comment on function public.contact_keepalive() is 'Heartbeat for the Free-plan pause check. Callable only by service_role.';
revoke all on function public.contact_keepalive() from public, anon, authenticated;
grant  execute on function public.contact_keepalive() to service_role;

-- 5. Project-wide hygiene.
--    (a) Projects created before 2026-05-30 auto-granted anon/authenticated/service_role on every new public object; new projects
--        do not. These are no-ops on a new project and the fix on an old one.
alter default privileges for role postgres in schema public revoke all on tables    from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on routines  from anon, authenticated, service_role;
--    (b) PUBLIC's built-in EXECUTE on new functions is a global default that a per-schema REVOKE cannot remove (PostgreSQL: "you
--        cannot revoke privileges per-schema if they are granted globally"). Remove it globally: from now on a function postgres
--        creates anywhere in this project is executable only by roles it is granted to. This project exists for the contact form
--        alone, so no other function needs PUBLIC EXECUTE.
alter default privileges for role postgres revoke execute on routines from public;

commit;

-- PostgREST reloads its schema cache, so the two functions appear as RPC endpoints (and nothing else does).
notify pgrst, 'reload schema';
