begin;
-- A public link must never bypass archive state.
create or replace function public.docs_is_public(document_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.docs_published p join public.docs_pages d on d.id=p.id where p.id=document_id and d.archived_at is null and p.visibility='public' and public.docs_folder_is_public(p.folder_id) and (p.project_id is null or exists(select 1 from public.docs_projects c where c.id=p.project_id and c.visibility='public')));
$$;
drop policy page_access_manage_read on public.docs_page_access;
create policy page_access_manage_read on public.docs_page_access for select to authenticated using(public.docs_role()='admin' or exists(select 1 from public.docs_pages p where p.id=page_id and public.docs_manages_team(p.team_id)));
-- Manage archived rows through a separate, administrator-only function.
create function public.docs_archive(document_id uuid,restore boolean default false) returns void language plpgsql security definer set search_path='' as $$
begin
 if coalesce(public.docs_role(),'')<>'admin' then raise exception 'Administrator access required';end if;
 update public.docs_pages set archived_at=case when restore then null else now() end where id=document_id;
 if not found then raise exception 'Document not found';end if;
end;$$;
revoke all on function public.docs_archive(uuid,boolean) from public;
grant execute on function public.docs_archive(uuid,boolean) to authenticated;

create function public.docs_slug(value text) returns text language sql immutable set search_path='' as $$
 select left(trim(both '-' from regexp_replace(lower(value),'[^a-z0-9]+','-','g')),120);
$$;
alter table public.docs_projects add column slug text;
update public.docs_projects set slug=public.docs_slug(name);
alter table public.docs_projects alter column slug set not null;
alter table public.docs_projects add constraint docs_project_slug_unique unique(slug);
create function public.docs_project_slug() returns trigger language plpgsql set search_path='' as $$begin
 if new.slug is null or new.slug='' then new.slug:=public.docs_slug(new.name);end if;
 if new.slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then raise exception 'Use lowercase letters, numbers and hyphens in the slug';end if;return new;end;$$;
create trigger docs_project_slug before insert or update on public.docs_projects for each row execute function public.docs_project_slug();
create table public.docs_slug_aliases(slug text primary key,page_id uuid not null references public.docs_pages(id) on delete cascade);
alter table public.docs_slug_aliases enable row level security;
create policy slug_alias_read on public.docs_slug_aliases for select to anon,authenticated using(exists(select 1 from public.docs_published p where p.id=page_id));
grant select on public.docs_slug_aliases to anon,authenticated;
grant all on public.docs_slug_aliases to service_role;
create function public.docs_preserve_slug() returns trigger language plpgsql security definer set search_path='' as $$begin
 perform pg_advisory_xact_lock(84932042);
 if exists(select 1 from public.docs_slug_aliases where slug=new.slug and page_id<>new.id) then raise exception 'This slug belongs to an existing shared link';end if;
 if tg_op='UPDATE' and new.slug<>old.slug then insert into public.docs_slug_aliases(slug,page_id) values(old.slug,old.id) on conflict do nothing;end if;
 return new;end;$$;
create trigger docs_preserve_slug before insert or update of slug on public.docs_pages for each row execute function public.docs_preserve_slug();
create or replace function public.docs_create_release(project uuid,release_version text,description text default '') returns uuid language plpgsql security definer set search_path='' as $$
declare new_id uuid:=gen_random_uuid(); app public.docs_projects; clean_version text; clean_slug text;
begin
 if coalesce(public.docs_role(),'') not in ('admin','publisher') then raise exception 'Company publisher access required to create application releases';end if;
 clean_version:=regexp_replace(btrim(release_version),'^[vV](?=[0-9])','');
 if clean_version !~ '^[0-9]+(\.[0-9]+){1,3}([.-][a-zA-Z0-9.-]+)?$' then raise exception 'Use a version such as 5.11.0 or 5.11.0-beta.1';end if;
 select * into app from public.docs_projects where id=project;
 if app.id is null then raise exception 'Application not found';end if;
 clean_slug:=app.slug||'-v'||public.docs_slug(clean_version);
 insert into public.docs_pages(id,title,slug,kind,version,summary,visibility) values(new_id,app.name||' · v'||clean_version,clean_slug,'release',clean_version,description,app.visibility);
 insert into public.docs_releases(id,project_id,version) values(new_id,project,clean_version);return new_id;
