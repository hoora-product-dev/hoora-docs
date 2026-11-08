import webpush from 'web-push';
import { serverClient, requireMember } from '../server/supabase.js';
import { publishedPath } from '../server/links.js';
export const maxDuration = 60;
export function validSubscription(value) {
  try {
    const url = new URL(value?.endpoint);
    const host = url.hostname;
    const allowed =
      ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'].includes(
        host,
      ) ||
      host.endsWith('.notify.windows.com') ||
      host.endsWith('.push.apple.com');
    return (
      url.protocol === 'https:' &&
      !url.port &&
      !url.username &&
      !url.password &&
      allowed &&
      value.endpoint.length < 3000 &&
      JSON.stringify(value).length < 5000 &&
      /^[A-Za-z0-9_-]{80,100}$/.test(value.keys?.p256dh || '') &&
      /^[A-Za-z0-9_-]{16,32}$/.test(value.keys?.auth || '')
    );
  } catch {
    return false;
  }
}
export function pushMessage(page) {
  const snapshot = page?.release_snapshot || {};
  const release = page?.kind === 'release' && snapshot.project;
  if (release) {
    const platform = String(snapshot.project).trim().slice(0, 48);
    const rawVersion = String(page.version || snapshot.version || '')
      .replace(/^v/i, '')
      .trim();
    const title = rawVersion
      ? `${platform} v${rawVersion} released`
      : `${platform} update published`;
    const sections = [
      ...new Set(
        (snapshot.entries || [])
          .map((entry) => String(entry.vertical || '').trim())
          .filter(Boolean),
      ),
    ];
    const body = sections.length
      ? `Updates: ${sections.join(', ')}. Open to see what changed.`
      : 'A new version is live. Open to see what changed.';
    return { title: title.slice(0, 80), body: body.slice(0, 160) };
  }
  const title = page?.title ? `New in Hoora Docs: ${page.title}` : 'New Hoora Docs update';
  return {
    title: title.slice(0, 80),
    body: String(page?.summary || 'Open Hoora Docs to read the latest update.').slice(0, 160),
  };
}
const devicePlatforms = ['android', 'ios', 'windows', 'macos', 'linux', 'other'];
const activeDays = 30;
/** Installs and notification devices that opened Hoora Docs in the last 30 days. */
export function deviceStats(installs, subscriptions, now = Date.now()) {
  const since = now - activeDays * 86400000;
  const summary = (rows) => {
    const active = rows.filter((row) => Date.parse(row.last_seen_at) >= since);
    return {
      active: active.length,
      people: new Set(active.map((row) => row.user_id)).size,
      total: rows.length,
    };
  };
  return { activeDays, installs: summary(installs), notifications: summary(subscriptions) };
}
async function vapid(call) {
  const config =
    process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
      ? { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY }
      : (await call('/rest/v1/docs_system_config?key=eq.push_vapid&select=value'))[0]?.value;
  return config;
}
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const call = serverClient(),
      { member } = await requireMember(req, call);
    const keys = await vapid(call);
    if (req.method === 'GET' && req.query?.stats) {
      if (member.role !== 'admin')
        return res.status(403).json({ error: 'Administrator access required.' });
      const [installs, subscriptions] = await Promise.all([
        call('/rest/v1/docs_app_installs?select=user_id,last_seen_at'),
        call('/rest/v1/docs_push_subscriptions?select=user_id,last_seen_at'),
      ]);
      return res.status(200).json(deviceStats(installs, subscriptions));
    }
    if (req.method === 'GET') return res.status(200).json({ publicKey: keys?.publicKey || null });
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const b = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    if (b.action === 'device') {
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          b.deviceId || '',
        )
      )
        return res.status(400).json({ error: 'This device could not be identified.' });
      await call('/rest/v1/docs_app_installs?on_conflict=device_id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({
          device_id: b.deviceId.toLowerCase(),
          user_id: member.id,
          platform: devicePlatforms.includes(b.platform) ? b.platform : 'other',
          last_seen_at: new Date().toISOString(),
        }),
      });
      return res.status(200).json({ ok: true });
    }
    if (b.action === 'subscribe') {
      if (!validSubscription(b.subscription))
        return res.status(400).json({ error: 'This browser subscription is invalid.' });
      // The endpoint belongs to a browser, which may have switched accounts. Replace its owner.
      await call('/rest/v1/docs_push_subscriptions?on_conflict=endpoint', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({
          user_id: member.id,
          endpoint: b.subscription.endpoint,
          subscription: b.subscription,
          last_seen_at: new Date().toISOString(),
        }),
      });
      return res.status(200).json({ ok: true });
    }
    if (b.action === 'unsubscribe') {
      await call(
        '/rest/v1/docs_push_subscriptions?user_id=eq.' +
          member.id +
          '&endpoint=eq.' +
          encodeURIComponent(String(b.endpoint || '')),
        { method: 'DELETE' },
      );
      return res.status(200).json({ ok: true });
    }
    if (b.action !== 'notify' || !/^[a-f0-9-]{36}$/i.test(b.id || ''))
      return res.status(400).json({ error: 'Invalid notice request.' });
    // docs_notify decides: administrators and the managers of the document's team.
    const notice = await call('/rest/v1/rpc/docs_notify', {
      method: 'POST',
      headers: { Authorization: req.headers.authorization },
      body: JSON.stringify({ document_id: b.id }),
    });
    let delivered = 0,
      failed = 0,
      removed = 0;
    const reached = new Set();
    if (keys) {
      webpush.setVapidDetails('mailto:rahul@hoora.me', keys.publicKey, keys.privateKey);
      const subscriptions = await call('/rest/v1/docs_push_subscriptions?select=*');
      const active = new Set(
        (
          await call(
            '/rest/v1/docs_members?active=eq.true&password_setup_complete=eq.true&select=id',
          )
        ).map((m) => m.id),
      );
      const [page] = await call(
        '/rest/v1/docs_published?id=eq.' +
          b.id +
          '&select=slug,title,summary,kind,version,release_snapshot',
      );
      const message = pushMessage(page);
      for (let start = 0; start < subscriptions.length; start += 10) {
        await Promise.all(
          subscriptions.slice(start, start + 10).map(async (sub) => {
            if (!active.has(sub.user_id)) return;
            const allowed = await call('/rest/v1/rpc/docs_can_read_published_for', {
              method: 'POST',
              body: JSON.stringify({ document_id: b.id, viewer_id: sub.user_id }),
            });
            if (!allowed) return;
            try {
              await webpush.sendNotification(
                sub.subscription,
                JSON.stringify({ ...message, url: publishedPath(page), tag: notice }),
                { TTL: 3600, timeout: 5000 },
              );
              delivered++;
              reached.add(sub.user_id);
            } catch (error) {
              failed++;
              if ([404, 410].includes(error.statusCode)) {
                removed++;
                await call('/rest/v1/docs_push_subscriptions?id=eq.' + sub.id, {
                  method: 'DELETE',
                });
              }
            }
          }),
        );
      }
    }
    return res
      .status(200)
      .json({ ok: true, notice, delivered, people: reached.size, failed, removed });
  } catch (error) {
    return res
      .status(error.status || 400)
      .json({ error: error.message || 'Unable to complete this action.' });
  }
}
