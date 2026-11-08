import test from 'node:test';
import assert from 'node:assert/strict';
import handler, { validateRelease, canViewRelease } from '../api/upcoming.js';
import { filterIdFromUrl, searchTickets, VERTICAL_FIELD, OWNER_FIELD } from '../server/jira.js';
// These tests check every Jira call, so the shared ticket cache is off here;
// the last test turns it on to check caching itself.
process.env.JIRA_CACHE = 'off';
const id = 'df7328d8-c004-4596-b9b1-b2d3a1ccc598';
const release = {
  id,
  slug: 'release-5-12-0',
  filter_id: '12576',
  title: 'Customer release',
  version: '5.12.0',
  release_date: '2026-11-20',
  enabled: true,
  updated_at: '2026-11-07T00:00:00Z',
};
const response = () => ({
  headers: {},
  setHeader(k, v) {
    this.headers[k] = v;
  },
  status(code) {
    this.code = code;
    return this;
  },
  json(data) {
    this.data = data;
  },
});
function stub(member = {}, email = 'viewer@hoora.me', jiraIssues = []) {
  const calls = [];
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'server-only';
  process.env.JIRA_READ_EMAIL = 'integration@example.com';
  process.env.JIRA_READ_API_TOKEN = 'read-only-secret';
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    let data;
    if (url.endsWith('/auth/v1/user'))
      data = { id, email, email_confirmed_at: '2026-11-01T00:00:00Z' };
    else if (url.includes('/docs_members?'))
      data = [{ id, role: 'viewer', active: true, password_setup_complete: true, ...member }];
    else if (url.includes('/docs_upcoming_releases?')) data = [release];
    else if (url.includes('/rpc/docs_upcoming_rate_limit')) data = null;
    else if (url.includes('api.atlassian.com')) data = { issues: jiraIssues, isLast: true };
    else throw Error('Unexpected request ' + url);
    return new Response(JSON.stringify(data), { status: 200 });
  };
  return calls;
}
test('Upcoming filters accept only the approved Jira host and numeric saved filters', () => {
  assert.equal(filterIdFromUrl('https://hooratechteam.atlassian.net/issues?filter=12576'), '12576');
  for (const value of [
    'https://evil.com/issues?filter=12576',
    'https://hooratechteam.atlassian.net.evil.com/issues?filter=12576',
    'http://hooratechteam.atlassian.net/issues?filter=12576',
    'https://x:y@hooratechteam.atlassian.net/issues?filter=12576',
    'https://hooratechteam.atlassian.net/issues?jql=project=ALL',
    'https://hooratechteam.atlassian.net/issues?filter=12576 OR 1=1',
  ])
    assert.throws(() => filterIdFromUrl(value));
});
test('Release configuration validates dates and requires one before sharing', () => {
  const body = {
    title: 'Sprint',
    version: '5.12.0',
    filterUrl: 'https://hooratechteam.atlassian.net/issues?filter=12576',
    releaseDate: '2026-11-20',
    enabled: true,
  };
  assert.equal(validateRelease(body).filter_id, '12576');
  assert.throws(() => validateRelease({ ...body, releaseDate: '2026-02-30' }));
  assert.throws(() => validateRelease({ ...body, releaseDate: '' }));
});
test('Shared releases are visible to every member; drafts only to administrators', () => {
  assert.ok(canViewRelease(release, { role: 'viewer' }));
  assert.ok(!canViewRelease({ ...release, enabled: false }, { role: 'viewer' }));
  assert.ok(!canViewRelease({ ...release, enabled: false }, { role: 'manager' }));
  assert.ok(canViewRelease({ ...release, enabled: false }, { role: 'admin' }));
});
test('Anonymous requests cannot list upcoming releases', async () => {
  const res = response();
  await handler({ method: 'POST', headers: {}, body: { action: 'list' } }, res);
  assert.equal(res.code, 401);
});
test('Unshared releases stay hidden from members and never reach Jira', async () => {
  const original = globalThis.fetch;
  release.enabled = false;
  try {
    const calls = stub({}, 'other@hoora.me');
    for (const action of ['tickets', 'ticket']) {
      const res = response();
      await handler(
        {
          method: 'POST',
          headers: { authorization: 'Bearer verified' },
          body: { action, id, key: 'HCUS-1914' },
        },
        res,
      );
      assert.equal(res.code, 404);
    }
    const res = response();
    await handler(
      { method: 'POST', headers: { authorization: 'Bearer verified' }, body: { action: 'list' } },
      res,
    );
    assert.deepEqual(res.data.releases, []);
    assert.ok(!calls.some((c) => c.url.includes('atlassian')));
  } finally {
    globalThis.fetch = original;
    release.enabled = true;
  }
});
test('Non-admin members cannot modify release settings, delete releases, or inspect connection', async () => {
  const original = globalThis.fetch;
  try {
    const calls = stub();
    for (const action of ['save', 'delete', 'connection']) {
      const res = response();
      await handler(
        { method: 'POST', headers: { authorization: 'Bearer verified' }, body: { action, id } },
        res,
      );
      assert.equal(res.code, 403);
    }
    assert.ok(!calls.some((c) => c.url.includes('docs_upcoming_releases')));
  } finally {
    globalThis.fetch = original;
  }
});
test('Ticket details are queried inside the saved filter and reject tickets outside it', async () => {
  const original = globalThis.fetch;
  try {
    const calls = stub();
    const res = response();
    await handler(
      {
        method: 'POST',
        headers: { authorization: 'Bearer verified' },
        body: { action: 'ticket', id, key: 'HCUS-99999', jql: 'project = ALL', filter_id: '1' },
      },
      res,
    );
    assert.equal(res.code, 404);
    const jira = calls.find((c) => c.url.includes('atlassian'));
    assert.equal(JSON.parse(jira.options.body).jql, 'filter = 12576 AND key = "HCUS-99999"');
    assert.ok(!calls.some((c) => c.url.includes('/issue/')));
  } finally {
    globalThis.fetch = original;
  }
});
test('Ticket list exposes only projected fields and never descriptions, tokens or allowlists', async () => {
  const original = globalThis.fetch;
  try {
    stub({}, 'viewer@hoora.me', [
      {
        key: 'HCUS-1914',
        fields: {
          summary: 'Booking update',
          description: 'private-full-description',
          status: { name: 'In progress' },
          [VERTICAL_FIELD]: [{ id: '10519', value: 'Autocare' }],
          [OWNER_FIELD]: { accountId: 'owner-1', displayName: 'Owner' },
        },
      },
    ]);
    const res = response();
    await handler(
      {
        method: 'POST',
        headers: { authorization: 'Bearer verified' },
        body: { action: 'tickets', id },
      },
      res,
    );
    assert.equal(res.code, 200);
    assert.equal(res.data.verticals[0].label, 'Autocare');
    assert.equal(res.data.owners[0].id, 'owner-1');
    assert.ok(!JSON.stringify(res.data).includes('private-full-description'));
    assert.ok(!JSON.stringify(res.data).includes('filterUrl'));
    assert.ok(!JSON.stringify(res.data).includes('read-only-secret'));
    assert.equal(res.headers['Cache-Control'], 'private, no-store');
  } finally {
    globalThis.fetch = original;
  }
});
test('Jira pagination retrieves every title without broadening the query', async () => {
  const original = globalThis.fetch;
  try {
    let count = 0;
    globalThis.fetch = async (url, o) => {
      const b = JSON.parse(o.body);
      assert.equal(b.jql, 'filter = 12576');
      assert.ok(!b.fields.includes('description'));
      count++;
      if (count === 2) assert.equal(b.nextPageToken, 'next');
      return new Response(
        JSON.stringify({
          issues: [{ key: 'HCUS-' + count }],
          isLast: count === 2,
          ...(count === 1 ? { nextPageToken: 'next' } : {}),
        }),
      );
    };
    const result = await searchTickets('12576');
    assert.equal(result.length, 2);
    await assert.rejects(() => searchTickets('12576', 'HCUS-1" OR key="HCUS-2'));
  } finally {
    globalThis.fetch = original;
  }
});

test('Repeat views of the same filter are answered from the cache, not Jira', async (t) => {
  process.env.JIRA_CACHE = 'on';
  t.after(() => (process.env.JIRA_CACHE = 'off'));
  Object.assign(process.env, { JIRA_EMAIL: 'bot@hoora.me', JIRA_API_TOKEN: 'token' });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response(
      JSON.stringify({ issues: [{ key: 'HCUS-1', fields: { summary: 'One' } }], isLast: true }),
    );
  });
  const first = await searchTickets('987654321');
  const second = await searchTickets('987654321');
  assert.deepEqual(second, first);
  assert.equal(calls, 1);
});
