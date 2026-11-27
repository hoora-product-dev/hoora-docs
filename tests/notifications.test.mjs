import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import handler from '../api/notifications.js';
import { announcement } from '../server/email.js';
import { releaseSigners, teamsCard, teamsPreview, teamsPayload } from '../server/teams.js';
test('Publishers and viewers cannot preview or draft announcements', async () => {
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'server';
  const original = fetch;
  let external = 0;
  try {
    for (const role of ['publisher', 'viewer']) {
      globalThis.fetch = async (url) => {
        if (!url.startsWith('https://test.supabase.co')) external++;
        return new Response(
          JSON.stringify(
            url.endsWith('/auth/v1/user')
              ? { id: 'member' }
              : [{ id: 'member', role, active: true, password_setup_complete: true }],
          ),
        );
      };
      for (const action of ['preview', 'draft', 'teams-send']) {
        const res = {
          setHeader() {},
          status(n) {
            this.code = n;
            return this;
          },
          json(d) {
            this.data = d;
          },
        };
        await handler(
          {
            method: 'POST',
            headers: { authorization: 'Bearer valid-session' },
            body: { action, id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
          },
          res,
        );
        assert.equal(res.code, 403);
        assert.match(res.data.error, /administrators/);
      }
    }
    assert.equal(external, 0);
  } finally {
    globalThis.fetch = original;
  }
});
test('Announcement template escapes contributor content and includes the public release link', () => {
  const mail = announcement({
    title: '<script>alert(1)</script>',
    slug: 'demo-release',
    kind: 'release',
    summary: 'A & B',
    published_at: '2026-11-05',
    release_snapshot: {
      entries: [
        {
          vertical: 'Garage',
          body: [
            '### 1. [HC-1](https://x.test/HC-1) · <img onerror=alert(1)>',
            '### 2. Second change',
          ].join('\n'),
        },
      ],
    },
  });
  assert.ok(!mail.html.includes('<script>'));
  assert.match(mail.html, /&lt;img/);
  assert.match(mail.html, /https:\/\/release.hoora.in\/docs\/demo-release/);
  assert.match(mail.html, /Rahul Tripathi/);
  assert.match(mail.html, /View release notes/);
  assert.match(mail.html, /Install Hoora Docs/);
  assert.match(mail.html, /Product &amp; Tech teams<\/span>/, 'Two teams working together');
  assert.match(mail.html, /Shipped by the/);
  // The footer: "From the desk of Rahul Tripathi", the name linked to his profile.
  assert.match(
    mail.html,
    /class="foot"[^>]*>From the desk of <a href="https:\/\/rahul-tripathi\.web\.app\/"[^>]*>Rahul Tripathi<\/a><\/td>/,
  );
  assert.ok(!/Sent with|Hoora Docs<\/a> by|Curated|On behalf of/.test(mail.html));
  assert.match(mail.text, /\n\nFrom the desk of Rahul Tripathi$/);
  assert.ok(!mail.html.includes('Reply to this email'));
  assert.ok(!mail.body.includes('display:none'), 'The copy has no hidden preview text');
  assert.ok(mail.html.includes('https://release.hoora.in/install'));
  assert.match(mail.html, /Second change/);
  assert.ok(!mail.html.includes('HC-1'), 'Ticket keys stay out of the email');
  assert.ok(!/test preview|restricted to/i.test(mail.html));
  assert.ok(!mail.body.includes('<html'), 'The copyable body is a fragment');
  assert.ok(!/<div[^>]*(width|height):/.test(mail.body), 'Sized shapes are table cells');
  assert.ok(!/<a [^>]*padding/.test(mail.body), 'Buttons are padded cells, not padded links');
  assert.ok(!mail.body.includes('<!--'), 'No Outlook-only markup that a paste would drop');
});
test('Announcements are preview only: no Outlook draft and no Microsoft Graph call', async () => {
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'server';
  const original = fetch;
  const external = [];
  globalThis.fetch = async (url) => {
    let data = {};
    if (!url.startsWith('https://test.supabase.co')) external.push(url);
    if (url.endsWith('/auth/v1/user')) data = { id: 'member' };
    else if (url.includes('/docs_members'))
      data = [{ id: 'member', active: true, role: 'admin', password_setup_complete: true }];
    else if (url.includes('/docs_published'))
      data = [
        {
          id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          title: 'Release',
          slug: 'release',
          kind: 'release',
          version: '5.11.0',
          published_at: '2026-11-05',
          release_snapshot: { project: 'Customer App', entries: [] },
        },
      ];
    return new Response(JSON.stringify(data));
  };
  const res = {
    setHeader() {},
    status(n) {
      this.code = n;
      return this;
    },
    json(d) {
      this.data = d;
    },
  };
  try {
    await handler(
      {
        method: 'POST',
        headers: { authorization: 'Bearer s' },
        body: {
          id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          action: 'draft',
          providerToken: 'x.y.z',
        },
      },
      res,
    );
    assert.equal(res.code, 400);
    assert.match(res.data.error, /Invalid action/);
    assert.deepEqual(external, [], 'Nothing reaches Microsoft Graph');
  } finally {
    globalThis.fetch = original;
  }
});
test('Release email asks for issues or feedback by email or in a Teams chat', () => {
  const release = (project) =>
    announcement({
      slug: 'release',
      kind: 'release',
      version: '5.13.0',
      published_at: '2026-11-25',
      release_snapshot: {
        project,
        entries: [{ vertical: 'Auto Care', body: '### 1. Change one\n### 2. Change two' }],
      },
    });
  const enc = encodeURIComponent;
  for (const project of ['Customer App', 'Hoora on Web']) {
    const mail = release(project);
    const name = `${project} v5.13.0`;
    // Email: to Rahul and Deep, Product and Jyotindra in CC, the release as the subject.
    const mailto = `mailto:rahul@hoora.me,deep@hoora.me?cc=product@hoora.in,jyotindra@hoora.me&amp;subject=${enc(`${name} - Issue or feedback`)}`;
    assert.ok(mail.body.includes(`href="${mailto}"`), 'Email button');
    // Teams: a one-to-one chat with Rahul, the release name already typed in.
    const teams = `https://teams.microsoft.com/l/chat/0/0?users=rahul%40hoora.me&amp;message=${enc(`${name}: `)}`;
    assert.ok(mail.body.includes(`href="${teams}"`), 'Teams link');
    assert.match(mail.body, /Issues or feedback\? Let us know<\/td>/);
    assert.match(mail.body, /<a href="mailto:[^"]*"[^>]*>Email<\/a>/);
    assert.match(mail.body, /<a href="https:\/\/teams\.microsoft\.com[^"]*"[^>]*>Teams<\/a>/);
    // A soft strip: a table cell with its own background, which survives a paste into Outlook.
    assert.match(
      mail.body,
      /<td class="note" bgcolor="#f7f7f8"[^>]*>(?:(?!<\/td>).)*Issues or feedback\?/,
    );
    const strip = mail.body.indexOf('Issues or feedback');
    assert.ok(strip < mail.body.indexOf('Shipped by the'), 'Just before the credits');
    assert.equal(mail.body.split('Issues or feedback').length, 2, 'Shown once');
    assert.ok(
      !/class="btn-secondary"[^>]*>(?:(?!<\/td>).)*>(Email|Teams)</.test(mail.body),
      'Plain links, not boxed buttons',
    );
    assert.match(
      mail.body,
      /class="foot"[^>]*>From the desk of <a [^>]*>Rahul Tripathi<\/a><\/td>/,
    );
    assert.match(
      mail.text,
      /\n\nIssues or feedback\? Let us know by email to rahul@hoora\.me, deep@hoora\.me \(cc product@hoora\.in, jyotindra@hoora\.me\) or on Teams: https:\/\/teams\.microsoft\.com\/l\/chat\/0\/0\?users=rahul%40hoora\.me&message=[^\n]+\n\nShipped by the Product & Tech teams\n\nFrom the desk of Rahul Tripathi$/,
    );
  }
  const app = release('Customer App');
  assert.ok(
    app.body.indexOf('Issues or feedback') > app.body.indexOf('Download on the App Store'),
    'Under the store badges',
  );
});
test('Release email lists the highlights openly and the main button counts all the changes', () => {
  const release = (count) =>
    announcement({
      slug: 'release',
      kind: 'release',
      version: '5.13.0',
      published_at: '2026-11-25',
      release_snapshot: {
        project: 'Customer App',
        entries: [
          {
            vertical: 'Auto Care',
            body: Array.from({ length: count }, (_, i) => `### ${i + 1}. Change ${i + 1}`).join(
              '\n',
            ),
          },
        ],
      },
    });
  const many = release(40);
  // The main button carries the count when the list shows only some of the changes.
  assert.equal(
    many.body.match(/<a href="([^"]+)"[^>]*>View all 40 changes<\/a>/)?.[1],
    many.url,
    'The button opens the release notes',
  );
  assert.ok(!many.body.includes('View release notes'));
  assert.ok(
    !/class="list"|View all &rarr;|more change/.test(many.body),
    'No boxed list or extra row',
  );
  assert.match(many.text, /- Change 4 \(Auto Care\)\n\nView all 40 changes: /);
  // When every change is listed, the button keeps its usual label.
  const few = release(4);
  assert.match(few.body, />View release notes<\/a>/);
  assert.ok(!few.body.includes('View all'));
});

