begin;
drop policy teams_read on public.docs_teams;
create policy teams_read on public.docs_teams for select to authenticated using(public.docs_role()='admin' or manager_id=auth.uid() or exists(select 1 from public.docs_team_members m join public.docs_members u on u.email=m.email where m.team_id=docs_teams.id and u.id=auth.uid() and u.active and u.password_setup_complete));
commit;
