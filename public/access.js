/**
 * Access: one model for teams, people and content.
 * Levels: View < Edit (create and edit drafts) < Publish (publish, notify) < Manage (share, grant, delete).
 * The database decides; this module only shows and changes grants through its functions.
 */
const LEVELS = [
  [1, 'View'],
  [2, 'Edit'],
  [3, 'Publish'],
  [4, 'Manage'],
];
export const levelName = (level) =>
  LEVELS.find(([value]) => value === Number(level))?.[1] || 'No access';
const TEAM_ROLES = [
  ['viewer', 'Viewer'],
  ['contributor', 'Editor'],
  ['publisher', 'Publisher'],
  ['manager', 'Manager'],
];
const teamRoleName = (role) => TEAM_ROLES.find(([value]) => value === role)?.[1] || role;
const ORG_ROLES = [
  ['viewer', 'Viewer'],
  ['publisher', 'Publisher'],
  ['manager', 'Manager'],
  ['admin', 'Administrator'],
];
const COLLECTIONS = {
  release: 'Release notes',
  upcoming: 'Upcoming releases',
  sop: 'SOPs',
  documentation: 'Documentation',
};
const EMAIL = /^[^@\s]+@hoora\.me$/;

/** The signed-in member's levels, from the database access report. */
export function accessLevels(state) {
  const level = (entry) => Number(typeof entry === 'object' ? entry?.level : entry) || 0;
  const report = () => state.access || {};
  const any = (key, minimum) => Object.values(report()[key] || {}).some((v) => level(v) >= minimum);
  const org = () => state.member?.role;
  const levels = {
    page: (id) => level(report().pages?.[id]),
    collection: (key) => level(report().collections?.[key]),
    project: (id) => level(report().projects?.[id]),
    folder: (id) => level(report().folders?.[id]),
    team: (id) => level(report().teams?.[id]),
    /** Can create new library documents somewhere. */
    canCreate: () =>
      org() === 'admin' ||
      org() === 'publisher' ||
      ['sop', 'documentation'].some((key) => levels.collection(key) >= 2) ||
      any('teams', 2) ||
      any('folders', 2),
    /** Can open the writing workspace (create, or edit at least one draft). */
    canAuthor: () => levels.canCreate() || any('pages', 2),
    canPublishNew: () =>
      org() === 'admin' ||
      org() === 'publisher' ||
      ['sop', 'documentation'].some((key) => levels.collection(key) >= 3) ||
      any('teams', 3),
    canStartRelease: (projectId = '') =>
      projectId
        ? levels.project(projectId) >= 3
        : levels.collection('release') >= 3 || any('projects', 3),
  };
  return levels;
}

/** "Chrome on Windows" from a browser's user agent. */
export function deviceName(agent = '') {
  const ua = String(agent);
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /CriOS|Chrome\//.test(ua)
        ? 'Chrome'
        : /FxiOS|Firefox\//.test(ua)
          ? 'Firefox'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Browser';
  const system = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Mac OS X|Macintosh/.test(ua)
            ? 'Mac'
            : /Linux/.test(ua)
              ? 'Linux'
              : '';
  return system ? `${browser} on ${system}` : browser;
}

