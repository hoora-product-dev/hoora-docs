begin;
create table public.docs_storage_cleanup(page_id uuid primary key,created_at timestamptz not null default now());
alter table public.docs_storage_cleanup enable row level security;
revoke all on public.docs_storage_cleanup from public,anon,authenticated;grant all on public.docs_storage_cleanup to service_role;
create function public.docs_queue_deleted_files() returns trigger language plpgsql security definer set search_path='' as $$begin insert into public.docs_storage_cleanup(page_id) values(old.id) on conflict do nothing;return old;end;$$;
create trigger docs_deleted_files before delete on public.docs_pages for each row execute function public.docs_queue_deleted_files();
commit;
