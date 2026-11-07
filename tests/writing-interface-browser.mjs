/** Read-only interface checks for the coordinated login and full-page writing surfaces. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { loadEnvFile } from 'node:process';
import { mkdir } from 'node:fs/promises';
import { serverClient } from '../server/supabase.js';
try {
  loadEnvFile();
} catch {}
const base = process.env.HOORA_TEST_BASE_URL || 'http://localhost:3000',
  call = serverClient(),
  browser = await chromium.launch({ channel: 'chrome', headless: true });
let session;
const errors = [];
await mkdir('test-results/writing', { recursive: true });
try {
  for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    await context.addInitScript((value) => localStorage.setItem('hoora-theme', value), theme);
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(base + '/login');
      await page.getByRole('button', { name: 'Continue with Microsoft', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Continue with email', exact: true }).click();
      await page.getByLabel('Work email', { exact: true }).waitFor();
      assert.equal(
        await page.getByRole('heading', { name: 'Continue to Hoora Docs', exact: true }).count(),
        1,
      );
      assert.equal(await page.locator('.login-back').count(), 0);
      const dimensions = await page.evaluate(() => {
        const submit = document.querySelector('#login-submit'),
          input = document.querySelector('#email');
        return {
          button: submit.getBoundingClientRect().width,
          input: input.getBoundingClientRect().width,
          outline: getComputedStyle(input).outlineStyle,
          overflow: document.documentElement.scrollWidth - innerWidth,
        };
      });
      assert.ok(Math.abs(dimensions.button - dimensions.input) < 1);
      assert.equal(dimensions.outline, 'none');
      assert.ok(dimensions.overflow <= 1);
      assert.equal(await page.getByRole('button', { name: 'Continue', exact: true }).count(), 1);
      assert.equal(
        await page
          .getByRole('button', { name: 'Continue with Microsoft', exact: true })
          .isVisible(),
        true,
      );
      if ([390, 1440].includes(width))
        await page.screenshot({ path: `test-results/writing/${theme}-email-${width}.png` });
    }
    await context.close();
  }
  const [member] = await call(
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
  const [project] = await call('/rest/v1/docs_projects?select=id&limit=1');
  for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    await context.addInitScript(
      ({ session, theme }) => {
        localStorage.setItem('hoora-session', JSON.stringify(session));
        localStorage.setItem('hoora-theme', theme);
      },
      { session, theme },
    );
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    for (const release of [false, true]) {
      await page.goto(base + '/new' + (release ? '?kind=release&project=' + project.id : ''));
      await page.locator('[contenteditable=true]').waitFor();
      assert.equal(await page.locator('dialog[open]').count(), 0);
      assert.equal(await page.locator('.editor-top-actions>.btn').count(), 2);
      assert.equal(
        await page.locator('.rich-canvas').evaluate((el) => getComputedStyle(el).borderTopWidth),
        '0px',
      );
      if (release) {
        assert.equal(await page.getByLabel('Platform', { exact: true }).inputValue(), project.id);
        assert.ok(await page.getByLabel('Section', { exact: true }).count());
      } else {
        await page.getByLabel('More actions', { exact: true }).click();
        await page.getByRole('button', { name: 'Open preview', exact: true }).waitFor();
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('.editor-more[open]').count(), 0);
      }
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        const controls = await page.locator('.editor-top-actions>.btn').evaluateAll((items) =>
          items.map((item) => ({
            height: item.getBoundingClientRect().height,
            font: getComputedStyle(item).fontSize,
            radius: getComputedStyle(item).borderRadius,
          })),
        );
        assert.ok(
          controls.every(
            (control) =>
              control.height === 38 && control.font === '12px' && control.radius === '8px',
          ),
        );
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        if ([390, 1440].includes(width))
          await page.screenshot({
            path: `test-results/writing/${theme}-${release ? 'release' : 'document'}-${width}.png`,
          });
      }
    }
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    'PASS Coordinated email/Microsoft login, full-width CTA, two primary editor actions, consistent control dimensions and borderless document/release writing at four widths in both themes.',
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