const teamsRelease = (project, extra = {}) => ({
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  slug: 'release',
  kind: 'release',
  version: '5.13.0',
  published_at: '2026-11-25',
  release_snapshot: {
    project,
    entries: [
      {
        vertical: 'Auto Care',
        body: Array.from({ length: 6 }, (_, i) => `### ${i + 1}. Change ${i + 1}`).join('\n'),
      },
    ],
  },
  ...extra,
});

test('Teams card says what the release email says, with links to the live site', () => {
  const card = teamsCard(teamsRelease('Customer App'));
  assert.equal(card.type, 'AdaptiveCard');
  assert.equal(card.version, '1.4');
  const all = JSON.stringify(card);
  for (const words of [
    'Now live',
    'Customer App',
    'v5.13.0',
    'What’s new',
    'Change 1',
    'Auto Care',
  ])
    assert.ok(all.includes(words), words);
  assert.ok(!all.includes('Change 5'), 'Four highlights, like the email');
  const actions = card.body
    .filter((item) => item.type === 'ActionSet')
    .flatMap((set) => set.actions);
  assert.deepEqual(
    actions.map((action) => [action.title, action.url]),
    [
      ['View all 6 changes', 'https://release.hoora.in/release-notes/5.13.0/customer-app'],
      ['Install Hoora Docs', 'https://release.hoora.in/install'],
    ],
  );
  assert.equal(actions[0].style, 'positive', 'The release notes button stands out');
  // The store badges from the email, each image opening its store listing.
  assert.ok(all.includes('"Update the Hoora app"'));
  const badges = card.body
    .filter((item) => item.type === 'ColumnSet')
    .flatMap((set) => set.columns.flatMap((col) => col.items))
    .filter((item) => item.type === 'Image' && item.selectAction);
  assert.deepEqual(
    badges.map((badge) => [badge.url, badge.selectAction.url]),
    [
      [
        'https://release.hoora.in/email/google-play.png',
        'https://play.google.com/store/apps/details?id=com.hoora.hoora_customer',
      ],
      [
        'https://release.hoora.in/email/app-store.png',
        'https://apps.apple.com/in/app/id1622615009',
      ],
    ],
  );
  for (const image of ['google-play.png', 'app-store.png'])
    assert.ok(existsSync(new URL('../public/email/' + image, import.meta.url)), image);
  // A local preview shows the card's own images from the local copy.
  assert.ok(
    teamsPreview(card, 'http://localhost:3000').includes(
      '<a href="https://play.google.com/store/apps/details?id=com.hoora.hoora_customer"><img src="http://localhost:3000/email/google-play.png"',
    ),
  );
  // Feedback opens a Teams chat with Rahul, the release typed in.
  assert.ok(
    all.includes(
      'https://teams.microsoft.com/l/chat/0/0?users=rahul%40hoora.me&message=Customer%20App%20v5.13.0%3A%20',
    ),
  );
  assert.match(all, /Shipped by the \*\*Product & Tech teams\*\*/);
  // The sign-off is the last line: one centred line, no photo, the same on every release.
  const signOff = card.body.at(-1);
  assert.equal(signOff.type, 'TextBlock');
  // Rahul's name opens his profile; Deepkumar's opens a Teams chat with him.
  assert.equal(
    signOff.text,
    'From the desk of [Rahul Tripathi](https://rahul-tripathi.web.app/), [Deepkumar Mahajan](https://teams.microsoft.com/l/chat/0/0?users=deep%40hoora.me)',
  );
  assert.equal(signOff.horizontalAlignment, 'Center');
  assert.equal(signOff.separator, true);
  // No photo: the only round image is the Hoora logo at the top.
  assert.equal(all.match(/"style":"Person"/g).length, 1);
  assert.ok(!all.includes('rahul-tripathi.jpg'));
  assert.match(teamsPreview(card), /text-align:center;[^>]*>From the desk of <a /);
  assert.ok(!all.includes('localhost'));
  assert.deepEqual(teamsPayload(card).attachments[0], {
    contentType: 'application/vnd.microsoft.card.adaptive',
    contentUrl: null,
    content: card,
  });
});

