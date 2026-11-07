import { pasteScreenshot } from './helpers/editor-files.mjs';
import { chromium } from 'playwright';
import { loadEnvFile } from 'node:process';
import assert from 'node:assert/strict';
import { serverClient } from '../server/supabase.js';
import { cleanupDeletedFiles } from '../api/content.js';
import { mkdir } from 'node:fs/promises';
loadEnvFile();
const call = serverClient(),
  url = process.env.SUPABASE_URL,
  key = process.env.SUPABASE_ANON_KEY,
  base = process.env.HOORA_TEST_BASE_URL || 'http://localhost:3000';
if (!url.includes('jrjkxddjwcphdmjeqyfq')) throw Error('Wrong project');
const suffix = crypto.randomUUID().slice(0, 8),
  appId = crypto.randomUUID(),
  sectionId = crypto.randomUUID();
let userId, releaseId, browser;
await mkdir('test-results', { recursive: true });
try {
  const email = 'release-browser-' + suffix + '@hoora.me',
    password = crypto.randomUUID() + 'Aa!';
  const user = await call('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  userId = user.id;
  await call('/rest/v1/docs_members', {
    method: 'POST',
    body: JSON.stringify({
      id: userId,
      email,
      name: 'Temporary Release Administrator',
      role: 'admin',
      password_setup_complete: true,
    }),
  });
  const response = await fetch(url + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const session = await response.json();
  assert.ok(session.access_token);
  await call('/rest/v1/docs_projects', {
    method: 'POST',
    body: JSON.stringify({ id: appId, name: 'Release UI ' + suffix, visibility: 'private' }),
  });
  await call('/rest/v1/docs_verticals', {
    method: 'POST',
    body: JSON.stringify({
      id: sectionId,
      name: 'Section UI ' + suffix,
      icon: 'car',
      color: 'blue',
    }),
  });
  await call('/rest/v1/docs_project_sections', {
    method: 'POST',
    body: JSON.stringify({ project_id: appId, vertical_id: sectionId }),
  });
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript((s) => {
    if (window === top)
      localStorage.setItem(
        'hoora-session',
        JSON.stringify({ ...s, expires_at: Date.now() / 1000 + s.expires_in }),
      );
  }, session);
  const p = await context.newPage(),
    errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(base + '/releases?project=release-ui-' + suffix);
  await p.getByRole('heading', { name: 'Release UI ' + suffix, exact: true }).waitFor();
  await p.getByRole('button', { name: 'New release', exact: true }).click();
  await p.locator('#contribution-form').waitFor();
  assert.equal(await p.locator('dialog[open]').count(), 0);
  assert.equal(await p.getByLabel('Platform', { exact: true }).inputValue(), appId);
  await p.getByLabel('Version', { exact: true }).fill('1.2.3');
  await p.getByLabel('Section', { exact: true }).selectOption(sectionId);
  await p.getByLabel('Contribution heading', { exact: true }).fill('Improved booking workflow');
  await p.locator('[data-entry-view="source"]').click();
  await p
    .locator('#entry-body')
    .fill('## What changed\n\n- Clearer booking steps\n- **Faster** assignment');
  await pasteScreenshot(p, '#entry-body');
  await p.waitForFunction(() => document.querySelector('#entry-body').value.includes('.webp)'));
  releaseId = (await call('/rest/v1/docs_releases?project_id=eq.' + appId))[0].id;
  await p.getByRole('button', { name: 'Save draft', exact: true }).click();
  await p.getByText('Draft saved', { exact: true }).first().waitFor();
  assert.ok(await p.locator('#contribution-form').isVisible(), 'Saving retains the writing page');
  assert.ok((await p.locator('#entry-body').inputValue()).includes('Clearer booking steps'));
  assert.equal(
    (await call('/rest/v1/docs_published?id=eq.' + releaseId)).length,
    0,
    'Saving must not publish',
  );
  await p.screenshot({ path: 'test-results/release-writing-desktop.png' });
  for (const width of [320, 390, 768, 1440]) {
    await p.setViewportSize({ width, height: 1000 });
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await p.getByRole('button', { name: 'Publish release', exact: true }).click();
  await p.getByRole('heading', { name: 'Version 1.2.3', exact: true }).waitFor();
  await p
    .locator('.contribution')
    .first()
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  await p.locator('#contribution-form').waitFor();
  await p.getByRole('button', { name: 'Save draft', exact: true }).click();
  await p.getByText('Draft saved', { exact: true }).first().waitFor();
  assert.equal(
    (await call('/rest/v1/docs_entries?release_id=eq.' + releaseId))[0].submitted,
    true,
    'Saving existing notes preserves readiness unless the author changes it',
  );
  await p.getByRole('button', { name: 'Mark ready', exact: true }).click();
  await p.getByRole('heading', { name: 'Version 1.2.3', exact: true }).waitFor();
  await p.getByRole('link', { name: 'Preview', exact: true }).click();
  await p.getByText('Saved draft preview · not published', { exact: true }).waitFor();
  await p.getByRole('heading', { name: 'Improved booking workflow', exact: true }).waitFor();
  await p.getByRole('link', { name: 'Back to editing', exact: true }).click();
  await p.getByLabel('More actions', { exact: true }).click();
  await p.getByRole('link', { name: 'Edit details', exact: true }).click();
  await p.locator('#release-details-form').waitFor();
  assert.equal(await p.locator('dialog[open]').count(), 0);
  await p.getByLabel('Summary', { exact: true }).fill('A clear first release summary.');
  await p.getByRole('button', { name: 'Save settings', exact: true }).click();
  await p.getByRole('heading', { name: 'Version 1.2.3', exact: true }).waitFor();
  await p.getByLabel('More actions', { exact: true }).click();
  await p.getByRole('link', { name: 'View published', exact: true }).click();
  await p.waitForURL('**/release-notes/1.2.3/release-ui-' + suffix);
  await p.locator('.native-release-document').waitFor();
  await p.getByRole('heading', { name: 'Improved booking workflow', exact: true }).waitFor();
  await p.locator('#app[aria-busy="false"]').waitFor();
  await p.screenshot({ path: 'test-results/release-published.png' });
  console.log(
    'PASS One-page platform/version/section writing, WebP paste, retained private draft, direct publication and ready contribution flow',
  );
  await p.getByRole('link', { name: 'Edit my contribution', exact: true }).click();
  await p.getByLabel('More actions', { exact: true }).click();
  await p.getByRole('button', { name: 'Email announcement', exact: true }).click();
  await p.getByText('rahul@hoora.me', { exact: true }).waitFor();
  assert.equal(await p.getByRole('button', { name: 'Send test to Rahul', exact: true }).count(), 1);
  await p.screenshot({ path: 'test-results/admin-email-preview.png' });
  await p.getByRole('button', { name: 'Close', exact: true }).click();
  console.log('PASS Administrator email template previews without sending');
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  if (releaseId) await call('/rest/v1/docs_pages?id=eq.' + releaseId, { method: 'DELETE' });
  await call('/rest/v1/docs_projects?id=eq.' + appId, { method: 'DELETE' });
  await call('/rest/v1/docs_verticals?id=eq.' + sectionId, { method: 'DELETE' });
  await cleanupDeletedFiles(call);
  if (userId) await call('/auth/v1/admin/users/' + userId, { method: 'DELETE' });
}
