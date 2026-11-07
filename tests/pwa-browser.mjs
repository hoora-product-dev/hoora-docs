import { chromium } from 'playwright';
import { loadEnvFile } from 'node:process';
import { serverClient } from '../server/supabase.js';
import assert from 'node:assert/strict';
try {
  loadEnvFile();
} catch {}
const base = process.env.HOORA_TEST_BASE_URL || 'http://localhost:5174';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let session;
try {
  const anonymous = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await anonymous.addInitScript(() =>
    Object.defineProperty(navigator, 'standalone', { get: () => true }),
  );
  const first = await anonymous.newPage();
  await first.goto(base + '/app');
  await first.getByRole('heading', { name: 'Continue to Hoora Docs', exact: true }).waitFor();
  assert.equal(new URL(first.url()).pathname, '/login');
  await anonymous.close();
  const call = serverClient(),
    [member] = await call(
      '/rest/v1/docs_members?role=eq.admin&active=eq.true&password_setup_complete=eq.true&select=email&limit=1',
    );
  const link = await call('/auth/v1/admin/generate_link', {
    method: 'POST',
    body: JSON.stringify({ type: 'magiclink', email: member.email }),
  });
  session = await call('/auth/v1/verify', {
    method: 'POST',
    body: JSON.stringify({ type: 'magiclink', token_hash: link.hashed_token }),
  });
  session.expires_at = Date.now() / 1000 + session.expires_in;
  const signed = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await signed.addInitScript((s) => {
    Object.defineProperty(navigator, 'standalone', { get: () => true });
    localStorage.setItem('hoora-session', JSON.stringify(s));
  }, session);
  const page = await signed.newPage();
  await page.goto(base + '/app');
  await page.locator('.app-welcome-card').waitFor();
  await page.locator('[data-action=app-continue]').click();
  await page
    .getByRole('heading', { name: 'Hoora knowledge, in one place.', exact: true })
    .waitFor();
  await page.goto(base + '/home');
  await page
    .getByRole('heading', { name: 'Hoora knowledge, in one place.', exact: true })
    .waitFor();
  assert.equal(await page.locator('.footer-install').count(), 0);
  await page.goto(base + '/app');
  await page
    .getByRole('heading', { name: 'Hoora knowledge, in one place.', exact: true })
    .waitFor();
  console.log(
    'PASS Installed-app emulation: login first, notification choice, releases home, returning launch and hidden install promotion.',
  );
} finally {
  await browser.close();
  if (session)
    await fetch(process.env.SUPABASE_URL + '/auth/v1/logout?scope=local', {
      method: 'POST',
      headers: {
        apikey: process.env.SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + session.access_token,
      },
    }).catch(() => {});
}
