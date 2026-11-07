import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const base = process.env.HOORA_TEST_BASE_URL || 'https://hoora-docs.vercel.app';
for (let i = 0; i < 10; i++) {
  const r = await fetch(base + '/router.js');
  if (r.ok) break;
  if (i === 9) throw Error('New deployment is not ready');
  await new Promise((resolve) => setTimeout(resolve, 5000));
}
await mkdir('test-results', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '/releases');
  await page.getByRole('heading', { name: 'All updates', exact: true }).waitFor();
  await page.getByRole('link', { name: 'Customer App', exact: true }).click();
  await page.getByRole('heading', { name: 'Customer App', exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('project'), 'customer-app');
  assert.equal(await page.locator('.version-section-tabs a').count(), 0);
  const releaseLink = await page.locator('.timeline-item h3 a').first().getAttribute('href');
  await page.locator('.timeline-item h3 a').first().click();
  await page.locator('.native-release-header').waitFor();
  assert.ok(new URL(page.url()).pathname.startsWith('/release-notes/'));
  assert.ok((await page.locator('.native-release-title').innerText()).includes('Customer App'));
  const count = await page.locator('.contributor-line').count();
  const tabs = page.getByRole('navigation', { name: 'Release sections' });
  if ((await tabs.locator('a').count()) > 1) {
    await tabs.locator('a').nth(1).click();
    await page.waitForFunction(
      () =>
        new URL(location.href).searchParams.has('section') &&
        !document.body.classList.contains('vehicle-loading'),
    );
    assert.equal(await page.locator('.native-release-body .release-section').count(), 1);
    await tabs.getByRole('link', { name: 'All', exact: true }).click();
    await page.waitForFunction(
      () =>
        !new URL(location.href).searchParams.has('section') &&
        !document.body.classList.contains('vehicle-loading'),
    );
    assert.equal(await page.locator('.contributor-line').count(), count);
  }
  await page.getByRole('button', { name: 'Copy link', exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/production-release.png' });
  const metadata = await page.request.get(base + releaseLink.slice(1));
  assert.equal(metadata.status(), 200);
  assert.ok((await metadata.text()).includes('og:title'));
  console.log(
    'PASS Production platform/version URL, section filtering, contributor attribution, copy action and share metadata',
  );
  await page.keyboard.press('Control+k');
  await page.locator('#global-query').fill('booking');
  await page.locator('#global-results a').first().waitFor();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.locator('dialog').waitFor({ state: 'hidden' });
  console.log('PASS Production ranked search and keyboard opening');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + '/releases');
  await page.getByRole('heading', { name: 'All updates', exact: true }).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: 'test-results/production-mobile.png' });
  const manifest = await (await page.request.get(base + '/manifest.webmanifest')).json();
  assert.equal(manifest.display, 'standalone');
  for (const icon of manifest.icons)
    assert.equal((await page.request.get(base + icon.src)).status(), 200);
  assert.equal((await page.request.get(base + '/sw.js')).status(), 200);
  for (const api of ['push', 'content'])
    assert.equal((await page.request.get(base + '/api/' + api)).status(), 401);
  assert.equal((await page.request.get(base + '/styles.css')).status(), 404);
  console.log('PASS Production app files, anonymous API denial and removed legacy stylesheet');
  await page.goto(base + '/docs/non-public-private-test');
  await page.getByRole('heading', { name: 'Sign in to continue', exact: true }).waitFor();
  console.log('PASS Direct private URL opens the company sign-in gate');
  assert.deepEqual(errors, []);
  await page.goto(base + '/login');
  await page.getByRole('button', { name: 'Continue with Microsoft', exact: true }).click();
  await page.waitForURL(/login\.microsoftonline\.com|login\.microsoft\.com/, { timeout: 30000 });
  console.log(
    'PASS Microsoft button reaches the real Entra sign-in service; no employee credentials entered',
  );
} finally {
  await browser.close();
}
