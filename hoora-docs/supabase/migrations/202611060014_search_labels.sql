begin;
create or replace function public.docs_search_stamp() returns trigger language plpgsql security definer set search_path='' as $$declare labels text;begin
 select coalesce((select name from public.docs_teams where id=new.team_id),'')||' '||coalesce((select name from public.docs_types where key=new.kind),'')||' '||coalesce((select name from public.docs_projects where id=new.project_id),'')||' '||coalesce((select name from public.docs_verticals where id=new.vertical_id),'') into labels;
 new.search_vector:=setweight(to_tsvector('english',new.title),'A')||setweight(to_tsvector('english',new.summary||' '||array_to_string(new.tags,' ')||' '||coalesce(new.owner_name,'')||' '||coalesce(new.published_by_name,'')||' '||labels),'B')||setweight(to_tsvector('english',new.body||' '||coalesce(new.release_snapshot::text,'')),'C');return new;end;$$;
update public.docs_published set search_vector=search_vector;
commit;
