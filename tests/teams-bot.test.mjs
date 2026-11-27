import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import notifications from '../api/notifications.js';
import { resetTeamsBot, serviceAddress } from '../server/teams-bot.js';

const BOT = '11111111-2222-3333-4444-555555555555';
const TENANT = 'e990c26c-1489-4803-b7f2-dc1cf4cac0bf';
const SERVICE = 'https://smba.trafficmanager.net/in/';
const USER = 'aea09af3-9678-4612-b7f1-d817c46eb0de';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', endorsements: ['msteams'] };

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
function token(claims = {}, { kid = 'k1', key = privateKey } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'RS256', typ: 'JWT', kid });
  const body = b64({
    iss: 'https://api.botframework.com',
    aud: BOT,
    exp: now + 3600,
    nbf: now - 10,
    serviceUrl: SERVICE,
    ...claims,
  });
  const signature = createSign('RSA-SHA256').update(`${head}.${body}`).sign(key, 'base64url');
  return `Bearer ${head}.${body}.${signature}`;
}

const install = (extra = {}) => ({
  type: 'installationUpdate',
  action: 'add',
  channelId: 'msteams',
  serviceUrl: SERVICE,
  from: { id: '29:rahul', aadObjectId: USER, name: 'Rahul Tripathi' },
  recipient: { id: '28:' + BOT, name: 'Hoora Releases' },
  conversation: { id: 'a:chat-rahul', conversationType: 'personal', tenantId: TENANT },
  channelData: { tenant: { id: TENANT } },
  ...extra,
});

// A fake Microsoft and Supabase: Bot Framework keys, sign-in tokens, Teams member details
// and messages, and the docs_teams_chats table.
function world({
  chats = [],
  role = 'admin',
  release = {},
  members = [],
  claim = { ok: true },
  testClaim = { ok: true, id: 't1', used: 1 },
  allowed = true,
  teamsDown = false,
} = {}) {
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'server';
  process.env.TEAMS_BOT_ID = BOT;
  process.env.TEAMS_BOT_SECRET = 'secret';
  process.env.MICROSOFT_TENANT_ID = TENANT;
  delete process.env.TEAMS_WORKFLOW_URL;
  delete process.env.TEAMS_DELIVERY;
  resetTeamsBot();
  const log = {
    messages: [],
    writes: [],
    tokens: [],
    lookups: [],
    claims: [],
    sends: [],
    tests: [],
    deleted: [],
  };
  globalThis.fetch = async (url, options = {}) => {
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
    if (url === 'https://login.botframework.com/v1/.well-known/openidconfiguration')
      return json({ jwks_uri: 'https://login.botframework.com/v1/.well-known/keys' });
    if (url === 'https://login.botframework.com/v1/.well-known/keys') return json({ keys: [jwk] });
    if (url.startsWith('https://login.microsoftonline.com/')) {
      log.tokens.push(url);
      return json({ access_token: 'bot-token', expires_in: 3600 });
    }
    if (url.startsWith(SERVICE)) {
      assert.equal(options.headers.Authorization, 'Bearer bot-token');
      if (url.includes('/members/'))
        return json({ id: '29:rahul', name: 'Rahul Tripathi', email: 'Rahul@hoora.me' });
      if (teamsDown) return json({ error: { message: 'Teams is down' } }, 502);
      log.messages.push({ url, body: JSON.parse(options.body) });
      return json({ id: 'm1' });
    }
    if (url.endsWith('/auth/v1/user')) return json({ id: 'member' });
    if (url.includes('/docs_members?id=eq.member'))
      return json([
        {
          id: 'member',
          name: 'Rahul  Tripathi',
          email: 'Rahul@hoora.me',
          active: true,
          role,
          password_setup_complete: true,
        },
      ]);
    if (url.includes('/docs_members')) {
      log.lookups.push(decodeURIComponent(url));
      return json(
        members.filter(
          (member) =>
            decodeURIComponent(url).includes(`id=eq.${member.id}&`) ||
            decodeURIComponent(url).includes(`"${member.name}"`),
        ),
      );
    }
    if (url.includes('/docs_published'))
      return json([
        {
          id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          slug: 'release',
          kind: 'release',
          version: '5.13.0',
          published_at: '2026-11-25',
          release_snapshot: {
            project: 'Customer App',
            entries: [{ vertical: 'Auto Care', body: '### 1. Change one' }],
          },
          ...release,
        },
      ]);
    if (url.includes('/rpc/docs_can_send_teams')) return json(allowed);
    if (url.includes('/rpc/docs_teams_test_claim')) {
      log.tests.push(JSON.parse(options.body));
      return json(testClaim);
    }
    if (url.includes('/docs_teams_tests')) {
      if (options.method === 'DELETE') {
        log.deleted.push(url);
        return new Response(null, { status: 204 });
      }
      return json([]);
    }
    if (url.includes('/rpc/docs_teams_claim')) {
      log.claims.push(JSON.parse(options.body));
      return json(claim);
    }
    if (url.includes('/docs_teams_sends')) {
      if (options.method === 'PATCH') {
        log.sends.push(JSON.parse(options.body));
        return new Response(null, { status: 204 });
      }
      return json([]);
    }
    if (url.includes('/docs_teams_chats')) {
      if (options.method === 'POST' || options.method === 'PATCH') {
        log.writes.push({ url, method: options.method, body: JSON.parse(options.body) });
        return new Response('', { status: 201 });
      }
      return json(chats);
    }
    throw new Error('Unexpected request ' + url);
  };
  return log;
}

