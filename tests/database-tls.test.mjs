import test from 'node:test';
import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { databaseOptions } from '../scripts/database-options.mjs';
test('Database maintenance verifies the Supabase CA and preserves its project guard', () => {
  const options = databaseOptions({
    SUPABASE_URL: 'https://jrjkxddjwcphdmjeqyfq.supabase.co',
    SUPABASE_DB_PASSWORD: 'test-only',
  });
  assert.equal(options.ssl.rejectUnauthorized, true);
  assert.equal(new X509Certificate(options.ssl.ca).ca, true);
  assert.match(new X509Certificate(options.ssl.ca).subject, /Supabase Root 2021 CA/);
  assert.throws(() =>
    databaseOptions({
      SUPABASE_URL: 'https://other.supabase.co',
      SUPABASE_DB_PASSWORD: 'test-only',
    }),
  );
});
