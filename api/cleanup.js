import { serverClient } from '../server/supabase.js';
import { cleanupDeletedFiles } from './content.js';
import { isScheduledRun } from '../server/cron.js';

// Vercel invokes this endpoint once per day: it signs out devices unused for 30
// days, keeps 7 days of activity, and removes files of deleted documents.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'POST')
    return res.status(405).json({ error: 'Method not allowed' });
  if (!isScheduledRun(req)) return res.status(401).json({ error: 'Scheduled cleanup only.' });
  try {
    const call = serverClient();
    const maintenance = await call('/rest/v1/rpc/docs_daily_maintenance', {
      method: 'POST',
      body: '{}',
    });
    let files = 0;
    try {
      files = await cleanupDeletedFiles(call);
    } catch {
      /* Remaining files are retried on the next run. */
    }
    return res.status(200).json({ ok: true, ...maintenance, files });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Cleanup failed.' });
  }
}
