import { createPublicKey, createVerify } from 'node:crypto';

/**
 * Hoora Releases, the Hoora Docs bot in Microsoft Teams. It checks that a request really
 * comes from Teams (the Bot Framework signs every one), remembers each person's one-to-one
 * chat when they add the bot, and posts release cards into those chats.
 * Settings (server only): TEAMS_BOT_ID and TEAMS_BOT_SECRET from Teams Developer Portal,
 * and MICROSOFT_TENANT_ID, the Hoora organization in Microsoft.
 */

const OPENID = 'https://login.botframework.com/v1/.well-known/openidconfiguration';
const ISSUER = 'https://api.botframework.com';
const SCOPE = 'https://api.botframework.com/.default';
// Bot Framework allows five minutes of clock difference.
const SKEW = 300;

export const botReady = () => Boolean(process.env.TEAMS_BOT_ID && process.env.TEAMS_BOT_SECRET);
const fail = (status, message) => Object.assign(new Error(message), { status });

async function getJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw fail(response.status, data?.error?.message || data?.message || 'Teams request failed.');
  return data;
}

// Bot Framework signing keys, refreshed at least once a day.
let signing = { at: 0, keys: [] };
async function signingKeys() {
  if (signing.keys.length && Date.now() - signing.at < 12 * 3600e3) return signing.keys;
  const { jwks_uri } = await getJson(OPENID);
  const { keys } = await getJson(jwks_uri);
  signing = { at: Date.now(), keys };
  return keys;
}

const decode = (part) => Buffer.from(part, 'base64url');

/**
 * Checks the Bot Framework token on a request from Teams: signed by a current Bot Framework
 * key that is endorsed for the request's channel, issued for this bot, in date, and for the
 * same service address as the request. Throws with status 401 or 403 when it is not genuine.
 */
export async function verifyTeamsRequest(authorization, activity) {
  const token = /^Bearer ([\w-]+\.[\w-]+\.[\w-]+)$/.exec(authorization || '')?.[1];
  if (!token) throw fail(401, 'Missing token.');
  const [head, body, signature] = token.split('.');
  let header, claims;
  try {
    header = JSON.parse(decode(head));
    claims = JSON.parse(decode(body));
  } catch {
    throw fail(401, 'Malformed token.');
  }
  if (header.alg !== 'RS256') throw fail(401, 'Unexpected token algorithm.');
  const key = (await signingKeys()).find((item) => item.kid === header.kid);
  if (!key) throw fail(401, 'Unknown signing key.');
  const publicKey = createPublicKey({ key: { kty: key.kty, n: key.n, e: key.e }, format: 'jwk' });
  if (!createVerify('RSA-SHA256').update(`${head}.${body}`).verify(publicKey, decode(signature)))
    throw fail(401, 'Invalid token signature.');
  const now = Date.now() / 1000;
  if (claims.iss !== ISSUER) throw fail(401, 'Unexpected token issuer.');
  if (claims.aud !== process.env.TEAMS_BOT_ID) throw fail(401, 'Token is for another bot.');
  if (!(claims.exp > now - SKEW) || (claims.nbf && claims.nbf > now + SKEW))
    throw fail(401, 'Token has expired.');
  if (!activity?.serviceUrl || claims.serviceUrl !== activity.serviceUrl)
    throw fail(401, 'Token is for another service address.');
  if (activity.channelId !== 'msteams' || !(key.endorsements || []).includes('msteams'))
    throw fail(403, 'Only Microsoft Teams is accepted.');
}

// Teams service addresses: replies only ever go to Microsoft's own hosts.
export function serviceAddress(url) {
  const address = new URL(url);
  if (
    address.protocol !== 'https:' ||
    !/(^|\.)(trafficmanager\.net|botframework\.com|teams\.microsoft\.com)$/.test(address.hostname)
  )
    throw fail(400, 'Unexpected Teams service address.');
  return address.href.replace(/\/?$/, '/');
}

