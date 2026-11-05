begin;
alter table public.docs_members drop constraint docs_members_role_check;
update public.docs_members set role='publisher' where role='editor';
alter table public.docs_members add constraint docs_members_role_check check(role in ('admin','publisher','viewer'));
alter table public.docs_members alter column role set default 'viewer';
create table public.docs_types(
 key text primary key check(key ~ '^[a-z][a-z0-9-]{0,39}$'),name text not null check(length(name) between 1 and 80),
 icon text not null default 'documentation',color text not null default 'blue' check(color in ('blue','green','violet','orange','slate')),
 default_visibility text not null default 'private' check(default_visibility in ('private','public')),fields text[] not null default '{}' check(cardinality(fields)<=10)
);
insert into public.docs_types(key,name,icon,color,default_visibility) values('release','Release notes','release','violet','public'),('sop','SOPs','sop','green','private'),('documentation','Documentation','book','blue','private');
alter table public.docs_types enable row level security;
create policy types_read on public.docs_types for select to anon,authenticated using(true);
create policy types_manage on public.docs_types for all to authenticated using(public.docs_role()='admin') with check(public.docs_role()='admin');
grant select on public.docs_types to anon,authenticated;
grant insert,update,delete on public.docs_types to authenticated;
alter table public.docs_pages drop constraint docs_pages_kind_check;
alter table public.docs_pages add constraint docs_pages_kind_fkey foreign key(kind) references public.docs_types(key) on delete restrict;
alter table public.docs_pages add column visibility text not null default 'private' check(visibility in ('private','public'));
alter table public.docs_pages add column custom_fields jsonb not null default '{}' check(jsonb_typeof(custom_fields)='object' and octet_length(custom_fields::text)<=20000);
alter table public.docs_published add column visibility text not null default 'private' check(visibility in ('private','public'));
alter table public.docs_published add column folder_id uuid references public.docs_folders(id) on delete set null;
alter table public.docs_published add column project_id uuid references public.docs_projects(id) on delete cascade;
alter table public.docs_published add column custom_fields jsonb not null default '{}';
alter table public.docs_projects add column visibility text not null default 'public' check(visibility in ('private','public'));
alter table public.docs_projects add column icon text not null default 'grid';
alter table public.docs_projects add column color text not null default 'blue' check(color in ('blue','green','violet','orange','slate'));
alter table public.docs_folders add column visibility text not null default 'private' check(visibility in ('private','public'));
alter table public.docs_folders add column parent_id uuid references public.docs_folders(id) on delete set null;
alter table public.docs_folders add column icon text not null default 'folder';
alter table public.docs_folders add column color text not null default 'slate' check(color in ('blue','green','violet','orange','slate'));
alter table public.docs_verticals add column icon text not null default 'grid';
alter table public.docs_verticals add column color text not null default 'blue' check(color in ('blue','green','violet','orange','slate'));
update public.docs_verticals set icon=case name when 'Auto Care' then 'car' when 'Garage Services' then 'tool' when 'Products & Accessories' then 'bag' when 'VSA' then 'users' else 'grid' end,color=case name when 'Auto Care' then 'blue' when 'Garage Services' then 'orange' when 'Products & Accessories' then 'violet' when 'VSA' then 'green' else 'slate' end;
update public.docs_projects set icon=case when name ilike '%web%' then 'web' when name ilike '%admin%' then 'settings' else 'phone' end;
update public.docs_pages set visibility='public' where kind='release';
update public.docs_published p set visibility=d.visibility,folder_id=d.folder_id,project_id=r.project_id from public.docs_pages d left join public.docs_releases r on r.id=d.id where p.id=d.id;
create function public.docs_folder_is_public(folder uuid) returns boolean language sql stable security definer set search_path='' as $$
 with recursive parents as(select id,parent_id,visibility from public.docs_folders where id=folder union all select f.id,f.parent_id,f.visibility from public.docs_folders f join parents p on f.id=p.parent_id)
 select coalesce(bool_and(visibility='public'),true) from parents;
$$;
revoke all on function public.docs_folder_is_public(uuid) from public;
grant execute on function public.docs_folder_is_public(uuid) to anon,authenticated,service_role;
create function public.docs_is_public(document_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.docs_published p where p.id=document_id and p.visibility='public'
 and public.docs_folder_is_public(p.folder_id)
 and (p.project_id is null or exists(select 1 from public.docs_projects c where c.id=p.project_id and c.visibility='public')));
