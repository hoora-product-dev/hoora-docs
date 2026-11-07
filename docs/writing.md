# Writing and publishing

## Documents

New document opens a writing page with a title, optional summary and a continuous editor. Settings are alongside the page on desktop and collapse above the content on mobile. Markdown and HTML artifact formats use the same page shell.

Save draft keeps the writing page open and assigns a durable edit URL. Publish updates the reader-facing copy. Draft changes remain private until publication. Open preview, View published, approval, announcements, unpublishing and deletion are grouped under More actions when the current role and document state allow them.

Write, split view, preview and Markdown source share the same content. Pasted or dropped images pass through WebP preparation before private Storage upload. Links, drawings and HTML artifacts retain their existing isolated preview and access controls.

## Release notes

New release opens a full writing page at `/new?kind=release`. Choose the platform, version and section, then write the first contribution. There is no separate creation dialog.

- Save draft stores the release and contribution privately, keeps the editor open and gives the contribution a durable URL.
- Publish release saves the contribution as ready and publishes the version. Publication does not send an email announcement.
- Pasting the first file creates the private release draft needed to own the upload. Platform and version then lock to that draft; the section remains selectable.
- An existing version's Add my notes opens the same writing surface. Save draft preserves the selected readiness status. Mark ready returns to the release overview for review and publication.
- Authors can explicitly change readiness in Contribution settings. Attribution stays attached to the contribution.
- Release metadata and visibility are edited on a full settings page at `/edit/:id?settings=1`.

Server permissions and revision checks remain authoritative. Duplicate versions, concurrent edits and failed uploads show errors without discarding the writing surface. Concurrent pasted files share one draft creation request; a closed editor cannot lend its pending release to a different writing page.
