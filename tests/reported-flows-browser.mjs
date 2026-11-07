/** Exercise reported interactions with a real member session; never publish or change content. */
import { chromium } from 'playwright';
import { loadEnvFile } from 'node:process';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { serverClient } from '../server/supabase.js';
loadEnvFile();
const base = process.env.HOORA_TEST_BASE_URL || 'http://localhost:5174';
const call = serverClient();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
await mkdir('test-results/reported-flows', { recursive: true });
let session;
try {
  const [member] = await call(
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
  for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      reducedMotion: 'reduce',
    });
    await context.addInitScript(
      ({ session, theme }) => {
        localStorage.setItem('hoora-session', JSON.stringify(session));
        localStorage.setItem('hoora-theme', theme);
      },
      { session, theme },
    );
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base + '/home');
    await page.locator('.rail-person').waitFor({ state: 'attached' });
    for (const width of [320, 375, 390, 844]) {
      await page.setViewportSize({ width, height: 844 });
      // Simulate the extra iPhone status-bar height in standalone mode.
      if (theme === 'light')
        await page.evaluate(() => document.body.style.setProperty('--mobile-header', '104px'));
      await page.locator('[data-action=menu]').click();
      const geometry = await page.evaluate(() => {
        const rail = document.querySelector('.sidebar'),
          r = rail.getBoundingClientRect();
        const link = rail.querySelector('.sidelink'),
          b = link.getBoundingClientRect();
        return {
          top: r.top,
          header: document.querySelector('.topbar').getBoundingClientRect().bottom,
          hit: link.contains(document.elementFromPoint(b.x + 20, b.y + b.height / 2)),
          assistant: getComputedStyle(document.querySelector('.assistant-shell')).visibility,
        };
      });
      assert.ok(geometry.top >= geometry.header, JSON.stringify(geometry));
      assert.equal(geometry.hit, true, 'Drawer links must be above the scrim');
      assert.equal(geometry.assistant, 'hidden');
      assert.ok(
        await page.locator('[data-action=menu]').evaluate((el) => {
          const box = el.getBoundingClientRect();
          return box.width >= 44 && box.height >= 44;
        }),
        'Menu button must remain touch-safe',
      );
      if (width === 390)
        await page.screenshot({ path: `test-results/reported-flows/${theme}-drawer.png` });
      await page.locator('.rail-more summary').click();
      const menu = await page.locator('.rail-menu').boundingBox();
      assert.ok(menu.x >= 0 && menu.x + menu.width <= width);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('main').evaluate((el) => el.inert), false);
    }
    await page.setViewportSize({ width: 844, height: 390 });
    await page.locator('[data-action=menu]').click();
    assert.equal(
      await page.locator('.assistant-shell').evaluate((el) => getComputedStyle(el).visibility),
      'hidden',
    );
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/api/assistant', async (route) => {
      await new Promise((r) => setTimeout(r, 2000));
      await route.fulfill({ json: { answer: 'Fixture answer', sources: [] } });
    });
    await page.locator('.assistant-trigger').click();
    await page.locator('#assistant-question').fill('What is the latest release?');
    await page.locator('.assistant-form button').click();
    await page.locator('.assistant-working-label').waitFor();
    const animation = await page.locator('.assistant-working-label').evaluate((el) => ({
      name: getComputedStyle(el).animationName,
      start: getComputedStyle(el).backgroundPosition,
    }));
    await page.waitForTimeout(180);
    const end = await page
      .locator('.assistant-working-label')
      .evaluate((el) => getComputedStyle(el).backgroundPosition);
    assert.equal(animation.name, 'assistant-wave-shine');
    assert.notEqual(animation.start, end, 'Thinking highlight must actually move');
    await page.getByText('Fixture answer', { exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await page.goto(base + '/releases');
    await page.locator('.timeline-item a').first().waitFor();
    await page.locator('.timeline-item a').first().click();
    await page.locator('.native-release-header').waitFor();
    assert.doesNotMatch(
      await page.locator('.native-release-header').innerText(),
      /sign-in|Admin access|Edit access|View access/,
    );
    await page.locator('.native-release-actions a').click();
    await page
      .locator('#contribution-form .tiptap, #contribution-form [contenteditable=true]')
      .first()
      .waitFor();
    assert.ok(
      (await page.locator('#entry-body').inputValue()).length > 0,
      'Edit must load existing content immediately',
    );
    assert.equal(await page.locator('[data-action=delete-entry]').count(), 0);
    await page.screenshot({ path: `test-results/reported-flows/${theme}-editor.png` });
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      'PASS ' +
        theme +
        ': mobile drawer hit testing, account menu, real shimmer under reduced motion, one-click populated release editor',
    );
  }
} finally {
  await browser.close();
  if (session)
    await fetch(process.env.SUPABASE_URL + '/auth/v1/logout?scope=local', {
      method: 'POST',
      headers: {
        apikey: process.env.SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + session.access_token,
      },
    });
}
