begin;

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
