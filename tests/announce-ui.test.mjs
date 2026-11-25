import test from 'node:test';
import assert from 'node:assert/strict';
import { announceFeature } from '../public/ui/announce.js';

const email = {
  subject: 'Customer App v5.13.0 is now live',
  html: '<!doctype html><html><head></head><body><p style="color:#fff">Email</p></body></html>',
  body: '<p style="color:#fff">Email</p>',
  text: 'Customer App v5.13.0 is now live',
};

function feature() {
  const toasts = [];
  const announce = announceFeature({
    e: String,
    icon: (name) => `<svg data-icon="${name}"></svg>`,
    appApi: async () => email,
    toast: (message) => toasts.push(message),
    busy: (_button, work) => work(),
    releases: () => [
      {
        page: { id: 'release' },
        project: { name: 'Customer App' },
        version: '5.13.0',
        published: { published_at: '2026-11-25' },
      },
    ],
  });
  return { announce, toasts };
}

test('Announce offers only Copy email, with no Open in Outlook button', async () => {
  const { announce } = feature();
  const html = await announce.view(new URLSearchParams());
  assert.match(html, /Copy email/);
  assert.ok(!/Open in Outlook/.test(html));
  assert.ok(!html.includes('announce-outlook'));
  assert.equal(await announce.action('announce-outlook'), false);
});

test('Copy email marks the clipboard as Outlook content so Outlook keeps its colors', async () => {
  const { announce, toasts } = feature();
  await announce.view(new URLSearchParams());
  const copied = new Map();
  const original = document.execCommand;
  // The browser fires a copy event for execCommand('copy'); the page fills its clipboard data.
  document.execCommand = (command) => {
    assert.equal(command, 'copy');
    const event = new window.Event('copy', { cancelable: true });
    event.clipboardData = { setData: (type, value) => copied.set(type, value) };
    document.dispatchEvent(event);
    return event.defaultPrevented;
  };
  try {
    assert.equal(await announce.action('announce-copy'), true);
  } finally {
    document.execCommand = original;
  }
  assert.equal(copied.get('text/html'), email.body);
  assert.equal(copied.get('text/plain'), email.text);
  // Outlook on the web pastes other content with "Merge formatting", which turns every
  // text color, size and font into its default; this marker makes it keep the source formatting.
  assert.equal(copied.get('text/olk-copy'), 'MailCompose');
  assert.match(toasts.at(-1), /Email copied/);

  // The page stops handling copy events afterwards, so a later Ctrl+C copies normally.
  const later = new window.Event('copy', { cancelable: true });
  later.clipboardData = { setData: () => assert.fail('A later copy must not be rewritten') };
  document.dispatchEvent(later);
  assert.equal(later.defaultPrevented, false);
});
