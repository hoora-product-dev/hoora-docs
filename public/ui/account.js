/** Account and administration live in one avatar menu in the topbar. */
export const settingsLinks = (member) => {
  if (!member) return [];
  if (member.role !== 'admin')
    return [
      ['account', 'user', 'Account'],
      ['access', 'users', 'Teams'],
    ];
  return [
    ['account', 'user', 'Account'],
    ['access', 'users', 'Access'],
    ['folders', 'folder', 'Structure'],
    ['activity', 'list', 'Activity'],
    ['feedback', 'chat', 'Feedback'],
  ];
};

export function accountMenu({ state, e, icon, avatar, theme }) {
  const member = state.member;
  if (!member) return '';
  const links = settingsLinks(member);
  return `<details class="account-menu"><summary aria-label="Account and settings" title="${e(member.name || member.email)}"><span class="user-avatar">${avatar}</span></summary><div class="account-menu-panel"><div class="account-menu-identity"><strong>${e(member.name || member.email)}</strong><small>${e(member.email)}</small></div>${links
    .map(([route, glyph, label]) => `<a href="#/${route}">${icon(glyph)}<span>${label}</span></a>`)
    .join(
      '',
    )}<div class="account-menu-divider"></div><button type="button" data-action="theme">${icon(theme === 'dark' ? 'sun' : 'moon')}<span>${theme === 'dark' ? 'Light theme' : 'Dark theme'}</span></button><button type="button" data-action="logout">${icon('logout')}<span>Sign out</span></button></div></details>`;
}
