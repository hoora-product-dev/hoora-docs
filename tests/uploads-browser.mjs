import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  await page.goto(process.env.HOORA_TEST_BASE_URL || 'http://localhost:3000');
  const results = await page.evaluate(async () => {
    const { prepareUpload } = await import('/vendor/uploads.js');
    const canvas = document.createElement('canvas');
    canvas.width = 2500;
    canvas.height = 1200;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffd600';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#111';
    ctx.fillRect(100, 100, 700, 600);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const image = await prepareUpload(new File([blob], 'diagram.png', { type: 'image/png' }));
    const bitmap = await createImageBitmap(image);
    const result = {
      type: image.type,
      name: image.name,
      width: bitmap.width,
      height: bitmap.height,
      size: image.size,
    };
    bitmap.close();
    let videoRejected = false;
    try {
      await prepareUpload(new File(['video'], 'video.mp4', { type: 'video/mp4' }));
    } catch {
      videoRejected = true;
    }
    return { ...result, videoRejected };
  });
  assert.equal(results.type, 'image/webp');
  assert.equal(results.name, 'diagram.webp');
  assert.equal(results.width, 1920);
  assert.ok(results.size <= 1024 * 1024);
  assert.equal(results.videoRejected, true);
  console.log('PASS Images become compressed WebP at ≤1920px; videos are rejected.');
} finally {
  await browser.close();
}
