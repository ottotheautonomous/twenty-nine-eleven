-- Negative control for live_checks.sql, run as postgres after offline_checks.sql: every line below breaks one rule, and
-- live_checks.sql must report FAIL for checks 2-14. Never run this anywhere but the throwaway offline cluster.
grant usage on schema intake to anon;
grant select on intake.contact_submissions to anon;
grant execute on function public.contact_keepalive() to authenticated;
alter table intake.keepalive no force row level security;
create policy leak on intake.contact_submissions for select to anon using (true);
create table public.leaky (x int);
alter default privileges for role postgres in schema public grant select on tables to anon;
create or replace function public.submit_enquiry(p_request_id uuid, p_name text, p_email text, p_message text, p_source text default null)
  returns void language sql security definer set search_path = '' as
  'insert into intake.contact_submissions (request_id, name, email, message, source) values (p_request_id, p_name, p_email, p_message, p_source)';
alter function public.submit_enquiry(uuid, text, text, text, text) security invoker;
create publication leak for table intake.contact_submissions;
