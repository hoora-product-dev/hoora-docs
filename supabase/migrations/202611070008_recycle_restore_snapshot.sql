begin;

create or replace function public.docs_trash(document_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare allowed boolean;
begin
  select public.docs_role()='admin' or public.docs_can_write_page(document_id) into allowed;
  if not coalesce(allowed,false) then raise exception 'Delete access required'; end if;
  update public.docs_pages set archived_at=coalesce(archived_at,now()), deleted_at=coalesce(deleted_at,now()), deleted_by=coalesce(deleted_by,auth.uid()), purge_after=coalesce(purge_after,now()+interval '30 days') where id=document_id;
  -- Keep the published snapshot hidden but restorable until purge.
end; $$;

create or replace function public.docs_trash_project(project uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if public.docs_role()<>'admin' then raise exception 'Administrator access required'; end if;
  update public.docs_pages set archived_at=coalesce(archived_at,now()), deleted_at=coalesce(deleted_at,now()), deleted_by=coalesce(deleted_by,auth.uid()), purge_after=coalesce(purge_after,now()+interval '30 days')
    where id in (select id from public.docs_releases where project_id=project);
  update public.docs_projects set deleted_at=coalesce(deleted_at,now()), deleted_by=coalesce(deleted_by,auth.uid()), purge_after=coalesce(purge_after,now()+interval '30 days') where id=project;
end; $$;

commit;
