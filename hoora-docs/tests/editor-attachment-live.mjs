import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  await page.goto(process.env.HOORA_TEST_BASE_URL||'http://localhost:3000/');
  const result = await page.evaluate(async () => {
    document.body.innerHTML = '<div id="editor"><div data-rich-canvas></div></div><textarea id="source"></textarea>';
    const textarea = document.querySelector('#source');
    const source = '![Diagram](attachment:00000000-0000-0000-0000-000000000000/diagram.webp)\n\n[PDF](attachment:00000000-0000-0000-0000-000000000000/guide.pdf)';
    textarea.value = source;
    const { mountRichEditor } = await import('/vendor/rich-editor.js');
    const mounted = mountRichEditor({ root: document.querySelector('#editor'), textarea });
    const markdown = mounted.getMarkdown();
    mounted.destroy();
    return markdown;
  });
  assert.match(result, /!\[Diagram\]\(attachment:.*diagram\.webp\)/);
  assert.match(result, /\[PDF\]\(attachment:.*guide\.pdf\)/);
  console.log('Editor preserves uploaded image and document links.');
} finally {
  await browser.close();
}
