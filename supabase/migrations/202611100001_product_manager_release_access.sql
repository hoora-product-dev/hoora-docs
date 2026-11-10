begin;

-- Product-team managers can own the release workflow across the organization.
-- Team membership still controls SOP/document access; this exception is only
-- for release notes and their publication notices.
create or replace function public.docs_has_team_permission(
  team uuid, collection text, folder uuid, project uuid, wanted text, member uuid default auth.uid()
) returns boolean language plpgsql stable security definer set search_path='' as $$
declare role_name text; wanted_rank integer; role_rank integer;
begin
  if public.docs_role_for(member) is null then return false; end if;
  wanted_rank:=case wanted when 'read' then 1 when 'contribute' then 2 when 'edit' then 3 when 'publish' then 4 when 'manage' then 5 when 'delete' then 6 else 99 end;
  if wanted_rank=99 then return false; end if;
  if public.docs_role_for(member)='admin' then return true; end if;
  if team is null then return public.docs_role_for(member)='publisher' and wanted_rank<=4; end if;
  role_name:=public.docs_team_role(team,member);
  role_rank:=case role_name when 'manager' then 6 when 'publisher' then 4 when 'contributor' then 3 when 'viewer' then 1 else 0 end;
  if wanted_rank>role_rank then return false; end if;
  if wanted='read' then return true; end if;
  if collection='release' and role_name='manager' and wanted in ('contribute','edit','publish') then return true; end if;
  if collection in ('sop','documentation') then
    return wanted_rank <= case role_name when 'manager' then 4 when 'publisher' then 4 when 'contributor' then 3 else 1 end;
  end if;
  return exists(
    select 1 from public.docs_team_permissions p
    where p.team_id=team and (p.expires_at is null or p.expires_at>now())
      and ((p.scope_type='collection' and p.collection_key=collection)
        or (p.scope_type='folder' and p.folder_id=folder)
        or (p.scope_type='project' and p.project_id=project))
      and wanted_rank <= case p.capability when 'read' then 1 when 'contribute' then 2 when 'edit' then 3 when 'publish' then 4 when 'manage' then 5 when 'delete' then 6 else 0 end
  );
end; $$;

create or replace function public.docs_can_write_page_for(document_id uuid, viewer_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.docs_pages p
    where p.id=document_id and p.deleted_at is null
      and (public.docs_role_for(viewer_id)='admin'
        or (p.kind='release' and exists(select 1 from public.docs_teams t where public.docs_team_role(t.id,viewer_id)='manager'))
        or (p.team_id is null and public.docs_role_for(viewer_id)='publisher')
        or public.docs_has_team_permission(p.team_id,p.kind,p.folder_id,public.docs_page_project(p.id),'edit',viewer_id))
  )
$$;

create or replace function public.docs_can_publish_page_for(document_id uuid, viewer_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.docs_pages p
    where p.id=document_id and p.deleted_at is null
      and (public.docs_role_for(viewer_id)='admin'
        or (p.kind='release' and exists(select 1 from public.docs_teams t where public.docs_team_role(t.id,viewer_id)='manager'))
        or (p.team_id is null and public.docs_role_for(viewer_id)='publisher')
        or public.docs_has_team_permission(p.team_id,p.kind,p.folder_id,public.docs_page_project(p.id),'publish',viewer_id))
  )
$$;

create or replace function public.docs_notify(document_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare p public.docs_published; result uuid; last_sent timestamptz; manager boolean;
begin
  select * into p from public.docs_published where id=document_id;
  if p.id is null or not public.docs_can_read_published(document_id) then raise exception 'Published document access required'; end if;
  select exists(select 1 from public.docs_teams t where public.docs_team_role(t.id,auth.uid())='manager') into manager;
  if not coalesce(public.docs_role()='admin' or manager, false) then raise exception 'Only a product-team manager or an administrator can send notices'; end if;
  perform pg_advisory_xact_lock(hashtextextended(document_id::text, 42));
  select max(created_at) into last_sent from public.docs_notices where page_id=document_id;
  if last_sent > now() - interval '3 hours' then raise exception 'This document was announced recently. Try after %', last_sent + interval '3 hours'; end if;
  insert into public.docs_notices(page_id, sender_id, sender_name)
    values (document_id, auth.uid(), (select name from public.docs_members where id=auth.uid())) returning id into result;
  insert into public.docs_audit_log(user_id, page_id, action, metadata)
    values (auth.uid(), document_id, 'notice_sent', jsonb_build_object('notice_id', result));
  return result;
end; $$;

commit;