function response() {
  return {
    setHeader() {},
    status(n) {
      this.code = n;
      return this;
    },
    json(d) {
      this.data = d;
    },
  };
}
async function fromTeams(activity, authorization = token()) {
  const res = response();
  // Teams calls /api/teams, which vercel.json routes to the notifications function.
  await notifications(
    { method: 'POST', query: { source: 'teams' }, headers: { authorization }, body: activity },
    res,
  );
  return res;
}

test('Adding Hoora Releases remembers the chat with the work email and says hello once', async () => {
  const original = fetch;
  try {
    const log = world();
    const res = await fromTeams(install());
    assert.equal(res.code, 200);
    assert.equal(res.data.result, 'added');
    assert.equal(log.writes.length, 1);
    assert.match(log.writes[0].url, /docs_teams_chats\?on_conflict=user_id$/);
    assert.deepEqual(
      {
        ...log.writes[0].body,
        installed_at: undefined,
        updated_at: undefined,
      },
      {
        user_id: USER,
        email: 'rahul@hoora.me',
        name: 'Rahul Tripathi',
        conversation_id: 'a:chat-rahul',
        service_url: SERVICE,
        tenant_id: TENANT,
        installed_at: undefined,
        removed_at: null,
        updated_at: undefined,
      },
    );
    assert.equal(log.messages.length, 1);
    assert.equal(log.messages[0].url, SERVICE + 'v3/conversations/a%3Achat-rahul/activities');
    assert.match(log.messages[0].body.text, /^Hi Rahul, I'm Hoora Releases\./);
    // The bot signs in through the Hoora organization first.
    assert.match(log.tokens[0], new RegExp(`/${TENANT}/oauth2/v2.0/token$`));

    // Teams also sends conversationUpdate for the same install: no second hello.
    const again = world({ chats: [{ removed_at: null }] });
    await fromTeams(
      install({
        type: 'conversationUpdate',
        action: undefined,
        membersAdded: [{ id: '28:' + BOT }],
      }),
    );
    assert.equal(again.writes.length, 1);
    assert.equal(again.messages.length, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test('Removing the bot stops messages to that person', async () => {
  const original = fetch;
  try {
    const log = world();
    const res = await fromTeams(install({ action: 'remove' }));
    assert.equal(res.data.result, 'removed');
    assert.equal(log.writes[0].method, 'PATCH');
    assert.match(log.writes[0].url, new RegExp(`user_id=eq.${USER}$`));
    assert.ok(log.writes[0].body.removed_at);
  } finally {
    globalThis.fetch = original;
  }
});

test('Only genuine Teams requests for this bot, from Hoora, are accepted', async () => {
  const original = fetch;
  const { privateKey: stranger } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  try {
    const cases = [
      ['no token', install(), '', 401],
      ['another bot', install(), token({ aud: 'someone-else' }), 401],
      ['another issuer', install(), token({ iss: 'https://evil.example' }), 401],
      ['expired', install(), token({ exp: Math.floor(Date.now() / 1000) - 600 }), 401],
      ['forged signature', install(), token({}, { key: stranger }), 401],
      ['unknown key', install(), token({}, { kid: 'k9' }), 401],
      ['other service address', install({ serviceUrl: 'https://evil.example/' }), token(), 401],
      ['other channel', install({ channelId: 'webchat' }), token(), 403],
      [
        'other organization',
        install({ channelData: { tenant: { id: 'other' } }, conversation: { id: 'x' } }),
        token(),
        403,
      ],
    ];
    for (const [name, activity, authorization, status] of cases) {
      const log = world();
      const res = await fromTeams(activity, authorization);
      assert.equal(res.code, status, name);
      assert.equal(log.writes.length + log.messages.length, 0, name);
    }
  } finally {
    globalThis.fetch = original;
  }
});

test('Replies only go to Microsoft Teams service addresses', () => {
  assert.equal(
    serviceAddress('https://smba.trafficmanager.net/in'),
    SERVICE.replace('/in/', '/in/'),
  );
  for (const bad of [
    'http://smba.trafficmanager.net/in/',
    'https://evil.example/',
    'https://trafficmanager.net.evil.io/',
  ])
    assert.throws(() => serviceAddress(bad), /Unexpected Teams service address/);
});

async function send(action = 'teams-send') {
  const res = response();
  await notifications(
    {
      method: 'POST',
      headers: { authorization: 'Bearer s' },
      body: { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', action },
    },
    res,
  );
  return res;
}
const bothChats = [
  { email: 'rahul@hoora.me', conversation_id: 'a:chat-rahul', service_url: SERVICE },
  { email: 'deep@hoora.me', conversation_id: 'a:chat-deep', service_url: SERVICE },
];

test('Send on Teams goes from Hoora Releases to everyone who has it', async () => {
  const original = fetch;
  try {
    const log = world({ chats: bothChats });
    const res = await send();
    assert.equal(res.code, 200);
    assert.deepEqual(res.data, { sent: ['rahul@hoora.me', 'deep@hoora.me'], failed: [] });
    assert.deepEqual(
      log.messages.map((message) => message.url),
      [
        SERVICE + 'v3/conversations/a%3Achat-rahul/activities',
        SERVICE + 'v3/conversations/a%3Achat-deep/activities',
      ],
    );
    const [message] = log.messages;
    assert.equal(message.body.summary, 'Customer App v5.13.0 is now live');
    assert.equal(
      message.body.attachments[0].contentType,
      'application/vnd.microsoft.card.adaptive',
    );
    assert.equal(message.body.attachments[0].content.type, 'AdaptiveCard');
    assert.ok(!JSON.stringify(message.body).includes('Test message'));
  } finally {
    globalThis.fetch = original;
  }
});

test('Send on Teams explains when nobody has the bot yet', async () => {
  const original = fetch;
  try {
    const log = world({ chats: [] });
    const res = await send();
    assert.equal(res.code, 400);
    assert.match(res.data.error, /Nobody has Hoora Releases in Teams yet/);
    assert.equal(log.messages.length + log.claims.length, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test('Test on Teams sends the card to yourself only, marked as a test, 10 a day', async () => {
  const original = fetch;
  try {
    const log = world({ chats: bothChats, testClaim: { ok: true, id: 't7', used: 4 } });
    const res = await send('teams-test');
    assert.equal(res.code, 200);
    assert.deepEqual(res.data, { sent: ['rahul@hoora.me'], failed: [], used: 4, limit: 10 });
    assert.deepEqual(log.tests, [
      { member: 'member', target: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
    ]);
    assert.equal(log.messages.length, 1, 'Only your own chat');
    assert.equal(log.messages[0].url, SERVICE + 'v3/conversations/a%3Achat-rahul/activities');
    assert.equal(log.messages[0].body.summary, 'Test: Customer App v5.13.0 is now live');
    assert.equal(
      log.messages[0].body.attachments[0].content.body[0].text,
      'Test message: only you received this.',
    );
    assert.equal(log.claims.length + log.sends.length, 0, 'A test never blocks the real send');

    // The 11th test in 24 hours is refused.
    const full = world({
      chats: bothChats,
      testClaim: { ok: false, used: 10, limit: 10, next_at: '2026-11-28T04:30:00Z' },
    });
    const again = await send('teams-test');
    assert.equal(again.code, 429);
    assert.equal(
      again.data.error,
      'You have used your 10 test messages for today. You can test again after 28 Nov, 10:00 am.',
    );
    assert.equal(full.messages.length, 0);

    // A test that does not reach Teams does not count.
    const down = world({ chats: bothChats, teamsDown: true });
    const failed = await send('teams-test');
    assert.equal(failed.code, 400);
    assert.deepEqual(down.deleted, ['https://test.supabase.co/rest/v1/docs_teams_tests?id=eq.t1']);

    // Without the bot in your own Teams, there is nowhere to send the test.
    const absent = world({ chats: [bothChats[1]] });
    const nowhere = await send('teams-test');
    assert.equal(nowhere.code, 400);
    assert.match(nowhere.data.error, /Add Hoora Releases in Teams first/);
    assert.equal(absent.messages.length + absent.tests.length, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test('Product Team managers can send; other members cannot and do not see the buttons', async () => {
  const original = fetch;
  try {
    const manager = world({ chats: bothChats, role: 'viewer', allowed: true });
    assert.equal((await send()).code, 200);
    assert.equal(manager.messages.length, 2);

    const other = world({ chats: bothChats, role: 'publisher', allowed: false });
    const refused = await send();
    assert.equal(refused.code, 403);
    assert.match(refused.data.error, /administrators and Product Team managers/);
    assert.equal((await send('teams-test')).code, 403);
    const status = await send('teams-status');
    assert.equal(status.code, 200);
    assert.deepEqual(status.data, { allowed: false });
    assert.equal(other.messages.length, 0);

    // Allowed people see who it reaches and their tests left.
    world({ chats: bothChats });
    const mine = await send('teams-status');
    assert.deepEqual(
      { ...mine.data, last: undefined },
      {
        allowed: true,
        ready: true,
        sender: 'Hoora Releases',
        everyone: { people: 2 },
        tests: { used: 0, limit: 10 },
        last: undefined,
      },
    );
  } finally {
    globalThis.fetch = original;
  }
});

test('The card is signed by the release publisher and writers, found in Hoora Docs', async () => {
  const original = fetch;
  try {
    const log = world({
      chats: [{ email: 'rahul@hoora.me', conversation_id: 'a:chat-rahul', service_url: SERVICE }],
      release: {
        published_by: 'p1',
        published_by_name: 'Tom Sharma',
        release_snapshot: {
          project: 'Admin Panel',
          entries: [
            { vertical: 'Garage', author: 'Priya Rao', body: '### 1. Change one' },
            { vertical: 'Auto Care', author: 'Tom Sharma', body: '### 1. Change two' },
            { vertical: 'Products', author: 'Old Writer', body: '### 1. Change three' },
          ],
        },
      },
      members: [
        { id: 'p1', name: 'Tom Sharma', email: 'Tom@hoora.me' },
        { id: 'p2', name: 'Priya Rao', email: 'priya@hoora.me' },
      ],
    });
    const res = await send();
    assert.equal(res.code, 200);
    const card = log.messages[0].body.attachments[0].content;
    assert.equal(
      card.body.at(-1).text,
      'From the desk of [Tom Sharma](https://teams.microsoft.com/l/chat/0/0?users=tom%40hoora.me), [Priya Rao](https://teams.microsoft.com/l/chat/0/0?users=priya%40hoora.me), Old Writer',
    );
    // Issues and feedback go to the publisher, who comes first.
    assert.ok(
      JSON.stringify(card).includes(
        '"Chat on Teams","url":"https://teams.microsoft.com/l/chat/0/0?users=tom%40hoora.me&message=',
      ),
    );
    assert.ok(
      log.lookups.some((url) => url.includes('name=in.("Priya Rao","Tom Sharma","Old Writer")')),
    );
  } finally {
    globalThis.fetch = original;
    for (const name of ['TEAMS_BOT_ID', 'TEAMS_BOT_SECRET', 'MICROSOFT_TENANT_ID'])
      delete process.env[name];
  }
});

const rahulsChat = [
  { email: 'rahul@hoora.me', conversation_id: 'a:chat-rahul', service_url: SERVICE },
];

test('A release is sent on Teams once a day: the send is claimed, then recorded', async () => {
  const original = fetch;
  try {
    const log = world({ chats: rahulsChat });
    const res = await send();
    assert.equal(res.code, 200);
    assert.deepEqual(log.claims, [{ target: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }]);
    assert.equal(log.sends.length, 1);
    assert.ok(log.sends[0].sent_at);
    assert.equal(log.sends[0].sent_by, 'member');
    assert.equal(log.sends[0].sending_since, null);
  } finally {
    globalThis.fetch = original;
  }
});

test('Nobody can send a release on Teams again within 24 hours, or while it is being sent', async () => {
  const original = fetch;
  try {
    const done = world({
      chats: rahulsChat,
      claim: {
        ok: false,
        sent_at: '2026-11-27T04:30:00Z',
        sent_by_name: 'Tom Sharma',
        next_at: '2026-11-28T04:30:00Z',
      },
    });
    const again = await send();
    assert.equal(again.code, 429);
    assert.equal(
      again.data.error,
      'Already sent on Teams by Tom Sharma at 27 Nov, 10:00 am. It can be sent again after 28 Nov, 10:00 am.',
    );
    assert.equal(done.messages.length + done.sends.length, 0);

    const busy = world({ chats: rahulsChat, claim: { ok: false, sending: true } });
    const twice = await send();
    assert.equal(twice.code, 429);
    assert.match(twice.data.error, /being sent on Teams right now/);
    assert.equal(busy.messages.length + busy.sends.length, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test('When Teams does not take the message, the claim is released so it can be sent later', async () => {
  const original = fetch;
  try {
    const log = world({ chats: rahulsChat, teamsDown: true });
    const res = await send();
    assert.equal(res.code, 400);
    assert.deepEqual(log.sends, [{ sending_since: null }]);
  } finally {
    globalThis.fetch = original;
    for (const name of ['TEAMS_BOT_ID', 'TEAMS_BOT_SECRET', 'MICROSOFT_TENANT_ID'])
      delete process.env[name];
  }
});

test('The bot address /api/teams fits the Hobby plan: routed to an existing function', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.deepEqual(
    config.rewrites.find((rule) => rule.source === '/api/teams'),
    { source: '/api/teams', destination: '/api/notifications?source=teams' },
  );
  const functions = readdirSync(new URL('../api/', import.meta.url)).filter((name) =>
    name.endsWith('.js'),
  );
  assert.ok(
    functions.length <= 12,
    `Vercel Hobby allows 12 server functions, not ${functions.length}`,
  );
});