test('Teams preview escapes release text and draws the card as a chat message', () => {
  const html = teamsPreview(
    teamsCard(
      teamsRelease('x', {
        release_snapshot: {
          project: '<script>alert(1)</script>',
          entries: [{ vertical: 'Garage', body: '### 1. <img src=x onerror=alert(1)>' }],
        },
      }),
    ),
  );
  assert.ok(!html.includes('<script>alert'));
  assert.ok(!html.includes('<img src=x'));
  assert.match(html, /&lt;img src=x/);
  assert.match(html, /<b>Hoora Releases<\/b>/);
  assert.match(
    html,
    /<a class="action positive" href="https:\/\/release\.hoora\.in\/release-notes\//,
  );
  assert.match(html, /<strong>Product &amp; Tech teams<\/strong>/);
  assert.match(html, /prefers-color-scheme:dark/);
});

function teamsServer({ role = 'admin', hook } = {}) {
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'server';
  if (hook === undefined) delete process.env.TEAMS_WORKFLOW_URL;
  else process.env.TEAMS_WORKFLOW_URL = hook;
  const sent = [];
  globalThis.fetch = async (url, options = {}) => {
    let data = {};
    if (!url.startsWith('https://test.supabase.co')) {
      sent.push({ url, body: JSON.parse(options.body) });
      return new Response('', { status: 202 });
    }
    if (url.endsWith('/auth/v1/user')) data = { id: 'member' };
    else if (url.includes('/docs_members'))
      data = [{ id: 'member', active: true, role, password_setup_complete: true }];
    else if (url.includes('/docs_published')) data = [teamsRelease('Admin Panel')];
    else if (url.includes('/rpc/docs_teams_claim')) data = { ok: true };
    else if (url.includes('/rpc/docs_teams_test_claim')) data = { ok: true, id: 't1', used: 1 };
    else if (url.includes('/docs_teams_tests')) data = [];
    else if (url.includes('/docs_teams_sends')) data = [];
    return new Response(JSON.stringify(data));
  };
  return sent;
}

