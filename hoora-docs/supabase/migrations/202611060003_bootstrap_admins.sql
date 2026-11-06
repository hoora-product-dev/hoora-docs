begin;

-- Each nominated administrator receives the role once, after their verified
-- Hoora Microsoft sign-in. A later demotion is never silently reversed.
create table public.docs_bootstrap_admins (
  email text primary key check (email = lower(email) and email like '%@hoora.me'),
  claimed_at timestamptz
);
alter table public.docs_bootstrap_admins enable row level security;
revoke all on public.docs_bootstrap_admins from anon, authenticated;
grant select, update on public.docs_bootstrap_admins to service_role;

insert into public.docs_bootstrap_admins(email)
values ('rahul@hoora.me'), ('harsh@hoora.me');

update public.docs_members set role='admin'
where lower(email)='rahul@hoora.me' and auth_source='microsoft' and active;
update public.docs_bootstrap_admins set claimed_at=now()
where email='rahul@hoora.me'
  and exists (select 1 from public.docs_members where lower(email)='rahul@hoora.me' and role='admin' and active);

commit;
