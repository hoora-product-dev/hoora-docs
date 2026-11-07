begin;
alter table public.docs_members add column auth_source text not null default 'password' check(auth_source in ('password','microsoft'));
alter table public.docs_members add column microsoft_subject text unique;
create table public.docs_sso_blocks(microsoft_subject text primary key,email text not null,created_at timestamptz not null default now());
alter table public.docs_sso_blocks enable row level security;
revoke all on public.docs_sso_blocks from anon,authenticated;
alter table public.docs_pages add column format text not null default 'markdown' check(format in ('markdown','html'));
alter table public.docs_pages add column artifact_path text;
alter table public.docs_published add column format text not null default 'markdown' check(format in ('markdown','html'));
alter table public.docs_published add column artifact_path text;
alter table public.docs_pages add constraint docs_artifact_path check(artifact_path is null or artifact_path ~ ('^' || id::text || '/[a-zA-Z0-9_.-]+\.html?$'));
create or replace function public.docs_publish(page_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if public.docs_role() not in ('admin','publisher') or public.docs_role() is null then raise exception 'Publisher access required'; end if;
 if exists(select 1 from public.docs_pages where id=page_id and format='html' and artifact_path is null) then raise exception 'Upload an HTML file before publishing'; end if;
 insert into public.docs_published(id,title,slug,kind,vertical_id,body,summary,version,tags,revision,format,artifact_path)
 select id,title,slug,kind,vertical_id,body,summary,version,tags,revision,format,artifact_path from public.docs_pages where id=page_id
 on conflict(id) do update set title=excluded.title,slug=excluded.slug,kind=excluded.kind,vertical_id=excluded.vertical_id,
 body=excluded.body,summary=excluded.summary,version=excluded.version,tags=excluded.tags,revision=excluded.revision,format=excluded.format,artifact_path=excluded.artifact_path,published_at=now();
 if not found then raise exception 'Document not found'; end if;
end; $$;
update storage.buckets set allowed_mime_types=array_append(allowed_mime_types,'text/html') where id='hoora-docs' and not ('text/html'=any(allowed_mime_types));
commit;
