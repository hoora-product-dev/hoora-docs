import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSource } from '../public/sources.js';
import { validSubscription } from '../api/push.js';
test('Link sources are detected from exact provider hosts, with safe HTTPS fallback', () => {
  assert.equal(detectSource('https://docs.google.com/document/d/abc/edit').type, 'GOOGLE_DOC');
  assert.equal(
    detectSource('https://docs.google.com/spreadsheets/d/abc/edit').type,
    'GOOGLE_SHEET',
  );
  assert.equal(
    detectSource('https://docs.google.com/presentation/d/abc/edit').type,
    'GOOGLE_SLIDE',
  );
  assert.equal(detectSource('https://hoora.sharepoint.com/:x:/r/example').type, 'MICROSOFT_SHEET');
  assert.equal(detectSource('https://app.powerbi.com/reportEmbed?id=1').type, 'DASHBOARD');
  assert.equal(
    detectSource('https://docs.google.com.attacker.test/document/d/fake').type,
    'OTHER_URL',
  );
  assert.throws(() => detectSource('javascript:alert(1)'));
  assert.throws(() => detectSource('https://user:secret@example.com'));
  assert.throws(() => detectSource('http://example.com'));
});
test('Push subscriptions reject arbitrary network destinations and malformed encryption keys', () => {
  const keys = { p256dh: 'a'.repeat(87), auth: 'b'.repeat(22) };
  assert.equal(
    validSubscription({ endpoint: 'https://fcm.googleapis.com/fcm/send/test', keys }),
    true,
  );
  for (const endpoint of [
    'http://fcm.googleapis.com/fcm/send/test',
    'https://localhost/private',
    'https://127.0.0.1/',
    'https://fcm.googleapis.com.attacker.test/test',
    'https://fcm.googleapis.com:8443/test',
    'https://user@fcm.googleapis.com/test',
  ])
    assert.equal(validSubscription({ endpoint, keys }), false);
  assert.equal(validSubscription({ endpoint: 'https://fcm.googleapis.com/test', keys: {} }), false);
});
