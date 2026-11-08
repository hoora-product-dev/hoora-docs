/** Home: one search, the latest releases and recently updated documents. */
export function homePage({ state, e, icon, platformName, versionKey, date, link }) {
  const pages = state.member ? state.published : [];
  const releases = pages.filter((page) => page.kind === 'release').slice(0, 5),
    documents = pages
      .filter((page) => page.kind !== 'release')
      .sort(
        (a, b) =>
          new Date(b.updated_at || b.published_at) - new Date(a.updated_at || a.published_at),
      )
      .slice(0, 5);
  const list = (title, href, items, row) =>
    items.length
      ? `<section class="home-list"><div><h2>${title}</h2><a href="${href}">View all ${icon('chevron')}</a></div>${items.map(row).join('')}</section>`
      : '';
  const firstName = String(state.member?.name || '')
    .trim()
    .split(/\s+/)[0];
  return `<main id="main" class="home"><div class="home-intro"><h1>${firstName ? `Hi ${e(firstName)}, what are you looking for?` : 'Hoora knowledge, in one place.'}</h1><form id="home-search-form" class="home-search" action="/search" method="get" role="search">${icon('search')}<label class="sr-only" for="home-query">Search knowledge</label><input id="home-query" name="q" type="search" placeholder="Search releases, SOPs and documentation…" maxlength="200" autocomplete="off" aria-controls="home-search-results"></form></div><section class="home-search-results" id="home-search-results" aria-label="Search results" hidden><p id="home-search-status" class="search-status" role="status" aria-live="polite"></p><div id="home-results" class="search-result-list"></div></section><div id="home-content" class="home-columns">${list(
    'Latest releases',
    '#/releases',
    releases,
    (page) =>
      `<a href="${link(page)}"><span>${e(platformName(page.release_snapshot?.project || page.title))} <em>v${e(versionKey(page.version))}</em></span><small>${date(page.published_at)}</small></a>`,
  )}${list(
    'Recently updated',
    state.member && ['admin', 'publisher', 'manager'].includes(state.member.role)
      ? '#/workspace'
      : '#/browse',
    documents,
    (page) =>
      `<a href="${link(page)}"><span>${e(page.title)}</span><small>${e(state.types.find((type) => type.key === page.kind)?.name || 'Document')}</small></a>`,
  )}</div></main>`;
}
