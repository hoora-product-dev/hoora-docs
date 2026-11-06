begin;

alter table public.docs_members drop constraint docs_members_role_check;
alter table public.docs_members add constraint docs_members_role_check
  check (role in ('admin','manager','publisher','viewer'));

alter table public.docs_pages drop constraint docs_pages_visibility_check;
alter table public.docs_pages add constraint docs_pages_visibility_check
  check (visibility in ('public','private','restricted'));
alter table public.docs_published drop constraint docs_published_visibility_check;
alter table public.docs_published add constraint docs_published_visibility_check
  check (visibility in ('public','private','restricted'));

create table public.docs_page_access (
  page_id uuid not null references public.docs_pages(id) on delete cascade,
  email text not null check (length(email) <= 320 and email = lower(email) and email ~ '^[^@[:space:]]+@hoora\.me$'),
  granted_by uuid references public.docs_members(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (page_id, email)
);
create index docs_page_access_email on public.docs_page_access(email);
alter table public.docs_page_access enable row level security;
create policy page_access_manage_read on public.docs_page_access
  for select to authenticated using (public.docs_role() in ('admin','manager'));
revoke all on public.docs_page_access from anon, authenticated;
grant select on public.docs_page_access to authenticated;
grant all on public.docs_page_access to service_role;

create or replace function public.docs_can_read_published_for(document_id uuid, viewer_id uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare access_mode text; viewer_role text; viewer_email text;
begin
  if public.docs_is_public(document_id) then return true; end if;
  select visibility into access_mode from public.docs_published where id = document_id;
  if access_mode is null or viewer_id is null then return false; end if;
  select role, lower(email) into viewer_role, viewer_email
    from public.docs_members where id = viewer_id and active and password_setup_complete;
  if viewer_role is null then return false; end if;
  if access_mode = 'restricted' then
    return viewer_role in ('admin','manager') or exists (
      select 1 from public.docs_page_access a
      where a.page_id = document_id and a.email = viewer_email
    );
  end if;
  return true;
end; $$;
revoke all on function public.docs_can_read_published_for(uuid, uuid) from public;
grant execute on function public.docs_can_read_published_for(uuid, uuid) to service_role;

create or replace function public.docs_can_read_published(document_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.docs_can_read_published_for(document_id, auth.uid());
$$;
revoke all on function public.docs_can_read_published(uuid) from public;
grant execute on function public.docs_can_read_published(uuid) to anon, authenticated, service_role;

drop policy published_read on public.docs_published;
create policy published_read on public.docs_published
  for select to anon, authenticated using (public.docs_can_read_published(id));

create or replace function public.docs_guard_access() returns trigger
language plpgsql security definer set search_path = '' as $$
declare default_access text; valid_fields text[];
begin
  if tg_op = 'INSERT' then
    select default_visibility, fields into default_access, valid_fields
      from public.docs_types where key = new.kind;
    if coalesce(public.docs_role(), '') <> 'admin' and coalesce(auth.role(), '') <> 'service_role'
      then new.visibility := coalesce(default_access, 'private'); end if;
  elsif new.visibility <> old.visibility
    and coalesce(public.docs_role(), '') not in ('admin','manager')
    and coalesce(auth.role(), '') <> 'service_role' then
      raise exception 'Only administrators and managers can change document access';
  end if;
  select fields into valid_fields from public.docs_types where key = new.kind;
  if exists (
    select 1 from jsonb_each(new.custom_fields) f
    where f.key <> all(coalesce(valid_fields, '{}'))
      or jsonb_typeof(f.value) <> 'string' or length(f.value #>> '{}') > 2000
  ) then raise exception 'Custom fields must match administrator-defined fields and contain at most 2000 characters'; end if;
  if tg_op = 'UPDATE' and new.visibility <> old.visibility then
    update public.docs_published set visibility = new.visibility where id = new.id;
  end if;
  return new;
end; $$;

create function public.docs_set_access(document_id uuid, access_mode text, allowed_emails text[] default '{}')
returns void language plpgsql security definer set search_path = '' as $$
declare normalized text[]; page_record record;
begin
  if public.docs_role() not in ('admin','manager') then
    raise exception 'Administrator or manager access required';
  end if;
  if access_mode not in ('public','private','restricted') then
    raise exception 'Choose a valid access setting';
  end if;
  normalized := array(
    select distinct lower(btrim(email)) from unnest(coalesce(allowed_emails, '{}')) email
    where btrim(email) <> '' order by 1
  );
  if cardinality(normalized) > 100 then raise exception 'Add at most 100 people'; end if;
  if exists(select 1 from unnest(normalized) email where email !~ '^[^@[:space:]]+@hoora\.me$')
    then raise exception 'Use Hoora work email addresses'; end if;
  if access_mode = 'restricted' and cardinality(normalized) = 0
    then raise exception 'Add at least one Hoora email for selected-people access'; end if;
  select p.id,p.folder_id,r.project_id into page_record
    from public.docs_pages p left join public.docs_releases r on r.id = p.id
    where p.id = document_id for update of p;
  if page_record.id is null then raise exception 'Document not found'; end if;
  if access_mode = 'public' and (
    not public.docs_folder_is_public(page_record.folder_id)
    or exists(select 1 from public.docs_projects project
      where project.id = page_record.project_id and project.visibility <> 'public')
  ) then raise exception 'This page is inside a private folder or application'; end if;
  update public.docs_pages set visibility = access_mode where id = document_id;
  delete from public.docs_page_access where page_id = document_id;
  if access_mode = 'restricted' then
    insert into public.docs_page_access(page_id,email,granted_by)
      select document_id,email,auth.uid() from unnest(normalized) email;
  end if;
end; $$;
revoke all on function public.docs_set_access(uuid, text, text[]) from public;
grant execute on function public.docs_set_access(uuid, text, text[]) to authenticated;

commit;
