import { serverClient } from '../server/supabase.js';

// Vercel invokes this endpoint once per day. The database remains the source
// of truth: only rows whose 30-day purge_after timestamp has elapsed can be
// removed, and the existing Storage cleanup trigger handles attachments.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'POST')
    return res.status(405).json({ error: 'Method not allowed' });
  const cronSecret = process.env.CRON_SECRET;
  const authorization = req.headers.authorization || '';
  const isScheduled = req.headers['x-vercel-cron'] === '1' || req.headers['x-vercel-cron'] === 'true';
  if (cronSecret && authorization !== `Bearer ${cronSecret}`)
    return res.status(401).json({ error: 'Unauthorized cleanup request.' });
  if (!cronSecret && !isScheduled)
    return res.status(401).json({ error: 'Scheduled cleanup only.' });
  try {
    const call = serverClient();
    const purged = await call('/rest/v1/rpc/docs_purge_expired_trash', {
      method: 'POST',
      body: '{}',
    });
    return res.status(200).json({ ok: true, purged: Number(purged || 0) });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Cleanup failed.' });
  }
}
