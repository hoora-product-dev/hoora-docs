begin;

-- Team members may grant only an equal-or-lower team role. This intentionally
-- allows a viewer to add another viewer while preventing privilege escalation.
create or replace function public.docs_can_grant_team_role(target_team uuid, target_role text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare actor_role text;
declare actor_rank integer;
declare target_rank integer;
begin
  actor_role := public.docs_team_role(target_team);
  if actor_role = 'admin' then return target_role in ('viewer','contributor','publisher','manager'); end if;
  actor_rank := case actor_role when 'viewer' then 1 when 'contributor' then 2 when 'publisher' then 3 when 'manager' then 4 else 0 end;
  target_rank := case target_role when 'viewer' then 1 when 'contributor' then 2 when 'publisher' then 3 when 'manager' then 4 else 99 end;
  return actor_rank > 0 and target_rank <= actor_rank and target_role <> 'manager';
end; $$;

drop policy if exists team_members_manage on public.docs_team_members;
create policy team_members_manage on public.docs_team_members for all to authenticated
  using (public.docs_can_grant_team_role(team_id, role))
  with check (public.docs_can_grant_team_role(team_id, role) and added_by=auth.uid());

revoke all on function public.docs_can_grant_team_role(uuid,text) from public;
grant execute on function public.docs_can_grant_team_role(uuid,text) to authenticated,service_role;

commit;
