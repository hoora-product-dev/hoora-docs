import test from 'node:test';
import assert from 'node:assert/strict';
import { accessLevels, deviceName, activeLabel, levelName } from '../public/access.js';
import { settingsLinks } from '../public/ui/account.js';

const state = (role, access) => ({ member: { role, email: 'a@hoora.me' }, access });

test('Levels come from the database report', () => {
  const levels = accessLevels(
    state('viewer', {
      pages: { p1: { level: 2 } },
      collections: { release: { level: 1 }, sop: { level: 0 } },
      projects: { app: { level: 3 } },
      folders: {},
      teams: { t1: 1 },
    }),
  );
  assert.equal(levels.page('p1'), 2);
  assert.equal(levels.page('missing'), 0);
  assert.equal(levels.team('t1'), 1);
  assert.equal(levels.canCreate(), false, 'a team viewer cannot create documents');
  assert.equal(levels.canAuthor(), true, 'an Edit grant on one page opens the workspace');
  assert.equal(levels.canStartRelease('app'), true);
  assert.equal(levels.canStartRelease('other'), false);
  assert.equal(levels.canStartRelease(), true);
});

test('Organization publishers and administrators create company-wide documents', () => {
  assert.equal(accessLevels(state('publisher', {})).canCreate(), true);
  assert.equal(accessLevels(state('admin', {})).canPublishNew(), true);
  assert.equal(accessLevels(state('viewer', {})).canCreate(), false);
  assert.equal(accessLevels(state('viewer', { teams: { t: 2 } })).canCreate(), true);
  assert.equal(accessLevels(state('viewer', { teams: { t: 2 } })).canPublishNew(), false);
});

test('Level names', () => {
  assert.deepEqual([1, 2, 3, 4, 0].map(levelName), [
    'View',
    'Edit',
    'Publish',
    'Manage',
    'No access',
  ]);
});

test('Devices are named from the browser and system', () => {
  assert.equal(
    deviceName(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
    ),
    'Chrome on Windows',
  );
  assert.equal(
    deviceName(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    ),
    'Safari on iPhone',
  );
  assert.equal(
    deviceName(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130 Safari/537.36 Edg/130',
    ),
    'Edge on Mac',
  );
  assert.equal(deviceName(''), 'Browser');
});

test('Last activity reads naturally', () => {
  const now = Date.parse('2026-11-12T12:00:00Z');
  assert.equal(activeLabel('2026-11-12T11:58:00Z', now), 'Active now');
  assert.equal(activeLabel('2026-11-12T11:30:00Z', now), '30 min ago');
  assert.equal(activeLabel('2026-11-12T09:00:00Z', now), '3 h ago');
  assert.equal(activeLabel('2026-11-10T12:00:00Z', now), '2 d ago');
  assert.equal(activeLabel(null, now), '');
});

test('Settings show Account and Teams to members, Access and administration to administrators', () => {
  assert.deepEqual(
    settingsLinks({ role: 'viewer' }).map(([key]) => key),
    ['account', 'access'],
  );
  assert.deepEqual(
    settingsLinks({ role: 'publisher' }).map(([, , label]) => label),
    ['Account', 'Teams'],
  );
  assert.deepEqual(
    settingsLinks({ role: 'admin' }).map(([key]) => key),
    ['account', 'access', 'folders', 'activity', 'feedback'],
  );
  assert.deepEqual(settingsLinks(null), []);
});

