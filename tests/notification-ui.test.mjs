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
  assert.ok(root.querySelector('[data-hub-action="install"]'));
  assert.equal(root.querySelector('[data-hub-action="push-disable"]'), null);
});
