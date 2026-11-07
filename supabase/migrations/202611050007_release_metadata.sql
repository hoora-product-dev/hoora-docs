begin;
create unique index docs_releases_normalized_version on public.docs_releases(project_id,lower(regexp_replace(btrim(version),'^[vV](?=[0-9])','')));
create or replace function public.docs_create_release(project uuid,release_version text,description text default '') returns uuid language plpgsql security definer set search_path='' as $$
declare new_id uuid:=gen_random_uuid(); project_name text; project_access text;
begin
 if coalesce(public.docs_role(),'') not in ('admin','publisher') then raise exception 'Publisher access required';end if;
 release_version:=regexp_replace(btrim(release_version),'^[vV](?=[0-9])','');
 select name,visibility into project_name,project_access from public.docs_projects where id=project;
 if project_name is null then raise exception 'Application not found';end if;
 insert into public.docs_pages(id,title,slug,kind,version,summary,visibility) values(new_id,project_name||' · '||release_version,regexp_replace(lower(project_name||'-'||release_version),'[^a-z0-9]+','-','g')||'-'||left(new_id::text,8),'release',release_version,description,project_access);
 insert into public.docs_releases(id,project_id,version) values(new_id,project,release_version);return new_id;
end; $$;
update public.docs_published p set release_snapshot=jsonb_set(jsonb_set(jsonb_set(p.release_snapshot,'{project_icon}',to_jsonb(c.icon)),'{project_color}',to_jsonb(c.color)),'{entries}',coalesce((select jsonb_agg(n||jsonb_build_object('vertical_icon',coalesce(v.icon,'grid'),'vertical_color',coalesce(v.color,'slate'))) from jsonb_array_elements(p.release_snapshot->'entries') n left join public.docs_verticals v on v.id::text=n->>'vertical_id'),'[]'::jsonb)) from public.docs_projects c where p.project_id=c.id and p.release_snapshot is not null;
commit;