// Access tokens for sending, per sign-in authority. A bot made in Teams Developer Portal signs
// in either through the Hoora organization or through Bot Framework; the one that Teams
// accepts is remembered.
const tokens = new Map();
let authorities = null;
async function accessToken(authority) {
  const cached = tokens.get(authority);
  if (cached && Date.now() < cached.until) return cached.value;
  const data = await getJson(`https://login.microsoftonline.com/${authority}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.TEAMS_BOT_ID,
      client_secret: process.env.TEAMS_BOT_SECRET,
      scope: SCOPE,
    }),
  });
  tokens.set(authority, {
    value: data.access_token,
    until: Date.now() + (data.expires_in - 300) * 1000,
  });
  return data.access_token;
}

async function connector(url, options = {}) {
  authorities ||= [process.env.MICROSOFT_TENANT_ID, 'botframework.com'].filter(Boolean);
  let lastError;
  for (const authority of [...authorities]) {
    try {
      const data = await getJson(url, {
        ...options,
        headers: {
          ...options.headers,
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await accessToken(authority)}`,
        },
      });
      authorities = [authority, ...authorities.filter((item) => item !== authority)];
      return data;
    } catch (error) {
      lastError = error;
      if (error.status !== 401) throw error;
    }
  }
  throw lastError;
}

/** Posts a message into a one-to-one chat with the bot. */
export function sendToChat(chat, activity) {
  return connector(
    `${serviceAddress(chat.service_url)}v3/conversations/${encodeURIComponent(chat.conversation_id)}/activities`,
    { method: 'POST', body: JSON.stringify(activity) },
  );
}

/** A release card as a Teams message, with the line Teams shows in its notification. */
export const cardMessage = (card, summary) => ({
  type: 'message',
  summary,
  attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: card }],
});

const added = (activity) =>
  (activity.type === 'installationUpdate' && activity.action === 'add') ||
  (activity.type === 'conversationUpdate' &&
    (activity.membersAdded || []).some((member) => member.id === activity.recipient?.id));
const removed = (activity) =>
  (activity.type === 'installationUpdate' && activity.action === 'remove') ||
  (activity.type === 'conversationUpdate' &&
    (activity.membersRemoved || []).some((member) => member.id === activity.recipient?.id));

/**
 * Handles a verified request from Teams. When someone adds Hoora Releases, it remembers
 * their one-to-one chat (with their work email, from Teams) and says hello once; when they
 * remove it, it stops sending to them. Everything else is ignored: the bot only notifies.
 */
export async function handleActivity(activity, call) {
  const tenant = activity.channelData?.tenant?.id || activity.conversation?.tenantId;
  if (!tenant || tenant !== process.env.MICROSOFT_TENANT_ID)
    throw fail(403, 'Only the Hoora organization is accepted.');
  if (activity.conversation?.conversationType !== 'personal') return 'ignored';
  const userId = activity.from?.aadObjectId;
  if (!userId || !/^[0-9a-f-]{36}$/i.test(userId)) return 'ignored';
  const filter = `user_id=eq.${encodeURIComponent(userId)}`;
  if (removed(activity)) {
    await call(`/rest/v1/docs_teams_chats?${filter}`, {
      method: 'PATCH',
      body: JSON.stringify({ removed_at: new Date().toISOString() }),
    });
    return 'removed';
  }
  if (!added(activity)) return 'ignored';
  const serviceUrl = serviceAddress(activity.serviceUrl);
  const [before] = await call(`/rest/v1/docs_teams_chats?${filter}&select=removed_at`);
  const member = await connector(
    `${serviceUrl}v3/conversations/${encodeURIComponent(activity.conversation.id)}/members/${encodeURIComponent(activity.from.id)}`,
  );
  const now = new Date().toISOString();
  const chat = {
    user_id: userId,
    email: String(member.email || member.userPrincipalName || '').toLowerCase() || null,
    name: member.name || activity.from.name || null,
    conversation_id: activity.conversation.id,
    service_url: serviceUrl,
    tenant_id: tenant,
    installed_at: now,
    removed_at: null,
    updated_at: now,
  };
  await call('/rest/v1/docs_teams_chats?on_conflict=user_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(chat),
  });
  // Teams sends two events when the bot is added; hello goes out once.
  if (!before || before.removed_at) {
    const first = String(chat.name || '').split(/\s+/)[0];
    await sendToChat(chat, {
      type: 'message',
      text: `Hi${first ? ' ' + first : ''}, I'm Hoora Releases. When a new Hoora release goes live, I'll send you a short note here with what's new and a link to the release notes.`,
    });
  }
  return 'added';
}

/** For tests: forget cached keys and tokens. */
export function resetTeamsBot() {
  signing = { at: 0, keys: [] };
  tokens.clear();
  authorities = null;
}
