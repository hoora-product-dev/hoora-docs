import test from 'node:test';
import assert from 'node:assert/strict';
import { createContributionEditor } from '../public/editor/contribution.js';
function fixture(db) {
  const state = {
    member: { role: 'admin' },
    pages: [],
    releases: [],
    entries: [],
    projects: [{ id: 'platform', name: 'Customer App' }],
    verticals: [{ id: 'section', name: 'Auto Care' }],
    projectSections: [{ project_id: 'platform', vertical_id: 'section', active: true }],
    dirty: false,
  };
  const editor = createContributionEditor({
    state,
    db,
    e: (value) => String(value ?? ''),
    icon: () => '',
    sidebar: () => '',
    options: (values) =>
      values.map((value) => `<option value="${value.id}">${value.name}</option>`).join(''),
    richToolbar: () => '',
    canEdit: () => true,
  });
  const open = () => {
    document.body.innerHTML = editor.view(null, null, { create: true, projectId: 'platform' });
    document.querySelector('#release-version').value = '1.2.3';
  };
  open();
  return { editor, state, open };
}
test('Concurrent pasted files create one release draft and lock its platform/version', async () => {
  let finish,
    calls = 0;
  const { editor, state } = fixture(async () => {
    calls++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const first = editor.ensureRelease(),
    second = editor.ensureRelease();
  assert.equal(calls, 1);
  assert.equal(document.querySelector('#release-project').disabled, true);
  assert.equal(document.querySelector('#release-version').readOnly, true);
  finish('release-one');
  assert.deepEqual(await Promise.all([first, second]), ['release-one', 'release-one']);
  assert.equal(await editor.ensureRelease(), 'release-one');
  assert.equal(calls, 1);
  assert.equal(state.dirty, true);
});
test('A rejected release creation restores editable setup fields for retry', async () => {
  const { editor } = fixture(async () => {
    throw Error('This version already exists');
  });
  await assert.rejects(editor.ensureRelease(), /already exists/);
  assert.equal(document.querySelector('#release-project').disabled, false);
  assert.equal(document.querySelector('#release-version').readOnly, false);
  assert.equal(document.querySelector('#contribution-form').dataset.releaseId, '');
});
test('A new editor cannot reuse an in-flight release belonging to a closed editor', async () => {
  let finish,
    calls = 0;
  const { editor, open } = fixture(async () =>
    ++calls === 1
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : 'new-release',
  );
  const pending = editor.ensureRelease();
  open();
  assert.equal(await editor.ensureRelease(), 'new-release');
  finish('old-release');
  await assert.rejects(pending, /editor was closed/);
  assert.equal(document.querySelector('#contribution-form').dataset.releaseId, 'new-release');
  assert.equal(calls, 2);
});
