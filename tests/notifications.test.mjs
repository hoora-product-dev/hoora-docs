import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/notifications.js';
import { announcement } from '../server/email.js';
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
      for (const action of ['preview', 'draft']) {
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
