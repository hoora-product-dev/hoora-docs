begin;
create table public.docs_teams (
 id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 100),
 slug text not null unique check(slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 manager_id uuid not null references public.docs_members(id), created_at timestamptz not null default now()
);
create table public.docs_team_members (
 team_id uuid references public.docs_teams(id) on delete cascade,
 email text not null check(email=lower(email) and email ~ '^[^@[:space:]]+@hoora\.me$'),
 role text not null default 'viewer' check(role in ('viewer','publisher')),
 added_by uuid references public.docs_members(id), created_at timestamptz not null default now(),primary key(team_id,email)
);
alter table public.docs_pages add column team_id uuid references public.docs_teams(id) on delete restrict;
alter table public.docs_pages add column archived_at timestamptz;
alter table public.docs_published add column team_id uuid references public.docs_teams(id) on delete restrict;
alter table public.docs_pages drop constraint docs_pages_visibility_check;
alter table public.docs_pages add constraint docs_pages_visibility_check check(visibility in ('public','private','restricted','team'));
alter table public.docs_published drop constraint docs_published_visibility_check;
alter table public.docs_published add constraint docs_published_visibility_check check(visibility in ('public','private','restricted','team'));
create index docs_pages_team on public.docs_pages(team_id);
create index docs_published_team on public.docs_published(team_id);