async function announce(action) {
  const res = {
    setHeader() {},
    status(n) {
      this.code = n;
      return this;
    },
    json(d) {
      this.data = d;
    },
  };
  await handler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer s' },
      body: { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', action },
    },
    res,
  );
  return res;
}

test('On a local copy, Test and Send post the card through the test flow, to Rahul only', async () => {
  const original = fetch;
  const hook =
    'https://flow.environment.api.powerplatform.com:443/powerautomate/automations/direct/workflows/abc/triggers/manual/paths/invoke?sig=secret';
  try {
    const sent = teamsServer({ hook });
    const preview = await announce('preview');
    assert.equal(preview.code, 200);
    assert.deepEqual(preview.data.teams.everyone, { only: 'rahul@hoora.me' });
    assert.deepEqual(preview.data.teams.tests, { used: 0, limit: 10 });
    assert.equal(preview.data.teams.sender, 'Workflows (test flow)');
    assert.equal(preview.data.teams.ready, true);
    assert.ok(
      !JSON.stringify(preview.data).includes('sig=secret'),
      'The flow address stays on the server',
    );
    assert.equal(sent.length, 0, 'A preview sends nothing');

    const res = await announce('teams-send');
    assert.equal(res.code, 200);
    assert.deepEqual(res.data.sent, ['rahul@hoora.me']);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, hook);
    assert.equal(sent[0].body.type, 'message');
    assert.match(JSON.stringify(sent[0].body), /Admin Panel/);
    assert.ok(!JSON.stringify(sent[0].body).includes('Test message'));

    // A test says so at the top of the card.
    const test = await announce('teams-test');
    assert.equal(test.code, 200);
    assert.deepEqual(test.data, { sent: ['rahul@hoora.me'], failed: [], used: 1, limit: 10 });
    assert.equal(sent.length, 2);
    assert.equal(
      sent[1].body.attachments[0].content.body[0].text,
      'Test message: only you received this.',
    );
  } finally {
    globalThis.fetch = original;
    delete process.env.TEAMS_WORKFLOW_URL;
  }
});

