begin;
create table public.docs_system_config(key text primary key,value jsonb not null);
alter table public.docs_system_config enable row level security;
revoke all on public.docs_system_config from public,anon,authenticated;
grant all on public.docs_system_config to service_role;
commit;
