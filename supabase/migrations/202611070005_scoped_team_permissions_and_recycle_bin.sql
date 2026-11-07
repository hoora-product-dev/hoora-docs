begin;

-- Scoped authorization and a recoverable recycle bin.  Teams are the normal
-- permission subject; individual grants remain available only where an admin
-- explicitly needs an exception.
alter table public.docs_team_members
  drop constraint if exists docs_team_members_role_check;
alter table public.docs_team_members
  add constraint docs_team_members_role_check
  check (role in ('viewer','contributor','publisher','manager'));

alter table public.docs_folders
  add column if not exists team_id uuid references public.docs_teams(id) on delete restrict;
create index if not exists docs_folders_team_idx on public.docs_folders(team_id);

alter table public.docs_pages
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.docs_members(id) on delete set null,
  add column if not exists purge_after timestamptz;
create index if not exists docs_pages_recycle_idx on public.docs_pages(purge_after) where purge_after is not null;
alter table public.docs_projects
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.docs_members(id) on delete set null,
  add column if not exists purge_after timestamptz;
create index if not exists docs_projects_recycle_idx on public.docs_projects(purge_after) where purge_after is not null;

create table if not exists public.docs_team_permissions (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.docs_teams(id) on delete cascade,
  scope_type text not null check (scope_type in ('collection','folder','project')),
  collection_key text check (collection_key in ('release','sop','documentation')),
  folder_id uuid references public.docs_folders(id) on delete cascade,
  project_id uuid references public.docs_projects(id) on delete cascade,
  capability text not null check (capability in ('read','contribute','edit','publish','manage','delete')),
  granted_by uuid not null references public.docs_members(id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  constraint docs_team_permissions_target_check check (
    (scope_type='collection' and collection_key is not null and folder_id is null and project_id is null)
    or (scope_type='folder' and folder_id is not null and collection_key is null and project_id is null)
    or (scope_type='project' and project_id is not null and collection_key is null and folder_id is null)
  )
);
create index if not exists docs_team_permissions_team_idx on public.docs_team_permissions(team_id);
create index if not exists docs_team_permissions_folder_idx on public.docs_team_permissions(folder_id);
create index if not exists docs_team_permissions_project_idx on public.docs_team_permissions(project_id);
alter table public.docs_team_permissions enable row level security;
drop policy if exists team_permissions_read on public.docs_team_permissions;
drop policy if exists team_permissions_manage on public.docs_team_permissions;
create policy team_permissions_read on public.docs_team_permissions for select to authenticated
  using (public.docs_role()='admin' or public.docs_team_access(team_id));
create policy team_permissions_manage on public.docs_team_permissions for all to authenticated
  using (public.docs_role()='admin') with check (public.docs_role()='admin' and granted_by=auth.uid());
revoke all on public.docs_team_permissions from anon;
grant select on public.docs_team_permissions to authenticated;
grant insert,update,delete on public.docs_team_permissions to authenticated;
grant all on public.docs_team_permissions to service_role;

-- Compatibility helper: the project historically exposed docs_role().
create or replace function public.docs_role_for(member uuid)
returns text language sql stable security definer set search_path=''
as $$ select role from public.docs_members where id=member and active and password_setup_complete $$;

create or replace function public.docs_team_role(team uuid, member uuid default auth.uid())
returns text language sql stable security definer set search_path=''
as $$
  select case
    when public.docs_role_for(member)='admin' then 'admin'
    when exists(select 1 from public.docs_teams t where t.id=team and t.manager_id=member) then 'manager'
    else (select tm.role from public.docs_team_members tm join public.docs_members m on lower(m.email)=tm.email
      where tm.team_id=team and m.id=member and m.active and m.password_setup_complete)
  end
$$;
revoke all on function public.docs_role_for(uuid),public.docs_team_role(uuid,uuid) from public;
grant execute on function public.docs_role_for(uuid),public.docs_team_role(uuid,uuid) to authenticated,service_role;

create or replace function public.docs_manages_team(team uuid) returns boolean
language sql stable security definer set search_path=''
as $$ select coalesce(public.docs_role_for(auth.uid())='admin' or public.docs_team_role(team,auth.uid())='manager',false) $$;
create or replace function public.docs_team_access(team uuid, write_access boolean default false) returns boolean
language sql stable security definer set search_path=''
as $$ select coalesce(
  public.docs_role_for(auth.uid())='admin'
  or public.docs_team_role(team,auth.uid())='manager'
  or exists(select 1 from public.docs_team_members tm join public.docs_members m on lower(m.email)=tm.email
    where tm.team_id=team and m.id=auth.uid() and m.active and m.password_setup_complete
      and (not write_access or tm.role in ('contributor','publisher'))),false) $$;
revoke all on function public.docs_manages_team(uuid),public.docs_team_access(uuid,boolean) from public;
grant execute on function public.docs_manages_team(uuid),public.docs_team_access(uuid,boolean) to authenticated,service_role;

create or replace function public.docs_has_team_permission(
  team uuid, collection text, folder uuid, project uuid, wanted text, member uuid default auth.uid()
) returns boolean language plpgsql stable security definer set search_path='' as $$
declare role_name text; rank integer;
begin
  if team is null then return public.docs_role_for(member) in ('admin','publisher'); end if;
  if public.docs_role_for(member)='admin' then return true; end if;
  role_name:=public.docs_team_role(team,member);
  if role_name is null then return false; end if;
  if wanted='read' then return true; end if;
  if role_name='manager' and collection in ('sop','documentation') then return true; end if;
  if role_name='publisher' and wanted in ('contribute','edit','publish') then return true; end if;
  if role_name='contributor' and wanted in ('contribute','edit') then return true; end if;
  rank:=case wanted when 'read' then 1 when 'contribute' then 2 when 'edit' then 3 when 'publish' then 4 when 'manage' then 5 when 'delete' then 6 else 99 end;
  return exists(
    select 1 from public.docs_team_permissions p
    where p.team_id=team and (p.expires_at is null or p.expires_at>now())
      and ((p.scope_type='collection' and p.collection_key=collection)
        or (p.scope_type='folder' and p.folder_id=folder)
        or (p.scope_type='project' and p.project_id=project))
      and case p.capability
        when 'read' then rank>=1
        when 'contribute' then rank>=2
        when 'edit' then rank>=3
        when 'publish' then rank>=4
        when 'manage' then rank>=5
        when 'delete' then rank>=6
        else false end
  );
end; $$;
revoke all on function public.docs_has_team_permission(uuid,text,uuid,uuid,text,uuid) from public;
grant execute on function public.docs_has_team_permission(uuid,text,uuid,uuid,text,uuid) to authenticated,service_role;

create or replace function public.docs_page_project(document_id uuid) returns uuid
language sql stable security definer set search_path=''
as $$ select project_id from public.docs_releases where id=document_id $$;
revoke all on function public.docs_page_project(uuid) from public;
grant execute on function public.docs_page_project(uuid) to authenticated,service_role;

create or replace function public.docs_can_read_folder(folder uuid, member uuid default auth.uid())
returns boolean language sql stable security definer set search_path=''
as $$ select folder is null or public.docs_role_for(member)='admin' or (select team_id from public.docs_folders where id=folder) is null or public.docs_team_access((select team_id from public.docs_folders where id=folder)) $$;

create or replace function public.docs_can_read_published_for(document_id uuid, viewer_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare p public.docs_published; member public.docs_members; owner uuid;
begin
  select * into p from public.docs_published where id=document_id;
  if not found or exists(select 1 from public.docs_pages where id=document_id and (archived_at is not null or deleted_at is not null)) then return false; end if;
  select * into member from public.docs_members where id=viewer_id and active and password_setup_complete;
  if member.id is null then return false; end if;
  if member.role='admin' then return true; end if;
  select created_by into owner from public.docs_pages where id=document_id;
  if owner=viewer_id then return true; end if;
  if p.visibility='restricted' then
    return exists(select 1 from public.docs_page_access a where a.page_id=document_id and a.email=lower(member.email));
  end if;
  if p.team_id is null then return true; end if;
  return public.docs_team_access(p.team_id,false);
end; $$;
revoke all on function public.docs_can_read_published_for(uuid,uuid) from public;
grant execute on function public.docs_can_read_published_for(uuid,uuid) to authenticated,service_role;

drop policy if exists published_read on public.docs_published;
create policy published_read on public.docs_published for select to authenticated
  using (public.docs_can_read_published_for(id,auth.uid()));
revoke select on public.docs_published,public.docs_published_index from anon;

create or replace function public.docs_can_create(team uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce(public.docs_role_for(auth.uid())='admin'
    or (team is null and public.docs_role_for(auth.uid())='publisher')
    or (team is not null and public.docs_team_role(team,auth.uid()) in ('manager','publisher','contributor')),
  false)
$$;

create or replace function public.docs_can_write_page_for(document_id uuid, viewer_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.docs_pages p
    where p.id=document_id and p.archived_at is null and p.deleted_at is null
      and (public.docs_role_for(viewer_id)='admin'
        or (p.team_id is null and public.docs_role_for(viewer_id)='publisher')
        or public.docs_has_team_permission(p.team_id,p.kind,p.folder_id,public.docs_page_project(p.id),'edit',viewer_id))
  )
$$;
create or replace function public.docs_can_write_page(document_id uuid)
returns boolean language sql stable security definer set search_path='' as $$ select public.docs_can_write_page_for(document_id,auth.uid()) $$;

create or replace function public.docs_can_publish_page_for(document_id uuid, viewer_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.docs_pages p
    where p.id=document_id and p.archived_at is null and p.deleted_at is null
      and (public.docs_role_for(viewer_id)='admin'
        or (p.team_id is null and public.docs_role_for(viewer_id)='publisher')
        or public.docs_has_team_permission(p.team_id,p.kind,p.folder_id,public.docs_page_project(p.id),'publish',viewer_id))
  )
$$;
revoke all on function public.docs_can_read_folder(uuid,uuid),public.docs_can_publish_page_for(uuid,uuid) from public;
grant execute on function public.docs_can_read_folder(uuid,uuid),public.docs_can_publish_page_for(uuid,uuid) to authenticated,service_role;

-- Replace broad folder visibility with organization/team visibility.
drop policy if exists folders_read on public.docs_folders;
create policy folders_read on public.docs_folders for select to authenticated
  using (public.docs_can_read_folder(id));

-- Team managers can only create content inside an assigned team folder. Admins
-- remain the only users who can change the structure itself.
drop policy if exists pages_create on public.docs_pages;
create policy pages_create on public.docs_pages for insert to authenticated
  with check (public.docs_can_create(team_id) and created_by=auth.uid()
    and (folder_id is null or public.docs_can_read_folder(folder_id)));
drop policy if exists pages_edit on public.docs_pages;
create policy pages_edit on public.docs_pages for update to authenticated
  using (public.docs_can_write_page(id))
  with check (public.docs_can_write_page(id) or public.docs_role()='admin');

create or replace function public.docs_trash(document_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare allowed boolean;
begin
  select public.docs_role()='admin' or public.docs_can_write_page(document_id) into allowed;
  if not coalesce(allowed,false) then raise exception 'Delete access required'; end if;
  update public.docs_pages set archived_at=coalesce(archived_at,now()), deleted_at=coalesce(deleted_at,now()), deleted_by=coalesce(deleted_by,auth.uid()), purge_after=coalesce(purge_after,now()+interval '30 days') where id=document_id;
  delete from public.docs_published where id=document_id;
end; $$;

create or replace function public.docs_restore(document_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if public.docs_role() <> 'admin' then raise exception 'Administrator access required'; end if;
  update public.docs_pages set archived_at=null,deleted_at=null,deleted_by=null,purge_after=null where id=document_id;
end; $$;

create or replace function public.docs_trash_project(project uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if public.docs_role()<>'admin' then raise exception 'Administrator access required'; end if;
  update public.docs_pages set archived_at=coalesce(archived_at,now()), deleted_at=coalesce(deleted_at,now()), deleted_by=coalesce(deleted_by,auth.uid()), purge_after=coalesce(purge_after,now()+interval '30 days')
    where id in (select id from public.docs_releases where project_id=project);
  delete from public.docs_published where id in (select id from public.docs_releases where project_id=project);
  update public.docs_projects set deleted_at=coalesce(deleted_at,now()), deleted_by=coalesce(deleted_by,auth.uid()), purge_after=coalesce(purge_after,now()+interval '30 days') where id=project;
end; $$;

create or replace function public.docs_purge_expired_trash()
returns integer language plpgsql security definer set search_path='' as $$
declare removed integer;
begin
  if coalesce(auth.role(),'')<>'service_role' and public.docs_role()<>'admin' then raise exception 'Administrator access required'; end if;
  delete from public.docs_pages where purge_after is not null and purge_after<=now();
  delete from public.docs_projects where purge_after is not null and purge_after<=now();
  get diagnostics removed = row_count;
  return removed;
end; $$;
revoke all on function public.docs_trash(uuid),public.docs_restore(uuid),public.docs_trash_project(uuid),public.docs_purge_expired_trash() from public;
grant execute on function public.docs_trash(uuid),public.docs_restore(uuid),public.docs_trash_project(uuid) to authenticated;
grant execute on function public.docs_purge_expired_trash() to service_role;

-- Team membership permissions are now team-scoped. Admins can assign any role;
-- managers can grant only viewer/contributor/publisher below their own role.
create or replace function public.docs_can_grant_team_role(target_team uuid, target_role text)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(public.docs_role()='admin' or (
    public.docs_team_role(target_team)= 'manager' and target_role in ('viewer','contributor','publisher')
  ),false)
$$;

commit;