$$;
revoke all on function public.docs_is_public(uuid) from public;
grant execute on function public.docs_is_public(uuid) to anon,authenticated,service_role;
drop policy published_read on public.docs_published;
create policy published_read on public.docs_published for select to anon,authenticated using(public.docs_role() is not null or public.docs_is_public(id));
create function public.docs_guard_access() returns trigger language plpgsql security definer set search_path='' as $$
declare default_access text; valid_fields text[];
begin
 if tg_op='INSERT' then
  select default_visibility,fields into default_access,valid_fields from public.docs_types where key=new.kind;
  if coalesce(public.docs_role(),'')<>'admin' and coalesce(auth.role(),'')<>'service_role' then new.visibility:=coalesce(default_access,'private');end if;
 elsif new.visibility<>old.visibility and coalesce(public.docs_role(),'')<>'admin' and coalesce(auth.role(),'')<>'service_role' then raise exception 'Only administrators can change document visibility';
 end if;
 select fields into valid_fields from public.docs_types where key=new.kind;
 if exists(select 1 from jsonb_each(new.custom_fields) f where f.key<>all(coalesce(valid_fields,'{}')) or jsonb_typeof(f.value)<>'string' or length(f.value#>>'{}')>2000) then raise exception 'Custom fields must match the administrator-defined fields and contain at most 2000 characters';end if;
 if tg_op='UPDATE' and new.visibility<>old.visibility then update public.docs_published set visibility=new.visibility where id=new.id;end if;
 return new;
end; $$;
create trigger docs_access_guard before insert or update on public.docs_pages for each row execute function public.docs_guard_access();
create function public.docs_guard_folder_tree() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.parent_id is not null and (new.parent_id=new.id or exists(with recursive ancestors as(select id,parent_id from public.docs_folders where id=new.parent_id union all select f.id,f.parent_id from public.docs_folders f join ancestors a on f.id=a.parent_id) select 1 from ancestors where id=new.id)) then raise exception 'A folder cannot contain itself or an ancestor';end if;
 return new;
end; $$;
create trigger docs_folder_tree before insert or update on public.docs_folders for each row execute function public.docs_guard_folder_tree();
drop policy folders_manage on public.docs_folders;
create policy folders_manage on public.docs_folders for all to authenticated using(public.docs_role()='admin') with check(public.docs_role()='admin');
drop policy verticals_manage on public.docs_verticals;
create policy verticals_manage on public.docs_verticals for all to authenticated using(public.docs_role()='admin') with check(public.docs_role()='admin');
drop policy projects_manage on public.docs_projects;
create policy projects_manage on public.docs_projects for all to authenticated using(public.docs_role()='admin') with check(public.docs_role()='admin');
drop policy pages_delete on public.docs_pages;
create policy pages_delete on public.docs_pages for delete to authenticated using(public.docs_role()='admin');
drop policy entries_delete on public.docs_entries;
create policy entries_delete on public.docs_entries for delete to authenticated using(public.docs_role()='admin');
drop policy releases_manage on public.docs_releases;
create policy releases_create on public.docs_releases for insert to authenticated with check(public.docs_role() in ('admin','publisher'));
create policy releases_admin on public.docs_releases for update to authenticated using(public.docs_role()='admin') with check(public.docs_role()='admin');
create policy releases_delete on public.docs_releases for delete to authenticated using(public.docs_role()='admin');
drop policy docs_files_delete on storage.objects;
create policy docs_files_delete on storage.objects for delete to authenticated using(bucket_id='hoora-docs' and public.docs_role()='admin');
create or replace function public.docs_resolve_request(request_id uuid,approve boolean,note text default '') returns void language plpgsql security definer set search_path='' as $$
declare r public.docs_requests;
begin
 if coalesce(public.docs_role(),'')<>'admin' then raise exception 'Administrator access required';end if;
 select * into r from public.docs_requests where id=request_id for update;
 if not found or r.status<>'pending' then raise exception 'Request already handled or not found';end if;
 if length(note)>2000 then raise exception 'Response is too long';end if;
 if approve then
  if r.kind='access' then update public.docs_members set role='publisher' where id=r.requester_id and active and role='viewer';
  else perform public.docs_publish(r.page_id);end if;
 end if;
 update public.docs_requests set status=case when approve then 'approved' else 'rejected' end,resolved_by=auth.uid(),resolution=note,resolved_at=now() where id=request_id;
end; $$;
create function public.docs_delete_project(project uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if coalesce(public.docs_role(),'')<>'admin' then raise exception 'Administrator access required';end if;
 delete from public.docs_pages where id in(select id from public.docs_releases where project_id=project);
 delete from public.docs_projects where id=project;
end; $$;
revoke all on function public.docs_delete_project(uuid) from public;
grant execute on function public.docs_delete_project(uuid) to authenticated;
-- Publish/create functions are replaced below in this same transaction.
create or replace function public.docs_publish(page_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare snapshot jsonb; content text;
begin
 if coalesce(public.docs_role(),'') not in ('admin','publisher') then raise exception 'Publisher access required';end if;
 perform 1 from public.docs_pages where id=page_id for update;
 if not found then raise exception 'Document not found';end if;
 if exists(select 1 from public.docs_pages where id=page_id and format='html' and artifact_path is null) then raise exception 'Upload an HTML file before publishing';end if;
 if exists(select 1 from public.docs_releases where id=page_id) then
  select jsonb_build_object('project',p.name,'project_icon',p.icon,'project_color',p.color,'version',r.version,'entries',coalesce((select jsonb_agg(jsonb_build_object('id',n.id,'vertical',v.name,'vertical_id',v.id,'vertical_icon',v.icon,'vertical_color',v.color,'title',n.title,'body',n.body,'tickets',n.tickets,'author',n.author_name,'edited_by',n.updated_name,'updated_at',n.updated_at) order by v.name,n.created_at) from public.docs_entries n join public.docs_verticals v on v.id=n.vertical_id where n.release_id=r.id and n.submitted),'[]'::jsonb)) into snapshot from public.docs_releases r join public.docs_projects p on p.id=r.project_id where r.id=page_id;
  if jsonb_array_length(snapshot->'entries')=0 then raise exception 'Submit at least one contribution before publishing';end if;
  select string_agg('## '||(n->>'vertical')||E'\n\n### '||(n->>'title')||E'\n\n'||(n->>'body')||E'\n\nAdded by '||(n->>'author'),E'\n\n' order by n->>'vertical') into content from jsonb_array_elements(snapshot->'entries') n;
 end if;
 insert into public.docs_published(id,title,slug,kind,vertical_id,body,summary,version,tags,revision,format,artifact_path,release_snapshot,visibility,folder_id,project_id,custom_fields)
 select id,title,slug,kind,vertical_id,coalesce(content,body),summary,version,tags,revision,format,artifact_path,snapshot,visibility,folder_id,(select project_id from public.docs_releases where id=page_id),custom_fields from public.docs_pages where id=page_id
 on conflict(id) do update set title=excluded.title,slug=excluded.slug,kind=excluded.kind,vertical_id=excluded.vertical_id,body=excluded.body,summary=excluded.summary,version=excluded.version,tags=excluded.tags,revision=excluded.revision,format=excluded.format,artifact_path=excluded.artifact_path,release_snapshot=excluded.release_snapshot,visibility=excluded.visibility,folder_id=excluded.folder_id,project_id=excluded.project_id,custom_fields=excluded.custom_fields,published_at=now();
end; $$;

create or replace function public.docs_create_release(project uuid,release_version text,description text default '') returns uuid language plpgsql security definer set search_path='' as $$
declare new_id uuid:=gen_random_uuid(); project_name text; project_access text;
begin
 if coalesce(public.docs_role(),'') not in ('admin','publisher') then raise exception 'Publisher access required';end if;
 select name,visibility into project_name,project_access from public.docs_projects where id=project;
 if project_name is null then raise exception 'Application not found';end if;
 insert into public.docs_pages(id,title,slug,kind,version,summary,visibility) values(new_id,project_name||' · '||release_version,regexp_replace(lower(project_name||'-'||release_version),'[^a-z0-9]+','-','g')||'-'||left(new_id::text,8),'release',release_version,description,project_access);
 insert into public.docs_releases(id,project_id,version) values(new_id,project,release_version);return new_id;
end; $$;

commit;
