begin;
create extension if not exists vector with schema extensions;
create table public.docs_ai_chunks(
 id bigint generated always as identity primary key,
 document_id uuid not null references public.docs_published(id) on delete cascade,
 revision integer not null,
 section text not null default '',
 content text not null,
 embedding extensions.vector(1536) not null,
 created_at timestamptz not null default now()
);
create index docs_ai_chunks_document_idx on public.docs_ai_chunks(document_id,revision);
alter table public.docs_ai_chunks enable row level security;
create policy docs_ai_chunks_read on public.docs_ai_chunks for select to anon,authenticated
 using(public.docs_can_read_published(document_id));
revoke all on public.docs_ai_chunks from anon,authenticated;
grant select on public.docs_ai_chunks to anon,authenticated;
grant usage,select on sequence public.docs_ai_chunks_id_seq to service_role;
create function public.docs_ai_match(query_embedding extensions.vector(1536),match_count integer default 8)
returns table(document_id uuid,section text,content text,similarity real)
language sql stable security invoker set search_path='' as $$
 select c.document_id,c.section,c.content,(1-(c.embedding OPERATOR(extensions.<=>) query_embedding))::real similarity
 from public.docs_ai_chunks c join public.docs_published p on p.id=c.document_id and p.revision=c.revision
 where public.docs_can_read_published(c.document_id)
 order by c.embedding OPERATOR(extensions.<=>) query_embedding limit greatest(1,least(match_count,12));
$$;
revoke all on function public.docs_ai_match(extensions.vector,integer) from public;
grant execute on function public.docs_ai_match(extensions.vector,integer) to anon,authenticated;
commit;
