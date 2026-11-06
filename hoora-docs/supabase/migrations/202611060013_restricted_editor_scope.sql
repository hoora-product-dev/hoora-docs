begin;
create or replace function public.docs_can_write_page_for(document_id uuid,viewer_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.docs_pages p join public.docs_members m on m.id=viewer_id and m.active and m.password_setup_complete where p.id=document_id and p.archived_at is null and (
 m.role='admin' or exists(select 1 from public.docs_teams t where t.id=p.team_id and t.manager_id=m.id and m.role='manager') or
 ((p.visibility<>'restricted' or p.created_by=m.id or exists(select 1 from public.docs_page_access a where a.page_id=p.id and a.email=lower(m.email))) and
 ((p.team_id is null and m.role='publisher') or exists(select 1 from public.docs_team_members tm where tm.team_id=p.team_id and tm.email=lower(m.email) and tm.role='publisher')))));
$$;
create or replace function public.docs_can_write_page(document_id uuid) returns boolean language sql stable security definer set search_path='' as $$ select public.docs_can_write_page_for(document_id,auth.uid());$$;
drop policy pages_read on public.docs_pages;
create policy pages_read on public.docs_pages for select to authenticated using(public.docs_role()='admin' or public.docs_can_write_page(id));
create or replace function public.docs_can_read_published_for(document_id uuid,viewer_id uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
declare p public.docs_published; member public.docs_members; manager uuid;owner uuid;
begin
 select * into p from public.docs_published where id=document_id;
 if not found or exists(select 1 from public.docs_pages where id=document_id and archived_at is not null) then return false;end if;
 if public.docs_is_public(document_id) then return true;end if;
 select * into member from public.docs_members where id=viewer_id and active and password_setup_complete;
 if member.id is null then return false;end if;
 if member.role='admin' then return true;end if;
 select manager_id into manager from public.docs_teams where id=p.team_id;
 select created_by into owner from public.docs_pages where id=document_id;
 if manager=viewer_id or owner=viewer_id then return true;end if;
 if p.visibility='team' then return exists(select 1 from public.docs_team_members where team_id=p.team_id and email=lower(member.email));end if;
 if p.visibility='restricted' then return exists(select 1 from public.docs_page_access where page_id=document_id and email=lower(member.email));end if;
 return true;
end;$$;
-- Restriction must also apply when a team publisher queries contribution drafts.
drop policy entries_read on public.docs_entries;
create policy entries_read on public.docs_entries for select to authenticated using(public.docs_can_write_page(release_id));
drop policy entries_create on public.docs_entries;
create policy entries_create on public.docs_entries for insert to authenticated with check(public.docs_can_write_page(release_id) and author_id=auth.uid());
drop policy entries_edit on public.docs_entries;
create policy entries_edit on public.docs_entries for update to authenticated using(public.docs_can_write_page(release_id)) with check(public.docs_can_write_page(release_id));
drop policy releases_read on public.docs_releases;
create policy releases_read on public.docs_releases for select to authenticated using(public.docs_can_write_page(id) or public.docs_can_read_published(id));
commit;
