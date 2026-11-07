/** Screenshot regressions: automatic search, one focus ring and separated library tools. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const base = process.env.HOORA_TEST_BASE_URL || 'http://localhost:5174';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
await mkdir('test-results/search', { recursive: true });
try {
  const errors = [];
  for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    await context.addInitScript((value) => localStorage.setItem('hoora-theme', value), theme);
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(base + '/home');
      const input = page.getByRole('searchbox', { name: 'Search knowledge' });
      await input.fill('booking');
      await page.locator('#home-results h2 a').first().waitFor();
      assert.equal(new URL(page.url()).pathname, '/home');
      assert.equal(await input.evaluate((el) => el === document.activeElement), true);
      assert.equal(await input.evaluate((el) => getComputedStyle(el).outlineStyle), 'none');
      assert.equal(
        await page.locator('.home-search').evaluate((el) => getComputedStyle(el).outlineStyle),
        'none',
      );
      assert.equal(await page.locator('dialog[open]').count(), 0);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      if ([390, 1440].includes(width))
        await page.screenshot({
          path: `test-results/search/${theme}-home-${width}.png`,
          fullPage: true,
        });
      await input.fill('');
      await page.locator('#home-content').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#home-search-results').isVisible(), false);
      assert.equal(await input.evaluate((el) => el.checkValidity()), true);
      await page.goto(base + '/browse');
      await page.locator('#public-search').waitFor();
      const geometry = await page.evaluate(() => {
        const search = document.querySelector('.library-tools').getBoundingClientRect(),
          list = document.querySelector('#document-list').getBoundingClientRect();
        return { gap: list.top - search.bottom, alignment: Math.abs(search.width - list.width) };
      });
      assert.ok(geometry.gap >= 18);
      assert.ok(geometry.alignment < 1);
    }
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    'PASS Live home search without Enter, clear/reset, single focus outline, aligned library spacing and no overflow at four widths in both themes.',
  );
} finally {
  await browser.close();
}
