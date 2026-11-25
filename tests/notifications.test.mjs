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
  assert.match(mail.html, /Product &amp; Tech teams/);
  assert.match(mail.html, /Shipped by the/);
  assert.match(mail.html, /Hoora Docs<\/a> &middot; Rahul Tripathi/);
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
