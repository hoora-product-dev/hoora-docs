begin;
alter table public.docs_folders add column slug text unique;
create function public.docs_folder_slug() returns trigger language plpgsql security definer set search_path='' as $$declare base text;candidate text;counter integer:=2;begin
 if new.slug is null or new.slug='' then
  perform pg_advisory_xact_lock(84932044);base:=coalesce(nullif(public.docs_slug(new.name),''),'folder');candidate:=base;
  while exists(select 1 from public.docs_folders where slug=candidate and id<>new.id) loop candidate:=base||'-'||counter;counter:=counter+1;end loop;
  new.slug:=candidate;
 end if;
 if new.slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then raise exception 'Use lowercase letters, numbers and hyphens in the folder slug';end if;
 return new;end;$$;
create trigger docs_folder_slug before insert or update on public.docs_folders for each row execute function public.docs_folder_slug();
update public.docs_folders set slug=null;
alter table public.docs_folders alter column slug set not null;
commit;
