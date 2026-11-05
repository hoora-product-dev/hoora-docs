begin;
create table public.docs_members (
 id uuid primary key references auth.users(id) on delete cascade,
 email text not null, name text not null default '',
 role text not null default 'editor' check (role in ('admin','publisher','editor','viewer')),
 active boolean not null default true, created_at timestamptz not null default now()
);
create function public.docs_role() returns text language sql stable security definer set search_path = '' as $$
 select role from public.docs_members where id = (select auth.uid()) and active;
$$;
revoke all on function public.docs_role() from public;
grant execute on function public.docs_role() to anon, authenticated;
alter table public.docs_members enable row level security;
create policy members_read on public.docs_members for select to authenticated using (id = (select auth.uid()) or public.docs_role() = 'admin');
create function public.docs_guard_last_admin() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 perform pg_advisory_xact_lock(84932041);
 if old.role = 'admin' and old.active and (tg_op = 'DELETE' or new.role <> 'admin' or not new.active) then
   if not exists (select 1 from public.docs_members where id <> old.id and role='admin' and active) then
     raise exception 'At least one active administrator is required';
   end if;
 end if;
 if tg_op = 'DELETE' then return old; end if;
 return new;
end; $$;
create trigger docs_last_admin before update or delete on public.docs_members for each row execute function public.docs_guard_last_admin();

create table public.docs_verticals (
 id uuid primary key default gen_random_uuid(), name text not null unique check(length(name) between 1 and 100),
 description text not null default '', created_at timestamptz not null default now()
);
alter table public.docs_verticals enable row level security;
create policy verticals_read on public.docs_verticals for select to anon,authenticated using (true);
create policy verticals_manage on public.docs_verticals for all to authenticated using (public.docs_role() in ('admin','publisher')) with check (public.docs_role() in ('admin','publisher'));

create table public.docs_folders (
 id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 100),
 vertical_id uuid references public.docs_verticals(id) on delete restrict,
 created_at timestamptz not null default now()
);
alter table public.docs_folders enable row level security;
create policy folders_read on public.docs_folders for select to authenticated using (public.docs_role() is not null);
create policy folders_manage on public.docs_folders for all to authenticated using (public.docs_role() in ('admin','publisher','editor')) with check (public.docs_role() in ('admin','publisher','editor'));

