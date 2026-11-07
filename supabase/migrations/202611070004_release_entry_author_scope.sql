begin;

-- Contributors may edit only their own release notes. Administrators retain
-- moderation control over every contribution.
drop policy if exists entries_edit on public.docs_entries;
create policy entries_edit on public.docs_entries
  for update to authenticated
  using (public.docs_role() = 'admin' or author_id = auth.uid())
  with check (public.docs_role() = 'admin' or author_id = auth.uid());

drop policy if exists entries_delete on public.docs_entries;
create policy entries_delete on public.docs_entries
  for delete to authenticated
  using (public.docs_role() = 'admin' or author_id = auth.uid());

commit;
