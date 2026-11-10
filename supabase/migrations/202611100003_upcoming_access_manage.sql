begin;

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

commit;
