begin;
alter table public.docs_members add column password_setup_complete boolean not null default true;
update public.docs_members set password_setup_complete=false where auth_source='microsoft';
create or replace function public.docs_role() returns text language sql stable security definer set search_path='' as $$
 select role from public.docs_members where id=auth.uid() and active and password_setup_complete;
$$;
-- Retain only the current draft and explicitly published snapshot. No rollback archive.
create or replace function public.docs_track_revision() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' then
  new.revision:=old.revision+1; new.created_by:=old.created_by; new.created_at:=old.created_at;
 end if;
 new.updated_at:=now(); new.updated_by:=auth.uid(); return new;
end; $$;
drop table public.docs_revisions;
create table public.docs_mail_tests(
 id uuid primary key, actor_id uuid references auth.users(id) on delete set null,
 page_id uuid references public.docs_pages(id) on delete set null,
 status text not null default 'pending', created_at timestamptz not null default now()
);
alter table public.docs_mail_tests enable row level security;
revoke all on public.docs_mail_tests from anon,authenticated;
create table public.docs_projects(
 id uuid primary key default gen_random_uuid(),name text not null unique check(length(name) between 1 and 100),
 description text not null default '' check(length(description)<=500),created_at timestamptz not null default now()
);
create table public.docs_releases(
 id uuid primary key references public.docs_pages(id) on delete cascade,
 project_id uuid not null references public.docs_projects(id) on delete restrict,
 version text not null check(length(version) between 1 and 80),unique(project_id,version)
);
create table public.docs_entries(
 id uuid primary key default gen_random_uuid(),release_id uuid not null references public.docs_releases(id) on delete cascade,
 vertical_id uuid not null references public.docs_verticals(id) on delete restrict,
 title text not null check(length(title) between 1 and 200),body text not null default '' check(length(body)<=100000),
 tickets text not null default '' check(length(tickets)<=1000),submitted boolean not null default false,
 author_id uuid references auth.users(id) on delete set null,author_name text not null default '',
 updated_by uuid references auth.users(id) on delete set null,updated_name text not null default '',
 revision integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index on public.docs_entries(release_id);
create function public.docs_stamp_entry() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then
  new.author_id:=auth.uid(); new.author_name:=(select name from public.docs_members where id=auth.uid());new.revision:=1;
 else
  new.author_id:=old.author_id;new.author_name:=old.author_name;new.created_at:=old.created_at;
  new.release_id:=old.release_id;new.revision:=old.revision+1;
 end if;
 new.updated_by:=auth.uid();new.updated_name:=(select name from public.docs_members where id=auth.uid());new.updated_at:=now();
 return new;
end; $$;
create trigger docs_entry_stamp before insert or update on public.docs_entries for each row execute function public.docs_stamp_entry();
create function public.docs_touch_release() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.docs_pages set updated_at=now() where id=case when tg_op='DELETE' then old.release_id else new.release_id end;
 return null;
end; $$;
create trigger docs_entry_touch after insert or update or delete on public.docs_entries for each row execute function public.docs_touch_release();
alter table public.docs_projects enable row level security;
alter table public.docs_releases enable row level security;
alter table public.docs_entries enable row level security;
create policy projects_read on public.docs_projects for select to authenticated using(public.docs_role() is not null);
create policy projects_manage on public.docs_projects for all to authenticated using(public.docs_role() in ('admin','publisher')) with check(public.docs_role() in ('admin','publisher'));
create policy releases_read on public.docs_releases for select to authenticated using(public.docs_role() is not null);
create policy releases_manage on public.docs_releases for all to authenticated using(public.docs_role() in ('admin','publisher')) with check(public.docs_role() in ('admin','publisher'));
create policy entries_read on public.docs_entries for select to authenticated using(public.docs_role() is not null);
create policy entries_create on public.docs_entries for insert to authenticated with check(public.docs_role() in ('admin','publisher','editor') and author_id=auth.uid());
create policy entries_edit on public.docs_entries for update to authenticated using(public.docs_role() in ('admin','publisher') or (public.docs_role()='editor' and author_id=auth.uid())) with check(public.docs_role() in ('admin','publisher') or (public.docs_role()='editor' and author_id=auth.uid()));
create policy entries_delete on public.docs_entries for delete to authenticated using(public.docs_role() in ('admin','publisher') or (public.docs_role()='editor' and author_id=auth.uid()));
alter table public.docs_published add column release_snapshot jsonb;
create or replace function public.docs_publish(page_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare snapshot jsonb; content text;
begin
 if coalesce(public.docs_role(),'') not in ('admin','publisher') then raise exception 'Publisher access required';end if;
 perform 1 from public.docs_pages where id=page_id for update;
 if not found then raise exception 'Document not found';end if;
 if exists(select 1 from public.docs_pages where id=page_id and format='html' and artifact_path is null) then raise exception 'Upload an HTML file before publishing';end if;
 if exists(select 1 from public.docs_releases where id=page_id) then
  select jsonb_build_object('project',p.name,'version',r.version,'entries',coalesce((select jsonb_agg(jsonb_build_object('id',n.id,'vertical',v.name,'title',n.title,'body',n.body,'tickets',n.tickets,'author',n.author_name,'edited_by',n.updated_name,'updated_at',n.updated_at) order by v.name,n.created_at) from public.docs_entries n join public.docs_verticals v on v.id=n.vertical_id where n.release_id=r.id and n.submitted),'[]'::jsonb)) into snapshot from public.docs_releases r join public.docs_projects p on p.id=r.project_id where r.id=page_id;
  if jsonb_array_length(snapshot->'entries')=0 then raise exception 'Submit at least one contribution before publishing';end if;
  select string_agg('## '||(n->>'vertical')||E'\n\n### '||(n->>'title')||E'\n\n'||(n->>'body')||E'\n\nAdded by '||(n->>'author'),E'\n\n' order by n->>'vertical') into content from jsonb_array_elements(snapshot->'entries') n;
 end if;
 insert into public.docs_published(id,title,slug,kind,vertical_id,body,summary,version,tags,revision,format,artifact_path,release_snapshot)
 select id,title,slug,kind,vertical_id,coalesce(content,body),summary,version,tags,revision,format,artifact_path,snapshot from public.docs_pages where id=page_id
 on conflict(id) do update set title=excluded.title,slug=excluded.slug,kind=excluded.kind,vertical_id=excluded.vertical_id,body=excluded.body,summary=excluded.summary,version=excluded.version,tags=excluded.tags,revision=excluded.revision,format=excluded.format,artifact_path=excluded.artifact_path,release_snapshot=excluded.release_snapshot,published_at=now();
end; $$;
create table public.docs_requests(
 id uuid primary key default gen_random_uuid(),kind text not null check(kind in ('access','publish')),
 requester_id uuid references public.docs_members(id) on delete cascade,requester_name text not null,
 page_id uuid references public.docs_pages(id) on delete cascade,reason text not null check(length(reason) between 1 and 2000),
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 resolved_by uuid references auth.users(id) on delete set null,resolution text not null default '',
 created_at timestamptz not null default now(),resolved_at timestamptz
);
create unique index docs_pending_request on public.docs_requests(requester_id,kind,coalesce(page_id,'00000000-0000-0000-0000-000000000000'::uuid)) where status='pending';
alter table public.docs_requests enable row level security;
create policy requests_read on public.docs_requests for select to authenticated using(public.docs_role() is not null and (requester_id=auth.uid() or public.docs_role()='admin' or (kind='publish' and public.docs_role()='publisher')));
create function public.docs_request(request_kind text,request_reason text,document_id uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if public.docs_role() is null then raise exception 'Sign in first';end if;
 if request_kind='access' and (public.docs_role()<>'viewer' or document_id is not null) then raise exception 'Only viewers can request editor access';end if;
 if request_kind='publish' and (coalesce(public.docs_role(),'') not in ('admin','publisher','editor') or not exists(select 1 from public.docs_pages where id=document_id)) then raise exception 'Document or editor access required';end if;
 insert into public.docs_requests(kind,requester_id,requester_name,page_id,reason) values(request_kind,auth.uid(),(select name from public.docs_members where id=auth.uid()),document_id,request_reason) returning id into result;
 return result;
end; $$;
create function public.docs_resolve_request(request_id uuid,approve boolean,note text default '') returns void language plpgsql security definer set search_path='' as $$
declare r public.docs_requests;
begin
 select * into r from public.docs_requests where id=request_id for update;
 if not found or r.status<>'pending' then raise exception 'Request already handled or not found';end if;
 if coalesce(public.docs_role(),'') not in ('admin','publisher') or (r.kind='access' and public.docs_role()<>'admin') then raise exception 'Administrator or publisher access required';end if;
 if length(note)>2000 then raise exception 'Response is too long';end if;
 if approve then
  if r.kind='access' then update public.docs_members set role='editor' where id=r.requester_id and active and role='viewer';
  else perform public.docs_publish(r.page_id);end if;
 end if;
 update public.docs_requests set status=case when approve then 'approved' else 'rejected' end,resolved_by=auth.uid(),resolution=note,resolved_at=now() where id=request_id;
end; $$;
create function public.docs_create_release(project uuid,release_version text,description text default '') returns uuid language plpgsql security definer set search_path='' as $$
declare new_id uuid:=gen_random_uuid(); project_name text;
begin
 if coalesce(public.docs_role(),'') not in ('admin','publisher') then raise exception 'Publisher access required';end if;
 select name into project_name from public.docs_projects where id=project;
 if project_name is null then raise exception 'Application not found';end if;
 insert into public.docs_pages(id,title,slug,kind,version,summary) values(new_id,project_name||' · '||release_version,regexp_replace(lower(project_name||'-'||release_version),'[^a-z0-9]+','-','g')||'-'||left(new_id::text,8),'release',release_version,description);
 insert into public.docs_releases(id,project_id,version) values(new_id,project,release_version);return new_id;
end; $$;
revoke all on function public.docs_request(text,text,uuid),public.docs_resolve_request(uuid,boolean,text),public.docs_create_release(uuid,text,text) from public;
grant execute on function public.docs_request(text,text,uuid),public.docs_resolve_request(uuid,boolean,text),public.docs_create_release(uuid,text,text) to authenticated;
grant select,insert,update,delete on public.docs_projects,public.docs_releases,public.docs_entries to authenticated;
grant select on public.docs_requests to authenticated;
revoke insert,update,delete on public.docs_requests from anon,authenticated;
update storage.buckets set file_size_limit=10485760,allowed_mime_types=array['image/webp','application/pdf','text/plain','text/markdown','text/csv','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/html'] where id='hoora-docs';
insert into public.docs_projects(name,description) values('Customer App','Customer experience releases'),('Admin Panel','Internal tools and operations releases'),('Hoora on Web','Website and web app releases');
insert into public.docs_verticals(name,description) values('Auto Care','Vehicle care experiences'),('Garage Services','Garage and service journeys'),('Products & Accessories','D2C shopping and accessories'),('VSA','Vehicle service advisor workflows') on conflict(name) do nothing;
commit;
