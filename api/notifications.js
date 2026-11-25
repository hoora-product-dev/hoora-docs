import { serverClient, requireMember } from '../server/supabase.js';
import { announcement, releaseSections } from '../server/email.js';
import { releaseHighlights } from '../server/highlights.js';

// Release announcement emails, for administrators only. Hoora Docs never sends them:
// it shows the email for the administrator to copy into Outlook and send themselves.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const call = serverClient(),
      { member } = await requireMember(req, call);
    if (member.role !== 'admin')
      return res
        .status(403)
        .json({ error: 'Only administrators can prepare email announcements.' });
    const b = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    if (!/^[a-f0-9-]{36}$/i.test(b.id || '')) throw new Error('Invalid release.');
    const [page] = await call(`/rest/v1/docs_published?id=eq.${b.id}&select=*`);
    if (!page || page.kind !== 'release')
      throw new Error('Choose a published release to announce.');
    // Local previews point images and links at the local site; everything else uses production.
    const host = String(req.headers?.host || '');
    const origin = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)
      ? 'http://' + host
      : 'https://release.hoora.in';
    if (b.action !== 'preview') throw new Error('Invalid action.');
    // Short written highlights, cached per published version of the release.
    const highlights = await releaseHighlights(
      `${page.id}:${page.updated_at || page.published_at || ''}`,
      releaseSections(page),
    );
    return res.status(200).json(announcement(page, origin, highlights));
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message });
  }
}