/** "Active now", "3 hours ago", "12 Nov 2026". */
export function activeLabel(value, now = Date.now()) {
  if (!value) return '';
  const minutes = Math.round((now - new Date(value).getTime()) / 60000);
  if (minutes < 5) return 'Active now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} h ago`;
  if (minutes < 10080) return `${Math.round(minutes / 1440)} d ago`;
  return new Date(value).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function accessFeature({
  state,
  db,
  admin,
  e,
  icon,
  dialog,
  confirmAction,
  modal,
  toast,
  load,
  render,
  settingsSidebar,
  date,
  platformName,
  routeUrl,
  publishedRoute,
}) {
  const levels = accessLevels(state);
  const isAdmin = () => state.member?.role === 'admin';
  const myEmail = () => state.member?.email?.toLowerCase() || '';
  const teamOf = (id) => state.teams.find((team) => team.id === id || team.slug === id);
  const myTeamRole = (teamId) =>
    state.teamMembers.find((m) => m.team_id === teamId && m.email === myEmail())?.role || '';
  const managesTeam = (team) => !!team && (isAdmin() || myTeamRole(team.id) === 'manager');
  const members = () => state.members || [];
  const memberByEmail = (email) =>
    members().find((m) => m.email?.toLowerCase() === String(email).toLowerCase());
  const personName = (email) => memberByEmail(email)?.name || email;
  const allPages = () => {
    const seen = new Map();
    for (const page of [...state.pages, ...state.published])
      if (!seen.has(page.id)) seen.set(page.id, page);
    return [...seen.values()].filter((page) => !page.deleted_at);
  };
  const pageOf = (id) => allPages().find((page) => page.id === id);
  const releaseOf = (id) => state.releases.find((release) => release.id === id);
  const projectOf = (id) => state.projects.find((project) => project.id === id);
  const folderOf = (id) => state.folders.find((folder) => folder.id === id);
  const pageTitle = (page) => {
    if (!page) return 'Removed document';
    if (page.kind !== 'release') return page.title;
    const release = releaseOf(page.id);
    const project = projectOf(release?.project_id || page.project_id);
    return project
      ? `${platformName(project.name)} ${page.version || release?.version || ''}`.trim()
      : page.title;
  };
  const targetKey = (grant) =>
    grant.target_type === 'collection'
      ? `collection:${grant.collection_key}`
      : `${grant.target_type}:${grant.project_id || grant.folder_id || grant.page_id}`;
  const targetLabel = (key) => {
    const [type, id] = String(key).split(':');
    if (type === 'collection') return COLLECTIONS[id] || id;
    if (type === 'project')
      return `Release notes · ${platformName(projectOf(id)?.name || 'Removed platform')}`;
    if (type === 'folder') return `Folder · ${folderOf(id)?.name || 'Removed folder'}`;
    return pageTitle(pageOf(id));
  };
  const principalLabel = (grant) =>
    grant.team_id ? teamOf(grant.team_id)?.name || 'Removed team' : personName(grant.email);
  const expiry = (grant) => (grant.expires_at ? `Until ${date(grant.expires_at)}` : '');
  const levelSelect = (attrs, selected, max = 4, label = 'Access level') =>
    `<select class="access-level" ${attrs} aria-label="${e(label)}">${LEVELS.filter(
      ([value]) => value <= max,
    )
      .map(
        ([value, name]) =>
          `<option value="${value}" ${Number(selected) === value ? 'selected' : ''}>${name}</option>`,
      )
      .join('')}</select>`;
  const roleSelect = (attrs, selected, label) =>
    `<select class="access-level" ${attrs} aria-label="${e(label)}">${TEAM_ROLES.map(
      ([value, name]) =>
        `<option value="${value}" ${selected === value ? 'selected' : ''}>${name}</option>`,
    ).join('')}</select>`;
  const removeButton = (attrs, label) =>
    `<button type="button" class="iconbtn access-remove" ${attrs} aria-label="${e(label)}" title="${e(label)}">${icon('close')}</button>`;
  const canChangeGrant = (grant) => {
    if (isAdmin()) return true;
    if (grant.target_type === 'page') return levels.page(grant.page_id) >= 4;
    if (grant.target_type === 'folder') return levels.folder(grant.folder_id) >= 4;
    return false;
  };
  const grantRow = (grant, { show = 'principal', inherited = '' } = {}) => {
    const editable = !inherited && canChangeGrant(grant);
    const name = show === 'principal' ? principalLabel(grant) : targetLabel(targetKey(grant));
    const kind = show === 'principal' ? (grant.team_id ? 'Team' : 'Person') : '';
    return `<tr><td><strong>${e(name)}</strong>${kind || inherited || expiry(grant) ? `<small>${e([kind, inherited, expiry(grant)].filter(Boolean).join(' · '))}</small>` : ''}</td><td class="access-cell-level">${editable ? levelSelect(`data-grant-level="${grant.id}"`, grant.level, 4, `Access for ${name}`) : `<span>${levelName(grant.level)}</span>`}</td><td class="access-cell-action">${editable ? removeButton(`data-access-action="remove-grant" data-id="${grant.id}"`, `Remove access for ${name}`) : ''}</td></tr>`;
  };
  const table = (rows, emptyText) =>
    rows.length
      ? `<div class="tablewrap access-tablewrap"><table class="access-table"><tbody>${rows.join('')}</tbody></table></div>`
      : `<p class="access-empty">${e(emptyText)}</p>`;
  const section = (title, body, action = '') =>
    `<section class="access-section"><div class="access-section-head"><h2>${e(title)}</h2>${action}</div>${body}</section>`;

  // ——— Target catalogue (where access can apply) ———
  function folderChain(folderId) {
    const chain = [];
    let current = folderOf(folderId);
    while (current && chain.length < 20) {
      chain.push(current);
      current = folderOf(current.parent_id);
    }
    return chain;
  }
  /** Targets above this one whose grants also apply here. */
  function ancestors(key) {
    const [type, id] = key.split(':');
    if (type === 'project') return ['collection:release'];
    if (type === 'folder') return folderChain(folderOf(id)?.parent_id).map((f) => `folder:${f.id}`);
    if (type === 'page') {
      const page = pageOf(id);
      if (!page) return [];
      const release = releaseOf(id);
      return [
        ...folderChain(page.folder_id).map((f) => `folder:${f.id}`),
        ...(release ? [`project:${release.project_id}`] : []),
        `collection:${page.kind}`,
      ];
    }
    return [];
  }
  function targetOptions(selected = '') {
    const option = (key, label) =>
      `<option value="${e(key)}" ${key === selected ? 'selected' : ''}>${e(label)}</option>`;
    const documents = allPages().filter((page) => page.kind !== 'release');
    const releases = allPages().filter((page) => page.kind === 'release');
    return `<optgroup label="Collections">${Object.entries(COLLECTIONS)
      .map(([key, label]) => option(`collection:${key}`, label))
      .join(
        '',
      )}</optgroup>${state.projects.length ? `<optgroup label="Release platforms">${state.projects.map((p) => option(`project:${p.id}`, platformName(p.name))).join('')}</optgroup>` : ''}${state.folders.length ? `<optgroup label="Folders">${state.folders.map((f) => option(`folder:${f.id}`, f.name)).join('')}</optgroup>` : ''}${
      documents.length
        ? `<optgroup label="Documents">${documents
            .sort((a, b) => a.title.localeCompare(b.title))
            .map((p) => option(`page:${p.id}`, p.title))
            .join('')}</optgroup>`
        : ''
    }${
      releases.length
        ? `<optgroup label="Releases">${releases
            .map((p) => option(`page:${p.id}`, pageTitle(p)))
            .sort()
            .join('')}</optgroup>`
        : ''
    }`;
  }

  // ——— Grant dialog (one shared form) ———
  function grantDialog({ team = '', email = '', target = '' } = {}) {
    const fixedPrincipal = team || email;
    const principalField = fixedPrincipal
      ? `<p class="access-dialog-target">${e(team ? teamOf(team)?.name : personName(email))}</p>`
      : `<div class="field"><label for="grant-principal">Team or person</label><select id="grant-principal" name="principal"><option value="">Choose…</option><optgroup label="Teams">${state.teams
          .map((t) => `<option value="team:${t.id}">${e(t.name)}</option>`)
          .join('')}</optgroup>${
          members().length > 1
            ? `<optgroup label="People">${members()
                .filter((m) => m.active !== false)
                .map(
                  (m) =>
                    `<option value="email:${e(m.email.toLowerCase())}">${e(m.name || m.email)}</option>`,
                )
                .join('')}</optgroup>`
            : ''
        }</select></div><div class="field"><label for="grant-emails">Or Hoora emails</label><input id="grant-emails" name="emails" autocomplete="off" placeholder="name@hoora.me, another@hoora.me"></div>`;
    const targetField = target
      ? `<p class="access-dialog-target">${e(targetLabel(target))}</p>`
      : `<div class="field"><label for="grant-target">Where</label><select id="grant-target" name="target" required><option value="">Choose…</option>${targetOptions()}</select></div>`;
    dialog(
      `<h2>Add access</h2><form class="access-form">${principalField}${targetField}<div class="access-form-row"><div class="field"><label for="grant-level">Access</label>${levelSelect('id="grant-level" name="level"', 1)}</div><div class="field"><label for="grant-expiry">Expires</label><select id="grant-expiry" name="expiry"><option value="">Never</option><option value="7">In 7 days</option><option value="30">In 30 days</option><option value="90">In 90 days</option></select></div></div><p class="error" role="alert"></p><div class="dialog-actions"><button type="button" class="btn outline" data-close>Cancel</button><button type="submit" class="btn dark">Add access</button></div></form>`,
      async (form) => {
        const principals = [];
        if (team) principals.push({ team });
        else if (email) principals.push({ email });
        else {
          const picked = String(form.get('principal') || '');
          if (picked.startsWith('team:')) principals.push({ team: picked.slice(5) });
          if (picked.startsWith('email:')) principals.push({ email: picked.slice(6) });
          for (const address of String(form.get('emails') || '')
            .split(/[\s,;]+/)
            .map((value) => value.trim().toLowerCase())
            .filter(Boolean)) {
            if (!EMAIL.test(address)) throw new Error(`${address} is not a Hoora work email.`);
            if (!principals.some((p) => p.email === address)) principals.push({ email: address });
          }
        }
        if (!principals.length) throw new Error('Choose a team or a person.');
        const where = target || String(form.get('target') || '');
        if (!where) throw new Error('Choose where this access applies.');
        const [type, id] = where.split(':');
        const days = Number(form.get('expiry') || 0);
        for (const principal of principals)
          await db('rpc/docs_grant_access', '', {
            method: 'POST',
            body: {
              team: principal.team || null,
              person_email: principal.email || null,
              target_type: type,
              collection_key: type === 'collection' ? id : null,
              target_id: type === 'collection' ? null : id,
              access_level: Number(form.get('level')),
              expires: days ? new Date(Date.now() + days * 86400000).toISOString() : null,
            },
          });
        await load();
        await render();
        toast(principals.length === 1 ? 'Access added.' : `Access added for ${principals.length}.`);
      },
    );
  }

  // ——— Teams tab ———
  const ROLE_ORDER = ['manager', 'publisher', 'contributor', 'viewer'];
  const ROLE_GROUPS = {
    manager: 'Managers',
    publisher: 'Publishers',
    contributor: 'Editors',
    viewer: 'Viewers',
  };
  const rosterOf = (team) =>
    state.teamMembers
      .filter((m) => m.team_id === team.id)
      .sort(
        (a, b) =>
          ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) ||
          personName(a.email).localeCompare(personName(b.email)),
      );
  function memberRow(m, team, manage) {
    const person = memberByEmail(m.email);
    const name = person?.name || m.email;
    return `<tr><td><strong>${e(name)}</strong><small>${e(person ? m.email : `${m.email} · Not signed in yet`)}</small></td><td class="access-cell-level">${manage ? roleSelect(`data-team-role="${team.id}" data-email="${e(m.email)}"`, m.role, `Role of ${name}`) : `<span>${teamRoleName(m.role)}</span>`}</td><td class="access-cell-action">${manage ? removeButton(`data-access-action="remove-member" data-team="${team.id}" data-email="${e(m.email)}"`, `Remove ${name} from ${team.name}`) : ''}</td></tr>`;
  }
  /** Members grouped by role: Managers, Publishers, Editors, Viewers. */
  function hierarchy(team, manage) {
    const roster = rosterOf(team);
    return ROLE_ORDER.flatMap((role) => {
      const people = roster.filter((m) => m.role === role);
      if (!people.length) return [];
      return [
        `<tr class="access-group"><td colspan="3">${ROLE_GROUPS[role]} · ${people.length}</td></tr>`,
        ...people.map((m) => memberRow(m, team, manage)),
      ];
    });
  }
  /** Signed-up or invited people who are in no team. */
  function unassignedPeople() {
    const inTeam = new Set(state.teamMembers.map((m) => m.email));
    return directory().filter((p) => !inTeam.has(p.email));
  }
  function unassignedSection(people, title = 'Unassigned') {
    const rows = people.map((p) => {
      const name = p.name || p.email;
      const note = [
        p.email !== name ? p.email : '',
        p.role === 'admin' ? 'Administrator' : '',
        p.pending ? 'Not signed in yet' : '',
        p.active === false ? 'Disabled' : '',
      ].filter(Boolean);
      return `<tr><td class="access-cell-check"><input type="checkbox" data-assign-email="${e(p.email)}" aria-label="Select ${e(name)}"></td><td><strong>${e(name)}</strong>${note.length ? `<small>${e(note.join(' · '))}</small>` : ''}</td><td class="access-cell-wide"><button type="button" class="btn text small" data-access-action="assign" data-email="${e(p.email)}">Add to team</button></td></tr>`;
    });
    const tools = people.length
      ? `<div class="toolbar-actions"><label class="access-select-all"><input type="checkbox" data-assign-all> Select all</label><button type="button" class="btn outline small" data-access-action="assign" data-assign-selected disabled>${icon('plus')}Add selected to team</button></div>`
      : '';
    return section(`${title} · ${people.length}`, table(rows, 'Everyone is in a team.'), tools);
  }
  function overview(listed) {
    const withPeople = listed.filter((t) => rosterOf(t).length);
    const empty = listed.filter((t) => !rosterOf(t).length);
    const inTeams = new Set(
      state.teamMembers.filter((m) => listed.some((t) => t.id === m.team_id)).map((m) => m.email),
    ).size;
    const unassigned = isAdmin() ? unassignedPeople() : [];
    const blocks = withPeople
      .map((t) => {
        const manage = managesTeam(t);
        const actions = `<div class="toolbar-actions"><a class="btn text small" href="#/access?tab=teams&team=${e(t.slug)}">Open</a>${manage ? `<button type="button" class="btn outline small" data-access-action="add-people" data-team="${t.id}">${icon('plus')}Add people</button>` : ''}</div>`;
        return section(
          `${t.name} · ${rosterOf(t).length}`,
          table(hierarchy(t, manage), ''),
          actions,
        );
      })
      .join('');
    const emptyLine = empty.length
      ? `<p class="access-note">No members yet: ${empty.map((t) => `<a href="#/access?tab=teams&team=${e(t.slug)}">${e(t.name)}</a>`).join(', ')}</p>`
      : '';
    return `<div class="access-detail-head"><div><h2 class="access-title">All teams</h2><p>${inTeams} ${inTeams === 1 ? 'person' : 'people'} in ${withPeople.length} ${withPeople.length === 1 ? 'team' : 'teams'}${isAdmin() ? ` · ${unassigned.length} unassigned` : ''}</p></div></div>${isAdmin() && unassigned.length ? unassignedSection(unassigned) : ''}${blocks}${emptyLine}`;
  }
  function teamsTab(params) {
    const listed = (isAdmin() ? state.teams : state.teams.filter((t) => myTeamRole(t.id))).slice();
    const chosen = params.get('team') || (isAdmin() || listed.length > 1 ? 'all' : '');
    const team = chosen === 'all' || chosen === 'unassigned' ? null : teamOf(chosen) || listed[0];
    const view = team ? team.id : chosen;
    const item = (key, href, label, count) =>
      `<a class="access-item ${view === key ? 'active' : ''}" href="${href}" ${view === key ? 'aria-current="page"' : ''}><span>${e(label)}</span><small>${count}</small></a>`;
    const unassigned = isAdmin() ? unassignedPeople() : [];
    const list =
      (listed.length > 1 || isAdmin()
        ? item(
            'all',
            '#/access?tab=teams&team=all',
            'All teams',
            new Set(state.teamMembers.map((m) => m.email)).size,
          )
        : '') +
      listed
        .map((t) => item(t.id, `#/access?tab=teams&team=${e(t.slug)}`, t.name, rosterOf(t).length))
        .join('') +
      (isAdmin()
        ? `<div class="rail-label">People</div>${item('unassigned', '#/access?tab=teams&team=unassigned', 'Unassigned', unassigned.length)}`
        : '');
    if (view === 'all') return { list, detail: overview(listed) };
    if (view === 'unassigned')
      return {
        list,
        detail: `<div class="access-detail-head"><div><h2 class="access-title">Unassigned</h2><p>People in no team. They read only what is shared with everyone at Hoora.</p></div></div>${unassignedSection(unassigned, 'People')}`,
      };
    if (!team)
      return {
        list,
        detail: `<p class="access-empty">${isAdmin() || state.member.role === 'manager' ? 'No teams yet.' : 'You are not in a team yet. A team manager can add your Hoora email.'}</p>`,
      };
    const manage = managesTeam(team);
    const roster = rosterOf(team);
    const grants = state.grants
      .filter((g) => g.team_id === team.id)
      .map((g) => grantRow(g, { show: 'target' }));
    const owned = allPages().filter((page) => page.team_id === team.id).length;
    const actions = manage
      ? `<div class="toolbar-actions"><button type="button" class="btn text" data-access-action="rename-team" data-team="${team.id}">Rename</button><button type="button" class="btn text danger" data-access-action="delete-team" data-team="${team.id}">Delete</button></div>`
      : '';
    const detail = `<div class="access-detail-head"><div><h2 class="access-title">${e(team.name)}</h2><p>${roster.length} ${roster.length === 1 ? 'person' : 'people'}${owned ? ` · <a href="#/workspace?team=${e(team.slug)}">${owned} ${owned === 1 ? 'document' : 'documents'}</a>` : ''}${!manage && myTeamRole(team.id) ? ` · You are ${teamRoleName(myTeamRole(team.id))}` : ''}</p></div>${actions}</div>${section(
      'Members',
      table(hierarchy(team, manage), 'No one in this team yet.'),
      manage
        ? `<button type="button" class="btn outline small" data-access-action="add-people" data-team="${team.id}">${icon('plus')}Add people</button>`
        : '',
    )}${section(
      'Access',
      table(grants, 'This team has access to its own documents only.'),
      isAdmin()
        ? `<button type="button" class="btn outline small" data-access-action="add-access" data-team="${team.id}">${icon('plus')}Add access</button>`
        : '',
    )}`;
    return { list, detail };
  }

  // ——— People tab (administrators) ———
  function directory() {
    const known = new Map(
      members().map((m) => [m.email.toLowerCase(), { ...m, email: m.email.toLowerCase() }]),
    );
    for (const email of [
      ...state.teamMembers.map((m) => m.email),
      ...state.grants.filter((g) => g.email).map((g) => g.email),
    ])
      if (!known.has(email))
        known.set(email, { id: '', email, name: '', role: '', active: true, pending: true });
    return [...known.values()].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
  }
  async function peopleTab(params) {
    const lastActive = await db('rpc/docs_members_last_active', '', {
      method: 'POST',
      body: {},
    }).catch(() => []);
    const active = new Map(lastActive.map((row) => [row.member_id, row]));
    const everyone = directory();
    const chosen = params.get('person') || '';
    const person =
      (chosen && everyone.find((p) => p.id === chosen || p.email === chosen)) || everyone[0];
    const list = everyone
      .map((p) => {
        const href = `#/access?tab=people&person=${encodeURIComponent(p.id || p.email)}`;
        const teamsOf = state.teamMembers.filter((m) => m.email === p.email);
        const note = p.pending
          ? 'Invited'
          : !p.active
            ? 'Disabled'
            : teamsOf.length
              ? teamOf(teamsOf[0].team_id)?.name +
                (teamsOf.length > 1 ? ' +' + (teamsOf.length - 1) : '')
              : 'No team';
        return `<a class="access-item ${person === p ? 'active' : ''}" href="${href}" data-search-text="${e((p.name + ' ' + p.email).toLowerCase())}" ${person === p ? 'aria-current="page"' : ''}><span>${e(p.name || p.email)}</span>${note ? `<small>${note}</small>` : ''}</a>`;
      })
      .join('');
    if (!person) return { list, detail: '<p class="access-empty">No people yet.</p>' };
    const memberships = state.teamMembers
      .filter((m) => m.email === person.email)
      .map((m) => {
        const t = teamOf(m.team_id);
        return `<tr><td><strong>${e(t?.name || 'Removed team')}</strong></td><td class="access-cell-level">${roleSelect(`data-team-role="${m.team_id}" data-email="${e(m.email)}"`, m.role, `Role in ${t?.name || 'team'}`)}</td><td class="access-cell-action">${removeButton(`data-access-action="remove-member" data-team="${m.team_id}" data-email="${e(m.email)}"`, `Remove from ${t?.name || 'team'}`)}</td></tr>`;
      });
    const direct = state.grants
      .filter((g) => g.email === person.email)
      .map((g) => grantRow(g, { show: 'target' }));
    let effective = '';
    let devices = '';
    if (person.id && person.active) {
      const [report, sessions] = await Promise.all([
        db('rpc/docs_access_report', '', { method: 'POST', body: { member: person.id } }).catch(
          () => null,
        ),
        db('rpc/docs_member_devices', '', { method: 'POST', body: { member: person.id } }).catch(
          () => [],
        ),
      ]);
      if (report) {
        const rows = [];
        for (const [key, entry] of Object.entries(report.collections || {}))
          if (entry.level) rows.push([COLLECTIONS[key], entry]);
        // Only list what adds access beyond its parent, so one team grant is one row.
        const levelOf = (entry) => Number(entry?.level) || 0;
        const releases = levelOf(report.collections?.release);
        for (const [id, entry] of Object.entries(report.projects || {}))
          if (levelOf(entry) > releases)
            rows.push([`Release notes · ${platformName(projectOf(id)?.name || '')}`, entry]);
        const folderLevel = (folderId) =>
          folderChain(folderId).reduce(
            (max, f) => Math.max(max, levelOf(report.folders?.[f.id])),
            0,
          );
        for (const [id, entry] of Object.entries(report.folders || {})) {
          const parent = folderOf(id)?.parent_id;
          if (levelOf(entry) > (parent ? folderLevel(parent) : 0))
            rows.push([`Folder · ${folderOf(id)?.name || ''}`, entry]);
        }
        for (const [id, entry] of Object.entries(report.pages || {})) {
          const page = pageOf(id);
          if (!page) continue;
          const release = releaseOf(id);
          const inherited = Math.max(
            levelOf(report.collections?.[page.kind]),
            release ? levelOf(report.projects?.[release.project_id]) : 0,
            folderLevel(page.folder_id),
            page.kind === 'release' || page.visibility === 'private' ? 1 : 0,
          );
          if (levelOf(entry) > inherited) rows.push([pageTitle(page), entry]);
        }
        effective = section(
          'Effective access',
          table(
            rows.map(
              ([name, entry]) =>
                `<tr><td><strong>${e(name)}</strong>${entry.via ? `<small>${e(entry.via)}</small>` : ''}</td><td class="access-cell-level"><span>${levelName(entry.level)}</span></td><td></td></tr>`,
            ),
            'Reads what is shared with everyone at Hoora.',
          ),
        );
      }
      devices = section(
        'Devices',
        table(
          sessions.map(
            (d) =>
              `<tr><td><strong>${e(deviceName(d.user_agent))}</strong><small>${e([d.ip, activeLabel(d.last_active_at)].filter(Boolean).join(' · '))}</small></td><td></td><td class="access-cell-action">${removeButton(`data-access-action="sign-out-member" data-member="${person.id}" data-device="${d.id}"`, `Sign out ${deviceName(d.user_agent)}`)}</td></tr>`,
          ),
          'Not signed in on any device.',
        ),
        sessions.length > 1
          ? `<button type="button" class="btn text small" data-access-action="sign-out-member" data-member="${person.id}">Sign out everywhere</button>`
          : '',
      );
    }
    const profile = person.pending
      ? `<p>Not signed in yet. Teams and access below apply when ${e(person.email)} first signs in.</p>`
      : `<form class="access-person-form" data-person-form="${person.id}"><div class="access-form-row"><div class="field"><label for="person-name">Name</label><input id="person-name" name="name" maxlength="100" required value="${e(person.name || '')}"></div><div class="field"><label for="person-role">Organization role</label><select id="person-role" name="role">${ORG_ROLES.map(([value, label]) => `<option value="${value}" ${person.role === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div><div class="field"><label for="person-active">Account</label><select id="person-active" name="active"><option value="true" ${person.active ? 'selected' : ''}>Active</option><option value="false" ${person.active ? '' : 'selected'}>Disabled</option></select></div></div><p class="error" role="alert"></p><div class="toolbar-actions"><button type="submit" class="btn dark small">Save</button><button type="button" class="btn text small" data-access-action="reset-password" data-member="${person.id}">Reset password</button>${person.id === state.member.id ? '' : `<button type="button" class="btn text small danger" data-access-action="remove-person" data-member="${person.id}">Remove</button>`}</div></form>`;
    const seen = person.id ? active.get(person.id) : null;
    const detail = `<div class="access-detail-head"><div><h2 class="access-title">${e(person.name || person.email)}</h2><p>${e(person.email)}${seen ? ` · ${e(activeLabel(seen.last_active_at))}` : ''}</p></div></div>${profile}${section(
      'Teams',
      table(memberships, 'Not in a team.'),
      `<button type="button" class="btn outline small" data-access-action="person-add-team" data-email="${e(person.email)}">${icon('plus')}Add to team</button>`,
    )}${section(
      'Direct access',
      table(direct, 'No direct access.'),
      `<button type="button" class="btn outline small" data-access-action="add-access" data-email="${e(person.email)}">${icon('plus')}Add access</button>`,
    )}${effective}${devices}`;
    return { list, detail };
  }

  // ——— Content tab (administrators) ———
  function contentTab(params) {
    const selected = params.get('node') || 'collection:release';
    const link = (key, label, depth = 0, note = '') =>
      `<a class="access-item ${key === selected ? 'active' : ''}" style="--depth:${depth}" href="#/access?tab=content&node=${encodeURIComponent(key)}" data-search-text="${e(label.toLowerCase())}" ${key === selected ? 'aria-current="page"' : ''}><span>${e(label)}</span>${note ? `<small>${e(note)}</small>` : ''}</a>`;
    const grantCount = (key) => state.grants.filter((g) => targetKey(g) === key).length || '';
    const releasesByProject = (projectId) =>
      allPages()
        .filter((p) => p.kind === 'release' && releaseOf(p.id)?.project_id === projectId)
        .map((p) => link(`page:${p.id}`, p.version || pageTitle(p), 2, grantCount(`page:${p.id}`)));
    const folderTree = (parent = null, depth = 1) =>
      state.folders
        .filter((f) => (f.parent_id || null) === parent)
        .map(
          (f) =>
            link(`folder:${f.id}`, f.name, depth, grantCount(`folder:${f.id}`)) +
            folderTree(f.id, depth + 1),
        )
        .join('');
    const docs = (kind) =>
      allPages()
        .filter((p) => p.kind === kind)
        .sort((a, b) => a.title.localeCompare(b.title))
        .map((p) => link(`page:${p.id}`, p.title, 1, grantCount(`page:${p.id}`)))
        .join('');
    const list = `${link('collection:release', COLLECTIONS.release, 0, grantCount('collection:release'))}${state.projects
      .map(
        (p) =>
          link(`project:${p.id}`, platformName(p.name), 1, grantCount(`project:${p.id}`)) +
          releasesByProject(p.id).join(''),
      )
      .join(
        '',
      )}${link('collection:upcoming', COLLECTIONS.upcoming, 0, grantCount('collection:upcoming'))}${link('collection:sop', COLLECTIONS.sop, 0, grantCount('collection:sop'))}${docs('sop')}${link('collection:documentation', COLLECTIONS.documentation, 0, grantCount('collection:documentation'))}${docs('documentation')}${state.folders.length ? `<div class="rail-label">Folders</div>${folderTree()}` : ''}`;

    const [type, id] = selected.split(':');
    const explicit = state.grants.filter((g) => targetKey(g) === selected).map((g) => grantRow(g));
    const inherited = ancestors(selected).flatMap((key) =>
      state.grants
        .filter((g) => targetKey(g) === key)
        .map((g) => grantRow(g, { inherited: `From ${targetLabel(key)}` })),
    );
    const page = type === 'page' ? pageOf(id) : null;
    const folder = type === 'folder' ? folderOf(id) : null;
    const owner = teamOf(page?.team_id || folder?.team_id || '');
    const baseline = [];
    if (owner)
      baseline.push(
        `<tr><td><strong>${e(owner.name)}</strong><small>Owner team · by team role${page?.visibility === 'restricted' ? ' · managers only' : ''}</small></td><td class="access-cell-level"><span>Role</span></td><td></td></tr>`,
      );
    if (type === 'page' && (page?.kind === 'release' || page?.visibility === 'private'))
      baseline.push(
        '<tr><td><strong>Everyone at Hoora</strong><small>General access</small></td><td class="access-cell-level"><span>View</span></td><td></td></tr>',
      );
    if (type === 'collection' && id === 'release')
      baseline.push(
        '<tr><td><strong>Everyone at Hoora</strong><small>Published releases</small></td><td class="access-cell-level"><span>View</span></td><td></td></tr>',
      );
    const general =
      page && page.kind !== 'release'
        ? `<div class="field access-general"><label for="general-access">General access</label><select id="general-access" data-general-access="${page.id}"><option value="private" ${page.visibility === 'private' ? 'selected' : ''}>Everyone at Hoora</option>${page.team_id ? `<option value="team" ${page.visibility === 'team' ? 'selected' : ''}>${e(teamOf(page.team_id)?.name || 'Owner team')}</option>` : ''}<option value="restricted" ${page.visibility === 'restricted' ? 'selected' : ''}>Only people added</option></select></div>`
        : '';
    const open =
      page && state.published.some((p) => p.id === page.id)
        ? `<a class="btn text small" href="${publishedRoute(
            state.published.find((p) => p.id === page.id),
            state.projects,
          )}">Open</a>`
        : '';
    const detail = `<div class="access-detail-head"><div><h2 class="access-title">${e(targetLabel(selected))}</h2>${ancestors(selected).length ? `<p>In ${e(ancestors(selected).map(targetLabel).reverse().join(' › '))}</p>` : ''}</div><div class="toolbar-actions">${open}</div></div>${general}${section(
      'Who has access',
      table([...explicit, ...inherited, ...baseline], 'Administrators only.'),
      `<button type="button" class="btn outline small" data-access-action="add-access" data-target="${e(selected)}">${icon('plus')}Add team or person</button>`,
    )}`;
    return { list, detail };
  }

  async function view(params) {
    const tabs = [['teams', 'Teams']];
    if (isAdmin()) tabs.push(['people', 'People'], ['content', 'Content']);
    let tab = params.get('tab') || 'teams';
    if (!tabs.some(([key]) => key === tab)) tab = 'teams';
    const { list, detail } =
      tab === 'people'
        ? await peopleTab(params)
        : tab === 'content'
          ? contentTab(params)
          : teamsTab(params);
    const primary =
      tab === 'teams' && ['admin', 'manager'].includes(state.member.role)
        ? `<button type="button" class="btn dark" data-access-action="new-team">${icon('plus')}New team</button>`
        : tab === 'people'
          ? `<button type="button" class="btn dark" data-access-action="add-person">${icon('plus')}Add person</button>`
          : tab === 'content'
            ? `<button type="button" class="btn dark" data-access-action="add-access">${icon('plus')}Add access</button>`
            : '';
    const searchable = tab !== 'teams' || state.teams.length > 12;
    return `<div class="layout">${settingsSidebar('access')}<main id="main" class="settings-content access-page"><div class="view-heading"><div><h1>${isAdmin() ? 'Access' : 'Teams'}</h1></div><div class="toolbar-actions">${primary}</div></div>${tabs.length > 1 ? `<nav class="access-tabs" aria-label="Access">${tabs.map(([key, label]) => `<a href="#/access?tab=${key}" class="${tab === key ? 'active' : ''}" ${tab === key ? 'aria-current="page"' : ''}>${label}</a>`).join('')}</nav>` : ''}<div class="access-split"><nav class="access-list" aria-label="${tab === 'people' ? 'People' : tab === 'content' ? 'Content' : 'Teams'}">${searchable ? `<label class="search compact access-filter">${icon('search')}<input type="search" placeholder="Filter…" aria-label="Filter list" data-access-filter></label>` : ''}${list}</nav><section class="access-detail" aria-live="polite">${detail}</section></div></main></div>`;
  }

  // ——— Document Share dialog ———
  async function share(page) {
    const link = location.origin + routeUrl(publishedRoute(page, state.projects));
    const linkRow = `<div class="share-link"><span>${e(link)}</span><button type="button" class="btn outline" data-action="copy-link">${icon('link')}Copy link</button></div>`;
    const mine = levels.page(page.id);
    const owner = teamOf(page.team_id || '');
    const general =
      page.kind === 'release'
        ? 'Everyone at Hoora'
        : page.visibility === 'private'
          ? 'Everyone at Hoora'
          : page.visibility === 'team' && owner
            ? owner.name
            : 'Only people added';
    if (mine < 4) {
      dialog(
        `<h2>Share</h2><p class="small">${e(page.title)}</p>${linkRow}<p class="share-summary">${icon('lock')}<span>Visible to <strong>${e(general)}</strong>. Everyone signs in with their Hoora account.</span></p><form><div class="dialog-actions"><button type="button" class="btn outline" data-close>Done</button></div></form>`,
      );
      return;
    }
    let entries = state.grants
      .filter((g) => g.page_id === page.id)
      .map((g) => ({ team_id: g.team_id, email: g.email, level: g.level }));
    const label = (entry) =>
      entry.team_id ? teamOf(entry.team_id)?.name || 'Team' : personName(entry.email);
    const listHtml = () =>
      entries.length
        ? entries
            .map(
              (entry, index) =>
                `<div class="share-person"><span>${e(label(entry))}${entry.team_id ? '<small>Team</small>' : label(entry) !== entry.email ? `<small>${e(entry.email)}</small>` : ''}</span>${levelSelect(`data-share-level="${index}"`, entry.level, mine, `Access for ${label(entry)}`)}${removeButton(`data-share-remove="${index}"`, `Remove ${label(entry)}`)}</div>`,
            )
            .join('')
        : '<p class="access-empty">No one added yet.</p>';
    const option = (value, title) =>
      `<option value="${value}" ${(page.kind === 'release' ? 'private' : page.visibility) === value ? 'selected' : ''}>${e(title)}</option>`;
    dialog(
      `<h2>Share</h2><p class="small">${e(page.title)}</p>${linkRow}<form class="share-form">${page.kind === 'release' ? '' : `<div class="field"><label for="share-general">General access</label><select id="share-general" name="access_mode">${option('private', 'Everyone at Hoora')}${owner ? option('team', owner.name) : ''}${option('restricted', 'Only people added')}</select></div>`}<div class="field"><label for="share-add">Add people or teams</label><div class="share-add"><input id="share-add" list="share-choices" autocomplete="off" placeholder="name@hoora.me or team"><datalist id="share-choices">${state.teams.map((t) => `<option value="${e(t.name)}"></option>`).join('')}${members()
        .map((m) => `<option value="${e(m.email.toLowerCase())}">${e(m.name || '')}</option>`)
        .join(
          '',
        )}</datalist>${levelSelect('id="share-add-level"', 1, mine, 'Access for the new person or team')}<button type="button" class="btn outline" data-share-add>Add</button></div></div><div class="share-people" data-share-list>${listHtml()}</div><p class="error" role="alert"></p><div class="dialog-actions"><button type="button" class="btn outline" data-close>Cancel</button><button type="submit" class="btn dark">Save</button></div></form>`,
      async (form) => {
        await db('rpc/docs_share', '', {
          method: 'POST',
          body: {
            document_id: page.id,
            access_mode: form.get('access_mode') || 'private',
            grants: entries,
          },
        });
        await load();
        await render();
        toast('Sharing updated.');
      },
    );
    const refresh = () => (modal.querySelector('[data-share-list]').innerHTML = listHtml());
    const addInput = modal.querySelector('#share-add');
    const add = () => {
      const error = modal.querySelector('.error');
      error.textContent = '';
      const value = addInput.value.trim();
      if (!value) return;
      const team = state.teams.find(
        (t) => t.name.toLowerCase() === value.toLowerCase() || t.slug === value.toLowerCase(),
      );
      const level = Number(modal.querySelector('#share-add-level').value);
      const address = value.toLowerCase();
      if (!team && !EMAIL.test(address)) {
        error.textContent = 'Choose a team, or type a Hoora work email.';
        return;
      }
      entries = entries.filter((entry) =>
        team ? entry.team_id !== team.id : entry.email !== address,
      );
      entries.push(team ? { team_id: team.id, level } : { email: address, level });
      addInput.value = '';
      refresh();
    };
    modal.querySelector('[data-share-add]').addEventListener('click', add);
    addInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        add();
      }
    });
    modal.querySelector('[data-share-list]').addEventListener('click', (event) => {
      const remove = event.target.closest('[data-share-remove]');
      if (!remove) return;
      entries.splice(Number(remove.dataset.shareRemove), 1);
      refresh();
    });
    modal.querySelector('[data-share-list]').addEventListener('change', (event) => {
      const select = event.target.closest('[data-share-level]');
      if (select) entries[Number(select.dataset.shareLevel)].level = Number(select.value);
    });
  }

  // ——— Document team field (editor, import, links) ———
  function teamField(page = {}) {
    const choices = state.teams.filter((t) => isAdmin() || levels.team(t.id) >= 2);
    const company =
      isAdmin() ||
      state.member.role === 'publisher' ||
      ['sop', 'documentation'].some((key) => levels.collection(key) >= 2);
    return `<div class="field"><label for="document-team">Team</label><select id="document-team" name="team_id" ${company ? '' : 'required'}>${company ? '<option value="">Company-wide</option>' : '<option value="">Choose your team</option>'}${choices.map((t) => `<option value="${t.id}" ${page.team_id === t.id ? 'selected' : ''}>${e(t.name)}</option>`).join('')}</select></div>`;
  }

  // ——— Account: devices ———
  async function devicesSection() {
    const devices = await db('rpc/docs_my_devices', '', { method: 'POST', body: {} }).catch(
      () => null,
    );
    if (!devices) return '';
    const rows = devices.map(
      (d) =>
        `<div class="device-row"><span class="device-icon">${icon(/iPhone|Android|iPad/.test(d.user_agent || '') ? 'phone' : 'web')}</span><div><strong>${e(deviceName(d.user_agent))}</strong><small>${e([d.is_current ? 'This device' : activeLabel(d.last_active_at), d.ip].filter(Boolean).join(' · '))}</small></div>${d.is_current ? '' : `<button type="button" class="btn text small" data-access-action="device-sign-out" data-device="${d.id}">Sign out</button>`}</div>`,
    );
    const others = devices.filter((d) => !d.is_current).length;
    return `<section class="setting-card devices-card"><div class="section-top"><h2>Devices</h2>${others ? '<button type="button" class="btn text small" data-access-action="devices-sign-out-others">Sign out other devices</button>' : ''}</div>${rows.join('') || '<p class="access-empty">No devices.</p>'}<p class="small">A device that isn’t used for 30 days is signed out.</p></section>`;
  }

  // ——— Actions ———
  const teamMembers = (body, query = '', method = 'POST') =>
    db('docs_team_members', query, {
      method,
      ...(body ? { body } : {}),
      ...(method === 'POST' ? { headers: { Prefer: 'resolution=merge-duplicates' } } : {}),
    });
  async function refresh(message) {
    await load();
    await render();
    if (message) toast(message);
  }
  function memberDialog() {
    dialog(
      `<h2>Add person</h2><form><div class="field"><label for="member-name">Name</label><input id="member-name" name="name" required maxlength="100"></div><div class="field"><label for="member-email">Hoora email</label><input id="member-email" name="email" type="email" required placeholder="name@hoora.me"></div><div class="field"><label for="member-password">Temporary password</label><input id="member-password" name="password" type="password" autocomplete="new-password" minlength="12" required></div><div class="field"><label for="member-role">Organization role</label><select id="member-role" name="role">${ORG_ROLES.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></div><p class="error" role="alert"></p><div class="dialog-actions"><button type="button" class="btn outline" data-close>Cancel</button><button type="submit" class="btn dark">Create login</button></div></form>`,
      async (form) => {
        await admin({ ...Object.fromEntries(form), action: 'create' });
        await refresh('Login created. Share the password securely.');
      },
    );
  }
  async function action(button) {
    const type = button.dataset.accessAction;
    const team = teamOf(button.dataset.team || '');
    if (type === 'add-access')
      return grantDialog({
        team: button.dataset.team,
        email: button.dataset.email,
        target: button.dataset.target,
      });
    if (type === 'remove-grant')
      return confirmAction('Remove this access?', 'It stops working right away.', async () => {
        await db('rpc/docs_revoke_access', '', {
          method: 'POST',
          body: { grant_id: button.dataset.id },
        });
        await refresh('Access removed.');
      });
    if (type === 'new-team' || type === 'rename-team')
      return dialog(
        `<h2>${team ? 'Rename team' : 'New team'}</h2><form><div class="field"><label for="team-name">Team name</label><input id="team-name" name="name" maxlength="100" required value="${e(team?.name || '')}"></div><p class="error" role="alert"></p><div class="dialog-actions"><button type="button" class="btn outline" data-close>Cancel</button><button type="submit" class="btn dark">${team ? 'Save' : 'Create team'}</button></div></form>`,
        async (form) => {
          const name = String(form.get('name')).trim();
          const slug = name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
          if (!slug) throw new Error('Include letters or numbers in the team name.');
          await db('docs_teams', team ? `?id=eq.${team.id}` : '', {
            method: team ? 'PATCH' : 'POST',
            body: team ? { name } : { name, slug, manager_id: state.member.id },
          });
          await load();
          location.hash = `#/access?tab=teams&team=${team ? team.slug : slug}`;
          toast(team ? 'Team renamed.' : 'Team created.');
        },
      );
    if (type === 'delete-team')
      return confirmAction(
        `Delete ${team.name}?`,
        'Members and team access are removed. Documents must be moved to another team first.',
        async () => {
          try {
            await db('docs_teams', `?id=eq.${team.id}`, { method: 'DELETE' });
          } catch (error) {
            throw new Error(
              /foreign key|violates/i.test(error.message)
                ? 'Move this team’s documents and folders to another team first.'
                : error.message,
            );
          }
          await load();
          location.hash = '#/access?tab=teams';
          toast('Team deleted.');
        },
      );
    if (type === 'add-people')
      return dialog(
        `<h2>Add people to ${e(team.name)}</h2><form><div class="field"><label for="team-emails">Hoora emails</label><textarea id="team-emails" name="emails" rows="3" required placeholder="name@hoora.me, colleague@hoora.me"></textarea></div><div class="field"><label for="team-role">Role</label>${roleSelect('id="team-role" name="role"', 'viewer', 'Team role')}</div><p class="error" role="alert"></p><div class="dialog-actions"><button type="button" class="btn outline" data-close>Cancel</button><button type="submit" class="btn dark">Add</button></div></form>`,
        async (form) => {
          const emails = [
            ...new Set(
              String(form.get('emails'))
                .split(/[\s,;]+/)
                .map((v) => v.trim().toLowerCase())
                .filter(Boolean),
            ),
          ];
          const invalid = emails.find((address) => !EMAIL.test(address));
          if (invalid) throw new Error(`${invalid} is not a Hoora work email.`);
          if (!emails.length || emails.length > 100) throw new Error('Add up to 100 Hoora emails.');
          await teamMembers(
            emails.map((email) => ({
              team_id: team.id,
              email,
              role: form.get('role'),
              added_by: state.member.id,
            })),
          );
          await refresh(
            emails.length === 1 ? 'Added to the team.' : `${emails.length} people added.`,
          );
        },
      );
    if (type === 'person-add-team' || type === 'assign') {
      const emails = button.dataset.email
        ? [button.dataset.email]
        : [...document.querySelectorAll('[data-assign-email]:checked')].map(
            (box) => box.dataset.assignEmail,
          );
      if (!emails.length) throw new Error('Select people first.');
      const who = emails.length === 1 ? personName(emails[0]) : `${emails.length} people`;
      return dialog(
        `<h2>Add to team</h2><p class="small">${e(who)}</p><form><div class="access-form-row"><div class="field"><label for="person-team">Team</label><select id="person-team" name="team" required><option value="">Choose…</option>${state.teams.map((t) => `<option value="${t.id}">${e(t.name)}</option>`).join('')}</select></div><div class="field"><label for="person-team-role">Role</label>${roleSelect('id="person-team-role" name="role"', 'viewer', 'Team role')}</div></div><p class="error" role="alert"></p><div class="dialog-actions"><button type="button" class="btn outline" data-close>Cancel</button><button type="submit" class="btn dark">Add</button></div></form>`,
        async (form) => {
          await teamMembers(
            emails.map((email) => ({
              team_id: form.get('team'),
              email,
              role: form.get('role'),
              added_by: state.member.id,
            })),
          );
          await refresh(
            emails.length === 1
              ? 'Added to the team.'
              : `${emails.length} people added to the team.`,
          );
        },
      );
    }
    if (type === 'remove-member')
      return confirmAction(
        'Remove from team?',
        `${personName(button.dataset.email)} loses the access this team gives.`,
        async () => {
          await teamMembers(
            null,
            `?team_id=eq.${button.dataset.team}&email=eq.${encodeURIComponent(button.dataset.email)}`,
            'DELETE',
          );
          await refresh('Removed from the team.');
        },
      );
    if (type === 'add-person') return memberDialog();
    if (type === 'reset-password')
      return dialog(
        `<h2>Reset password</h2><form><div class="field"><label for="reset-password">New temporary password</label><input id="reset-password" name="password" type="password" minlength="12" autocomplete="new-password" required></div><p class="error" role="alert"></p><div class="dialog-actions"><button type="button" class="btn outline" data-close>Cancel</button><button type="submit" class="btn dark">Reset password</button></div></form>`,
        async (form) => {
          await admin({
            action: 'password',
            id: button.dataset.member,
            password: form.get('password'),
          });
          toast('Password updated. Share it securely.');
        },
      );
    if (type === 'remove-person')
      return confirmAction(
        'Remove this person?',
        'Their login, teams and access are removed. Documents they wrote are kept.',
        async () => {
          await admin({ action: 'delete', id: button.dataset.member });
          await load();
          location.hash = '#/access?tab=people';
          toast('Person removed.');
        },
      );
    if (type === 'sign-out-member')
      return confirmAction(
        button.dataset.device ? 'Sign out this device?' : 'Sign out everywhere?',
        'They need to sign in again on that device.',
        async () => {
          await db('rpc/docs_sign_out_member', '', {
            method: 'POST',
            body: { member: button.dataset.member, device: button.dataset.device || null },
          });
          await refresh('Signed out.');
        },
      );
    if (type === 'device-sign-out' || type === 'devices-sign-out-others') {
      await db(
        type === 'device-sign-out' ? 'rpc/docs_sign_out_device' : 'rpc/docs_sign_out_other_devices',
        '',
        {
          method: 'POST',
          body: type === 'device-sign-out' ? { device: button.dataset.device } : {},
        },
      );
      await render();
      toast(type === 'device-sign-out' ? 'Device signed out.' : 'Other devices signed out.');
    }
  }
  async function change(field) {
    if ('assignAll' in field.dataset || 'assignEmail' in field.dataset) {
      const scope = field.closest('.access-detail') || document;
      const boxes = [...scope.querySelectorAll('[data-assign-email]')];
      if ('assignAll' in field.dataset) boxes.forEach((box) => (box.checked = field.checked));
      const picked = boxes.filter((box) => box.checked).length;
      const all = scope.querySelector('[data-assign-all]');
      if (all) all.checked = picked > 0 && picked === boxes.length;
      const action = scope.querySelector('[data-assign-selected]');
      if (action) {
        action.disabled = !picked;
        action.lastChild.textContent = picked ? `Add ${picked} to team` : 'Add selected to team';
      }
      return;
    }
    if (field.dataset.grantLevel) {
      const grant = state.grants.find((g) => g.id === field.dataset.grantLevel);
      if (!grant) return;
      await db('rpc/docs_grant_access', '', {
        method: 'POST',
        body: {
          team: grant.team_id,
          person_email: grant.email,
          target_type: grant.target_type,
          collection_key: grant.collection_key,
          target_id: grant.project_id || grant.folder_id || grant.page_id,
          access_level: Number(field.value),
          expires: grant.expires_at,
        },
      });
      return refresh('Access updated.');
    }
    if (field.dataset.teamRole) {
      await teamMembers(
        { role: field.value },
        `?team_id=eq.${field.dataset.teamRole}&email=eq.${encodeURIComponent(field.dataset.email)}`,
        'PATCH',
      );
      return refresh('Role updated.');
    }
    if (field.dataset.generalAccess) {
      const id = field.dataset.generalAccess;
      await db('rpc/docs_share', '', {
        method: 'POST',
        body: {
          document_id: id,
          access_mode: field.value,
          grants: state.grants
            .filter((g) => g.page_id === id)
            .map((g) => ({ team_id: g.team_id, email: g.email, level: g.level })),
        },
      });
      return refresh('General access updated.');
    }
  }
  async function submit(form) {
    const data = new FormData(form);
    await admin({
      action: 'update',
      id: form.dataset.personForm,
      name: data.get('name'),
      role: data.get('role'),
      active: data.get('active') !== 'false',
    });
    await refresh('Saved.');
  }
  return { view, action, change, submit, share, teamField, devicesSection, levels };
}
