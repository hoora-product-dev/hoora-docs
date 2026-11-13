/**
 * End-to-end check of Access, Share, Devices and the settings pages, signed in as an
 * administrator through a short-lived session that is signed out at the end.
 * Every grant or membership the test creates uses a test email and is removed again.
 */
import { chromium } from 'playwright';
import { loadEnvFile } from 'node:process';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { serverClient } from '../server/supabase.js';
try {
  loadEnvFile();
} catch {}
const base = process.env.HOORA_TEST_BASE_URL || 'http://localhost:3000';
const testEmail = 'e2e-access-check@hoora.me';
const call = serverClient();
const out = 'test-results/access';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
const results = [];
let session;
const ready = async (page) => {
  try {
    await page.waitForFunction(
      () => document.querySelector('main') && !document.body.classList.contains('vehicle-loading'),
      {},
      { timeout: 30000 },
    );
  } catch (error) {
    await page.screenshot({ path: `${out}/timeout.png`, fullPage: true }).catch(() => {});
    const body = await page.evaluate(() => document.body.innerText.slice(0, 600)).catch(() => '');
    throw new Error(
      `${page.url()} did not finish loading. Errors: ${JSON.stringify(errors.slice(-5))} Page: ${body}`,
    );
  }
};
// The local server sends shared-link paths through the preview handler, which uses the
// production bundle; hash routes load the source directly, here and in production.
const at = (route) => `${base}/#/${route.replace(/^docs\//, 'doc/')}`;
const settle = (page) => page.waitForLoadState('networkidle').catch(() => {});

async function cleanup() {
  const grants = await call(`/rest/v1/docs_access_grants?email=eq.${testEmail}&select=id`);
  const members = await call(`/rest/v1/docs_team_members?email=eq.${testEmail}&select=team_id`);
  if (grants.length)
    await call(`/rest/v1/docs_access_grants?email=eq.${testEmail}`, { method: 'DELETE' });
  if (members.length)
    await call(`/rest/v1/docs_team_members?email=eq.${testEmail}`, { method: 'DELETE' });
  await call(`/rest/v1/docs_audit_log?metadata->>email=eq.${testEmail}`, {
    method: 'DELETE',
  }).catch(() => {});
  return { grants: grants.length, members: members.length };
}

