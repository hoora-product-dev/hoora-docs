begin;

-- Anonymous clients still receive an empty, successful query so the browser
-- can render the sign-in gate. They never receive a row because no anon RLS
-- policy exists on published content.
grant select on public.docs_published, public.docs_published_index to anon;

commit;
