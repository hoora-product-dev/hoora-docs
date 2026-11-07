begin;

-- A team manager retains management/read access when a document is narrowed to
-- selected people; restricted readers still remain limited to their grant list.
create or replace function public.docs_can_read_published_for(document_id uuid, viewer_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare p public.docs_published; member public.docs_members; owner uuid; folder_team uuid;
begin
  select * into p from public.docs_published where id=document_id;
  if not found or exists(select 1 from public.docs_pages where id=document_id and (archived_at is not null or deleted_at is not null)) then return false; end if;
  select * into member from public.docs_members where id=viewer_id and active and password_setup_complete;
  if member.id is null then return false; end if;
  if member.role='admin' then return true; end if;
  select created_by into owner from public.docs_pages where id=document_id;
  if owner=viewer_id then return true; end if;
  select f.team_id into folder_team from public.docs_folders f where f.id=p.folder_id;
  if folder_team is not null and public.docs_team_role(folder_team,viewer_id) is null then return false; end if;
  if p.team_id is not null and public.docs_team_role(p.team_id,viewer_id)='manager' then return true; end if;
  if p.visibility='restricted' then
    return exists(select 1 from public.docs_page_access a where a.page_id=document_id and a.email=lower(member.email));
  end if;
  if p.team_id is null then return true; end if;
  return public.docs_team_role(p.team_id,viewer_id) is not null;
end; $$;

commit;
