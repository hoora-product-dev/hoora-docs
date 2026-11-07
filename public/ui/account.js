/** Account and administration live in one avatar menu in the topbar. */
export const settingsLinks = (member, pendingRequests = 0) => {
  if (!member) return [];
  const links = [
    ['account', 'user', 'Account'],
    ['teams', 'users', 'Teams'],
  ];
  if (['admin', 'publisher'].includes(member.role))
    links.push(['requests', 'clock', 'Requests', pendingRequests]);
  if (member.role === 'admin')
    links.push(
      ['users', 'users', 'People & access'],
      ['folders', 'folder', 'Structure'],
      ['activity', 'list', 'Activity'],
      ['archive', 'archive', 'Recycle bin'],
    );
  return links;
};

export function accountMenu({ state, e, icon, avatar, theme }) {
  const member = state.member;
  if (!member) return '';
  const links = settingsLinks(member, state.pendingRequestCount);
  return `<details class="account-menu"><summary aria-label="Account and settings" title="${e(member.name || member.email)}"><span class="user-avatar">${avatar}</span>${state.pendingRequestCount && ['admin', 'publisher'].includes(member.role) ? '<span class="account-dot" aria-hidden="true"></span>' : ''}</summary><div class="account-menu-panel"><div class="account-menu-identity"><strong>${e(member.name || member.email)}</strong><small>${e(member.email)}</small></div>${links
    .map(
      ([route, glyph, label, count]) =>
        `<a href="#/${route}">${icon(glyph)}<span>${label}</span>${count ? `<span class="nav-count">${Math.min(99, count)}</span>` : ''}</a>`,
    )
    .join(
      '',
    )}<div class="account-menu-divider"></div><button type="button" data-action="theme">${icon(theme === 'dark' ? 'sun' : 'moon')}<span>${theme === 'dark' ? 'Light theme' : 'Dark theme'}</span></button>${member.role === 'admin' ? `<button type="button" data-action="reindex-knowledge">${icon('reload')}<span>Refresh AI index</span></button>` : ''}<button type="button" data-action="logout">${icon('logout')}<span>Sign out</span></button></div></details>`;
}
