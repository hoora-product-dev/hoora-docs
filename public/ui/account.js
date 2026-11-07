/** One account entry in the sidebar; every action has a consistent icon. */
export function sidebarAccount({ state, e, icon, avatar }) {
  const member = state.member;
  if (!member)
    return `<div class="rail-account signed-out"><a class="btn dark rail-sign-in" href="#/login" aria-label="Sign in">${icon('login')}<span>Sign in</span></a></div>`;
  const items = [
    ['account', 'user', 'Account settings'],
    ['teams', 'users', 'Teams'],
  ];
  if (member.role === 'admin')
    items.push(['folders', 'folder', 'Manage structure'], ['users', 'users', 'Manage people']);
  if (['admin', 'publisher'].includes(member.role)) items.push(['requests', 'clock', 'Requests']);
  if (member.role === 'admin')
    items.push(['archive', 'archive', 'Archive'], ['activity', 'list', 'Activity']);
  return `<div class="rail-account"><a href="#/account" class="rail-person"><span class="user-avatar">${avatar}</span><span><strong>${e(member.name || member.email)}</strong><small>${e(member.email)}</small></span></a><details class="rail-more"><summary aria-label="Workspace options" title="Workspace options">${icon('more')}</summary><div class="rail-menu"><div class="rail-menu-identity"><strong>${e(member.name || member.email)}</strong><small>${e(member.email)}</small></div>${items.map(([route, glyph, label]) => `<a href="#/${route}">${icon(glyph)}<span>${label}</span>${route === 'requests' && state.pendingRequestCount ? `<span class="nav-count">${Math.min(99, state.pendingRequestCount)}</span>` : ''}</a>`).join('')}${member.role === 'admin' ? `<button type="button" data-action="reindex-knowledge">${icon('reload')}<span>Refresh AI index</span></button>` : ''}<button type="button" data-action="logout">${icon('logout')}<span>Sign out</span></button></div></details></div>`;
}
