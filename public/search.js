import { icon } from './vendor/icons.js';
import { publishedRoute, routeUrl } from './router.js';
export function createSearchService(db) {
  const cache = new Map();
  return {
    async search(query) {
      const q = query.trim().slice(0, 200);
      if (!q) return [];
      const old = cache.get(q);
      if (old && Date.now() - old.at < 15000) return old.rows;
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
function filteredResults(state, matches, params) {
  const kind = params.get('kind') || '',
    team = params.get('team') || '',
    project = params.get('project') || '',
    sort = params.get('sort') || 'relevance';
  const results = matches
    .map((row) => ({ ...state.published.find((page) => page.id === row.id), ...row }))
    .filter(
      (page) =>
        (!kind || page.kind === kind) &&
        (!team || page.team_id === team) &&
        (!project || page.project_id === project),
    );
  const at = (page) =>
    new Date(
      sort === 'updated' ? page.updated_at || page.published_at : page.published_at,
    ).getTime() || 0;
  if (sort !== 'relevance')
    results.sort((a, b) => (sort === 'oldest' ? at(a) - at(b) : at(b) - at(a)));
  return results;
}
function resultMarkup({ state, e, names, matches, params, query }) {
  const rows = filteredResults(state, matches, params);
  return {
    count: query ? `${rows.length} ${rows.length === 1 ? 'result' : 'results'}` : '',
    html:
      rows
        .map(
          (page) =>
            `<article><small>${e(names[page.kind] || page.kind)}</small><h2><a href="${publishedRoute(page, state.projects)}">${e(page.title)}</a></h2>${page.summary ? `<p>${e(page.summary)}</p>` : ''}<div>${page.version ? `<span>v${e(page.version.replace(/^v/i, ''))}</span>` : ''}${page.owner_name ? `<span>${e(page.owner_name)}</span>` : ''}${page.updated_at || page.published_at ? `<span>Updated ${new Date(page.updated_at || page.published_at).toLocaleDateString('en-IN')}</span>` : ''}</div></article>`,
        )
        .join('') ||
      `<div class="empty"><h2>${query ? 'No matching documents' : 'Search Hoora Docs'}</h2><p>${query ? 'Try fewer words or broader filters.' : 'Find releases, guides and SOPs.'}</p></div>`,
  };
}
export async function searchResultsPage({ state, service, e, names, query, params }) {
  let matches = [],
    error = '';
  try {
    matches = query ? await service.search(query) : [];
  } catch {
    error = 'Search could not connect. Please try again.';
  }
  const result = resultMarkup({ state, e, names, matches, params, query });
  const option = (value, label, selected) =>
    `<option value="${e(value)}" ${value === selected ? 'selected' : ''}>${e(label)}</option>`;
  return `<main id="main" class="settings-content search-results-page"><div class="view-heading"><h1>Search</h1></div><form id="search-results-form" class="search-page-form" role="search"><div class="search">${icon('search')}<label class="sr-only" for="global-query">Search query</label><input id="global-query" name="q" type="search" value="${e(query)}" maxlength="200" placeholder="Search Hoora Docs…" autocomplete="off" aria-controls="global-results"><button class="btn dark" type="submit">Search</button></div><div class="search-result-filters"><label>Collection<select name="kind">${option('', 'All collections', params.get('kind'))}${state.types.map((type) => option(type.key, type.name, params.get('kind'))).join('')}</select></label>${state.member ? `<label>Team<select name="team">${option('', 'All teams', params.get('team'))}${state.teams.map((team) => option(team.id, team.name, params.get('team'))).join('')}</select></label>` : ''}<label>Platform<select name="project">${option('', 'All platforms', params.get('project'))}${state.projects.map((project) => option(project.id, project.name, params.get('project'))).join('')}</select></label><label>Sort<select name="sort">${option('relevance', 'Relevance', params.get('sort') || 'relevance')}${option('updated', 'Recently updated', params.get('sort'))}${option('newest', 'Newest', params.get('sort'))}${option('oldest', 'Oldest', params.get('sort'))}</select></label></div></form><p class="search-status" id="search-status" role="status" aria-live="polite">${e(error || result.count)}</p><div id="global-results" class="search-result-list" aria-label="Search results">${result.html}</div></main>`;
}
/** Search updates this page in place; it never opens a modal or replaces the input. */
export function bindSearchPage({ state, service, e, names }) {
  const form = document.querySelector('#search-results-form');
  if (!form) return;
  const input = form.elements.q,
    results = document.querySelector('#global-results'),
    status = document.querySelector('#search-status');
  let sequence = 0,
    timer;
  async function update() {
    const current = ++sequence,
      query = input.value.trim(),
      params = new URLSearchParams(new FormData(form));
    for (const [key, value] of [...params])
      if (!value || (key === 'sort' && value === 'relevance')) params.delete(key);
    history.replaceState(null, '', routeUrl('#/search') + (params.size ? '?' + params : ''));
    status.textContent = query ? 'Searching…' : '';
    results.setAttribute('aria-busy', 'true');
    try {
      const matches = query ? await service.search(query) : [];
      if (current !== sequence || !results.isConnected) return;
      const result = resultMarkup({ state, e, names, matches, params, query });
      results.innerHTML = result.html;
      status.textContent = result.count;
    } catch {
      if (current === sequence && results.isConnected)
        status.textContent = 'Search could not connect. Please try again.';
    } finally {
      if (current === sequence) results.removeAttribute('aria-busy');
    }
  }
  input.addEventListener('input', () => {
    clearTimeout(timer);
    sequence++;
    timer = setTimeout(update, 180);
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    clearTimeout(timer);
    update();
  });
  form.querySelectorAll('select').forEach((select) =>
    select.addEventListener('change', () => {
      clearTimeout(timer);
      update();
    }),
  );
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      const first = results.querySelector('h2 a');
      if (first) {
        event.preventDefault();
        first.focus();
      }
    }
  });
  input.focus({ preventScroll: true });
}
