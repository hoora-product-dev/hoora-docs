begin;
drop policy pages_read on public.docs_pages;
create policy pages_read on public.docs_pages for select to authenticated using(public.docs_role()='admin' or (archived_at is null and public.docs_can_create(team_id) and (visibility<>'restricted' or created_by=auth.uid() or public.docs_manages_team(team_id) or exists(select 1 from public.docs_page_access a where a.page_id=docs_pages.id and a.email=(select lower(email) from public.docs_members where id=auth.uid())))));
commit;
