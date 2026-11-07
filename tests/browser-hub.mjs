import { pasteScreenshot } from './helpers/editor-files.mjs';
import { cleanupDeletedFiles } from '../api/content.js';
import { chromium } from 'playwright';
import { loadEnvFile } from 'node:process';
import { serverClient } from '../server/supabase.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import assert from 'node:assert/strict';
loadEnvFile();
const call = serverClient(),
  base = process.env.HOORA_TEST_BASE_URL || 'http://localhost:3002',
  url = process.env.SUPABASE_URL,
  key = process.env.SUPABASE_ANON_KEY;
if (!url.includes('jrjkxddjwcphdmjeqyfq')) throw Error('Wrong project');
const users = [],
  teamIds = [],
  docIds = [],
  paths = [],
  errors = [];
let browser;
const suffix = crypto.randomUUID().slice(0, 8);
await mkdir('test-results', { recursive: true });
async function user(role) {
  const email = `browser-hub-${role}-${suffix}@hoora.me`,
    password = crypto.randomUUID() + 'Aa!';
  const u = await call('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  users.push(u.id);
  await call('/rest/v1/docs_members', {
    method: 'POST',
    body: JSON.stringify({
      id: u.id,
      email,
      name: 'Test ' + role,
      role,
      password_setup_complete: true,
    }),
  });
  const r = await fetch(url + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const session = await r.json();
  assert.ok(session.access_token);
  return {
    id: u.id,
    email,
    session: { ...session, expires_at: Date.now() / 1000 + session.expires_in },
  };
}
async function context(who) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  if (who)
    await ctx.addInitScript((session) => {
      if (window === window.top) localStorage.setItem('hoora-session', JSON.stringify(session));
    }, who.session);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  return { ctx, p };
}
async function waitText(p, text) {
  await p.getByText(text, { exact: true }).first().waitFor({ timeout: 15000 });
}
try {
  const manager = await user('manager'),
    viewer = await user('viewer'),
    admin = await user('admin');
  browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  });
  const { p } = await context(manager);
  await p.goto(base + '/teams');
  await p.getByRole('button', { name: 'New team', exact: true }).click();
  await p.getByLabel('Team name', { exact: true }).fill('Interface test ' + suffix);
  await p.getByRole('button', { name: 'Create team', exact: true }).click();
  await p.getByRole('link', { name: new RegExp('Interface test ' + suffix) }).click();
  await p.getByRole('heading', { name: 'Interface test ' + suffix, exact: true }).waitFor();
  const [team] = await call(
    '/rest/v1/docs_teams?name=eq.' + encodeURIComponent('Interface test ' + suffix),
  );
  teamIds.push(team.id);
  await p.getByRole('button', { name: 'Add people', exact: true }).click();
  await p.getByLabel('Hoora work emails').fill(viewer.email);
  await p.getByRole('button', { name: 'Save access', exact: true }).click();
  await waitText(p, viewer.email);
  console.log('PASS Manager creates team and grants reader access through UI');
  await p.getByRole('link', { name: 'New team document', exact: true }).click();
  await p.getByLabel('Document title', { exact: true }).fill('Browser guide ' + suffix);
  await p.getByLabel('Short description').fill('A temporary browser verification guide.');
  await p.getByRole('button', { name: 'Markdown source', exact: true }).click();
  await p
    .locator('#body')
    .fill('# Getting started\n\n## Team workflow\n\n**Read this guide** before publishing.');
  await pasteScreenshot(p, '#body');
  await p.waitForFunction(() => document.querySelector('#body').value.includes('.webp)'));
  await p.getByRole('button', { name: 'Write', exact: true }).click();
  await p.locator('[contenteditable=true]').waitFor();
  await pasteScreenshot(p, '[contenteditable=true]', 'visual.png');
  await p.waitForFunction(
    () => (document.querySelector('#body').value.match(/!\[/g) || []).length === 2,
  );
  await p.waitForFunction(
    () =>
      [...document.querySelectorAll('[contenteditable] img')].length === 2 &&
      [...document.querySelectorAll('[contenteditable] img')].every(
        (img) => img.complete && img.naturalWidth > 0,
      ),
  );
  await p.screenshot({ path: 'test-results/editor-desktop.png' });
  await p.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    'Mobile editor must fit the screen',
  );
  await p.screenshot({ path: 'test-results/editor-mobile.png' });
  await p.setViewportSize({ width: 1440, height: 1000 });
  await p.getByLabel('More actions', { exact: true }).click();
  await p.locator('.editor-top [data-action="open-draft-preview"]').click();
  await p.getByRole('heading', { name: 'Browser guide ' + suffix, exact: true }).waitFor();
  const [doc] = await call(
    '/rest/v1/docs_pages?title=eq.' + encodeURIComponent('Browser guide ' + suffix),
  );
  docIds.push(doc.id);
  await p.getByRole('link', { name: 'Back to editing', exact: true }).click();
  await p.locator('.editor-top [data-action="publish"]').click();
  await p
    .getByRole('link', { name: 'View published', exact: true, includeHidden: true })
    .first()
    .waitFor({ state: 'attached' });
  await p.getByLabel('More actions', { exact: true }).click();
  await p.getByRole('link', { name: 'View published', exact: true }).first().waitFor();
  await p.getByRole('link', { name: 'View published', exact: true }).first().click();
  await p.waitForURL('**/docs/' + doc.slug);
  await p.getByRole('heading', { name: 'Team workflow', exact: true }).waitFor();
  assert.equal(new URL(p.url()).pathname, '/docs/' + doc.slug);
  console.log('PASS Markdown source → saved preview → publication → clean document URL');
  await p.getByRole('button', { name: 'Share', exact: true }).click();
  await p.getByLabel('Who can view').selectOption('restricted');
  await p.getByLabel('People with access').fill(viewer.email);
  await p.getByRole('button', { name: 'Save access', exact: true }).click();
  await p.locator('dialog').waitFor({ state: 'hidden' });
  console.log('PASS Manager configures selected-email sharing');
  const { p: vp } = await context(viewer);
  await vp.goto(base + '/docs/' + doc.slug);
  await vp.getByRole('heading', { name: 'Team workflow', exact: true }).waitFor();
  assert.equal(await vp.getByRole('link', { name: 'Edit page', exact: true }).count(), 0);
  assert.equal(await vp.getByRole('button', { name: 'Notify readers', exact: true }).count(), 0);
  console.log('PASS Viewer reads shared page without editing or notice controls');
  const { p: anon } = await context();
  await anon.goto(base + '/docs/' + doc.slug);
  await anon.getByRole('heading', { name: 'Sign in to continue', exact: true }).waitFor();
  console.log('PASS Anonymous direct private URL requires sign-in');
  await p.keyboard.press('Control+k');
  await p.locator('#global-query').fill('Browser guide ' + suffix);
  await p.locator('#global-results a').first().waitFor();
  await p.keyboard.press('ArrowDown');
  await p.keyboard.press('Enter');
  await p.locator('dialog').waitFor({ state: 'hidden' });
  console.log('PASS Search works with keyboard selection');
  await p.screenshot({ path: 'test-results/team-document.png' });
  await p.goto(base + '/workspace');
  await p.getByRole('heading', { name: 'All documents', exact: true }).waitFor();
  await p.screenshot({ path: 'test-results/library-desktop.png' });
  await p.getByRole('button', { name: 'Add link / PDF', exact: true }).click();
  await p
    .getByLabel('URL', { exact: true })
    .fill('https://docs.google.com/document/d/test-document/edit');
  await p.getByLabel('Title', { exact: true }).fill('Browser link ' + suffix);
  await p.getByLabel('Team', { exact: true }).selectOption(team.id);
  await p.getByRole('button', { name: 'Publish asset', exact: true }).click();
  await p
    .getByRole('heading', { name: 'Browser link ' + suffix, exact: true })
    .first()
    .waitFor();
  const [link] = await call(
    '/rest/v1/docs_pages?title=eq.' + encodeURIComponent('Browser link ' + suffix),
  );
  docIds.push(link.id);
  await p.getByRole('link', { name: 'Open Google Docs', exact: true }).waitFor();
  console.log('PASS Link auto-detection and intentional provider fallback');
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText('Hoora secure PDF test');
  pdf.addPage().drawText('Second page');
  await writeFile('test-results/browser-guide.pdf', await pdf.save());
  await p.goto(base + '/workspace');
  await p.getByRole('button', { name: 'Add link / PDF', exact: true }).click();
  await p.getByLabel('What are you adding?').selectOption('pdf');
  await p.locator('#asset-pdf').setInputFiles('test-results/browser-guide.pdf');
  await p.getByLabel('Title', { exact: true }).fill('Browser PDF ' + suffix);
  await p.getByLabel('Team', { exact: true }).selectOption(team.id);
  await p.getByRole('button', { name: 'Publish asset', exact: true }).click();
  await p.getByText('Page 1 of 2', { exact: true }).waitFor({ timeout: 30000 });
  const [pdfPage] = await call(
    '/rest/v1/docs_pages?title=eq.' + encodeURIComponent('Browser PDF ' + suffix),
  );
  docIds.push(pdfPage.id);
  paths.push(pdfPage.file_metadata.storage_path);
  await p.getByRole('button', { name: 'Next', exact: true }).click();
  await p.getByText('Page 2 of 2', { exact: true }).waitFor();
  await p.screenshot({ path: 'test-results/pdf-preview.png' });
  console.log('PASS Secure PDF upload, embedded preview and page navigation');
  await p.goto(base + '/docs/' + doc.slug);
  await p.getByRole('button', { name: 'Manage related knowledge', exact: true }).click();
  await p.getByLabel('Browser link ' + suffix, { exact: true }).check();
  await p.getByRole('button', { name: 'Save connections', exact: true }).click();
  await p.getByRole('heading', { name: 'Related knowledge', exact: true }).waitFor();
  await vp.goto(base + '/docs/' + doc.slug);
  await vp
    .getByRole('link', { name: 'Documentation Browser link ' + suffix, exact: true })
    .waitFor();
  console.log('PASS Bidirectional related knowledge respects reader access');
  await call('/rest/v1/rpc/docs_notify', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + manager.session.access_token },
    body: JSON.stringify({ document_id: doc.id }),
  });
  await vp.goto(base + '/notifications');
  await vp.getByRole('heading', { name: 'Browser guide ' + suffix, exact: true }).waitFor();
  await vp
    .locator('[data-notice-read]')
    .filter({ has: vp.getByRole('heading', { name: 'Browser guide ' + suffix, exact: true }) })
    .click();
  await vp.waitForURL('**/docs/' + doc.slug);
  console.log('PASS Permission-aware inbox opens the exact document');
  const manifest = await (await p.request.get(base + '/manifest.webmanifest')).json();
  assert.equal(manifest.display, 'standalone');
  for (const icon of manifest.icons)
    assert.equal((await p.request.get(base + icon.src)).status(), 200);
  assert.ok(await p.evaluate(async () => !!(await navigator.serviceWorker.ready)));
  console.log('PASS Installable manifest, icons and service worker registration');
  await p.goto(base + '/new?team=' + team.id);
  await p.getByRole('button', { name: 'HTML artifact', exact: true }).click();
  await p
    .locator('#html-source')
    .fill(
      '<!doctype html><html><head><title>Browser artifact ' +
        suffix +
        '</title></head><body><h1>Interactive artifact</h1><button id="test" onclick="this.textContent=\'Clicked\'">Run action</button></body></html>',
    );
  await p.getByRole('button', { name: 'Use pasted HTML', exact: true }).click();
  await p.locator('[data-artifact] iframe').waitFor();
  const [artifact] = await call(
    '/rest/v1/docs_pages?title=eq.' + encodeURIComponent('Browser artifact ' + suffix),
  );
  docIds.push(artifact.id);
  paths.push(artifact.artifact_path);
  await p.locator('.editor-top [data-action="publish"]').click();
  await p
    .getByRole('link', { name: 'View published', exact: true, includeHidden: true })
    .first()
    .waitFor({ state: 'attached' });
  await p.getByLabel('More actions', { exact: true }).click();
  await p.getByRole('link', { name: 'View published', exact: true }).first().click();
  await p.getByRole('link', { name: 'Open full-page HTML preview', exact: true }).click();
  await p.locator('.native-artifact').waitFor();
  const frame = p.frameLocator('[data-artifact] iframe');
  await frame.getByRole('button', { name: 'Run action', exact: true }).click();
  await frame.getByRole('button', { name: 'Clicked', exact: true }).waitFor();
  assert.equal(await p.locator('.native-artifact').count(), 1);
  console.log(
    'PASS Pasted standalone HTML uploads, publishes and runs in full-page isolated preview',
  );
  const { p: ap } = await context(admin);
  await ap.goto(base + '/docs/' + doc.slug);
  await ap.getByRole('button', { name: 'Archive', exact: true }).click();
  await ap.locator('dialog').getByRole('button', { name: 'Archive', exact: true }).click();
  await ap.waitForURL('**/workspace');
  await vp.goto(base + '/docs/' + doc.slug);
  await vp.getByRole('heading', { name: 'Document unavailable', exact: true }).waitFor();
  await ap.goto(base + '/archive');
  await ap
    .locator('.structure-row')
    .filter({ hasText: 'Browser guide ' + suffix })
    .getByRole('button', { name: 'Restore', exact: true })
    .click();
  await ap.locator('dialog').getByRole('button', { name: 'Restore', exact: true }).click();
  await ap.locator('dialog').waitFor({ state: 'hidden' });
  await vp.goto(base + '/docs/' + doc.slug);
  await vp.getByRole('heading', { name: 'Team workflow', exact: true }).waitFor();
  console.log('PASS Administrator archive/restore updates shared document access');
  await ap.goto(base + '/docs/' + pdfPage.slug);
  await ap.getByRole('button', { name: 'Archive', exact: true }).click();
  await ap.locator('dialog').getByRole('button', { name: 'Archive', exact: true }).click();
  await ap.waitForURL('**/workspace');
  await ap.goto(base + '/archive');
  await ap
    .locator('.structure-row')
    .filter({ hasText: 'Browser PDF ' + suffix })
    .getByRole('button', { name: 'Delete permanently', exact: true })
    .click();
  await ap
    .locator('dialog')
    .getByRole('button', { name: 'Delete permanently', exact: true })
    .click();
  await ap.locator('dialog').waitFor({ state: 'hidden' });
  assert.equal((await call('/rest/v1/docs_pages?id=eq.' + pdfPage.id)).length, 0);
  assert.equal(
    (
      await call('/storage/v1/object/list/hoora-docs', {
        method: 'POST',
        body: JSON.stringify({ prefix: pdfPage.id, limit: 100 }),
      })
    ).length,
    0,
  );
  console.log('PASS Permanent deletion also removes uploaded PDF storage');
  await p.setViewportSize({ width: 390, height: 844 });
  await p.goto(base + '/teams');
  await p.getByRole('heading', { name: 'Your teams', exact: true }).waitFor();
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await p.getByRole('button', { name: 'Switch light or dark theme' }).click();
  await p.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  assert.equal(await p.locator('html').getAttribute('data-theme'), 'light');
  assert.equal(await p.locator('.logo-light').isVisible(), true);
  await p.screenshot({ path: 'test-results/teams-mobile-dark.png' });
  console.log('PASS Mobile team workspace and supplied dark-mode logo');
  assert.deepEqual(errors, [], 'Browser errors: ' + errors.join('; '));
  console.log('All browser workflows passed.');
} finally {
  await browser?.close();
  for (const id of teamIds) {
    const docs = await call('/rest/v1/docs_pages?team_id=eq.' + id + '&select=id,artifact_path');
    for (const d of docs) {
      if (!docIds.includes(d.id)) docIds.push(d.id);
      if (d.artifact_path && !paths.includes(d.artifact_path)) paths.push(d.artifact_path);
    }
  }
  if (paths.length)
    await call('/storage/v1/object/hoora-docs', {
      method: 'DELETE',
      body: JSON.stringify({ prefixes: paths }),
    });
  for (const id of docIds) await call('/rest/v1/docs_pages?id=eq.' + id, { method: 'DELETE' });
  for (const id of teamIds) await call('/rest/v1/docs_teams?id=eq.' + id, { method: 'DELETE' });
  await cleanupDeletedFiles(call);
  for (const id of users) await call('/auth/v1/admin/users/' + id, { method: 'DELETE' });
}
