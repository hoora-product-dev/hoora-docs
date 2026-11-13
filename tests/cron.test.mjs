import test from 'node:test';
import assert from 'node:assert/strict';
import { isScheduledRun } from '../server/cron.js';

const secret = 'a-long-random-cron-secret-value';
const request = (headers) => ({ headers });

test('Scheduled jobs run only with the CRON_SECRET bearer that Vercel sends', () => {
  assert.equal(isScheduledRun(request({ authorization: `Bearer ${secret}` }), secret), true);
  assert.equal(
    isScheduledRun(request({ authorization: 'Bearer wrong-secret-value-here' }), secret),
    false,
  );
  assert.equal(isScheduledRun(request({}), secret), false);
});

test('Spoofable cron headers are not enough', () => {
  const vercelShaped = request({
    'user-agent': 'vercel-cron/1.0',
    'x-vercel-cron-schedule': '15 2 * * *',
    'x-vercel-cron': '1',
  });
  assert.equal(isScheduledRun(vercelShaped, secret), false);
  assert.equal(isScheduledRun(vercelShaped, undefined), false, 'no secret configured means no run');
  assert.equal(isScheduledRun(request({ authorization: 'Bearer short' }), 'short'), false);
});
