begin;

-- Team members can only grant access at or below their own team role.
create or replace function public.docs_can_grant_team_role(target_team uuid, target_role text)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select coalesce(
    public.docs_manages_team(target_team)
    or exists (
      select 1
      from public.docs_team_members tm
      join public.docs_members m on lower(m.email)=tm.email
      where tm.team_id=target_team
        and m.id=auth.uid()
        and m.active
        and m.password_setup_complete
        and (
          tm.role='publisher'
          or (tm.role='viewer' and target_role='viewer')
        )
    ),
    false
  );
$$;

revoke all on function public.docs_can_grant_team_role(uuid,text) from public;
grant execute on function public.docs_can_grant_team_role(uuid,text) to authenticated,service_role;

drop policy team_members_manage on public.docs_team_members;
create policy team_members_insert on public.docs_team_members
  for insert to authenticated
  with check (public.docs_can_grant_team_role(team_id,role) and added_by=auth.uid());
create policy team_members_update on public.docs_team_members
  for update to authenticated
  using (public.docs_can_grant_team_role(team_id,role))
  with check (public.docs_can_grant_team_role(team_id,role));
create policy team_members_delete on public.docs_team_members
  for delete to authenticated
  using (public.docs_can_grant_team_role(team_id,role));

commit;