try {
  const [member] = await call(
    '/rest/v1/docs_members?role=eq.admin&active=eq.true&password_setup_complete=eq.true&select=email&order=created_at&limit=1',
  );
  const generated = await call('/auth/v1/admin/generate_link', {
    method: 'POST',
    body: JSON.stringify({ type: 'magiclink', email: member.email }),
  });
  session = await call('/auth/v1/verify', {
    method: 'POST',
    body: JSON.stringify({ type: 'magiclink', token_hash: generated.hashed_token }),
  });
  session.expires_at = Date.now() / 1000 + session.expires_in;
  await cleanup();
  const [doc] = await call(
    '/rest/v1/docs_published?kind=neq.release&select=id,slug,title&order=published_at.desc&limit=1',
  );
  const teams = await call('/rest/v1/docs_teams?select=id,slug,name&order=name');
  const roster = await call('/rest/v1/docs_team_members?select=team_id');
  const emptyTeam = teams.find((t) => !roster.some((m) => m.team_id === t.id)) || teams.at(-1);

  const open = async (theme, width) => {
    const ctx = await browser.newContext({
      viewport: { width, height: 1000 },
      reducedMotion: 'reduce',
    });
    await ctx.addInitScript(
      ([s, t]) => {
        localStorage.setItem('hoora-session', JSON.stringify(s));
        localStorage.setItem('hoora-theme', t);
      },
      [session, theme],
    );
    const page = await ctx.newPage();
    page.on('pageerror', (error) =>
      errors.push({ theme, width, url: page.url(), error: error.message }),
    );
    page.on('console', (message) => {
      if (message.type() === 'error' && !/favicon|Failed to load resource/.test(message.text()))
        errors.push({ theme, width, url: page.url(), error: message.text() });
    });
    return { ctx, page };
  };

  // 1. Every settings and reading page at phone and desktop widths, in both themes.
  const routes = [
    'access',
    'access?tab=teams&team=unassigned',
    'access?tab=people',
    'access?tab=content',
    'access?tab=content&node=collection%3Arelease',
    ...(doc ? [`access?tab=content&node=page%3A${doc.id}`, `docs/${doc.slug}`] : []),
    `access?tab=teams&team=${emptyTeam.slug}`,
    'account',
    'activity',
    'folders',
    'feedback',
    'home',
    'releases',
    'workspace',
    'notifications',
  ];
  for (const theme of ['light', 'dark'])
    for (const width of [390, 1440]) {
      const { ctx, page } = await open(theme, width);
      for (const route of routes) {
        await page.goto(at(route));
        await ready(page);
        await settle(page);
        const check = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth - innerWidth,
          heading: document.querySelector('main h1, main .access-title')?.textContent?.trim(),
          error: document.querySelector('.content-error')?.textContent,
          stray: /\bundefined\b|\[object Object\]/.test(
            document.querySelector('main')?.innerText || '',
          ),
          clipped: [...document.querySelectorAll('.access-tablewrap')].some(
            (wrap) => wrap.scrollWidth > wrap.clientWidth + 1,
          ),
          offenders: [...document.querySelectorAll('body *')]
            .filter((el) => {
              const r = el.getBoundingClientRect();
              return (
                r.width > 0 && r.right > innerWidth + 1 && getComputedStyle(el).position !== 'fixed'
              );
            })
            .slice(0, 5)
            .map(
              (el) =>
                `${el.tagName.toLowerCase()}.${String(el.className).split(' ').join('.')}@${Math.round(el.getBoundingClientRect().right)}`,
            ),
        }));
        results.push({ theme, width, route, ...check });
        await page.screenshot({
          path: `${out}/${theme}-${width}-${route.replace(/[^a-z0-9]+/gi, '_').slice(0, 60)}.png`,
          fullPage: true,
        });
      }
      await ctx.close();
    }
  const bad = results.filter(
    (r) => r.overflow > 1 || !r.heading || r.error || r.stray || r.clipped,
  );
  assert.deepEqual(bad, [], 'pages render with a heading, no errors and no sideways scroll');

  const { ctx, page } = await open('light', 1440);
  // 2. Old addresses lead to the new pages.
  for (const [from, to] of [
    ['users', '/access?tab=people'],
    ['permissions', '/access?tab=content'],
    ['requests', '/access'],
    ['archive', '/workspace'],
    ['teams', '/access'],
  ]) {
    await page.goto(`${base}/${from}`);
    await ready(page);
    assert.equal(
      new URL(page.url()).pathname + new URL(page.url()).search,
      to,
      `${from} redirects`,
    );
  }

  // 3. Teams: add a person, change the role, remove them.
  await page.goto(at(`access?tab=teams&team=${emptyTeam.slug}`));
  await ready(page);
  await page.click('[data-access-action="add-people"]');
  await page.fill('#team-emails', testEmail);
  await page.selectOption('#team-role', 'contributor');
  await page.click('#modal button[type="submit"]');
  const roleSelect = `[data-team-role="${emptyTeam.id}"][data-email="${testEmail}"]`;
  await page.waitForSelector(roleSelect, { timeout: 20000 });
  assert.equal(await page.inputValue(roleSelect), 'contributor');
  await page.selectOption(roleSelect, 'viewer');
  await page.waitForFunction(
    async ([sel]) => document.querySelector(sel)?.value === 'viewer',
    [roleSelect],
    { timeout: 20000 },
  );
  await settle(page);
  let rows = await call(`/rest/v1/docs_team_members?email=eq.${testEmail}&select=role`);
  assert.equal(rows[0]?.role, 'viewer', 'role change is saved');
  await page.click(`[data-access-action="remove-member"][data-email="${testEmail}"]`);
  await page.click('#modal button[type="submit"]');
  await page.waitForSelector(roleSelect, { state: 'detached', timeout: 20000 });
  rows = await call(`/rest/v1/docs_team_members?email=eq.${testEmail}&select=role`);
  assert.equal(rows.length, 0, 'member removed');

  if (doc) {
    // 4. Content: grant a person Edit on one document, raise it, revoke it.
    await page.goto(at(`access?tab=content&node=page%3A${doc.id}`));
    await ready(page);
    await page.click('.access-section [data-access-action="add-access"]');
    assert.ok(await page.$('#modal form.access-form'), 'Add access is a form');
    await page.fill('#grant-emails', testEmail);
    await page.selectOption('#grant-level', '2');
    await page.click('#modal button[type="submit"]');
    await page.waitForFunction(
      (email) =>
        [...document.querySelectorAll('.access-table strong')].some((s) => s.textContent === email),
      testEmail,
      { timeout: 20000 },
    );
    let grants = await call(`/rest/v1/docs_access_grants?email=eq.${testEmail}&select=id,level`);
    assert.equal(grants[0]?.level, 2, 'grant saved at Edit');
    // Saving a level replaces the grant, so the row is re-rendered with a new id.
    await page.selectOption(`[data-grant-level="${grants[0].id}"]`, '3');
    await page.waitForSelector(`[data-grant-level="${grants[0].id}"]`, {
      state: 'detached',
      timeout: 20000,
    });
    grants = await call(`/rest/v1/docs_access_grants?email=eq.${testEmail}&select=id,level`);
    await page.waitForSelector(`[data-grant-level="${grants[0].id}"]`, { timeout: 20000 });
    assert.equal(grants[0]?.level, 3, 'level change is saved');
    await page.click(`[data-access-action="remove-grant"][data-id="${grants[0].id}"]`);
    await page.click('#modal button[type="submit"]');
    await page.waitForSelector(`[data-grant-level="${grants[0].id}"]`, {
      state: 'detached',
      timeout: 20000,
    });
    grants = await call(`/rest/v1/docs_access_grants?email=eq.${testEmail}&select=id`);
    assert.equal(grants.length, 0, 'grant revoked');

    // 5. Share dialog on the document: add someone, then cancel without saving.
    await page.goto(at(`doc/${doc.slug}`));
    await ready(page);
    await page.click('[data-action="share"]');
    await page.waitForSelector('#modal form.share-form', { timeout: 20000 });
    await page.fill('#share-add', testEmail);
    await page.click('[data-share-add]');
    await page.waitForSelector('#modal .share-person', { timeout: 5000 });
    await page.screenshot({ path: `${out}/share-dialog.png` });
    await page.click('#modal [data-close]');
    grants = await call(`/rest/v1/docs_access_grants?email=eq.${testEmail}&select=id`);
    assert.equal(grants.length, 0, 'cancelled Share saves nothing');
  }

  if (doc) {
    // 6. Unassigned: someone with access but no team is listed; select them and add them to a team.
    await call('/rest/v1/docs_access_grants', {
      method: 'POST',
      body: JSON.stringify({ email: testEmail, target_type: 'page', page_id: doc.id, level: 1 }),
    });
    await page.goto(at('access?tab=teams&team=unassigned'));
    await ready(page);
    const box = `[data-assign-email="${testEmail}"]`;
    await page.waitForSelector(box, { timeout: 20000 });
    assert.equal(
      await page.$eval('[data-assign-selected]', (b) => b.disabled),
      true,
      'bulk add waits for a selection',
    );
    await page.check(box);
    await page.waitForFunction(
      () => !document.querySelector('[data-assign-selected]').disabled,
      {},
      { timeout: 5000 },
    );
    await page.click('[data-assign-selected]');
    await page.selectOption('#person-team', emptyTeam.id);
    await page.selectOption('#person-team-role', 'publisher');
    await page.click('#modal button[type="submit"]');
    await page.waitForSelector(box, { state: 'detached', timeout: 20000 });
    const added = await call(
      `/rest/v1/docs_team_members?email=eq.${testEmail}&select=team_id,role`,
    );
    assert.deepEqual(
      added,
      [{ team_id: emptyTeam.id, role: 'publisher' }],
      'selected people join the team',
    );
    await page.goto(at('access?tab=teams&team=all'));
    await ready(page);
    const overview = await page.textContent('.access-detail');
    const section = overview.slice(overview.indexOf(emptyTeam.name));
    assert.ok(
      /Publishers · 1/.test(section) && section.includes(testEmail),
      'All teams shows them under their team and role',
    );
    await cleanup();
  }

  // 7. Account devices and the People detail.
  await page.goto(at('account'));
  await ready(page);
  await settle(page);
  assert.match(await page.textContent('.devices-card'), /This device/);
  await page.goto(at('access?tab=people'));
  await ready(page);
  await settle(page);
  const people = await page.textContent('.access-detail');
  assert.match(people, /Effective access|Not signed in yet/);
  await page.click('[data-access-action="add-person"]');
  assert.ok(await page.$('#modal form #member-email'), 'Add person is a form');
  await page.click('#modal [data-close]');
  await ctx.close();

  assert.deepEqual(errors, [], 'no page or console errors');
  console.log(
    `PASS ${results.length} page checks (light and dark, 390 and 1440), redirects, team, grant and share flows. Screenshots in ${out}/`,
  );
} finally {
  await browser.close();
  const left = await cleanup().catch((error) => ({ error: error.message }));
  if (left.grants || left.members) console.log('Removed leftover test data:', left);
  if (session)
    await fetch(process.env.SUPABASE_URL + '/auth/v1/logout?scope=local', {
      method: 'POST',
      headers: {
        apikey: process.env.SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + session.access_token,
      },
    }).catch(() => {});
}
