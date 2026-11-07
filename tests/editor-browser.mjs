import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base = process.env.HOORA_TEST_BASE_URL || 'http://localhost:5174';
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base + '/login');
  await page.locator('.signin-card').waitFor();
  const result = await page.evaluate(async () => {
    const { mountRichEditor } = await import('/vendor/rich-editor.js'),
      { prepareUpload } = await import('/vendor/uploads.js');
    document.querySelector('#app').innerHTML =
      '<main><div id="test-editor"><div class="rich-toolbar"><button data-rich-command="link">Link</button></div><div data-rich-canvas></div><textarea></textarea></div></main>';
    const root = document.querySelector('#test-editor'),
      textarea = root.querySelector('textarea'),
      uploads = [],
      failures = [];
    const editor = mountRichEditor({
      root,
      textarea,
      onUpload: async (file) => {
        const prepared = await prepareUpload(file);
        uploads.push({ type: prepared.type, size: prepared.size, name: prepared.name });
        return {
          src: 'attachment:00000000-0000-4000-8000-000000000001/image.webp',
          alt: prepared.name,
          file: prepared,
        };
      },
      onError: (error) => failures.push(error.message),
    });
    const paste = (text) => {
      const transfer = new DataTransfer();
      transfer.setData('text/plain', text);
      root
        .querySelector('[contenteditable]')
        .dispatchEvent(
          new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
        );
    };
    paste('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    const card = textarea.value;
    editor.setMarkdown(card);
    const roundtrip = editor.editor.state.doc
      .toJSON()
      .content.some((node) => node.type === 'resourceCard');
    editor.setMarkdown('[Preview](https://example.com/Hoora_(service))');
    const balanced = editor.editor.state.doc
      .toJSON()
      .content.some(
        (node) =>
          node.type === 'resourceCard' && node.attrs.url === 'https://example.com/Hoora_(service)',
      );
    editor.setMarkdown(card);
    const canvas = document.createElement('canvas');
    canvas.width = 2500;
    canvas.height = 1500;
    canvas.getContext('2d').fillRect(0, 0, 2500, 1500);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], 'clipboard.png', { type: 'image/png' }));
    root
      .querySelector('[contenteditable]')
      .dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
    await new Promise((resolve, reject) => {
      const until = Date.now() + 5000;
      const check = () =>
        !root.dataset.uploading
          ? resolve()
          : Date.now() > until
            ? reject(Error('Image upload timed out'))
            : setTimeout(check, 20);
      check();
    });
    const images = editor.editor.state.doc
      .toJSON()
      .content.filter((node) => node.type === 'image').length;
    editor.setMarkdown('## Pasted Markdown\n\n**Bold** and [link](https://example.com).');
    const markdown = editor.getMarkdown();
    editor.destroy();
    return { card, roundtrip, balanced, uploads, images, markdown, failures };
  });
  assert.ok(result.card.includes('[Preview](https://www.youtube.com/watch?v=dQw4w9WgXcQ)'));
  assert.equal(result.roundtrip, true);
  assert.equal(result.balanced, true);
  assert.equal(result.images, 1);
  assert.equal(result.uploads[0].type, 'image/webp');
  assert.match(result.uploads[0].name, /\.webp$/);
  assert.ok(result.markdown.includes('## Pasted Markdown'));
  assert.deepEqual(result.failures, []);
  await page.evaluate(async () => {
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = '/vendor/drawing/drawing.css';
    document.head.append(style);
    const { openDrawingWorkspace } = await import('/vendor/drawing/drawing.js');
    window.drawingResult = openDrawingWorkspace();
  });
  await page.locator('.drawing-workspace .excalidraw').waitFor({ timeout: 30000 });
  await page.screenshot({ path: 'test-results/ui/drawing-desktop.png' });
  await page.locator('.drawing-workspace canvas').first().waitFor({ timeout: 15000 });
  await page.getByRole('radio', { name: 'Rectangle', exact: true }).locator('..').click();
  await page.mouse.move(430, 260);
  await page.mouse.down();
  await page.mouse.move(750, 440, { steps: 12 });
  await page.mouse.up();
  await page.locator('[data-drawing-save]').click();
  await page.locator('.drawing-workspace').waitFor({ state: 'detached' });
  const drawing = await page.evaluate(async () => {
    const result = await window.drawingResult;
    return {
      size: result.preview.size,
      type: result.preview.type,
      elements: JSON.parse(result.scene).elements.length,
    };
  });
  assert.equal(drawing.type, 'image/png');
  assert.ok(drawing.size > 0);
  assert.ok(drawing.elements > 0);
  assert.deepEqual(errors, []);
  console.log(
    'PASS Visual clipboard image → one WebP image; resource card Markdown round trip; full-screen drawing loads and closes.',
  );
} finally {
  await browser.close();
}
