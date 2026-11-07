begin;
create or replace function public.docs_publish(page_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare snapshot jsonb; content text;
begin
 if coalesce(public.docs_role(),'') not in ('admin','publisher') then raise exception 'Publisher access required';end if;
 perform 1 from public.docs_pages where id=page_id for update;
 if not found then raise exception 'Document not found';end if;
 if exists(select 1 from public.docs_pages where id=page_id and format='html' and artifact_path is null) then raise exception 'Upload an HTML file before publishing';end if;
 if exists(select 1 from public.docs_releases where id=page_id) then
  select jsonb_build_object('project',p.name,'version',r.version,'entries',coalesce((select jsonb_agg(jsonb_build_object('id',n.id,'vertical',v.name,'vertical_id',v.id,'title',n.title,'body',n.body,'tickets',n.tickets,'author',n.author_name,'edited_by',n.updated_name,'updated_at',n.updated_at) order by v.name,n.created_at) from public.docs_entries n join public.docs_verticals v on v.id=n.vertical_id where n.release_id=r.id and n.submitted),'[]'::jsonb)) into snapshot from public.docs_releases r join public.docs_projects p on p.id=r.project_id where r.id=page_id;
  if jsonb_array_length(snapshot->'entries')=0 then raise exception 'Submit at least one contribution before publishing';end if;
  select string_agg('## '||(n->>'vertical')||E'\n\n### '||(n->>'title')||E'\n\n'||(n->>'body')||E'\n\nAdded by '||(n->>'author'),E'\n\n' order by n->>'vertical') into content from jsonb_array_elements(snapshot->'entries') n;
 end if;
 insert into public.docs_published(id,title,slug,kind,vertical_id,body,summary,version,tags,revision,format,artifact_path,release_snapshot)
 select id,title,slug,kind,vertical_id,coalesce(content,body),summary,version,tags,revision,format,artifact_path,snapshot from public.docs_pages where id=page_id
 on conflict(id) do update set title=excluded.title,slug=excluded.slug,kind=excluded.kind,vertical_id=excluded.vertical_id,body=excluded.body,summary=excluded.summary,version=excluded.version,tags=excluded.tags,revision=excluded.revision,format=excluded.format,artifact_path=excluded.artifact_path,release_snapshot=excluded.release_snapshot,published_at=now();
end; $$;
update public.docs_published p set release_snapshot=jsonb_set(p.release_snapshot,'{entries}',(select jsonb_agg(n || jsonb_build_object('vertical_id',v.id)) from jsonb_array_elements(p.release_snapshot->'entries') n left join public.docs_verticals v on v.name=n->>'vertical')) where release_snapshot is not null;
commit;
