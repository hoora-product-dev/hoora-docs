begin;
alter table public.docs_pages add column source_url text check(source_url is null or (length(source_url)<=2048 and source_url ~ '^https://[^[:space:]]+$'));
alter table public.docs_pages add column source_type text not null default 'MARKDOWN' check(source_type in ('MARKDOWN','HTML','PDF','GOOGLE_DOC','GOOGLE_SHEET','GOOGLE_SLIDE','MICROSOFT_DOC','MICROSOFT_SHEET','MICROSOFT_SLIDE','DASHBOARD','OTHER_URL'));
alter table public.docs_pages add column file_metadata jsonb;
alter table public.docs_published add column source_url text;
alter table public.docs_published add column source_type text not null default 'MARKDOWN';
alter table public.docs_published add column file_metadata jsonb;
create function public.docs_source_snapshot() returns trigger language plpgsql security definer set search_path='' as $$begin
 select source_url,source_type,file_metadata,team_id into new.source_url,new.source_type,new.file_metadata,new.team_id from public.docs_pages where id=new.id;
 return new;end;$$;
create trigger docs_source_snapshot before insert or update on public.docs_published for each row execute function public.docs_source_snapshot();
create function public.docs_validate_source() returns trigger language plpgsql set search_path='' as $$begin
 if new.source_type not in ('MARKDOWN','HTML','PDF') and new.source_url is null then raise exception 'Paste an HTTPS URL';end if;
 if new.source_type='PDF' and new.file_metadata is null then raise exception 'Upload a PDF';end if;
 if new.file_metadata is not null and (coalesce((new.file_metadata->>'size')::bigint,0)>10485760 or new.file_metadata->>'mime_type'<>'application/pdf' or new.file_metadata->>'storage_path' not like new.id::text||'/%.pdf') then raise exception 'Invalid PDF metadata or file size';end if;
 return new;end;$$;
create trigger docs_validate_source before insert or update on public.docs_pages for each row execute function public.docs_validate_source();
create table public.docs_relationships(source_id uuid references public.docs_pages(id) on delete cascade,target_id uuid references public.docs_pages(id) on delete cascade,created_by uuid references public.docs_members(id) on delete set null,created_at timestamptz not null default now(),primary key(source_id,target_id),check(source_id<target_id));
alter table public.docs_relationships enable row level security;
create policy related_read on public.docs_relationships for select to anon,authenticated using(public.docs_can_read_published(source_id) and public.docs_can_read_published(target_id));
create policy related_write on public.docs_relationships for insert to authenticated with check((public.docs_can_write_page(source_id) or public.docs_can_write_page(target_id)) and public.docs_can_read_published(source_id) and public.docs_can_read_published(target_id) and created_by=auth.uid());
create policy related_remove on public.docs_relationships for delete to authenticated using(public.docs_can_write_page(source_id) or public.docs_can_write_page(target_id));
grant select on public.docs_relationships to anon,authenticated;grant insert,delete on public.docs_relationships to authenticated;grant all on public.docs_relationships to service_role;
-- PDF reads inherit document RLS, including team membership and archive state.
drop policy docs_files_read on storage.objects;
create policy docs_files_read on storage.objects for select to anon,authenticated using(bucket_id='hoora-docs' and (exists(select 1 from public.docs_pages p where p.id::text=(storage.foldername(name))[1] and public.docs_can_write_page(p.id)) or exists(select 1 from public.docs_published p where p.id::text=(storage.foldername(name))[1] and (strpos(p.body,'attachment:'||name||')')>0 or p.file_metadata->>'storage_path'=name))));
commit;
