begin;
create view public.docs_published_index with(security_invoker=true) as
 select id,title,slug,kind,vertical_id,summary,version,tags,revision,published_at,format,artifact_path,visibility,folder_id,project_id,custom_fields,published_by,published_by_name,team_id,source_url,source_type,file_metadata,owner_id,owner_name,updated_at,
 case when release_snapshot is null then null else jsonb_set(release_snapshot,'{entries}',coalesce((select jsonb_agg(entry-'body') from jsonb_array_elements(release_snapshot->'entries') entry),'[]'::jsonb)) end release_snapshot
 from public.docs_published;
grant select on public.docs_published_index to anon,authenticated,service_role;
commit;
