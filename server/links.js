export function publishedPath(page) {
  if (page?.kind === 'release' && page.version && page.release_snapshot?.project) {
    const version = String(page.version).replace(/^v(?=\d)/i, '');
    const application =
      page.release_snapshot.project_slug ||
      String(page.release_snapshot.project)
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    if (/^[a-z0-9][a-z0-9.-]*$/.test(version) && application)
      return `/release-notes/${encodeURIComponent(version)}/${encodeURIComponent(application)}`;
  }
  return `/docs/${encodeURIComponent(page.slug)}`;
}
