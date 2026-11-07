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
  await page.getByRole('heading', { name: 'Continue to Hoora Docs', exact: true }).waitFor();
  console.log('PASS Anonymous release routes require Hoora Microsoft sign-in');
  const releaseLink = '/release-notes/5.6.0/customer-app';
  const metadata = await page.request.get(base + releaseLink);
  assert.equal(metadata.status(), 200);
  const metadataHtml = await metadata.text();
  assert.ok(!metadataHtml.includes('Customer App · v5.6.0'));
  console.log('PASS Release metadata does not disclose organization-only content');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + '/releases');
  await page.getByRole('heading', { name: 'Continue to Hoora Docs', exact: true }).waitFor();
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
  await page.getByRole('heading', { name: 'Continue to Hoora Docs', exact: true }).waitFor();
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
