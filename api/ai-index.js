import { serverClient, requireMember } from '../server/supabase.js';

export const maxDuration = 60;
const uuid = /^[a-f0-9-]{36}$/i;
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
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  try {
    const call = serverClient();
    const { member } = await requireMember(req, call);
    if (!['admin', 'manager', 'publisher'].includes(member.role))
      return res.status(403).json({ error: 'Editor access required.' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const id = String(body.documentId || '');
    if (!uuid.test(id)) return res.status(400).json({ error: 'Invalid document.' });
    const auth = { Authorization: req.headers.authorization };
    const writable = await call(`/rest/v1/docs_pages?id=eq.${id}&select=id`, { headers: auth });
    if (!writable.length) return res.status(403).json({ error: 'You cannot index this document.' });
    const rows = await call(
      `/rest/v1/docs_published?id=eq.${id}&select=id,title,body,release_snapshot,revision`,
      { headers: auth },
    );
    if (!rows.length)
      return res.status(404).json({ error: 'Publish the document before indexing.' });
    const page = rows[0];
    let chunks = [];
    if (page.release_snapshot?.entries?.length) {
      for (const entry of page.release_snapshot.entries)
        chunks.push(
          ...pieces(
            `${page.title}\n${entry.title || ''}\n${entry.body || ''}`,
            entry.vertical || 'General',
          ),
        );
    } else {
      const parts = String(page.body || '').split(/(?=^#{1,3}\s)/m);
      for (const part of parts) {
        const heading = part.match(/^#{1,3}\s+(.+)$/m)?.[1] || page.title;
        chunks.push(...pieces(`${page.title}\n${part}`, heading));
      }
    }
    chunks = chunks.filter((c) => c.content.trim().length > 20).slice(0, 30);
    if (!chunks.length) return res.status(200).json({ ok: true, chunks: 0 });
    const token = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
    if (!token) return res.status(503).json({ error: 'AI Gateway is not configured.' });
    const embed = await fetch('https://ai-gateway.vercel.sh/v1/embeddings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'openai/text-embedding-3-small',
        input: chunks.map((c) => c.content),
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (!embed.ok)
      return res.status(502).json({ error: 'AI Gateway could not index this document.' });
    const vectors = (await embed.json()).data?.sort((a, b) => a.index - b.index) || [];
    if (vectors.length !== chunks.length || vectors.some((v) => v.embedding?.length !== 1536))
      throw Error('Embedding response was incomplete.');
    await call(`/rest/v1/docs_ai_chunks?document_id=eq.${id}`, { method: 'DELETE' });
    await call('/rest/v1/docs_ai_chunks', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(
        chunks.map((chunk, i) => ({
          document_id: id,
          revision: page.revision,
          section: chunk.section,
          content: chunk.content,
          embedding: JSON.stringify(vectors[i].embedding),
        })),
      ),
    });
    return res.status(200).json({ ok: true, chunks: chunks.length });
  } catch (error) {
    return res
      .status(error.status || 500)
      .json({ error: error.message || 'Document indexing failed.' });
  }
}
