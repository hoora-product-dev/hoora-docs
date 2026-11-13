import { serverClient, requireMember } from '../server/supabase.js';
export const maxDuration = 60;
async function collect(call, prefix, depth = 0) {
  if (depth > 10) throw Error('The document has too many nested upload folders.');
  const rows = await call('/storage/v1/object/list/hoora-docs', {
    method: 'POST',
    body: JSON.stringify({ prefix, limit: 1000, offset: 0 }),
  });
  const files = [];
  for (const row of rows || []) {
    const path = prefix + '/' + row.name;
    if (row.id) files.push(path);
    else files.push(...(await collect(call, path, depth + 1)));
    if (files.length >= 1000) break;
  }
  return files.slice(0, 1000);
}
export async function cleanupDeletedFiles(call) {
  const pending = await call(
    '/rest/v1/docs_storage_cleanup?select=page_id&order=created_at&limit=25',
  );
  let cleaned = 0;
  for (const row of pending) {
    if (!/^[a-f0-9-]{36}$/i.test(row.page_id)) continue;
    // Never clean a live document even if an old queue row remains.
    if ((await call('/rest/v1/docs_pages?id=eq.' + row.page_id + '&select=id')).length) continue;
    for (let batch = 0; batch < 10; batch++) {
      const paths = await collect(call, row.page_id);
      if (!paths.length) {
        await call('/rest/v1/docs_storage_cleanup?page_id=eq.' + row.page_id, { method: 'DELETE' });
        cleaned++;
        break;
      }
      await call('/storage/v1/object/hoora-docs', {
        method: 'DELETE',
        body: JSON.stringify({ prefixes: paths }),
      });
    }
  }
  return cleaned;
}
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const call = serverClient(),
      { member } = await requireMember(req, call);
    if (req.method === 'GET') {
      if (member.role !== 'admin')
        return res.status(403).json({ error: 'Administrator access required.' });
      const rows = await call('/rest/v1/docs_storage_cleanup?select=page_id');
      return res.status(200).json({ pending: rows.length });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    if (!['delete', 'delete-project'].includes(body.action))
      return res.status(400).json({ error: 'Invalid content action.' });
    if (body.action === 'delete-project' && member.role !== 'admin')
      return res.status(403).json({ error: 'Administrator access required.' });
    if (!/^[a-f0-9-]{36}$/i.test(body.id || ''))
      return res.status(400).json({ error: 'Invalid document.' });
    // Deletes are permanent. Row-level security allows them only with Manage access,
    // and the database queues the document's files for removal below.
    if (body.action === 'delete-project')
      await call('/rest/v1/rpc/docs_delete_project', {
        method: 'POST',
        headers: { Authorization: req.headers.authorization },
        body: JSON.stringify({ project: body.id }),
      });
    else {
      const removed = await call('/rest/v1/docs_pages?id=eq.' + body.id + '&select=id', {
        method: 'DELETE',
        headers: { Authorization: req.headers.authorization, Prefer: 'return=representation' },
      });
      if (!removed?.length)
        return res
          .status(403)
          .json({ error: 'Manage access is required to delete this document.' });
    }
    let cleaned = 0;
    try {
      cleaned = await cleanupDeletedFiles(call);
    } catch {
      return res.status(200).json({ ok: true, cleanupPending: true });
    }
    const remaining = await call('/rest/v1/docs_storage_cleanup?select=page_id&limit=1');
    return res.status(200).json({ ok: true, cleaned, cleanupPending: remaining.length > 0 });
  } catch (error) {
    return res
      .status(error.status || 400)
      .json({ error: error.message || 'Content could not be updated.' });
  }
}
