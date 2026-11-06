export function teamsFeature({ state, db, e, dialog, toast, load, render, icon, row }) {
  const manages = (team) => !!state.member && (
    state.member.role === 'admin' ||
    (state.member.role === 'manager' && team.manager_id === state.member.id)
  );
  const ownRole = (team) => state.teamMembers.find((member) =>
    member.team_id === team.id && member.email === state.member?.email?.toLowerCase()
  )?.role || '';
  const canGrant = (team, role) => manages(team) || ownRole(team) === 'publisher' || (ownRole(team) === 'viewer' && role === 'viewer');
  const canManagePeople = (team) => canGrant(team, 'viewer');
  const grantableRoles = (team) => ownRole(team) === 'viewer' && !manages(team) ? ['viewer'] : ['viewer', 'publisher'];
  const roleLabel = (role) => role === 'publisher' ? 'Publisher' : 'Viewer';
  const teamFor = (id) => state.teams.find((team) => team.id === id || team.slug === id);

  function field(page) {
    const choices = state.teams.filter((team) => manages(team) || state.teamMembers.some((member) =>
      member.team_id === team.id && member.email === state.member?.email?.toLowerCase() && member.role === 'publisher'
    ));
    const companyOption = ['admin', 'publisher'].includes(state.member.role);
    return `<div class="field"><label for="document-team">Document team</label><select id="document-team" name="team_id" ${companyOption ? '' : 'required'}>${companyOption ? '<option value="">Company workspace</option>' : '<option value="">Choose your team</option>'}${choices.map((team) => `<option value="${team.id}" ${page.team_id === team.id ? 'selected' : ''}>${e(team.name)}</option>`).join('')}</select><small>Team documents start with access limited to that team.</small></div>`;
  }

  async function view(id) {
    const team = teamFor(id);
    const canCreate = ['admin', 'manager'].includes(state.member?.role);
    if (id && !team) return `<main class="settings-content"><h1>Team unavailable</h1><p>You may no longer belong to this team.</p><a href="#/teams">Back to teams</a></main>`;
    if (!team) return `<main id="main" class="settings-content team-directory"><div class="view-heading"><div><h1>Your teams</h1><p>Shared knowledge, with access managed by each team.</p></div>${canCreate ? '<button class="btn dark" data-team-action="create">New team</button>' : ''}</div><div class="teams-grid">${state.teams.map((item) => `<a class="team-card" href="#/teams/${e(item.slug)}">${icon('users')}<h2>${e(item.name)}</h2><p>${state.teamMembers.filter((member) => member.team_id === item.id).length} members</p><span>${manages(item) ? 'You manage this team' : 'Team member'}</span></a>`).join('') || '<div class="empty"><h2>No teams yet</h2><p>A manager can add your Hoora email to a team. Your access will be ready when you sign in.</p></div>'}</div></main>`;

    const docs = state.pages.filter((page) => page.team_id === team.id && !page.archived_at);
    const linkedDocs = state.pages.filter((page) => page.team_id === team.id);
    const members = state.teamMembers.filter((member) => member.team_id === team.id);
    const canWrite = manages(team) || ownRole(team) === 'publisher';
    return `<main id="main" class="settings-content"><a class="native-back" href="#/teams">All teams</a><div class="view-heading"><div><h1>${e(team.name)}</h1><p>Documents and people in this team.</p></div><div class="toolbar-actions">${manages(team) ? `<button class="btn outline" data-team-action="rename" data-id="${team.id}">Team settings</button>` : ''}${canManagePeople(team) ? `<button class="btn dark" data-team-action="invite" data-id="${team.id}">Add people</button>` : ''}${canWrite ? `<a class="btn outline" href="#/new?team=${e(team.slug)}">New team document</a>` : ''}${manages(team) ? `<button class="btn danger" data-team-action="delete" data-id="${team.id}" ${linkedDocs.length ? 'disabled title="Move or delete this team’s documents first"' : ''}>Delete team</button>` : ''}</div></div>${manages(team) && linkedDocs.length ? '<p class="small team-delete-hint">Move or delete this team’s documents before deleting the team.</p>' : ''}<h2 class="team-section-title">Documents</h2><div class="document-table">${docs.map((page) => row(page, true)).join('') || '<div class="empty"><h3>No documents yet</h3><p>Create a team document to start sharing knowledge.</p></div>'}</div><h2 class="team-section-title">People</h2><p class="small">Publishers can create and publish team documents. Viewers can read them. You can grant access at or below your own team role.</p><div class="tablewrap"><table><thead><tr><th>Work email</th><th>Team access</th><th></th></tr></thead><tbody>${members.map((member) => `<tr><td>${e(member.email)}</td><td>${e(roleLabel(member.role))}</td><td>${canGrant(team, member.role) ? `<button class="btn text" data-team-action="manage-member" data-id="${team.id}" data-email="${e(member.email)}" data-role="${e(member.role)}">Manage</button>` : ''}</td></tr>`).join('')}</tbody></table></div></main>`;
  }

  async function action(button) {
    const type = button.dataset.teamAction;
    const id = button.dataset.id;
    const team = teamFor(id);
    if (type === 'remove') {
      const email = button.dataset.email;
      if (!canGrant(team, button.dataset.role || 'viewer')) throw new Error('You can only remove equal or lower team access.');
      dialog(`<h2>Remove team access?</h2><p>${e(email)} will lose the access provided by ${e(team.name)}. Direct document access still applies.</p><form><div class="dialog-actions"><button type="button" class="btn outline" data-close>Cancel</button><button class="btn danger">Remove access</button></div></form>`, async () => {
        await db('docs_team_members', `?team_id=eq.${id}&email=eq.${encodeURIComponent(email)}`, { method: 'DELETE' });
        await load(); await render(); toast('Team access removed.');
      });
      return;
    }
    if (type === 'manage-member') {
      const email = button.dataset.email;
      const currentRole = button.dataset.role;
      const roles = grantableRoles(team);
      if (!canGrant(team, currentRole)) throw new Error('You can only manage equal or lower team access.');
      dialog(`<h2>Manage team access</h2><p class="small">${e(email)}</p><form><div class="field"><label for="team-member-role">Team role</label><select id="team-member-role" name="role">${roles.map((role) => `<option value="${role}" ${role === currentRole ? 'selected' : ''}>${role === 'publisher' ? 'Publisher · create and publish' : 'Viewer · read team documents'}</option>`).join('')}</select></div><p class="error" role="alert"></p><div class="dialog-actions"><button type="button" class="btn text" data-team-action="remove" data-id="${id}" data-email="${e(email)}" data-role="${currentRole}">Remove</button><button type="button" class="btn outline" data-close>Cancel</button><button class="btn dark">Save access</button></div></form>`, async (form) => {
        const role = form.get('role');
        if (!roles.includes(role)) throw new Error('You cannot grant a higher team role than your own.');
        await db('docs_team_members', `?team_id=eq.${id}&email=eq.${encodeURIComponent(email)}`, { method: 'PATCH', body: { role } });
        await load(); await render(); toast('Team access updated.');
      });
      return;
    }
    if (type === 'delete') {
      if (!manages(team)) throw new Error('Only the administrator or team manager can delete this team.');
      if (state.pages.some((page) => page.team_id === team.id)) throw new Error('Move or delete this team’s documents first.');
      dialog(`<h2>Delete ${e(team.name)}?</h2><p>This removes the team and its membership list. Team documents must be moved or deleted first.</p><form><p class="error" role="alert"></p><div class="dialog-actions"><button type="button" class="btn outline" data-close>Cancel</button><button class="btn danger">Delete team</button></div></form>`, async () => {
        await db('docs_teams', `?id=eq.${id}`, { method: 'DELETE' });
        await load(); location.hash = '#/teams'; await render(); toast('Team deleted.');
      });
      return;
    }
    if (type === 'invite') {
      if (!canManagePeople(team)) throw new Error('You cannot assign access for this team.');
      const roles = grantableRoles(team);
      dialog(`<h2>Add people to ${e(team.name)}</h2><form><div class="field"><label for="team-emails">Hoora work emails</label><textarea id="team-emails" name="emails" rows="4" required placeholder="name@hoora.me, colleague@hoora.me"></textarea><small>Separate addresses with commas or spaces. They can sign in with Microsoft.</small></div><div class="field"><label for="team-access">Team access</label><select id="team-access" name="role">${roles.map((role) => `<option value="${role}">${role === 'publisher' ? 'Publisher · create and publish' : 'Viewer · read team documents'}</option>`).join('')}</select></div><p class="error" role="alert"></p><div class="dialog-actions"><button type="button" class="btn outline" data-close>Cancel</button><button class="btn dark">Save access</button></div></form>`, async (form) => {
        const emails = [...new Set(String(form.get('emails')).split(/[\s,;]+/).filter(Boolean).map((email) => email.toLowerCase()))];
        const role = form.get('role');
        if (!roles.includes(role)) throw new Error('You cannot grant a higher team role than your own.');
        if (!emails.length || emails.length > 100 || emails.some((email) => !/^\S+@hoora\.me$/.test(email))) throw new Error('Use up to 100 Hoora work emails.');
        await db('docs_team_members', '', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: emails.map((email) => ({ team_id: id, email, role, added_by: state.member.id })) });
        await load(); await render(); toast('Team access saved.');
      });
      return;
    }

    const managerChoices = state.member.role === 'admin' && type === 'rename'
      ? await db('docs_members', '?role=in.(admin,manager)&active=eq.true&select=id,name,email&order=name')
      : [];
    dialog(`<h2>${type === 'rename' ? 'Team settings' : 'Create a team'}</h2><form><div class="field"><label for="team-name">Team name</label><input id="team-name" name="name" maxlength="100" required value="${e(team?.name || '')}"></div>${managerChoices.length ? `<div class="field"><label for="team-manager">Team manager</label><select id="team-manager" name="manager_id"><option value="">Unassigned</option>${managerChoices.map((member) => `<option value="${member.id}" ${team?.manager_id === member.id ? 'selected' : ''}>${e(member.name || member.email)}</option>`).join('')}</select><small>Only administrators can transfer team ownership.</small></div>` : ''}<p class="error" role="alert"></p><div class="dialog-actions"><button type="button" class="btn outline" data-close>Cancel</button><button class="btn dark">${team ? 'Save changes' : 'Create team'}</button></div></form>`, async (form) => {
      const name = form.get('name').trim();
      if (!name) throw new Error('Enter a team name.');
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (!slug) throw new Error('Include letters or numbers in the team name.');
      await db('docs_teams', team ? `?id=eq.${id}` : '', { method: team ? 'PATCH' : 'POST', body: team ? { name, ...(state.member.role === 'admin' ? { manager_id: form.get('manager_id') || null } : {}) } : { name, slug, manager_id: state.member.id } });
      await load(); await render(); toast(team ? 'Team updated.' : 'Team created.');
    });
  }

  return { field, view, action, manages };
}
