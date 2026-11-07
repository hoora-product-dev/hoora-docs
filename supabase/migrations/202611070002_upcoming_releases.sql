begin;
create table public.docs_upcoming_releases (
 id uuid primary key default gen_random_uuid(),
 slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{0,119}$'),
 title text not null check (length(title) between 1 and 100),
 version text not null check (length(version) between 1 and 50),
 release_date date,
 filter_id text not null check (filter_id ~ '^[1-9][0-9]{0,15}$'),
 allowed_emails text[] not null default '{}',
 enabled boolean not null default false,
 created_by uuid references public.docs_members(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check (not enabled or release_date is not null),
 check (cardinality(allowed_emails) <= 200)
);
alter table public.docs_upcoming_releases enable row level security;
revoke all on public.docs_upcoming_releases from public,anon,authenticated;
grant select,insert,update,delete on public.docs_upcoming_releases to service_role;

create table public.docs_upcoming_rate_limits (
 actor uuid primary key references public.docs_members(id) on delete cascade,
 window_start timestamptz not null default now(),
 requests integer not null default 1
);
alter table public.docs_upcoming_rate_limits enable row level security;
revoke all on public.docs_upcoming_rate_limits from public,anon,authenticated;
grant all on public.docs_upcoming_rate_limits to service_role;
create function public.docs_upcoming_rate_limit(actor uuid) returns void
language plpgsql security invoker set search_path = public as $$
declare count_now integer;
begin
 insert into public.docs_upcoming_rate_limits as limits(actor) values (actor)
 on conflict on constraint docs_upcoming_rate_limits_pkey do update set
 requests = case when limits.window_start < now()-interval '1 minute' then 1 else limits.requests+1 end,
 window_start = case when limits.window_start < now()-interval '1 minute' then now() else limits.window_start end
 returning requests into count_now;
 if count_now > 60 then raise exception 'Upcoming release rate limit exceeded'; end if;
end;
$$;
revoke all on function public.docs_upcoming_rate_limit(uuid) from public,anon,authenticated;
grant execute on function public.docs_upcoming_rate_limit(uuid) to service_role;
commit;
