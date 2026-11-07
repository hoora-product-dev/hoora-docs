import { icon } from './vendor/icons.js';
import { publishedRoute } from './router.js';
export function createSearchService(db) {
  const cache = new Map();
  return {
    async search(query) {
      const q = query.trim().slice(0, 200);
      if (!q) return [];
      const existing = cache.get(q);
      if (existing && Date.now() - existing.at < 15000) return existing.rows;
      const rows = await db('rpc/docs_search', '', {
        method: 'POST',
        body: { query: q, result_limit: 50 },
      });
      cache.set(q, { at: Date.now(), rows });
      return rows;
    },
    clear() {
      cache.clear();
    },
  };
}
export function searchDialog({ service, dialog, e, modal, state, names }) {
  dialog(
    `<h2 class="sr-only">Search Hoora knowledge</h2><div class="command-search">${icon('search')}<label class="sr-only" for="global-query">Search all documents</label><input id="global-query" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="global-results" type="search" placeholder="Search Hoora Docs…" autocomplete="off"><button type="button" class="command-close" data-close aria-label="Close search"><kbd>Esc</kbd></button></div><div class="global-results" id="global-results" role="listbox" aria-label="Search results"></div><div class="command-footer"><span><kbd>${icon('up')}</kbd><kbd>${icon('down')}</kbd>Navigate</span><span><kbd>${icon('enter')}</kbd>Open</span><span>Search your knowledge</span></div>`,
  );
  modal.classList.add('command-dialog');
  const root = modal.querySelector('#global-results'),
    input = modal.querySelector('#global-query');
  let timer,
    sequence = 0,
    index = -1;
  const key = 'hoora-searches-' + (state.member?.id || 'public');
  function links() {
    return [...root.querySelectorAll('a')];
  }
  function select(next) {
    const all = links();
    index = Math.max(0, Math.min(next, all.length - 1));
    all.forEach((a, i) => {
      a.classList.toggle('selected', i === index);
      a.setAttribute('aria-selected', String(i === index));
    });
    if (all[index]) {
      input.setAttribute('aria-activedescendant', all[index].id);
      all[index].scrollIntoView({ block: 'nearest' });
    }
  }
  function remember() {
    const query = input.value.trim();
    if (!query) return;
    try {
      const old = JSON.parse(localStorage.getItem(key) || '[]');
      localStorage.setItem(
        key,
        JSON.stringify([query, ...old.filter((q) => q !== query)].slice(0, 5)),
      );
    } catch {}
  }
  async function update() {
    const seq = ++sequence,
      q = input.value.trim();
    index = -1;
    input.removeAttribute('aria-activedescendant');
    if (!q) {
      let recent = [];
      try {
        recent = JSON.parse(localStorage.getItem(key) || '[]');
      } catch {}
      root.innerHTML = recent.length
        ? `<p class="small">Recent searches</p>${recent.map((q) => `<button class="recent-search" data-recent-query="${e(q)}">${e(q)}</button>`).join('')}`
        : `<div class="command-empty">${icon('book')}<strong>Your knowledge, a search away</strong><p>Find releases, SOPs, documents and dashboards.</p></div>`;
      root.querySelectorAll('[data-recent-query]').forEach(
        (b) =>
          (b.onclick = () => {
            input.value = b.dataset.recentQuery;
            update();
          }),
      );
      return;
    }
    root.innerHTML = '<p class="muted" role="status">Searching…</p>';
    try {
      const rows = await service.search(q);
      if (seq !== sequence || !root.isConnected) return;
      root.innerHTML =
        rows
          .map(
            (p, i) =>
              `<a id="search-result-${i}" role="option" aria-selected="false" href="${publishedRoute(p, state.projects)}"><span class="command-result-title">${icon(p.kind === 'release' ? 'release' : p.kind === 'sop' ? 'sop' : 'documentation')}<span>${e(p.title)}</span></span><small>${e(names[p.kind] || p.kind)}${p.version ? ' · v' + e(p.version) : ''}</small><p>${e((p.summary || '').slice(0, 140))}</p></a>`,
          )
          .join('') ||
        '<p class="muted">No matching documents. Try fewer words or another spelling.</p>';
      root.insertAdjacentHTML(
        'beforeend',
        `<a class="search-all-results" id="search-all-results" role="option" aria-selected="false" href="#/search?q=${encodeURIComponent(q)}">See all results</a>`,
      );
      root.querySelectorAll('a').forEach(
        (a) =>
          (a.onclick = () => {
            remember();
            modal.close();
          }),
      );
    } catch {
      if (seq === sequence)
        root.innerHTML = '<p class="error">Search could not connect. Please try again.</p>';
    }
  }
  input.oninput = () => {
    clearTimeout(timer);
    sequence++;
    timer = setTimeout(update, 120);
  };
  input.onkeydown = (ev) => {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      select(index + (ev.key === 'ArrowDown' ? 1 : -1));
    }
    if (ev.key === 'Enter') {
      ev.preventDefault();
      const a = links()[index < 0 ? 0 : index];
      if (a) a.click();
    }
    if (ev.key === 'Escape') modal.close();
  };
  update();
  input.focus();
}
export async function searchResultsPage({ state, service, e, names, query, params }) {
  const matches = query ? await service.search(query) : [];
  const kind = params.get('kind') || '',
    team = params.get('team') || '',
    project = params.get('project') || '',
    sort = params.get('sort') || 'relevance';
  let results = matches
    .map((r) => ({ ...state.published.find((p) => p.id === r.id), ...r }))
    .filter(
      (p) =>
        (!kind || p.kind === kind) &&
        (!team || p.team_id === team) &&
        (!project || p.project_id === project),
    );
  if (sort === 'newest')
    results.sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
  if (sort === 'oldest')
    results.sort((a, b) => new Date(a.published_at) - new Date(b.published_at));
  if (sort === 'updated')
    results.sort(
      (a, b) => new Date(b.updated_at || b.published_at) - new Date(a.updated_at || a.published_at),
    );
  const option = (value, label, selected) =>
    `<option value="${e(value)}" ${value === selected ? 'selected' : ''}>${e(label)}</option>`;
  return `<main id="main" class="settings-content search-results-page"><div class="view-heading"><div><h1>${query ? 'Search results for “' + e(query) + '”' : 'Search your knowledge'}</h1><p>${query ? results.length + ' results' : 'Find releases, guides, SOPs and resources shared with you.'}</p></div></div><form id="search-results-form"><label class="search"><span class="sr-only">Search query</span><input name="q" type="search" value="${e(query)}" placeholder="Search products, SOPs, releases and dashboards…" required><button class="btn dark">Search</button></label><div class="search-result-filters"><label>Collection<select name="kind">${option('', 'All collections', kind)}${state.types.map((t) => option(t.key, t.name, kind)).join('')}</select></label><label>Team<select name="team">${option('', 'All teams', team)}${state.teams.map((t) => option(t.id, t.name, team)).join('')}</select></label><label>Application<select name="project">${option('', 'All applications', project)}${state.projects.map((p) => option(p.id, p.name, project)).join('')}</select></label><label>Sort<select name="sort">${option('relevance', 'Relevance', sort)}${option('updated', 'Recently updated', sort)}${option('newest', 'Newest', sort)}${option('oldest', 'Oldest', sort)}</select></label></div></form><div class="search-result-list">${results.map((p) => `<article><small>${e(names[p.kind] || p.kind)}</small><h2><a href="${publishedRoute(p, state.projects)}">${e(p.title)}</a></h2><p>${e(p.summary || p.body?.replace(/[#*`]/g, '').slice(0, 180) || 'Open this document to read more.')}</p><div>${p.owner_name ? `<span>${e(p.owner_name)}</span>` : ''}<span>Updated ${new Date(p.updated_at || p.published_at).toLocaleDateString('en-IN')}</span>${(p.tags || []).map((t) => `<span class="badge">${e(t)}</span>`).join('')}</div></article>`).join('') || `<div class="empty"><h2>${query ? 'No matching knowledge' : 'Start with a keyword'}</h2><p>${query ? 'Try fewer words, another spelling, or broader filters.' : 'Search results appear here. Use Ctrl or ⌘ + K for quick suggestions.'}</p></div>`}</div></main>`;
}
