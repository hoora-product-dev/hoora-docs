begin;

create or replace function public.docs_can_create(team uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce(public.docs_role_for(auth.uid())='admin'
    or (team is null and public.docs_role_for(auth.uid())='publisher')
    or (team is not null and public.docs_team_role(team,auth.uid()) in ('manager','publisher','contributor')),
  false)
$$;

drop policy if exists projects_read on public.docs_projects;
create policy projects_read on public.docs_projects for select to authenticated
  using (deleted_at is null and (public.docs_role()='admin' or public.docs_role() is not null));
drop policy if exists releases_read on public.docs_releases;
create policy releases_read on public.docs_releases for select to authenticated
  using (exists(select 1 from public.docs_pages p where p.id=docs_releases.id and p.archived_at is null and p.deleted_at is null));

drop policy if exists entries_read on public.docs_entries;
create policy entries_read on public.docs_entries for select to authenticated
  using (public.docs_can_read_published(release_id) or public.docs_can_write_page(release_id));

commit;
