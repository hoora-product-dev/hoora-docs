begin;
drop policy pages_read on public.docs_pages;
create policy pages_read on public.docs_pages for select to authenticated using(public.docs_role() in ('admin','publisher'));
drop policy entries_read on public.docs_entries;
create policy entries_read on public.docs_entries for select to authenticated using(public.docs_role() in ('admin','publisher'));
drop policy releases_read on public.docs_releases;
create policy releases_read on public.docs_releases for select to authenticated using(public.docs_role() in ('admin','publisher') or (public.docs_role()='viewer' and exists(select 1 from public.docs_published p where p.id=docs_releases.id)));
drop policy docs_files_read on storage.objects;
create policy docs_files_read on storage.objects for select to anon,authenticated using(bucket_id='hoora-docs' and (
 public.docs_role() in ('admin','publisher') or exists(select 1 from public.docs_published p where p.id::text=(storage.foldername(name))[1] and strpos(p.body,'attachment:'||name||')')>0)
));
-- Moving a published page into a private folder must restrict its old link immediately.
create function public.docs_sync_access() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.folder_id is distinct from old.folder_id or new.visibility<>old.visibility then update public.docs_published set folder_id=new.folder_id,visibility=new.visibility where id=new.id;end if;
 return null;
end; $$;
create trigger docs_access_sync after update on public.docs_pages for each row execute function public.docs_sync_access();
commit;