test('Teams sending stays off until a Teams flow address is set', async () => {
  const original = fetch;
  try {
    for (const hook of [undefined, 'http://flow.logic.azure.com/x', 'https://example.com/x']) {
      const sent = teamsServer({ hook });
      const preview = await announce('preview');
      assert.equal(preview.data.teams.ready, false);
      const res = await announce('teams-send');
      assert.equal(res.code, 400);
      assert.match(res.data.error, /not set up/);
      assert.equal(sent.length, 0);
    }
  } finally {
    globalThis.fetch = original;
    delete process.env.TEAMS_WORKFLOW_URL;
  }
});

const tom = { name: 'Tom Sharma', email: 'tom@hoora.me' };
const priya = { name: 'Priya Rao', email: 'priya@hoora.me' };
const rahul = { name: 'Rahul Tripathi', email: 'rahul@hoora.me' };
const signOffOf = (card) => card.body.at(-1).text;
const chatOf = (card) =>
  decodeURIComponent(JSON.stringify(card).match(/"Chat on Teams","url":"[^"]*users=([^&"]+)/)[1]);

test('Teams sign-off: Rahul and Deepkumar on Customer App and Hoora on Web, plus any writer', () => {
  for (const project of ['Customer App', 'Hoora on Web']) {
    const page = teamsRelease(project);
    const alone = teamsCard(page, null, releaseSigners(page));
    assert.equal(
      signOffOf(alone),
      'From the desk of [Rahul Tripathi](https://rahul-tripathi.web.app/), [Deepkumar Mahajan](https://teams.microsoft.com/l/chat/0/0?users=deep%40hoora.me)',
      project,
    );
    const shared = teamsCard(page, null, releaseSigners(page, [tom, rahul]));
    assert.match(
      signOffOf(shared),
      /^From the desk of \[Rahul Tripathi\]\([^)]+\), \[Deepkumar Mahajan\]\([^)]+\), \[Tom Sharma\]\(https:\/\/teams\.microsoft\.com\/l\/chat\/0\/0\?users=tom%40hoora\.me\)$/,
    );
    // Issues and feedback go to Rahul.
    assert.equal(chatOf(shared), 'rahul@hoora.me');
    // Every email keeps its own sign-off.
    assert.match(announcement(page).text, /\n\nFrom the desk of Rahul Tripathi$/);
  }
});

test('Teams sign-off on other platforms: publisher and writers, Rahul first when he is one', () => {
  const page = teamsRelease('Admin Panel');
  const team = teamsCard(page, null, releaseSigners(page, [tom, priya, tom]));
  assert.equal(
    signOffOf(team),
    'From the desk of [Tom Sharma](https://teams.microsoft.com/l/chat/0/0?users=tom%40hoora.me), [Priya Rao](https://teams.microsoft.com/l/chat/0/0?users=priya%40hoora.me)',
  );
  // Issues and feedback go to the first person, with the release typed in.
  assert.equal(chatOf(team), 'tom@hoora.me');
  assert.ok(JSON.stringify(team).includes('message=Admin%20Panel%20v5.13.0%3A%20'));

  const withRahul = teamsCard(page, null, releaseSigners(page, [tom, priya, rahul]));
  assert.match(
    signOffOf(withRahul),
    /^From the desk of \[Rahul Tripathi\]\(https:\/\/rahul-tripathi\.web\.app\/\), \[Tom Sharma\]/,
  );
  assert.equal(chatOf(withRahul), 'rahul@hoora.me');
  assert.ok(!signOffOf(withRahul).includes('Deepkumar'), 'Deepkumar signs only his platforms');

  // A writer without a Hoora Docs account keeps their name, without a link.
  const old = teamsCard(page, null, releaseSigners(page, [{ name: 'Old [Writer]' }, tom]));
  assert.match(signOffOf(old), /^From the desk of Old Writer, \[Tom Sharma\]/);
  assert.equal(chatOf(old), 'tom@hoora.me');

  // Nobody on record: no sign-off line, and feedback still reaches Rahul.
  const none = teamsCard(page, null, releaseSigners(page));
  assert.ok(!JSON.stringify(none).includes('From the desk of'));
  assert.equal(chatOf(none), 'rahul@hoora.me');
});
