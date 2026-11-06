begin;
create function public.docs_can_write_page_for(document_id uuid,viewer_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.docs_pages p join public.docs_members m on m.id=viewer_id and m.active and m.password_setup_complete where p.id=document_id and p.archived_at is null and (m.role='admin' or (p.team_id is null and m.role='publisher') or exists(select 1 from public.docs_teams t where t.id=p.team_id and t.manager_id=m.id and m.role='manager') or exists(select 1 from public.docs_team_members tm where tm.team_id=p.team_id and tm.email=lower(m.email) and tm.role='publisher')));
$$;
revoke all on function public.docs_can_write_page_for(uuid,uuid) from public;grant execute on function public.docs_can_write_page_for(uuid,uuid) to service_role;
commit;