create table public.docs_pages (
 id uuid primary key default gen_random_uuid(), title text not null check(length(title) between 1 and 250),
 slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 kind text not null check (kind in ('release','sop','documentation')),
 vertical_id uuid references public.docs_verticals(id) on delete restrict,
 folder_id uuid references public.docs_folders(id) on delete set null,
 body text not null default '' check(length(body) <= 500000), summary text not null default '' check(length(summary) <= 500),
 version text not null default '', tags text[] not null default '{}',
 created_by uuid references auth.users(id) on delete set null default auth.uid(),
 updated_by uuid references auth.users(id) on delete set null default auth.uid(),
 revision integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index docs_pages_vertical_idx on public.docs_pages(vertical_id);
create index docs_pages_folder_idx on public.docs_pages(folder_id);
alter table public.docs_pages enable row level security;
create policy pages_read on public.docs_pages for select to authenticated using (public.docs_role() is not null);
create policy pages_create on public.docs_pages for insert to authenticated with check (public.docs_role() in ('admin','publisher','editor') and created_by = auth.uid());
create policy pages_edit on public.docs_pages for update to authenticated using (public.docs_role() in ('admin','publisher','editor')) with check (public.docs_role() in ('admin','publisher','editor'));
create policy pages_delete on public.docs_pages for delete to authenticated using (public.docs_role() in ('admin','publisher'));

-- Public content is an explicit snapshot. Saving draft edits NEVER changes this table.
create table public.docs_published (
 id uuid primary key references public.docs_pages(id) on delete cascade,
 title text not null, slug text not null unique, kind text not null,
 vertical_id uuid references public.docs_verticals(id) on delete restrict,
 body text not null, summary text not null, version text not null, tags text[] not null,
 revision integer not null, published_at timestamptz not null default now()
);
create index docs_published_vertical_idx on public.docs_published(vertical_id);
alter table public.docs_published enable row level security;
create policy published_read on public.docs_published for select to anon,authenticated using (true);

create table public.docs_revisions (
 id bigint generated always as identity primary key,
 page_id uuid not null references public.docs_pages(id) on delete cascade,
 snapshot jsonb not null, created_at timestamptz not null default now(), actor uuid references auth.users(id) on delete set null
);
create index docs_revisions_page_idx on public.docs_revisions(page_id);
alter table public.docs_revisions enable row level security;
create policy revisions_read on public.docs_revisions for select to authenticated using (public.docs_role() is not null);
create function public.docs_track_revision() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if tg_op='UPDATE' then
   insert into public.docs_revisions(page_id,snapshot,actor) values(old.id,to_jsonb(old),auth.uid());
   new.revision := old.revision+1;
   new.created_by := old.created_by; new.created_at := old.created_at;
 end if;
 new.updated_at := now(); new.updated_by := auth.uid();
 return new;
end; $$;
create trigger docs_revision before insert or update on public.docs_pages for each row execute function public.docs_track_revision();

create function public.docs_publish(page_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if public.docs_role() not in ('admin','publisher') or public.docs_role() is null then raise exception 'Publisher access required'; end if;
 insert into public.docs_published(id,title,slug,kind,vertical_id,body,summary,version,tags,revision)
 select id,title,slug,kind,vertical_id,body,summary,version,tags,revision from public.docs_pages where id=page_id
 on conflict(id) do update set title=excluded.title,slug=excluded.slug,kind=excluded.kind,vertical_id=excluded.vertical_id,
 body=excluded.body,summary=excluded.summary,version=excluded.version,tags=excluded.tags,revision=excluded.revision,published_at=now();
 if not found then raise exception 'Document not found'; end if;
end; $$;
create function public.docs_unpublish(page_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if public.docs_role() not in ('admin','publisher') or public.docs_role() is null then raise exception 'Publisher access required'; end if;
 delete from public.docs_published where id=page_id;
end; $$;
revoke all on function public.docs_publish(uuid),public.docs_unpublish(uuid) from public;
grant execute on function public.docs_publish(uuid),public.docs_unpublish(uuid) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('hoora-docs','hoora-docs',false,20971520,array['image/png','image/jpeg','image/webp','application/pdf','text/plain','text/markdown','text/csv','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);
-- Upload paths start with the document UUID. Unpublishing revokes anonymous file access too.
create policy docs_files_read on storage.objects for select to anon,authenticated using (
 bucket_id='hoora-docs' and (public.docs_role() is not null or exists(select 1 from public.docs_published p where p.id::text=(storage.foldername(name))[1] and strpos(p.body, 'attachment:' || name || ')') > 0))
);
create policy docs_files_upload on storage.objects for insert to authenticated with check (
 bucket_id='hoora-docs' and public.docs_role() in ('admin','publisher','editor') and exists(select 1 from public.docs_pages p where p.id::text=(storage.foldername(name))[1])
);
create policy docs_files_delete on storage.objects for delete to authenticated using(bucket_id='hoora-docs' and public.docs_role() in ('admin','publisher'));
grant select on public.docs_verticals,public.docs_published to anon;
grant select on public.docs_members,public.docs_verticals,public.docs_folders,public.docs_pages,public.docs_published,public.docs_revisions to authenticated;
grant insert,update,delete on public.docs_verticals,public.docs_folders,public.docs_pages to authenticated;
revoke insert,update,delete on public.docs_published,public.docs_revisions,public.docs_members from anon,authenticated;

insert into public.docs_verticals(name,description) values
 ('Company','Company-wide updates and ways of working'),
 ('Product & Engineering','Product releases, technical guides, and engineering practices'),
 ('Operations','Everyday processes, service delivery, and operational playbooks'),
 ('Customer Experience','Support processes and customer-facing guidance');
commit;
