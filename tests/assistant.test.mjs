import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/assistant.js';
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
function prepare(t, readable = true) {
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
    else if (url.includes('/docs_published?')) {
      assert.equal(options.headers.apikey, 'public-test-key');
      assert.equal(options.headers.Authorization, 'Bearer viewer-test-token');
      data = readable
        ? [
            {
              id,
              title: 'Booking guide',
              slug: 'booking-guide',
              kind: 'documentation',
              body: 'Track booking progress in the customer app.',
            },
          ]
        : [];
    } else if (url.endsWith('/chat/completions')) {
      generations++;
      const body = JSON.parse(options.body);
      assert.equal(body.model, 'nvidia/nemotron-3.5-lightning-free');
      data = {
        choices: [
          {
            finish_reason: body.reasoning?.effort === 'none' ? 'stop' : 'length',
            message: {
              content: body.reasoning?.effort === 'none' ? 'Track booking progress [1].' : '',
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
  assert.equal(res.data.sources[0].url, '/docs/booking-guide');
  assert.equal(generations(), 1);
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