end;$$;

create table public.docs_audit_log(id bigint generated always as identity primary key,user_id uuid references public.docs_members(id) on delete set null,page_id uuid,action text not null,metadata jsonb not null default '{}',created_at timestamptz not null default now());
alter table public.docs_audit_log enable row level security;
create policy audit_admin on public.docs_audit_log for select to authenticated using(public.docs_role()='admin');
grant select on public.docs_audit_log to authenticated;
grant all on public.docs_audit_log to service_role;
create function public.docs_audit_change() returns trigger language plpgsql security definer set search_path='' as $$declare action text;pid uuid;begin
 if tg_table_name='docs_members' then
  if new.role=old.role and new.active=old.active then return new;end if;
  action:='user_access_changed';pid:=null;
 elsif tg_table_name='docs_published' then action:=case when tg_op='DELETE' then 'asset_unpublished' else 'asset_published' end;pid:=case when tg_op='DELETE' then old.id else new.id end;
 else pid:=case when tg_op='DELETE' then old.id else new.id end;action:=case when tg_op='INSERT' then 'asset_created' when tg_op='DELETE' then 'asset_deleted' when new.archived_at is distinct from old.archived_at then case when new.archived_at is null then 'asset_restored' else 'asset_archived' end else 'asset_updated' end;
 end if;
 insert into public.docs_audit_log(user_id,page_id,action) values(auth.uid(),pid,action);
 if tg_op='DELETE' then return old;end if;return new;
end;$$;
create trigger docs_page_audit after insert or update or delete on public.docs_pages for each row execute function public.docs_audit_change();
create trigger docs_publish_audit after insert or update or delete on public.docs_published for each row execute function public.docs_audit_change();
create trigger docs_member_audit after update on public.docs_members for each row execute function public.docs_audit_change();
create function public.docs_track(document_id uuid,event text) returns void language plpgsql security definer set search_path='' as $$begin
 if public.docs_role() is null or not public.docs_can_read_published(document_id) then raise exception 'Document access required';end if;
 if event not in ('asset_viewed','asset_shared','external_opened') then raise exception 'Invalid event';end if;
 if exists(select 1 from public.docs_audit_log where user_id=auth.uid() and page_id=document_id and action=event and created_at>now()-interval '5 minutes') then return;end if;
 insert into public.docs_audit_log(user_id,page_id,action) values(auth.uid(),document_id,event);
end;$$;
revoke all on function public.docs_track(uuid,text) from public;grant execute on function public.docs_track(uuid,text) to authenticated;
create function public.docs_recent() returns setof public.docs_published language sql stable security definer set search_path='' as $$
 select p.* from public.docs_published p join (select page_id,max(created_at) last_view from public.docs_audit_log where user_id=auth.uid() and action='asset_viewed' group by page_id) v on v.page_id=p.id where public.docs_role() is not null and public.docs_can_read_published(p.id) order by v.last_view desc limit 10;
$$;
revoke all on function public.docs_recent() from public;grant execute on function public.docs_recent() to authenticated;

