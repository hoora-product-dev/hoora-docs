begin;

-- Hoora Docs is an employee workspace: every existing document and new
-- document must require a verified Hoora Microsoft account.
alter table public.docs_pages disable trigger docs_access_guard;
update public.docs_types set default_visibility = 'private';
update public.docs_projects set visibility = 'private';
update public.docs_folders set visibility = 'private';
update public.docs_pages set visibility = 'private' where visibility = 'public';
update public.docs_published set visibility = 'private' where visibility = 'public';
alter table public.docs_pages enable trigger docs_access_guard;

create or replace function public.docs_is_public(document_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select false;
$$;
revoke all on function public.docs_is_public(uuid) from public;
grant execute on function public.docs_is_public(uuid) to anon, authenticated, service_role;

create or replace function public.docs_can_read_published_for(document_id uuid, viewer_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare p public.docs_published; member public.docs_members; manager uuid; owner uuid;
begin
  select * into p from public.docs_published where id=document_id;
  if not found or exists(select 1 from public.docs_pages where id=document_id and archived_at is not null) then return false; end if;
  select * into member from public.docs_members where id=viewer_id and active and password_setup_complete;
  if member.id is null then return false; end if;
  if member.role='admin' then return true; end if;
  select manager_id into manager from public.docs_teams where id=p.team_id;
  select created_by into owner from public.docs_pages where id=document_id;
  if manager=viewer_id or owner=viewer_id then return true; end if;
  if p.visibility='team' then
    return exists(select 1 from public.docs_team_members where team_id=p.team_id and email=lower(member.email));
  end if;
  if p.visibility='restricted' then
    return exists(select 1 from public.docs_page_access where page_id=document_id and email=lower(member.email));
  end if;
  return true;
end;
$$;
revoke all on function public.docs_can_read_published_for(uuid, uuid) from public;
grant execute on function public.docs_can_read_published_for(uuid, uuid) to service_role;

create or replace function public.docs_guard_access() returns trigger
language plpgsql security definer set search_path='' as $$
declare default_access text; valid_fields text[];
begin
  if new.visibility='public' then
    raise exception 'Public access is disabled. Hoora Microsoft sign-in is required.';
  end if;
  if tg_op='INSERT' then
    select default_visibility, fields into default_access, valid_fields
      from public.docs_types where key=new.kind;
    if coalesce(public.docs_role(), '') <> 'admin' and coalesce(auth.role(), '') <> 'service_role'
      then new.visibility := coalesce(default_access, 'private'); end if;
  elsif new.visibility <> old.visibility
    and coalesce(public.docs_role(), '') not in ('admin','manager')
    and coalesce(auth.role(), '') <> 'service_role' then
      raise exception 'Only administrators and managers can change document access';
  end if;
  select fields into valid_fields from public.docs_types where key=new.kind;
  if exists (
    select 1 from jsonb_each(new.custom_fields) f
    where f.key <> all(coalesce(valid_fields, '{}'))
      or jsonb_typeof(f.value) <> 'string' or length(f.value #>> '{}') > 2000
  ) then raise exception 'Custom fields must match administrator-defined fields and contain at most 2000 characters'; end if;
  if tg_op='UPDATE' and new.visibility <> old.visibility then
    update public.docs_published set visibility=new.visibility where id=new.id;
  end if;
  return new;
end;
$$;

create or replace function public.docs_set_access(document_id uuid, access_mode text, allowed_emails text[] default '{}')
returns void language plpgsql security definer set search_path='' as $$
declare p public.docs_pages; emails text[];
begin
  select * into p from public.docs_pages where id=document_id for update;
  if p.id is null then raise exception 'Document not found'; end if;
  if not coalesce(public.docs_role()='admin' or public.docs_manages_team(p.team_id),false)
    then raise exception 'Manage this document team to change access'; end if;
  if access_mode not in ('private','restricted','team')
    then raise exception 'Public access is disabled. Choose organization, selected people, or team access.'; end if;
  if access_mode='team' and p.team_id is null then raise exception 'Choose a team first'; end if;
  emails := array(select distinct lower(btrim(e)) from unnest(coalesce(allowed_emails,'{}')) e where btrim(e)<>'' order by 1);
  if cardinality(emails)>100 or exists(select 1 from unnest(emails) e where e !~ '^[^@[:space:]]+@hoora\.me$')
    then raise exception 'Use up to 100 Hoora work emails'; end if;
  if access_mode='restricted' and cardinality(emails)=0 then raise exception 'Add at least one person'; end if;
  update public.docs_pages set visibility=access_mode where id=p.id;
  delete from public.docs_page_access where page_id=p.id;
  if access_mode='restricted' then
    insert into public.docs_page_access(page_id,email,granted_by)
      select p.id,e,auth.uid() from unnest(emails) e;
  end if;
end;
$$;
revoke all on function public.docs_set_access(uuid,text,text[]) from public;
grant execute on function public.docs_set_access(uuid,text,text[]) to authenticated;

commit;