create function public.docs_manages_team(team uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.docs_role()='admin' or (public.docs_role()='manager' and exists(select 1 from public.docs_teams where id=team and manager_id=auth.uid()));
$$;
create function public.docs_team_access(team uuid,write_access boolean default false) returns boolean language sql stable security definer set search_path='' as $$
 select public.docs_manages_team(team) or exists(select 1 from public.docs_team_members tm join public.docs_members m on lower(m.email)=tm.email where tm.team_id=team and m.id=auth.uid() and m.active and m.password_setup_complete and (not write_access or tm.role='publisher'));
$$;
create function public.docs_can_create(team uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(public.docs_role()='admin' or (team is null and public.docs_role()='publisher') or (team is not null and public.docs_team_access(team,true)),false);
$$;
create function public.docs_can_write_page(document_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.docs_pages where id=document_id and archived_at is null and public.docs_can_create(team_id));
$$;
revoke all on function public.docs_manages_team(uuid),public.docs_team_access(uuid,boolean),public.docs_can_create(uuid),public.docs_can_write_page(uuid) from public;
grant execute on function public.docs_manages_team(uuid),public.docs_team_access(uuid,boolean),public.docs_can_create(uuid),public.docs_can_write_page(uuid) to authenticated,service_role;
alter table public.docs_teams enable row level security;
alter table public.docs_team_members enable row level security;
create policy teams_read on public.docs_teams for select to authenticated using(public.docs_team_access(id));
create policy teams_create on public.docs_teams for insert to authenticated with check(public.docs_role() in ('admin','manager') and manager_id=auth.uid());
create policy teams_update on public.docs_teams for update to authenticated using(public.docs_manages_team(id)) with check(public.docs_role()='admin' or manager_id=auth.uid());
create policy teams_delete on public.docs_teams for delete to authenticated using(public.docs_manages_team(id));
create policy team_members_read on public.docs_team_members for select to authenticated using(public.docs_team_access(team_id));
create policy team_members_manage on public.docs_team_members for all to authenticated using(public.docs_manages_team(team_id)) with check(public.docs_manages_team(team_id) and added_by=auth.uid());
grant select,insert,update,delete on public.docs_teams,public.docs_team_members to authenticated;
grant all on public.docs_teams,public.docs_team_members to service_role;
drop policy pages_read on public.docs_pages;
create policy pages_read on public.docs_pages for select to authenticated using(public.docs_role()='admin' or public.docs_can_create(team_id));
drop policy pages_create on public.docs_pages;
create policy pages_create on public.docs_pages for insert to authenticated with check(public.docs_can_create(team_id) and created_by=auth.uid());
drop policy pages_edit on public.docs_pages;
create policy pages_edit on public.docs_pages for update to authenticated using(public.docs_can_write_page(id)) with check(public.docs_can_create(team_id));

create or replace function public.docs_can_read_published_for(document_id uuid,viewer_id uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
declare p public.docs_published; member public.docs_members; manager uuid;
begin
 select * into p from public.docs_published where id=document_id;
 if not found or exists(select 1 from public.docs_pages where id=document_id and archived_at is not null) then return false;end if;
 if public.docs_is_public(document_id) then return true;end if;
 select * into member from public.docs_members where id=viewer_id and active and password_setup_complete;
 if member.id is null then return false;end if;
 if member.role='admin' then return true;end if;
 select manager_id into manager from public.docs_teams where id=p.team_id;
 if manager=viewer_id then return true;end if;
 if p.visibility='team' then return exists(select 1 from public.docs_team_members where team_id=p.team_id and email=lower(member.email));end if;
 if p.visibility='restricted' then return exists(select 1 from public.docs_page_access where page_id=document_id and email=lower(member.email));end if;
 return true;
end;$$;
create function public.docs_guard_team() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.visibility='team' and new.team_id is null then raise exception 'Choose a team for team-only access';end if;
 if tg_op='INSERT' and new.team_id is not null and coalesce(auth.role(),'')<>'service_role' then new.visibility:='team';end if;
 if tg_op='UPDATE' then
  if new.archived_at is distinct from old.archived_at and coalesce(public.docs_role(),'')<>'admin' and coalesce(auth.role(),'')<>'service_role' then raise exception 'Administrator access required to archive';end if;
  update public.docs_published set team_id=new.team_id where id=new.id and team_id is distinct from new.team_id;
 end if;
 return new;
end;$$;
create trigger docs_team_guard before insert or update on public.docs_pages for each row execute function public.docs_guard_team();
create or replace function public.docs_set_access(document_id uuid,access_mode text,allowed_emails text[] default '{}') returns void language plpgsql security definer set search_path='' as $$
declare p public.docs_pages; emails text[];
begin
 select * into p from public.docs_pages where id=document_id for update;
 if p.id is null then raise exception 'Document not found';end if;
 if not coalesce(public.docs_role()='admin' or public.docs_manages_team(p.team_id),false) then raise exception 'Manage this document team to change access';end if;
 if access_mode not in ('public','private','restricted','team') then raise exception 'Invalid access setting';end if;
 if access_mode='team' and p.team_id is null then raise exception 'Choose a team first';end if;
 emails:=array(select distinct lower(btrim(e)) from unnest(coalesce(allowed_emails,'{}')) e where btrim(e)<>'' order by 1);
 if cardinality(emails)>100 or exists(select 1 from unnest(emails) e where e !~ '^[^@[:space:]]+@hoora\.me$') then raise exception 'Use up to 100 Hoora work emails';end if;
 if access_mode='restricted' and cardinality(emails)=0 then raise exception 'Add at least one person';end if;
 if access_mode='public' and (not public.docs_folder_is_public(p.folder_id) or exists(select 1 from public.docs_releases r join public.docs_projects a on a.id=r.project_id where r.id=p.id and a.visibility<>'public')) then raise exception 'The parent folder or application is private';end if;
 update public.docs_pages set visibility=access_mode where id=p.id;
 delete from public.docs_page_access where page_id=p.id;
 if access_mode='restricted' then insert into public.docs_page_access(page_id,email,granted_by) select p.id,e,auth.uid() from unnest(emails) e;end if;
end;$$;
-- The old publisher builds the release snapshot. Wrap it with document-scoped authorization.
alter function public.docs_publish(uuid) rename to docs_publish_snapshot;
revoke all on function public.docs_publish_snapshot(uuid) from public,authenticated;
create function public.docs_publish(page_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare old_role text;
begin
 if not public.docs_can_write_page(page_id) then raise exception 'Publisher access to this document is required';end if;
 -- Snapshot builder uses the caller's global role; the scoped check above is authoritative.
 old_role:=current_setting('hoora.scoped_publish',true);
 perform set_config('hoora.scoped_publish','true',true);
 perform public.docs_publish_snapshot(page_id);
 update public.docs_published set team_id=p.team_id from public.docs_pages p where p.id=page_id and docs_published.id=p.id;
 perform set_config('hoora.scoped_publish',coalesce(old_role,''),true);
end;$$;
-- Replace only the old global-role gate in the snapshot builder, preserving its tested aggregation.
do $$declare definition text;begin
 select pg_get_functiondef('public.docs_publish_snapshot(uuid)'::regprocedure) into definition;
 definition:=replace(definition,'if coalesce(public.docs_role(),'''') not in (''admin'',''publisher'') then','if not public.docs_can_write_page(page_id) then');
 execute definition;
end;$$;
revoke all on function public.docs_publish(uuid) from public;
grant execute on function public.docs_publish(uuid) to authenticated;
create or replace function public.docs_unpublish(page_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.docs_can_write_page(page_id) then raise exception 'Publisher access to this document required';end if;
 delete from public.docs_published where id=page_id;
end;$$;
drop policy docs_files_upload on storage.objects;
create policy docs_files_upload on storage.objects for insert to authenticated with check(bucket_id='hoora-docs' and exists(select 1 from public.docs_pages p where p.id::text=(storage.foldername(name))[1] and public.docs_can_write_page(p.id)));
drop policy docs_files_read on storage.objects;
create policy docs_files_read on storage.objects for select to anon,authenticated using(bucket_id='hoora-docs' and (exists(select 1 from public.docs_pages p where p.id::text=(storage.foldername(name))[1] and public.docs_can_write_page(p.id)) or exists(select 1 from public.docs_published p where p.id::text=(storage.foldername(name))[1] and strpos(p.body,'attachment:'||name||')')>0)));
-- Anonymous storage queries also evaluate the writer predicate, which safely returns false.
grant execute on function public.docs_can_create(uuid),public.docs_can_write_page(uuid),public.docs_team_access(uuid,boolean),public.docs_manages_team(uuid) to anon;

commit;
