/** Consistent drawer behavior without re-rendering the page or moving content on hover. */
export function createNavigation({ app, state, icon }) {
  let returnFocus = null;
  function setOpen(open) {
    const layout = app.querySelector('.layout');
    if (!layout) return;
    layout.classList.toggle('menu-open', open);
    document.body.classList.toggle('navigation-open', open);
    const trigger = app.querySelector('[data-action=menu]');
    trigger?.setAttribute('aria-expanded', String(open));
    const main = layout.querySelector('main');
    if (main) main.inert = open;
    if (open) {
      returnFocus = document.activeElement;
      layout.querySelector('.sidebar a,.sidebar button')?.focus();
    } else {
      returnFocus?.isConnected && returnFocus.focus();
      returnFocus = null;
    }
  }
  function prepare() {
    document.body.classList.remove('navigation-open');
    const route = document.body.dataset.route;
    let rail = app.querySelector('.layout>.sidebar');
    if (
      !rail &&
      state.member &&
      !['login', 'install', 'app-welcome', 'artifact', 'preview'].includes(route)
    ) {
      const main = app.querySelector('main');
      if (main) {
        const layout = document.createElement('div');
        layout.className = 'layout app-layout';
        main.before(layout);
        layout.innerHTML = `<aside class="sidebar workspace-sidebar" aria-label="Workspace navigation"><a class="sidelink" href="#/home">${icon('grid')}<span>Home</span></a><a class="sidelink" href="#/releases">${icon('release')}<span>Releases</span></a><a class="sidelink" href="#/upcoming">${icon('clock')}<span>Upcoming releases</span></a><a class="sidelink" href="#/workspace">${icon('book')}<span>Library</span></a></aside>`;
        layout.append(main);
        rail = layout.querySelector('.sidebar');
      }
    }
    if (rail) {
      rail.id = 'workspace-navigation';
      const backdrop = document.createElement('button');
      backdrop.type = 'button';
      backdrop.className = 'navigation-backdrop';
      backdrop.setAttribute('aria-label', 'Close navigation');
      backdrop.tabIndex = -1;
      backdrop.addEventListener('click', () => setOpen(false));
      rail.after(backdrop);
    }
    const trigger = app.querySelector('[data-action=menu]');
    trigger?.setAttribute('aria-expanded', 'false');
    trigger?.setAttribute('aria-controls', 'workspace-navigation');
    const properties = app.querySelector('.editor .document-properties');
    if (properties && !properties.querySelector('.editor-settings')) {
      const details = document.createElement('details');
      details.className = 'editor-settings';
      details.open = matchMedia('(min-width:1101px)').matches;
      const summary = document.createElement('summary');
      summary.textContent = properties.querySelector('h2')?.textContent || 'Document details';
      properties.querySelector('h2')?.remove();
      const fields = document.createElement('div');
      fields.className = 'editor-settings-fields';
      fields.append(...properties.childNodes);
      details.append(summary, fields);
      properties.append(details);
    }
  }
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape')
      app.querySelectorAll('.rail-more[open]').forEach((menu) => {
        menu.open = false;
        menu.querySelector('summary')?.focus();
      });
    if (!document.body.classList.contains('navigation-open')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    }
    if (event.key === 'Tab') {
      const controls = [
        ...app.querySelectorAll('.sidebar a,.sidebar button,.sidebar summary'),
      ].filter((e) => e.getClientRects().length && !e.disabled);
      if (!controls.length) return;
      const first = controls[0],
        last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });
  document.addEventListener('click', (event) => {
    app.querySelectorAll('.rail-more[open]').forEach((menu) => {
      if (!menu.contains(event.target)) menu.open = false;
    });
    if (event.target.closest('.sidebar a') && document.body.classList.contains('navigation-open'))
      setOpen(false);
  });
  matchMedia('(min-width:901px)').addEventListener('change', (event) => {
    if (event.matches) setOpen(false);
  });
  matchMedia('(min-width:1101px)').addEventListener('change', (event) => {
    const details = app.querySelector('.editor-settings');
    if (details) details.open = event.matches;
  });
  return { prepare, setOpen };
}
