/** Primary writing actions stay visible; occasional actions share one keyboard-accessible menu. */
export function editorMenu(icon, items) {
  return `<details class="editor-more"><summary class="iconbtn" aria-label="More actions" title="More actions">${icon('more')}</summary><div class="editor-menu">${items}</div></details>`;
}
export function documentActions({
  icon,
  published,
  publishedLink,
  isNew,
  id,
  role,
  canPublish,
  html = false,
}) {
  const item = (glyph, label, attrs) =>
    `<button type="button" ${attrs}>${icon(glyph)}<span>${label}</span></button>`;
  // Markdown has an in-editor Preview tab; only HTML artifacts need a full-page preview.
  const menu =
    (html ? item('web', 'Open full preview', 'data-action="open-draft-preview"') : '') +
    (published ? `<a href="${publishedLink}">${icon('link')}<span>View published</span></a>` : '') +
    (!isNew && !canPublish
      ? item('clock', 'Request approval', `data-action="request-publish" data-id="${id}"`)
      : '') +
    (published && canPublish ? item('archive', 'Unpublish', 'data-action="unpublish"') : '') +
    (!isNew && role === 'admin'
      ? item('trash', 'Delete document', 'class="danger" data-action="delete-document"')
      : '');
  return `<button type="submit" form="editor-form" class="btn outline">Save draft</button>${canPublish ? '<button type="button" class="btn primary" data-action="publish">Publish</button>' : ''}${editorMenu(icon, menu)}`;
}
export function bindEditorMenus() {
  document.addEventListener('click', (event) => {
    document.querySelectorAll('.editor-more[open]').forEach((menu) => {
      if (
        !menu.contains(event.target) ||
        event.target.closest('.editor-menu button,.editor-menu a')
      )
        menu.open = false;
    });
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    document.querySelectorAll('.editor-more[open]').forEach((menu) => {
      menu.open = false;
      menu.querySelector('summary').focus();
    });
  });
}
