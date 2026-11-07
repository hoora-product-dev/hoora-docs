export function routeHash() {
  if (location.hash.startsWith('#/')) return location.hash;
  const path = location.pathname.replace(/^\/docs\//, '/doc/');
  return '#' + (path === '/' ? '/home' : path === '/app' ? '/home' : path) + location.search;
}
export function routeUrl(hash) {
  if (!hash?.startsWith('#/')) return hash;
  return hash.slice(1).replace(/^\/doc\//, '/docs/');
}
export function publishedRoute(page, projects = []) {
  if (
    page?.kind === 'release' &&
    page?.version &&
    (page?.project_id || page?.release_snapshot?.project)
  ) {
    // The platform's stored slug is the single source for release URLs.
    const project = projects.find((item) => item.id === page.project_id);
    const projectSlug =
      project?.slug ||
      String(page.release_snapshot?.project || '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    const version = String(page.version).replace(/^v(?=\d)/i, '');
    if (projectSlug && /^[a-z0-9][a-z0-9.-]*$/.test(version))
      return `#/release-notes/${encodeURIComponent(version)}/${encodeURIComponent(projectSlug)}`;
  }
  return `#/doc/${encodeURIComponent(page?.slug || '')}`;
}
export function canonicalizeRoute() {
  if (
    new URLSearchParams(location.search).has('code') ||
    new URLSearchParams(location.search).has('auth_callback')
  )
    return;
  const next = routeUrl(routeHash());
  if (location.pathname + location.search + location.hash !== next)
    history.replaceState(null, '', next);
}
