import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDrawing } from '../public/editor/drawing-data.js';
import { describeResource } from '../public/resources.js';
import { renderMarkdown } from '../src/markdown.js';
test('Resource previews accept only web URLs and exact YouTube hosts', () => {
  assert.equal(describeResource('javascript:alert(1)'), null);
  assert.equal(describeResource('https://user:pass@example.com'), null);
  assert.equal(describeResource('https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ').videoId, null);
  assert.equal(describeResource('https://youtu.be/dQw4w9WgXcQ').videoId, 'dQw4w9WgXcQ');
  const html = renderMarkdown('[Preview](https://youtu.be/dQw4w9WgXcQ)');
  assert.match(html, /data-load-video=/);
  assert.doesNotMatch(html, /<iframe|<script/);
});
test('Drawing scenes reject external image requests and strip executable hyperlinks', () => {
  assert.throws(() =>
    validateDrawing({
      type: 'excalidraw',
      elements: [],
      files: { bad: { mimeType: 'image/png', dataURL: 'https://example.com/tracker.png' } },
    }),
  );
  assert.throws(() =>
    validateDrawing({
      type: 'excalidraw',
      elements: [],
      files: { bad: { mimeType: 'image/svg+xml', dataURL: 'data:image/svg+xml;base64,PHN2Zz4=' } },
    }),
  );
  const scene = validateDrawing({
    type: 'excalidraw',
    elements: [{ id: 'one', type: 'rectangle', link: 'javascript:alert(1)' }],
    appState: { viewBackgroundColor: '#ffffff', collaborators: { secret: true } },
  });
  assert.equal(scene.elements[0].link, null);
  assert.equal(scene.appState.collaborators, undefined);
});
test('Stored drawings keep their editable reference beside a private raster preview', () => {
  const html = renderMarkdown(
    '![Diagram](attachment:00000000-0000-4000-8000-000000000001/preview.webp "drawing:attachment:00000000-0000-4000-8000-000000000001/scene.txt")',
  );
  assert.match(html, /data-storage-image=/);
  assert.match(html, /data-drawing-source=/);
  assert.doesNotMatch(html, /src="https?:/);
});
