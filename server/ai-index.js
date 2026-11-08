// Knowledge index for Hoora Assist: published documents split into sections and embedded.
// Indexing and questions must use the same model and size (1536, the database column).
export const embedding = { model: 'google/gemini-embedding-001', dimensions: 1536 };
function pieces(content, section) {
  const paragraphs = String(content || '').split(/\n{2,}/),
    out = [];
  let buffer = '';
  for (const paragraph of paragraphs) {
    if ((buffer + '\n\n' + paragraph).length > 3200 && buffer) {
      out.push({ section, content: buffer });
      buffer = '';
    }
    if (paragraph.length > 3200) {
      for (let i = 0; i < paragraph.length; i += 3200)
        out.push({ section, content: paragraph.slice(i, i + 3200) });
    } else buffer += (buffer ? '\n\n' : '') + paragraph;
  }
  if (buffer.trim()) out.push({ section, content: buffer });
  return out;
}

/** Embeds one published document. Returns the number of sections stored. */
export async function indexDocument(call, page) {
  let chunks = [];
  if (page.release_snapshot?.entries?.length) {
    for (const entry of page.release_snapshot.entries)
      chunks.push(
        ...pieces(
          `${page.title}
${entry.title || ''}
${entry.body || ''}`,
          entry.vertical || 'General',
        ),
      );
  } else {
    const parts = String(page.body || '').split(/(?=^#{1,3}s)/m);
    for (const part of parts) {
      const heading = part.match(/^#{1,3}s+(.+)$/m)?.[1] || page.title;
      chunks.push(
        ...pieces(
          `${page.title}
${part}`,
          heading,
        ),
      );
    }
  }
  chunks = chunks.filter((c) => c.content.trim().length > 20).slice(0, 30);
  await call(`/rest/v1/docs_ai_chunks?document_id=eq.${page.id}`, { method: 'DELETE' });
  if (!chunks.length) return 0;
  const token = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
  if (!token) throw Object.assign(Error('AI Gateway is not configured.'), { status: 503 });
  const embed = await fetch('https://ai-gateway.vercel.sh/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...embedding,
      input: chunks.map((c) => c.content),
    }),
    signal: AbortSignal.timeout(45000),
  });
  if (!embed.ok) {
    console.error(`AI index failed (${embed.status}): ${(await embed.text()).slice(0, 300)}`);
    throw Object.assign(Error('AI Gateway could not index this document.'), {
      status: embed.status === 429 ? 429 : 502,
    });
  }
  const vectors = (await embed.json()).data?.sort((a, b) => a.index - b.index) || [];
  if (vectors.length !== chunks.length || vectors.some((v) => v.embedding?.length !== 1536))
    throw Error('Embedding response was incomplete.');
  await call('/rest/v1/docs_ai_chunks', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(
      chunks.map((chunk, i) => ({
        document_id: page.id,
        revision: page.revision,
        section: chunk.section,
        content: chunk.content,
        embedding: JSON.stringify(vectors[i].embedding),
      })),
    ),
  });
  return chunks.length;
}

/** Documents whose latest published revision is not in the index yet. */
export async function staleDocuments(call) {
  const [published, indexed] = await Promise.all([
    call(
      '/rest/v1/docs_published?select=id,title,body,release_snapshot,revision&order=published_at.desc',
    ),
    call('/rest/v1/docs_ai_chunks?select=document_id,revision'),
  ]);
  const current = new Map(indexed.map((row) => [row.document_id, row.revision]));
  return published.filter((page) => current.get(page.id) !== page.revision);
}