/** Renders every Access view with fixture data, as an administrator and as a team viewer. */
test('Access pages, Share and Devices render for administrators and members', async () => {
  globalThis.location ??= window.location;
  const { accessFeature } = await import('../public/access.js');
  const e = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const team = { id: 't1', name: 'Product Team', slug: 'product-team' };
  const pages = [
    {
      id: 'p1',
      title: 'Refund SOP',
      kind: 'sop',
      team_id: 't1',
      visibility: 'team',
      slug: 'refund',
    },
    { id: 'r1', title: 'Customer App 5.6', kind: 'release', version: '5.6.0', slug: 'ca-5-6' },
  ];
  const make = (role) => {
    const state = {
      member: { id: 'm1', email: 'a@hoora.me', name: 'A', role },
      teams: [team],
      teamMembers: [
        { team_id: 't1', email: 'a@hoora.me', role: role === 'admin' ? 'manager' : 'viewer' },
      ],
      members: [
        { id: 'm1', email: 'a@hoora.me', name: 'A', role, active: true },
        { id: 'm2', email: 'b@hoora.me', name: 'B', role: 'viewer', active: true },
      ],
      grants: [
        { id: 'g1', team_id: 't1', target_type: 'collection', collection_key: 'release', level: 3 },
        { id: 'g2', email: 'new@hoora.me', target_type: 'page', page_id: 'p1', level: 2 },
      ],
      pages,
      published: pages,
      releases: [{ id: 'r1', project_id: 'app' }],
      projects: [{ id: 'app', name: 'Customer App', slug: 'customer-app' }],
      folders: [{ id: 'f1', name: 'Policies', parent_id: null }],
      access: { pages: { p1: { level: role === 'admin' ? 4 : 1 } }, teams: { t1: 1 } },
    };
    const calls = [];
    let dialogHtml = '';
    const modal = document.createElement('div');
    const feature = accessFeature({
      state,
      db: async (path) => {
        calls.push(path);
        if (path === 'rpc/docs_my_devices')
          return [{ id: 's1', user_agent: 'Chrome/1 Windows', ip: '1.1.1.1', is_current: true }];
        if (path === 'rpc/docs_member_devices') return [];
        if (path === 'rpc/docs_access_report')
          return {
            collections: { release: { level: 3, via: 'Team: Product Team' } },
            pages: {},
            projects: {},
            folders: {},
          };
        return [];
      },
      admin: async () => ({}),
      e,
      icon: (name) => `<i data-icon="${name}"></i>`,
      dialog: (html) => {
        dialogHtml = html;
        modal.innerHTML = html;
      },
      confirmAction: () => {},
      modal,
      toast: () => {},
      load: async () => {},
      render: async () => {},
      settingsSidebar: () => '<aside></aside>',
      date: (value) => String(value),
      platformName: (name) => name,
      routeUrl: (hash) => hash.slice(1),
      publishedRoute: (page) => `#/doc/${page.slug}`,
    });
    return { feature, state, calls, dialog: () => dialogHtml };
  };

  const admin = make('admin');
  for (const tab of ['teams', 'people', 'content']) {
    const html = await admin.feature.view(new URLSearchParams(`tab=${tab}`));
    assert.match(html, /class="access-split"/, `${tab} renders`);
    assert.ok(!/undefined|\[object Object\]/.test(html), `${tab} has no stray values`);
  }
  const all = await admin.feature.view(new URLSearchParams('tab=teams'));
  assert.match(all, /All teams/, 'administrators start on the whole organization');
  assert.match(all, /Managers · 1/, 'members are grouped by role');
  assert.match(all, /data-team-role="t1"/, 'managers change member roles');
  assert.match(all, /Unassigned · 2/, 'people in no team are listed');
  assert.match(all, /data-assign-email="b@hoora.me"/);
  assert.match(all, /data-assign-email="new@hoora.me"/, 'invited people without a team count too');
  const unassigned = await admin.feature.view(new URLSearchParams('tab=teams&team=unassigned'));
  assert.match(unassigned, /data-assign-selected disabled/, 'bulk add waits for a selection');
  const teamPage = await admin.feature.view(new URLSearchParams('tab=teams&team=product-team'));
  assert.match(teamPage, /Release notes/, 'team access lists its grants');
  const people = await admin.feature.view(new URLSearchParams('tab=people'));
  assert.match(people, /new@hoora\.me/, 'people invited by email are listed');
  assert.match(people, /Effective access/);
  const content = await admin.feature.view(new URLSearchParams('tab=content&node=page%3Ap1'));
  assert.match(content, /data-general-access="p1"/, 'admins set general access');
  assert.match(content, /From SOPs|Owner team/, 'inherited and owner access are shown');

  await admin.feature.action({ dataset: { accessAction: 'add-access' } });
  assert.match(admin.dialog(), /<form class="access-form">/, 'Add access is a real form');
  assert.match(admin.dialog(), /optgroup label="Release platforms"/);
  await admin.feature.share(pages[0]);
  assert.match(admin.dialog(), /<form class="share-form">/, 'Share is a real form');
  assert.match(admin.dialog(), /Only people added/);
  assert.match(await admin.feature.devicesSection(), /This device/);

  const member = make('viewer');
  const memberView = await member.feature.view(new URLSearchParams('tab=people'));
  assert.ok(!/access-tabs/.test(memberView), 'members see only their teams');
  assert.ok(!/data-team-role/.test(memberView), 'team viewers cannot change roles');
  await member.feature.share(pages[0]);
  assert.ok(!/share-form/.test(member.dialog()), 'View-level members get a read-only Share');
  assert.match(member.feature.teamField({}), /required/, 'members must pick a team');
});
