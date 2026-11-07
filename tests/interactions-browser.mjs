import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base = process.env.HOORA_TEST_BASE_URL || 'http://localhost:5174';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: 'reduce',
    }),
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base + '/releases');
  await page.locator('.timeline-item').first().waitFor();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  assert.equal(
    await page.locator('.sidebar').evaluate((el) => Math.round(el.getBoundingClientRect().width)),
    240,
  );
  const row = page.locator('.timeline-item').first(),
    before = await row.boundingBox();
  await row.hover();
  const after = await row.boundingBox();
  assert.deepEqual(after, before, 'Release rows must not resize or move on hover');
  assert.equal(await row.evaluate((el) => getComputedStyle(el).backgroundColor), 'rgb(36, 36, 36)');
  await page.locator('[data-action=rail-toggle]').click();
  assert.equal(
    await page.locator('body').evaluate((el) => el.classList.contains('rail-collapsed')),
    true,
  );
  await page.mouse.move(600, 500);
  const compactX = await page.locator('main').evaluate((el) => el.getBoundingClientRect().x);
  assert.ok(Math.abs(compactX - 64) < 1);
  await page.mouse.move(20, 120);
  assert.equal(
    await page.locator('.sidebar').evaluate((el) => el.getBoundingClientRect().width),
    240,
  );
  assert.equal(
    await page.locator('main').evaluate((el) => el.getBoundingClientRect().x),
    compactX,
    'Hover opens the rail over content without shifting the page',
  );
  await page.mouse.move(600, 500);
  assert.equal(
    await page.locator('.sidebar').evaluate((el) => el.getBoundingClientRect().width),
    64,
  );
  await page.mouse.move(20, 120);
  await page.locator('[data-action=rail-toggle]').click();
  assert.equal(
    await page.locator('body').evaluate((el) => el.classList.contains('rail-collapsed')),
    false,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator('[data-action=menu]').isVisible(), true);
  await page.locator('[data-action=menu]').click();
  assert.equal(await page.locator('main').evaluate((el) => el.inert), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('main').evaluate((el) => el.inert), false);
  assert.equal(await page.locator('[data-action=menu]').getAttribute('aria-expanded'), 'false');
  await page.getByRole('button', { name: 'Hoora Assist', exact: true }).click();
  assert.equal(
    await page
      .locator('.assistant-panel')
      .evaluate((el) => Math.round(el.getBoundingClientRect().width)),
    390,
  );
  assert.equal(
    await page
      .locator('.assistant-panel')
      .evaluate((el) => Math.round(el.getBoundingClientRect().height)),
    844,
  );
  await page.route('**/api/assistant', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.fulfill({ json: { answer: 'Verified response', sources: [] } });
  });
  await page.getByRole('textbox', { name: 'Your question' }).fill('What changed?');
  await page.getByRole('button', { name: 'Send question' }).click();
  await page.locator('.thinking').waitFor();
  assert.equal(
    await page
      .locator('.thinking-label')
      .evaluate((el) => getComputedStyle(el).animationName),
    'none',
  );
  await page.getByText('Verified response', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(
    await page.locator('body').evaluate((el) => el.classList.contains('assistant-open')),
    false,
  );
  const stable = await page.evaluate(async () => {
    const { createFeedback } = await import('/ui/feedback.js');
    const button = document.createElement('button');
    button.className = 'btn primary';
    button.textContent = 'Save changes';
    document.body.append(button);
    const measure = () => {
      const r = button.getBoundingClientRect();
      return [r.width, r.height, button.textContent];
    };
    const before = measure();
    let release;
    const task = createFeedback().busy(button, () => new Promise((resolve) => (release = resolve)));
    const during = measure();
    release();
    await task;
    const after = measure();
    button.remove();
    return { before, during, after };
  });
  assert.deepEqual(stable.before, stable.during);
  assert.deepEqual(stable.before, stable.after);
  assert.deepEqual(errors, []);
  console.log(
    'PASS Consistent hover, stable busy controls, default expanded rail, overlay hover, mobile drawer/keyboard, and full-screen assistant.',
  );
} finally {
  await browser.close();
}
