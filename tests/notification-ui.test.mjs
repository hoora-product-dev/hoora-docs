import test from 'node:test';
import assert from 'node:assert/strict';
import { workspaceFeatures } from '../public/workspace-features.js';

test('Notification cards render with icons, unread filtering and a single device action', async () => {
  const state = {
    member: { id: 'member' },
    published: [
      {
        id: 'release',
        kind: 'release',
        slug: 'release',
        title: 'Release',
        version: '5.11.0',
        release_snapshot: { project: 'Customer App' },
      },
    ],
    projects: [],
  };
  const reads = [];
  let push = { installed: true, supported: true, subscribed: true, permission: 'granted' };
  const features = workspaceFeatures({
    state,
    e: String,
    icon: (name) => `<svg data-icon="${name}"></svg>`,
    pwa: { status: async () => push },
    db: async (table) =>
      table === 'docs_notice_reads'
        ? reads
        : [
            { id: 'notice', page_id: 'release', sender_name: 'Rahul', created_at: '2026-11-07' },
            { id: 'private', page_id: 'inaccessible', created_at: '2026-11-07' },
          ],
  });
  const render = async () => {
    const root = document.createElement('div');
    root.innerHTML = await features.inbox();
    return root;
  };
  let root = await render();
  assert.equal(root.querySelectorAll('.notice-item').length, 1);
  assert.ok(root.querySelector('.notice-item svg'));
  assert.match(root.textContent, /Customer App v5.11.0 released/);
  assert.equal(state.unreadNoticeCount, 1);
  assert.ok(root.querySelector('[data-hub-action="push-disable"]'));
  assert.equal(root.querySelector('[data-hub-action="push-enable"]'), null);
  assert.equal(root.querySelector('[data-hub-action="install"]'), null);
  reads.push({ notice_id: 'notice' });
  push = { installed: false, supported: true, subscribed: false, permission: 'default' };
  root = await render();
  assert.equal(root.querySelectorAll('.notice-item').length, 0);
  assert.equal(state.unreadNoticeCount, 0);
  assert.ok(root.querySelector('[data-hub-action="push-enable"]'));
  // Installing has its own page; the inbox keeps one device setting.
  assert.equal(root.querySelector('[data-hub-action="install"]'), null);
  assert.ok(root.querySelector('[data-hub-action="show-all"]'));
  assert.equal(root.querySelector('[data-hub-action="push-disable"]'), null);
});

test('Test on Teams and Send on Teams sit beside Notify readers, for people allowed to send', async () => {
  const release = {
    id: 'release',
    kind: 'release',
    slug: 'release',
    title: 'Release',
    version: '5.13.0',
    release_snapshot: { project: 'Admin Panel' },
  };
  const calls = [];
  const dialogs = [];
  const toasts = [];
  let status = {
    allowed: true,
    ready: true,
    sender: 'Hoora Releases',
    everyone: { people: 296 },
    tests: { used: 9, limit: 10 },
    last: null,
  };
  const make = ({ role = 'admin', level = 3 } = {}) =>
    workspaceFeatures({
      state: {
        member: { id: 'member', role, name: 'Rahul Tripathi' },
        published: [release],
        pages: [],
        projects: [],
      },
      e: String,
      icon: (name) => `<svg data-icon="${name}"></svg>`,
      access: { levels: { page: () => level } },
      db: async () => [],
      dialog: (html, callback) => dialogs.push({ html, callback }),
      toast: (message, error) => toasts.push({ message, error }),
      appApi: async (path, body) => {
        calls.push(body);
        if (body.action === 'teams-status') return status;
        if (body.action === 'teams-test') return { sent: ['rahul@hoora.me'], used: 10, limit: 10 };
        return { sent: Array.from({ length: 296 }, (_, i) => `p${i}@hoora.me`), failed: [] };
      },
    });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  // Only on releases, and only for people who can already notify readers (the server decides).
  assert.ok(!make({ role: 'viewer', level: 1 }).pageTools(release).includes('teams-actions'));
  assert.ok(
    !make()
      .pageTools({ ...release, kind: 'guide' })
      .includes('teams-actions'),
  );
  const features = make();
  document.body.innerHTML = features.pageTools(release);
  const group = document.querySelector('[data-teams-status]');
  assert.equal(group.hidden, true, 'Hidden until the server says yes');
  assert.equal(group.previousElementSibling.dataset.hubAction, 'notify');
  await features.hydrate();
  await settle();
  assert.equal(group.hidden, false);
  const [test, send] = group.querySelectorAll('button');
  assert.equal(test.textContent, 'Test on Teams');
  assert.equal(send.textContent, 'Send on Teams');
  assert.match(test.title, /to you only.*9 of 10 tests used/);
  assert.ok(send.title.includes('everyone at Hoora who has Hoora Releases in Teams (296 people)'));

  // A test goes straight to yourself; the 10th test uses up the day.
  status = { ...status, tests: { used: 10, limit: 10 } };
  await features.action(test);
  assert.deepEqual(calls.at(-1), { id: 'release', action: 'teams-status' });
  assert.ok(calls.some((body) => body.action === 'teams-test'));
  assert.ok(toasts.at(-1).message.includes('Test sent to you on Teams (10 of 10'));
  assert.equal(test.disabled, true);

  // Sending to everyone asks first.
  await features.action(send);
  assert.equal(dialogs.length, 1);
  assert.ok(dialogs[0].html.includes('Send to everyone on Teams?'));
  assert.match(dialogs[0].html, /296 people/);
  assert.match(dialogs[0].html, /once a day/);
  assert.ok(!calls.some((body) => body.action === 'teams-send'), 'Nothing sent yet');
  status = {
    ...status,
    last: { at: '2026-11-27T10:00:00Z', by: 'Rahul  Tripathi', next: '2026-11-28T10:00:00Z' },
  };
  await dialogs[0].callback();
  assert.ok(calls.some((body) => body.action === 'teams-send'));
  assert.ok(toasts.at(-1).message.includes('Sent on Teams to 296 people.'));

  // Once sent to everyone, Send on Teams is off for 24 hours, for everyone.
  assert.equal(send.disabled, true);
  assert.equal(send.textContent, 'Sent on Teams');
  assert.match(send.title, /^Sent by Rahul Tripathi at .+. It can be sent again after .+.$/);
  await features.action(send);
  assert.equal(dialogs.length, 1, 'No second dialog');
  assert.equal(toasts.at(-1).error, true);

  // Someone the server does not allow never sees the buttons.
  status = { allowed: false };
  document.body.innerHTML = features.pageTools(release);
  await features.hydrate();
  await settle();
  assert.equal(document.querySelector('[data-teams-status]').hidden, true);
  document.body.innerHTML = '';
});
