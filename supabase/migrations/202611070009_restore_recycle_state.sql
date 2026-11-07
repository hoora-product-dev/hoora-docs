begin;

create or replace function public.docs_archive(document_id uuid, restore boolean default false)
returns void language plpgsql security definer set search_path='' as $$
begin
  if coalesce(public.docs_role(),'')<>'admin' then raise exception 'Administrator access required'; end if;
  if restore then
    update public.docs_pages set archived_at=null, deleted_at=null, deleted_by=null, purge_after=null where id=document_id;
  else
    update public.docs_pages set archived_at=coalesce(archived_at,now()), deleted_at=coalesce(deleted_at,now()), deleted_by=coalesce(deleted_by,auth.uid()), purge_after=coalesce(purge_after,now()+interval '30 days') where id=document_id;
  end if;
  if not found then raise exception 'Document not found'; end if;
end; $$;

commit;
