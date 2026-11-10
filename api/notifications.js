import { serverClient, requireMember } from '../server/supabase.js';
import { announcement, releaseSections } from '../server/email.js';
import { releaseHighlights } from '../server/highlights.js';

// Release announcement emails, for administrators only. Hoora Docs never sends them:
// it shows the email, and can place it as a draft in the administrator's own Outlook
// so they choose the recipients and press Send themselves.
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
    if (b.action !== 'preview' && b.action !== 'draft') throw new Error('Invalid action.');
    // Short written highlights, cached per published version of the release.
    const highlights = await releaseHighlights(
      `${page.id}:${page.updated_at || page.published_at || ''}`,
      releaseSections(page),
    );
    const email = announcement(page, origin, highlights);
    if (b.action === 'preview') return res.status(200).json(email);

    if (typeof b.providerToken !== 'string' || b.providerToken.length > 20000)
      throw new Error('Connect Outlook to open this email there.');
    const graphHeaders = { Authorization: 'Bearer ' + b.providerToken };
    const identityResponse = await fetch('https://graph.microsoft.com/oidc/userinfo', {
      headers: graphHeaders,
      signal: AbortSignal.timeout(10000),
    });
    const graphIdentity = await identityResponse.json().catch(() => ({}));
    if (
      !identityResponse.ok ||
      !member.microsoft_subject ||
      graphIdentity.sub !== member.microsoft_subject
    )
      throw new Error('Connect the same Microsoft account you use for Hoora Docs.');
    let claims = {};
    try {
      claims = JSON.parse(Buffer.from(b.providerToken.split('.')[1], 'base64url').toString());
    } catch {}
    if (
      claims.tid !== process.env.MICROSOFT_TENANT_ID ||
      !claims.scp?.split(' ').includes('Mail.ReadWrite')
    )
      throw new Error('Outlook permission has not been granted. Connect Outlook again.');
    // A draft with no recipients: it opens in Outlook, where the administrator adds the
    // contact list and sends it from their own mailbox.
    const draft = await fetch('https://graph.microsoft.com/v1.0/me/messages', {
      method: 'POST',
      headers: { ...graphHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject: email.subject,
        body: { contentType: 'HTML', content: email.html },
      }),
      signal: AbortSignal.timeout(15000),
    });
    const created = await draft.json().catch(() => null);
    if (!draft.ok || !created?.id)
      throw new Error(created?.error?.message || 'Outlook could not create the draft.');
    await call('/rest/v1/docs_audit_log', {
      method: 'POST',
      body: JSON.stringify({
        user_id: member.id,
        page_id: page.id,
        action: 'announcement_drafted',
        metadata: {},
      }),
    }).catch(() => {});
    return res.status(200).json({ ok: true, webLink: created.webLink || '' });
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message });
  }
}
