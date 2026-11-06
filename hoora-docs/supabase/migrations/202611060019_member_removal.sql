begin;
alter table public.docs_teams drop constraint docs_teams_manager_id_fkey;
alter table public.docs_teams alter column manager_id drop not null;
alter table public.docs_teams add constraint docs_teams_manager_id_fkey foreign key(manager_id) references public.docs_members(id) on delete set null;
alter table public.docs_team_members drop constraint docs_team_members_added_by_fkey;
alter table public.docs_team_members add constraint docs_team_members_added_by_fkey foreign key(added_by) references public.docs_members(id) on delete set null;
create or replace function public.docs_track_revision() returns trigger language plpgsql security definer set search_path='' as $$begin
 if tg_op='UPDATE' then
  new.revision:=old.revision+1;
  if not (new.created_by is null and not exists(select 1 from auth.users where id=old.created_by)) then new.created_by:=old.created_by;end if;
  new.created_at:=old.created_at;
 end if;new.updated_at:=now();new.updated_by:=auth.uid();return new;
end;$$;
create or replace function public.docs_stamp_entry() returns trigger language plpgsql security definer set search_path='' as $$begin
 if tg_op='INSERT' then new.author_id:=auth.uid();new.author_name:=(select name from public.docs_members where id=auth.uid());new.revision:=1;
 else
  if not (new.author_id is null and not exists(select 1 from auth.users where id=old.author_id)) then new.author_id:=old.author_id;end if;
  new.author_name:=old.author_name;new.created_at:=old.created_at;new.release_id:=old.release_id;new.revision:=old.revision+1;
 end if;
 new.updated_by:=auth.uid();new.updated_name:=coalesce((select name from public.docs_members where id=auth.uid()),new.author_name);new.updated_at:=now();return new;
end;$$;
commit;
