-- Run inside each fresh test database as the cluster superuser: the public-schema layout of a Supabase project.
grant all on schema public to postgres;
grant usage on schema public to anon, authenticated, service_role;
alter schema public owner to postgres;
