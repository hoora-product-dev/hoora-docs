import test from 'node:test';
import assert from 'node:assert/strict';
import handler, { answerDepth, persona } from '../api/assistant.js';
const id = '00000000-0000-4000-8000-000000000001';
const response = () => ({
  setHeader() {},
  status(code) {
    this.code = code;
    return this;
  },
  json(data) {
    this.data = data;
    return this;
  },
});
function prepare(t, readable = true, includeUpcoming = false) {
  const original = { ...process.env };
  Object.assign(process.env, {
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_ANON_KEY: 'public-test-key',
    AI_GATEWAY_API_KEY: 'test-gateway-key',
  });
  t.after(() => {
    process.env = original;
  });
  let generations = 0;
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    let data;
    if (url.includes('/rpc/docs_search')) data = [{ id }];
    else if (url.endsWith('/embeddings')) data = { data: [] };
    else if (url.includes('/api/upcoming')) {
      assert.equal(includeUpcoming, true);
      assert.equal(options.headers.Authorization, 'Bearer viewer-test-token');
      data = {
        releases: [
          {
            id: '00000000-0000-4000-8000-000000000002',
            slug: 'customer-app-5-12-0',
            title: 'Customer App',
            version: '5.12.0',
            releaseDate: '2026-11-20',
          },
        ],
      };
    } else if (url.includes('/docs_published?')) {
      assert.equal(options.headers.apikey, 'public-test-key');
      assert.equal(options.headers.Authorization, 'Bearer viewer-test-token');
      data = readable
        ? [
            {
              id,
              title: 'Booking guide',
              slug: 'booking-guide',
              kind: 'documentation',
              body: 'Track booking progress in the customer app. Ticket HCUS-1592.',
            },
          ]
        : [];
    } else if (url.endsWith('/chat/completions')) {
      generations++;
      const body = JSON.parse(options.body);
      assert.equal(body.model, 'openai/gpt-5.4-nano');
      // The fixed persona leads every request so the provider can cache it.
      assert.equal(body.messages[0].content, persona);
      assert.deepEqual(body.providerOptions, { gateway: { caching: 'auto' } });
      if (includeUpcoming)
        assert.match(body.messages[1].content, /Target release date: 20 Nov 2026/);
      data = {
        choices: [
          {
            finish_reason: ['low', 'medium'].includes(body.reasoning?.effort) ? 'stop' : 'length',
            message: {
              content: ['low', 'medium'].includes(body.reasoning?.effort)
                ? 'Track booking progress [1] [9].'
                : '',
            },
          },
        ],
      };
    } else throw Error('Unexpected request');
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return () => generations;
}
test('The free assistant reserves its token budget for an answer and returns document citations', async (t) => {
  const generations = prepare(t);
  const res = response();
  await handler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer viewer-test-token' },
      body: { question: 'How do bookings work?' },
    },
    res,
  );
  assert.equal(res.code, 200);
  assert.match(res.data.answer, /\[1\]/);
  assert.doesNotMatch(res.data.answer, /\[9\]/);
  assert.equal(res.data.sources[0].url, '/docs/booking-guide');
  assert.deepEqual(res.data.tickets, [
    { key: 'HCUS-1592', url: 'https://hooratechteam.atlassian.net/browse/HCUS-1592' },
  ]);
  assert.equal(generations(), 1);
});

test('Latest release metadata survives long documents and a failed primary reaches the fallback', async (t) => {
  const original = { ...process.env };
  Object.assign(process.env, {
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_ANON_KEY: 'public',
    AI_GATEWAY_API_KEY: 'gateway',
  });
  t.after(() => {
    process.env = original;
  });
  const releases = Array.from({ length: 8 }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    kind: 'release',
    title: `Customer App ${i + 1}`,
    version: `${i + 1}.0.0`,
    slug: `release-${i + 1}`,
    published_at: '2026-11-07',
    release_snapshot: {
      project: 'Customer App',
      project_slug: 'customer-app',
      release_date: `2026-10-${String(i + 1).padStart(2, '0')}`,
      entries: [{ body: 'Long source text '.repeat(1500) }],
    },
  }));
  const models = [];
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    let data;
    if (url.includes('/rpc/docs_search')) data = releases.slice(0, 6).map((r) => ({ id: r.id }));
    else if (url.endsWith('/embeddings')) data = { data: [] };
    else if (url.includes('kind=eq.release')) data = releases;
    else if (url.includes('/docs_published?id=')) data = releases;
    else if (url.endsWith('/chat/completions')) {
      const payload = JSON.parse(options.body);
      models.push(payload.model);
      assert.match(
        payload.messages[1].content,
        /Customer App 8; version 8.0.0; release date 8 Oct 2026/,
      );
      assert.match(
        payload.messages[1].content,
        /Customer App 3; version 3.0.0; release date 3 Oct 2026/,
      );
      if (models.length === 1) throw new TypeError('Transport unavailable');
      data = { choices: [{ message: { content: 'Version 8.0.0 released on 8 October [1].' } }] };
    } else throw Error('Unexpected request ' + url);
    return new Response(JSON.stringify(data));
  });
  const res = response();
  await handler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer viewer-test-token' },
      body: { question: 'What is the latest Customer App release date?' },
    },
    res,
  );
  assert.equal(res.code, 200);
  assert.equal(res.data.sources[0].url, '/release-notes/8.0.0/customer-app');
  assert.deepEqual(models, ['openai/gpt-5.4-nano', 'openai/gpt-5-mini']);
});
test('An inaccessible document never enters the generation context', async (t) => {
  const generations = prepare(t, false),
    res = response();
  await handler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer viewer-test-token' },
      body: { question: 'Show this document', currentDocumentId: id },
    },
    res,
  );
  assert.equal(res.code, 200);
  assert.deepEqual(res.data.sources, []);
  assert.equal(generations(), 0);
});

test('The assistant grounds upcoming release dates in the authorized release feed', async (t) => {
  const generations = prepare(t, true, true);
  const res = response();
  await handler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer viewer-test-token', host: 'test.local' },
      body: { question: 'Give me the target date for the upcoming Customer App release.' },
    },
    res,
  );
  assert.equal(res.code, 200);
  assert.equal(res.data.sources[1].url, '/upcoming/customer-app-5-12-0');
  assert.equal(generations(), 1);
});

test('Quick lookups think lightly; questions that compare or explain think more', () => {
  assert.equal(answerDepth('When did Customer App 5.11.0 go out?').effort, 'low');
  assert.equal(answerDepth('Why did car wash prices change?').effort, 'medium');
  assert.equal(answerDepth('Compare 5.10 and 5.11 for Auto Care').effort, 'medium');
  assert.equal(answerDepth('anyway, what shipped last week?').effort, 'low');
  assert.ok(answerDepth('Why?').maxTokens > answerDepth('When?').maxTokens);
});