create table public.docs_notices(id uuid primary key default gen_random_uuid(),page_id uuid not null references public.docs_pages(id) on delete cascade,sender_id uuid references public.docs_members(id) on delete set null,sender_name text not null,created_at timestamptz not null default now());
create index docs_notice_page_date on public.docs_notices(page_id,created_at desc);
create table public.docs_notice_reads(notice_id uuid references public.docs_notices(id) on delete cascade,user_id uuid references public.docs_members(id) on delete cascade,read_at timestamptz not null default now(),primary key(notice_id,user_id));
alter table public.docs_notices enable row level security;alter table public.docs_notice_reads enable row level security;
create policy notice_read on public.docs_notices for select to authenticated using(public.docs_role() is not null and public.docs_can_read_published(page_id));
create policy notice_read_own on public.docs_notice_reads for select to authenticated using(user_id=auth.uid());
create policy notice_mark_own on public.docs_notice_reads for insert to authenticated with check(user_id=auth.uid() and public.docs_role() is not null and exists(select 1 from public.docs_notices where id=notice_id and public.docs_can_read_published(page_id)));
grant select on public.docs_notices to authenticated;grant select,insert on public.docs_notice_reads to authenticated;
grant all on public.docs_notices,public.docs_notice_reads to service_role;
create function public.docs_notify(document_id uuid) returns uuid language plpgsql security definer set search_path='' as $$declare p public.docs_published;result uuid;last_sent timestamptz;begin
 select * into p from public.docs_published where id=document_id;
 if p.id is null or not public.docs_can_read_published(document_id) then raise exception 'Published document access required';end if;
 if not coalesce(public.docs_role()='admin' or (public.docs_role()='manager' and public.docs_manages_team(p.team_id)),false) then raise exception 'Only the team manager or administrator can send notices';end if;
 perform pg_advisory_xact_lock(hashtextextended(document_id::text,42));
 select max(created_at) into last_sent from public.docs_notices where page_id=document_id;
 if last_sent>now()-interval '3 hours' then raise exception 'This document was announced recently. Try after %',last_sent+interval '3 hours';end if;
 insert into public.docs_notices(page_id,sender_id,sender_name) values(document_id,auth.uid(),(select name from public.docs_members where id=auth.uid())) returning id into result;
 insert into public.docs_audit_log(user_id,page_id,action,metadata) values(auth.uid(),document_id,'notice_sent',jsonb_build_object('notice_id',result));return result;
end;$$;
revoke all on function public.docs_notify(uuid) from public;grant execute on function public.docs_notify(uuid) to authenticated;
create table public.docs_push_subscriptions(id uuid primary key default gen_random_uuid(),user_id uuid not null references public.docs_members(id) on delete cascade,endpoint text not null unique,subscription jsonb not null,created_at timestamptz not null default now());
alter table public.docs_push_subscriptions enable row level security;
revoke all on public.docs_push_subscriptions from anon,authenticated;grant all on public.docs_push_subscriptions to service_role;

create extension if not exists pg_trgm with schema extensions;
create function public.docs_search(query text,result_limit integer default 30) returns table(id uuid,title text,slug text,kind text,summary text,version text,published_at timestamptz,score real) language sql stable security invoker set search_path='' as $$
 with q as(select left(trim(query),200) term), scored as(select p.*,(
 case when lower(p.title)=lower(q.term) then 30 else 0 end + case when p.title ilike q.term||'%' then 15 else 0 end +
 case when p.title ilike '%'||q.term||'%' then 10 else 0 end +
 ts_rank_cd(to_tsvector('english',p.title||' '||p.summary||' '||p.body||' '||array_to_string(p.tags,' ')||' '||coalesce(p.published_by_name,'')||' '||coalesce(p.release_snapshot::text,'')),websearch_to_tsquery('english',q.term))*8 + extensions.similarity(p.title,q.term)*3)::real rank
 from public.docs_published p cross join q where public.docs_can_read_published(p.id) and (
 p.title ilike '%'||q.term||'%' or to_tsvector('english',p.title||' '||p.summary||' '||p.body||' '||array_to_string(p.tags,' ')||' '||coalesce(p.published_by_name,'')||' '||coalesce(p.release_snapshot::text,'')) @@ websearch_to_tsquery('english',q.term)
 or extensions.word_similarity(q.term,p.title)>0.3 or not exists(select 1 from regexp_split_to_table(lower(q.term),'\s+') token where lower(p.title||' '||p.summary||' '||p.body||' '||array_to_string(p.tags,' ')) not like '%'||token||'%')))
 select s.id,s.title,s.slug,s.kind,s.summary,s.version,s.published_at,s.rank from scored s order by s.rank desc,s.published_at desc limit greatest(1,least(result_limit,50));
$$;
revoke all on function public.docs_search(text,integer) from public;grant execute on function public.docs_search(text,integer) to anon,authenticated;
create index docs_search_fulltext on public.docs_published using gin(to_tsvector('english',title||' '||summary||' '||body));
create index docs_search_title_trigram on public.docs_published using gin(title extensions.gin_trgm_ops);
commit;
