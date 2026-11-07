import { serverClient } from '../server/supabase.js';
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const call = serverClient();
    if (!req.headers.authorization?.startsWith('Bearer ')) throw new Error('Sign in first.');
    const user = await call('/auth/v1/user', {
      headers: { Authorization: req.headers.authorization },
    });
    const [member] = await call(`/rest/v1/docs_members?id=eq.${user.id}&select=*`);
    if (!member?.active) throw new Error('Active team membership is required.');
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    if (
      typeof body.password !== 'string' ||
      body.password.length < 12 ||
      body.password.length > 128 ||
      body.password !== body.confirmPassword
    )
      throw new Error('Enter matching passwords between 12 and 128 characters.');
    if (member.auth_source === 'microsoft' && !member.password_setup_complete) {
      const claims = JSON.parse(
        Buffer.from(req.headers.authorization.slice(7).split('.')[1], 'base64url').toString(),
      );
      if (!member.microsoft_subject || !claims.amr?.some((x) => x.method === 'oauth'))
        throw new Error('Verify your Microsoft account before creating your Hoora Docs password.');
    }
    // Supabase verifies the session. Never store plaintext passwords in profiles.
    await call('/auth/v1/user', {
      method: 'PUT',
      headers: { Authorization: req.headers.authorization },
      body: JSON.stringify({ password: body.password }),
    });
    await call(`/rest/v1/docs_members?id=eq.${user.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ password_setup_complete: true }),
    });
    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message });
  }
}
