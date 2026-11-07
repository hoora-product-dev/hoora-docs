begin;
alter table public.docs_published add column owner_id uuid references public.docs_members(id) on delete set null;
alter table public.docs_published add column owner_name text;
alter table public.docs_published add column updated_at timestamptz;
create or replace function public.docs_source_snapshot() returns trigger language plpgsql security definer set search_path='' as $$begin
 if tg_op='INSERT' or new.revision<>old.revision or new.published_at is distinct from old.published_at then
  select p.source_url,p.source_type,p.file_metadata,p.team_id,p.created_by,m.name,p.updated_at into new.source_url,new.source_type,new.file_metadata,new.team_id,new.owner_id,new.owner_name,new.updated_at from public.docs_pages p left join public.docs_members m on m.id=p.created_by where p.id=new.id;
 end if;return new;end;$$;
update public.docs_published p set owner_id=d.created_by,owner_name=m.name,updated_at=d.updated_at from public.docs_pages d left join public.docs_members m on m.id=d.created_by where d.id=p.id;
-- Indexed search data is updated only when the public snapshot changes.
alter table public.docs_published add column search_vector tsvector;
create function public.docs_search_stamp() returns trigger language plpgsql set search_path='' as $$begin
 new.search_vector:=setweight(to_tsvector('english',new.title),'A')||setweight(to_tsvector('english',new.summary||' '||array_to_string(new.tags,' ')||' '||coalesce(new.owner_name,'')||' '||coalesce(new.published_by_name,'')),'B')||setweight(to_tsvector('english',new.body||' '||coalesce(new.release_snapshot::text,'')),'C');return new;end;$$;
create trigger docs_search_stamp before insert or update on public.docs_published for each row execute function public.docs_search_stamp();
update public.docs_published set search_vector=to_tsvector('english',title||' '||summary||' '||body||' '||array_to_string(tags,' ')||' '||coalesce(owner_name,'')||' '||coalesce(release_snapshot::text,''));
create index docs_search_vector on public.docs_published using gin(search_vector);
drop index public.docs_search_fulltext;
create or replace function public.docs_search(query text,result_limit integer default 30) returns table(id uuid,title text,slug text,kind text,summary text,version text,published_at timestamptz,score real) language sql stable security invoker set search_path='' as $$
 with q as(select left(trim(query),200) term), parsed as(select term,websearch_to_tsquery('english',term) full_query,to_tsquery('english',coalesce(nullif((select string_agg(token||':*',' & ') from regexp_split_to_table(regexp_replace(lower(term),'[^a-z0-9 ]',' ','g'),'\s+') token where token<>''),''),'nonmatchingterm')) prefix_query from q),scored as(select p.*,(
 case when lower(p.title)=lower(q.term) then 30 else 0 end + case when p.title ilike q.term||'%' then 15 else 0 end +case when p.title ilike '%'||q.term||'%' then 10 else 0 end + ts_rank_cd(p.search_vector,q.full_query)*8 +ts_rank_cd(p.search_vector,q.prefix_query)*4+extensions.similarity(p.title,q.term)*3)::real rank from public.docs_published p cross join parsed q where public.docs_can_read_published(p.id) and (p.title ilike '%'||q.term||'%' or p.search_vector@@q.full_query or p.search_vector@@q.prefix_query or extensions.word_similarity(q.term,p.title)>0.3))
 select s.id,s.title,s.slug,s.kind,s.summary,s.version,s.published_at,s.rank from scored s order by s.rank desc,s.published_at desc limit greatest(1,least(result_limit,100));
$$;
create function public.docs_popular() returns table(page_id uuid,views bigint) language sql stable security definer set search_path='' as $$
 select a.page_id,count(*) from public.docs_audit_log a where public.docs_role() is not null and a.action='asset_viewed' and a.created_at>now()-interval '30 days' and public.docs_can_read_published(a.page_id) group by a.page_id having count(distinct a.user_id)>=2 order by count(*) desc limit 5;
$$;
revoke all on function public.docs_popular() from public;grant execute on function public.docs_popular() to authenticated;
-- Existing machine-generated release slugs become readable; the old links are retained.
do $$declare r record;candidate text;begin
 for r in select p.id,a.slug app_slug,p.version from public.docs_pages p join public.docs_releases rel on rel.id=p.id join public.docs_projects a on a.id=rel.project_id where p.slug ~ '-[a-f0-9]{8}$' loop
  candidate:=r.app_slug||'-v'||public.docs_slug(regexp_replace(r.version,'^[vV](?=[0-9])',''));
  if not exists(select 1 from public.docs_pages where slug=candidate and id<>r.id) then update public.docs_pages set slug=candidate where id=r.id;update public.docs_published set slug=candidate where id=r.id;end if;
 end loop;
end;$$;
commit;
