begin;
create or replace function public.docs_role() returns text language sql stable security definer set search_path = '' as $$
 select role from public.docs_members
 where id=(select auth.uid()) and active
 and (auth_source<>'microsoft' or exists(
  select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr','[]'::jsonb)) as method
  where method->>'method'='oauth'
 ));
$$;
commit;
