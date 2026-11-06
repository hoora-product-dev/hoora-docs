begin;
create function public.docs_can_write_storage_path(object_path text) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.docs_pages p where p.id::text=split_part(object_path,'/',1) and public.docs_can_write_page_for(p.id,auth.uid()));$$;
revoke all on function public.docs_can_write_storage_path(text) from public;grant execute on function public.docs_can_write_storage_path(text) to anon,authenticated,service_role;
drop policy docs_files_read on storage.objects;
create policy docs_files_read on storage.objects for select to anon,authenticated using(bucket_id='hoora-docs' and (public.docs_can_write_storage_path(name) or exists(select 1 from public.docs_published p where p.id::text=(storage.foldername(name))[1] and (strpos(p.body,'attachment:'||name||')')>0 or p.file_metadata->>'storage_path'=name))));
commit;
