begin;

-- Sections are configured per application, while a section can be reused by another app.
create table if not exists public.docs_project_sections (
  project_id uuid not null references public.docs_projects(id) on delete cascade,
  vertical_id uuid not null references public.docs_verticals(id) on delete restrict,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (project_id,vertical_id)
);
create index if not exists docs_project_sections_order on public.docs_project_sections(project_id,active,sort_order);

-- Preserve every existing contribution by registering its section for that app.
insert into public.docs_project_sections(project_id,vertical_id)
select distinct release.project_id,entry.vertical_id
from public.docs_entries entry
join public.docs_releases release on release.id=entry.release_id
on conflict (project_id,vertical_id) do nothing;

alter table public.docs_project_sections enable row level security;
create policy project_sections_read on public.docs_project_sections
  for select to authenticated using(public.docs_role() is not null);
create policy project_sections_admin on public.docs_project_sections
  for all to authenticated using(public.docs_role()='admin')
  with check(public.docs_role()='admin');
grant select,insert,update,delete on public.docs_project_sections to authenticated;

create function public.docs_guard_entry_section() returns trigger
language plpgsql security definer set search_path='' as $$
declare application_id uuid;
begin
  if tg_op='UPDATE' and new.vertical_id=old.vertical_id then return new; end if;
  select project_id into application_id from public.docs_releases where id=new.release_id;
  if not exists (
    select 1 from public.docs_project_sections
    where project_id=application_id and vertical_id=new.vertical_id and active
  ) then raise exception 'Choose an active section configured for this application'; end if;
  return new;
end; $$;
create trigger docs_entry_section_guard before insert or update of vertical_id
on public.docs_entries for each row execute function public.docs_guard_entry_section();

-- Release publisher is credited separately from each contribution's author.
alter table public.docs_published
  add column published_by uuid references public.docs_members(id) on delete set null,
  add column published_by_name text;
create function public.docs_stamp_publisher() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  new.published_by:=auth.uid();
  new.published_by_name:=(select name from public.docs_members where id=auth.uid());
  return new;
end; $$;
create trigger docs_published_publisher before insert or update on public.docs_published
for each row execute function public.docs_stamp_publisher();

commit;
