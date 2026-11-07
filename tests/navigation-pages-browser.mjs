/** Regressions from the compact sidebar, search popup and ticket popup report. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { loadEnvFile } from 'node:process';
import { serverClient } from '../server/supabase.js';
try {
  loadEnvFile();
} catch {}
const base = process.env.HOORA_TEST_BASE_URL || 'http://localhost:5174';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let session;
try {
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: 'reduce',
    }),
    page = await context.newPage(),
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base + '/releases');
  await page.locator('.timeline-item').first().waitFor();
  const loginCount = () =>
    page
      .locator('a[href="#/login"]')
      .evaluateAll((links) => links.filter((link) => link.getClientRects().length).length);
  assert.equal(await loginCount(), 1);
  assert.equal(await page.locator('.topbar input,.topbar .compact-search').count(), 0);
  assert.equal(
    await page
      .getByRole('link', { name: 'Sign in', exact: true })
      .evaluate((el) => getComputedStyle(el).borderRadius),
    '8px',
  );
  await page.locator('[data-action=rail-toggle]').click();
  await page.mouse.move(700, 600);
  assert.equal(await loginCount(), 1);
  assert.equal(await page.locator('.rail-sign-in').isVisible(), true);
  assert.equal(await page.locator('.rail-brand>a').isVisible(), false);
  assert.equal(await page.locator('.rail-brand .logo-mark').count(), 0);
  const toggle = await page.locator('[data-action=rail-toggle]').boundingBox();
  assert.ok(toggle.y >= 0 && toggle.y + toggle.height <= 60);
  await page.screenshot({ path: 'test-results/compact-sidebar.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await loginCount(), 1);
  await page.locator('[data-action=menu]').click();
  assert.equal(await loginCount(), 1);
  await page.keyboard.press('Escape');
  await page.goto(base + '/home');
  const homeQuery = page.getByRole('searchbox', { name: 'Search knowledge' });
  await homeQuery.fill('booking');
  await page.locator('#home-results h2 a').first().waitFor();
  assert.equal(new URL(page.url()).pathname, '/home');
  assert.equal(await homeQuery.inputValue(), 'booking');
  assert.equal(await homeQuery.evaluate((el) => document.activeElement === el), true);
  assert.equal(await homeQuery.evaluate((el) => getComputedStyle(el).outlineStyle), 'none');
  assert.equal(await page.locator('#home-content').isVisible(), false);
  await page.screenshot({ path: 'test-results/home-live-search-mobile.png', fullPage: true });
  await homeQuery.fill('');
  await page.locator('#home-content').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#home-search-results').isVisible(), false);
  assert.equal(await homeQuery.evaluate((el) => el.checkValidity()), true);
  await homeQuery.press('Enter');
  assert.equal(await page.locator('dialog[open]').count(), 0);
  assert.equal(new URL(page.url()).pathname, '/home');
  await page.keyboard.press('Control+k');
  await page.locator('#global-query').waitFor();
  await page.locator('#global-query').fill('booking');
  await page.locator('#global-results h2 a').first().waitFor();
  assert.equal(new URL(page.url()).pathname, '/search');
  assert.equal(await page.locator('dialog[open]').count(), 0);
  await page.evaluate(() => (window.retainedSearchInput = document.querySelector('#global-query')));
  await page.locator('#global-query').fill('customer');
  await page.waitForFunction(
    () =>
      new URL(location.href).searchParams.get('q') === 'customer' &&
      document.querySelector('#search-status').textContent.includes('result'),
  );
  assert.equal(
    await page.evaluate(
      () => window.retainedSearchInput === document.querySelector('#global-query'),
    ),
    true,
  );
  await page.goto(base + '/login');
  await page.getByRole('button', { name: 'Continue with Microsoft', exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole('button', { name: 'Continue with Microsoft', exact: true })
      .evaluate((el) => getComputedStyle(el).borderRadius),
    '8px',
  );
  const call = serverClient(),
    [member] = await call(
      '/rest/v1/docs_members?role=eq.admin&active=eq.true&password_setup_complete=eq.true&select=email&limit=1',
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
  const signed = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  });
  await signed.addInitScript(
    (value) => localStorage.setItem('hoora-session', JSON.stringify(value)),
    session,
  );
  const admin = await signed.newPage();
  admin.on('pageerror', (error) => errors.push(error.message));
  await admin.goto(base + '/releases');
  await admin.locator('.timeline-item').first().waitFor();
  assert.equal(
    await admin.locator('.sidebar>.sidelink').first().getAttribute('href'),
    '#/upcoming',
  );
  await admin.locator('.rail-more summary').click();
  assert.equal(
    await admin
      .locator('.rail-menu a,.rail-menu button')
      .evaluateAll((items) => items.every((item) => item.querySelector('.icon svg'))),
    true,
  );
  await admin.screenshot({ path: 'test-results/account-menu.png' });
  await admin.keyboard.press('Escape');
  assert.equal(await admin.locator('.rail-more').getAttribute('open'), null);
  await admin.goto(base + '/browse');
  await admin.locator('#public-search').waitFor();
  for (const width of [320, 390, 1440]) {
    await admin.setViewportSize({ width, height: 900 });
    const geometry = await admin.evaluate(() => {
      const search = document.querySelector('.library-tools').getBoundingClientRect();
      const table = document.querySelector('#document-list').getBoundingClientRect();
      return { gap: table.top - search.bottom, difference: Math.abs(table.width - search.width) };
    });
    assert.ok(geometry.gap >= 18, 'Library search needs space before the document list');
    assert.ok(geometry.difference < 1, 'Library search and document list align');
  }
  await admin.screenshot({ path: 'test-results/library-search-spacing.png' });
  await admin.locator('#public-search').fill('booking');
  await admin
    .locator('#document-list')
    .getByRole('link', { name: /booking/i })
    .first()
    .waitFor();
  await admin.locator('#public-search').fill('no-matching-document-20261107-search-check');
  await admin.getByRole('heading', { name: 'No matching documents', exact: true }).waitFor();
  assert.equal(await admin.locator('#document-list .document-row').count(), 0);
  await admin.setViewportSize({ width: 1440, height: 1000 });
  await admin.goto(base + '/upcoming');
  await admin.locator('.upcoming-ticket').first().waitFor({ timeout: 30000 });
  assert.equal(await admin.locator('.upcoming-release-card').count(), 0);
  const vertical = await admin.locator('#upcoming-vertical option').nth(2).getAttribute('value');
  await admin.getByLabel('Vertical', { exact: true }).selectOption(vertical);
  await admin.locator('.upcoming-ticket').first().click();
  await admin.locator('.upcoming-ticket-page').waitFor();
  assert.equal(await admin.locator('dialog[open]').count(), 0);
  assert.match(new URL(admin.url()).pathname, /\/upcoming\/[^/]+\/tickets\/[A-Z][A-Z0-9_]*-\d+/);
  await admin.reload();
  await admin.locator('.upcoming-ticket-page').waitFor();
  await admin.getByRole('link', { name: 'Back to tickets', exact: true }).click();
  await admin.locator('#upcoming-vertical').waitFor();
  assert.equal(await admin.getByLabel('Vertical', { exact: true }).inputValue(), vertical);
  await admin.getByRole('link', { name: 'Manage', exact: true }).click();
  await admin.locator('#upcoming-form').waitFor();
  assert.equal(await admin.locator('dialog[open]').count(), 0);
  assert.equal(await admin.locator('.assistant-trigger').count(), 0);
  await admin.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  await admin.screenshot({ path: 'test-results/upcoming-settings-page.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    'PASS Live home/page search without Enter, single focus outline, library search spacing/alignment, sidebar/account menu, direct upcoming list and full-page ticket/settings navigation.',
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
