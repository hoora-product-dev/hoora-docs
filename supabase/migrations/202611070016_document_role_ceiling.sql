begin;

-- Team roles can write normal team knowledge, but they cannot delete it or
-- alter organization structure. The administrator remains the sole delete
-- authority. Release permissions stay explicitly scoped by migration 015.
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
  if collection in ('sop','documentation') then
    return wanted_rank <= case role_name
      when 'manager' then 4 when 'publisher' then 4
      when 'contributor' then 3 else 1 end;
  end if;
  return exists(
    select 1 from public.docs_team_permissions p
    where p.team_id=team and (p.expires_at is null or p.expires_at>now())
      and ((p.scope_type='collection' and p.collection_key=collection)
        or (p.scope_type='folder' and p.folder_id=folder)
        or (p.scope_type='project' and p.project_id=project))
      and wanted_rank <= case p.capability
        when 'read' then 1 when 'contribute' then 2 when 'edit' then 3
        when 'publish' then 4 when 'manage' then 5 when 'delete' then 6 else 0 end
  );
end; $$;

commit;
