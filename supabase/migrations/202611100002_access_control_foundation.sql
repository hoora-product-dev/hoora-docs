begin;

alter table public.docs_team_permissions
  drop constraint if exists docs_team_permissions_collection_key_check;
alter table public.docs_team_permissions
  add constraint docs_team_permissions_collection_key_check
  check (collection_key in ('release','upcoming','sop','documentation'));

create or replace function public.docs_can_upcoming(member uuid default auth.uid())
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(public.docs_role_for(member)='admin' or exists (
    select 1 from public.docs_teams t
    where public.docs_team_role(t.id,member) in ('manager','publisher','contributor','viewer')
      and exists (select 1 from public.docs_team_permissions p
        where p.team_id=t.id and p.scope_type='collection'
          and p.collection_key='upcoming' and p.capability in ('read','edit','publish','manage')
          and (p.expires_at is null or p.expires_at>now()))
  ),false)
$$;

create or replace function public.docs_can_manage_upcoming(member uuid default auth.uid())
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(public.docs_role_for(member)='admin' or exists (
    select 1 from public.docs_teams t
    where public.docs_team_role(t.id,member) in ('manager','publisher')
      and exists (select 1 from public.docs_team_permissions p
        where p.team_id=t.id and p.scope_type='collection'
          and p.collection_key='upcoming' and p.capability in ('edit','publish','manage')
          and (p.expires_at is null or p.expires_at>now()))
  ),false)
$$;

revoke all on function public.docs_can_upcoming(uuid),public.docs_can_manage_upcoming(uuid) from public;
grant execute on function public.docs_can_upcoming(uuid),public.docs_can_manage_upcoming(uuid) to authenticated,service_role;

commit;
