/** Read-only UI audit against real permission-filtered content. Never logs credentials. */
import { chromium } from 'playwright';
import { loadEnvFile } from 'node:process';
import { mkdir, writeFile } from 'node:fs/promises';
import { serverClient } from '../server/supabase.js';
import assert from 'node:assert/strict';
try {
  loadEnvFile();
} catch {}
const base = process.env.HOORA_TEST_BASE_URL || 'http://localhost:5174';
const theme = process.env.HOORA_UI_THEME || 'dark';
const call = serverClient(),
  widths = [320, 390, 768, 1024, 1440, 1920];
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
});
const results = [],
  errors = [];
let session;
await mkdir('test-results/ui', { recursive: true });
try {
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
  for (const role of ['public', 'admin']) {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: 'reduce',
    });
    await ctx.addInitScript((value) => localStorage.setItem('hoora-theme', value), theme);
    if (role === 'admin')
      await ctx.addInitScript(
        (s) => localStorage.setItem('hoora-session', JSON.stringify(s)),
        session,
      );
    const page = await ctx.newPage();
    page.on('pageerror', (error) => errors.push({ role, url: page.url(), error: error.message }));
    const routes =
      role === 'public'
        ? ['home', 'releases', 'release-notes/5.6.0/customer-app', 'browse', 'login', 'install']
        : [
            'home',
            'releases',
            'workspace',
            'teams',
            'notifications',
            'account',
            'users',
            'folders',
            'requests',
            'contributions',
            'archive',
            'activity',
            'upcoming',
            'new',
          ];
    for (const route of routes) {
      await page.goto(base + '/' + route);
      await page.waitForFunction(
        () =>
          document.querySelector('main') && !document.body.classList.contains('vehicle-loading'),
        {},
        { timeout: 30000 },
      );
      for (const width of widths) {
        await page.setViewportSize({ width, height: 1000 });
        await page.evaluate(() => document.fonts.ready);
        const geometry = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth - innerWidth,
          heading: document.querySelector('main h1')?.textContent,
          mainWidth: Math.round(document.querySelector('main').getBoundingClientRect().width),
          headerHeight: Math.round(
            document.querySelector('.topbar')?.getBoundingClientRect().height || 0,
          ),
          offenders: [...document.querySelectorAll('main *')]
            .filter((el) => {
              const r = el.getBoundingClientRect();
              return (
                r.width > 0 &&
                r.right > innerWidth + 2 &&
                getComputedStyle(el).position !== 'fixed' &&
                !el.closest('.tablewrap,pre,.editor-mode-tabs,.version-section-tabs')
              );
            })
            .slice(0, 8)
            .map((el) => ({
              tag: el.tagName,
              cls: el.className,
              right: Math.round(el.getBoundingClientRect().right),
            })),
          error: document.querySelector('.content-error')?.textContent,
        }));
        results.push({ role, theme, route, width, ...geometry });
        if ([390, 1440].includes(width))
          await page.screenshot({
            path:
              'test-results/ui/' +
              theme +
              '-' +
              role +
              '-' +
              route.replaceAll('/', '-') +
              '-' +
              width +
              '.png',
            fullPage: !route.startsWith('release-notes'),
          });
      }
    }
    await ctx.close();
  }
  await writeFile('test-results/ui/report.json', JSON.stringify({ results, errors }, null, 2));
  await writeFile(
    'test-results/ui/report-' + theme + '.json',
    JSON.stringify({ results, errors }, null, 2),
  );
  assert.deepEqual(errors, [], 'Pages must not raise browser exceptions.');
  assert.deepEqual(
    results.filter((result) => result.overflow > 1 || result.error),
    [],
    'All audited pages must fit their viewport.',
  );
  console.log(
    JSON.stringify(
      {
        screens: results.length,
        errors,
        problems: results.filter((r) => r.overflow > 1 || r.error),
      },
      null,
      2,
    ),
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
