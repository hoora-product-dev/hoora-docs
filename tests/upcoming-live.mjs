import { loadEnvFile } from 'node:process';
import assert from 'node:assert/strict';
import { serverClient, serverKeyHeaders } from '../server/supabase.js';
try {
  loadEnvFile();
} catch {}
const base = process.env.HOORA_TEST_BASE_URL || 'http://localhost:5173';
const call = serverClient();
const admins = await call(
  '/rest/v1/docs_members?role=eq.admin&active=eq.true&password_setup_complete=eq.true&select=email&limit=1',
);
assert.ok(admins[0], 'An active administrator is required.');
const generated = await call('/auth/v1/admin/generate_link', {
  method: 'POST',
  body: JSON.stringify({ type: 'magiclink', email: admins[0].email }),
});
const verified = await call('/auth/v1/verify', {
  method: 'POST',
  body: JSON.stringify({ type: 'magiclink', token_hash: generated.hashed_token }),
});
const token = verified.access_token;
const api = async (body) => {
  const response = await fetch(base + '/api/upcoming', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw Error(response.status + ': ' + data.error);
  return data;
};
let release;
try {
  const denied = await fetch(base + '/api/upcoming', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'list' }),
  });
  assert.equal(denied.status, 401);
  for (const table of ['docs_upcoming_releases', 'docs_upcoming_rate_limits']) {
    const r = await fetch(process.env.SUPABASE_URL + '/rest/v1/' + table + '?select=*', {
      headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token },
    });
    assert.ok([401, 403].includes(r.status), 'Browser database role must not read ' + table);
  }
  const result = await api({
    action: 'save',
    title: 'Verification ' + Date.now(),
    version: 'check',
    filterUrl: 'https://hooratechteam.atlassian.net/issues?filter=12576',
    enabled: false,
  });
  release = result.release;
  assert.equal(release.enabled, false);
  assert.ok((await api({ action: 'list' })).releases.some((r) => r.id === release.id));
  const changed = await api({
    action: 'save',
    id: release.id,
    updatedAt: release.updatedAt,
    title: release.title,
    version: 'check-updated',
    releaseDate: '2026-11-20',
    filterUrl: release.filterUrl,
    enabled: false,
  });
  release = changed.release;
  assert.equal(release.version, 'check-updated');
  const connection = await api({ action: 'connection' });
  if (process.env.HOORA_REQUIRE_JIRA === 'true')
    assert.ok(connection.configured, 'Production Jira connection must be configured.');
  if (connection.configured) {
    const shared = await api({
      action: 'save',
      id: release.id,
      updatedAt: release.updatedAt,
      title: release.title,
      version: release.version,
      releaseDate: release.releaseDate,
      filterUrl: release.filterUrl,
      enabled: true,
    });
    release = shared.release;
    const listed = await api({ action: 'tickets', id: release.id });
    assert.ok(listed.tickets.length > 0);
    assert.ok(listed.verticals.length > 0);
    assert.ok(listed.owners.length > 0);
    const detail = await api({ action: 'ticket', id: release.id, key: listed.tickets[0].key });
    assert.equal(detail.ticket.key, listed.tickets[0].key);
    assert.ok(detail.ticket.title);
    console.log(
      'PASS Live Jira: publish validation, ' +
        listed.tickets.length +
        ' titles, vertical/owner options, and ticket details.',
    );
  }
  const conflict = await fetch(base + '/api/upcoming', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'delete', id: release.id, updatedAt: '2020-01-01T00:00:00Z' }),
  });
  assert.equal(conflict.status, 409);
  await api({ action: 'delete', id: release.id, updatedAt: release.updatedAt });
  release = null;
  console.log(
    'PASS Live database: anonymous denial, browser-role table isolation, administrator create/update/delete and edit conflict protection.',
  );
} finally {
  if (release) await api({ action: 'delete', id: release.id, updatedAt: release.updatedAt });
  await fetch(process.env.SUPABASE_URL + '/auth/v1/logout?scope=local', {
    method: 'POST',
    headers: {
      ...serverKeyHeaders(process.env.SUPABASE_SERVICE_ROLE_KEY),
      Authorization: 'Bearer ' + token,
    },
  }).catch(() => {});
}
