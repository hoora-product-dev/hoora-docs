begin;
create or replace function public.docs_source_snapshot() returns trigger language plpgsql security definer set search_path='' as $$begin
 if tg_op='INSERT' or new.revision<>old.revision or new.published_at is distinct from old.published_at then
  select source_url,source_type,file_metadata,team_id into new.source_url,new.source_type,new.file_metadata,new.team_id from public.docs_pages where id=new.id;
 end if;
 return new;end;$$;
create or replace function public.docs_stamp_publisher() returns trigger language plpgsql security definer set search_path='' as $$begin
 if tg_op='INSERT' or new.revision<>old.revision or new.published_at is distinct from old.published_at then
  new.published_by:=auth.uid();new.published_by_name:=(select name from public.docs_members where id=auth.uid());
 end if;return new;end;$$;
commit;
