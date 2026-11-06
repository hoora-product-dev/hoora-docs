begin;
create function public.docs_has_email_grant(document_id uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.docs_page_access a join public.docs_members m on lower(m.email)=a.email where a.page_id=document_id and m.id=auth.uid() and m.active and m.password_setup_complete);$$;
revoke all on function public.docs_has_email_grant(uuid) from public;grant execute on function public.docs_has_email_grant(uuid) to authenticated;
drop policy pages_read on public.docs_pages;
create policy pages_read on public.docs_pages for select to authenticated using(public.docs_role()='admin' or (archived_at is null and public.docs_can_create(team_id) and (visibility<>'restricted' or created_by=auth.uid() or public.docs_manages_team(team_id) or public.docs_has_email_grant(id))));
commit;
