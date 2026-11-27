import test from 'node:test';
import assert from 'node:assert/strict';
import { announceFeature } from '../public/ui/announce.js';

const email = {
  subject: 'Customer App v5.13.0 is now live',
  html: '<!doctype html><html><head></head><body><p style="color:#fff">Email</p></body></html>',
  body: '<p style="color:#fff">Email</p>',
  text: 'Customer App v5.13.0 is now live',
  teams: {
    sender: 'Hoora Releases',
    everyone: { people: 296 },
    tests: { used: 2, limit: 10 },
    last: null,
    ready: true,
    preview: '<!doctype html><html><body>Teams card</body></html>',
  },
};

function feature({ ready = true } = {}) {
  const toasts = [];
  const calls = [];
  const confirms = [];
  const announce = announceFeature({
    e: String,
    icon: (name) => `<svg data-icon="${name}"></svg>`,
    appApi: async (path, body) => {
      calls.push(body);
      if (body.action === 'teams-send') return { sent: ['a@hoora.me', 'b@hoora.me'], failed: [] };
      if (body.action === 'teams-test') return { sent: ['rahul@hoora.me'], used: 3, limit: 10 };
      return { ...email, teams: { ...email.teams, ready } };
    },
    confirm: (title, description, action) => confirms.push({ title, description, action }),
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
  return { announce, toasts, calls, confirms };
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

test('Teams message: a preview, Test on Teams to yourself, then Send to everyone', async () => {
  const { announce, toasts, calls, confirms } = feature();
  const html = await announce.view(new URLSearchParams());
  assert.match(html, /Teams message/);
  assert.ok(html.includes('one-to-one chat from <strong>Hoora Releases</strong>'));
  assert.ok(html.includes('Test sends it to you only (2 of 10 used in the last 24 hours)'));
  assert.ok(
    html.includes('everyone at Hoora who has Hoora Releases in Teams (296 people), once a day'),
  );
  // The buttons sit below the preview: Test first, then Send to everyone.
  assert.ok(html.indexOf('announce-teams-preview') < html.indexOf('announce-teams-test'));
  assert.ok(html.indexOf('announce-teams-test') < html.indexOf('announce-teams-send'));
  assert.ok(!/disabled/.test(html.slice(html.indexOf('announce-send'))));

  // A test goes straight to yourself.
  document.body.innerHTML = html;
  assert.equal(await announce.action('announce-teams-test'), true);
  assert.deepEqual(calls.at(-1), { id: 'release', action: 'teams-test' });
  assert.ok(toasts.at(-1).includes('Test sent to you on Teams (3 of 10'));

  // Sending to everyone asks first.
  assert.equal(await announce.action('announce-teams-send'), true);
  assert.equal(calls.filter((body) => body.action === 'teams-send').length, 0, 'Nothing sent yet');
  assert.equal(confirms.length, 1);
  assert.ok(confirms[0].description.includes('Customer App v5.13.0 goes to everyone at Hoora'));
  await confirms[0].action();
  assert.deepEqual(calls.at(-1), { id: 'release', action: 'teams-send' });
  assert.ok(toasts.at(-1).includes('Sent on Teams to 2 people.'));
  assert.equal(document.querySelector('[data-action="announce-teams-send"]').disabled, true);
  document.body.innerHTML = '';
});

test('Teams buttons are off until Teams sending is set up', async () => {
  const { announce } = feature({ ready: false });
  const html = await announce.view(new URLSearchParams());
  assert.match(html, /data-action="announce-teams-test" disabled/);
  assert.match(html, /data-action="announce-teams-send" disabled/);
  assert.match(html, /Teams sending is not set up yet/);
});
