import { serverClient, requireMember } from '../server/supabase.js';
import { indexDocument, staleDocuments } from '../server/ai-index.js';

export const maxDuration = 60;
const uuid = /^[a-f0-9-]{36}$/i;

// POST: index one document right after it is published.
// GET: the daily job indexes every document whose latest revision is missing.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const call = serverClient();
    if (req.method === 'GET') {
      const cronSecret = process.env.CRON_SECRET;
      const scheduled =
        req.headers['x-vercel-cron'] === '1' || req.headers['x-vercel-cron'] === 'true';
      if (cronSecret ? req.headers.authorization !== `Bearer ${cronSecret}` : !scheduled)
        return res.status(401).json({ error: 'Scheduled indexing only.' });
      const started = Date.now();
      let indexed = 0;
      // The free AI Gateway tier allows 5 embedding requests a minute: pace them and
      // leave the rest for the next run. New documents are indexed when published.
      for (const page of await staleDocuments(call)) {
        if (Date.now() - started > 40000) break;
        if (indexed) await new Promise((resolve) => setTimeout(resolve, 13000));
        try {
          await indexDocument(call, page);
        } catch (error) {
          if (error.status === 429) break;
          throw error;
        }
        indexed++;
      }
      return res.status(200).json({ ok: true, indexed });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
    // Anyone who can edit the document (team editors and publishers included) may index it.
    await requireMember(req, call);
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
    return res.status(200).json({ ok: true, chunks: await indexDocument(call, rows[0]) });
  } catch (error) {
    return res
      .status(error.status || 500)
      .json({ error: error.message || 'Document indexing failed.' });
  }
}
