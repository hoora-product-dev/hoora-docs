begin;

-- Organization-only access applies to the containers that can otherwise
-- make a page discoverable. Do not allow a public project or folder to be
-- created after the initial visibility migration.
update public.docs_projects set visibility='private' where visibility='public';
update public.docs_folders set visibility='private' where visibility='public';

create or replace function public.docs_guard_container_access()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.visibility='public' then
    raise exception 'Public access is disabled. Hoora Microsoft sign-in is required.';
  end if;
  return new;
end;
$$;

drop trigger if exists docs_projects_access_guard on public.docs_projects;
create trigger docs_projects_access_guard
before insert or update of visibility on public.docs_projects
for each row execute function public.docs_guard_container_access();

drop trigger if exists docs_folders_access_guard on public.docs_folders;
create trigger docs_folders_access_guard
before insert or update of visibility on public.docs_folders
for each row execute function public.docs_guard_container_access();

-- Releases inherit the application's access in the legacy function. Keep the
-- function stable for existing clients, but always create organization-only
-- release drafts even when an old project row still contains public metadata.
create or replace function public.docs_create_release(project uuid,release_version text,description text default '')
returns uuid language plpgsql security definer set search_path='' as $$
declare new_id uuid:=gen_random_uuid(); app public.docs_projects; clean_version text; clean_slug text;
begin
  if coalesce(public.docs_role(),'') not in ('admin','publisher') then
    raise exception 'Company publisher access required to create application releases';
  end if;
  clean_version:=regexp_replace(btrim(release_version),'^[vV](?=[0-9])','');
  if clean_version !~ '^[0-9]+(\.[0-9]+){1,3}([.-][a-zA-Z0-9.-]+)?$' then
    raise exception 'Use a version such as 5.11.0 or 5.11.0-beta.1';
  end if;
  select * into app from public.docs_projects where id=project;
  if app.id is null then raise exception 'Application not found'; end if;
  clean_slug:=app.slug||'-v'||public.docs_slug(clean_version);
  insert into public.docs_pages(id,title,slug,kind,version,summary,visibility)
    values(new_id,app.name||' · v'||clean_version,clean_slug,'release',clean_version,description,'private');
  insert into public.docs_releases(id,project_id,version) values(new_id,project,clean_version);
  return new_id;
end;
$$;

commit;
