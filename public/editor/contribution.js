/** Release contributions share the document editor's page, modes and upload pipeline. */
import { bindSourceFiles } from './clipboard.js';
export function createContributionEditor({
  state,
  e,
  icon,
  sidebar,
  options,
  richToolbar,
  markdown,
  loadRichEditor,
  resolveImage,
  upload,
  db,
  load,
  render,
  toast,
  hydrateImages,
  canEdit,
}) {
  let mounted = null;
  const route = (releaseId, entryId) =>
    '#/contribute/' + releaseId + (entryId ? '?entry=' + encodeURIComponent(entryId) : '');
  function view(releaseId, entryId) {
    const release = state.releases.find((r) => r.id === releaseId),
      entry = state.entries.find((n) => n.id === entryId && n.release_id === releaseId);
    if (!release || (entryId && !entry)) throw Error('This release contribution is unavailable.');
    if (
      !canEdit(state.member?.role) ||
      state.pages.find((page) => page.id === releaseId)?._readOnly
    )
      throw Error('You do not have permission to edit this release.');
    let choices =
      state.projectSections === null
        ? state.verticals
        : (state.projectSections || [])
            .filter((s) => s.project_id === release.project_id && s.active)
            .map((s) => state.verticals.find((v) => v.id === s.vertical_id))
            .filter(Boolean);
    if (entry?.vertical_id && !choices.some((v) => v.id === entry.vertical_id))
      choices = [...choices, ...state.verticals.filter((v) => v.id === entry.vertical_id)];
    if (!choices.length) throw Error('An administrator needs to configure release sections first.');
    const page = state.pages.find((p) => p.id === releaseId),
      project = state.projects.find((p) => p.id === release.project_id);
    return `<div class="layout editor-layout contribution-editor-layout">${sidebar(true)}<main id="main" class="editor contribution-editor"><div class="editor-top"><nav class="breadcrumbs"><a href="#/edit/${e(releaseId)}">${e(project?.name || 'Release')} ${e(page?.version || '')}</a>${icon('chevron')}<span>${entry ? 'Edit contribution' : 'New contribution'}</span></nav><div class="editor-top-actions"><a class="btn outline" href="#/edit/${e(releaseId)}">Close</a><button class="btn primary" type="submit" form="contribution-form">Save contribution</button></div></div><form id="contribution-form" data-release-id="${e(releaseId)}" data-id="${e(entry?.id || '')}" data-revision="${entry?.revision || 0}"><div class="editor-heading"><label class="sr-only" for="entry-title">Contribution heading</label><input id="entry-title" name="title" maxlength="200" required value="${e(entry?.title || '')}" placeholder="Contribution heading"></div><div class="editor-grid"><section class="editor-main entry-writing"><div class="editor-mode-tabs entry-write-tabs"><div><button type="button" data-entry-view="visual" class="active">Write</button><button type="button" data-entry-view="split">Split view</button><button type="button" data-entry-view="preview">Preview</button><button type="button" data-entry-view="source">Markdown source</button></div><span class="editor-upload-status" role="status"></span></div><div class="contribution-writing" data-view="visual"><div class="source-editor">${richToolbar()}<div class="rich-canvas" data-rich-canvas></div><label class="sr-only" for="entry-body">Markdown source</label><textarea id="entry-body" name="body" class="rich-source" maxlength="100000" placeholder="Write or paste Markdown…">${e(entry?.body || '')}</textarea></div><div id="entry-preview" class="prose live-preview" hidden></div></div><input id="entry-attachment" type="file" hidden accept="image/png,image/jpeg,image/webp,.pdf,.txt,.md,.csv,.docx,.xlsx"><p class="error" role="alert"></p></section><aside class="document-properties"><h2>Contribution details</h2><div class="field"><label for="entry-vertical">Section</label><select id="entry-vertical" name="vertical_id" required>${options(choices, entry?.vertical_id, 'Choose a section')}</select></div><div class="field"><label for="entry-tickets">Ticket references</label><input id="entry-tickets" name="tickets" maxlength="1000" value="${e(entry?.tickets || '')}" placeholder="HCUS-123, HCUS-124"></div><div class="field"><label for="entry-status">Status</label><select id="entry-status" name="submitted"><option value="false">Work in progress</option><option value="true" ${entry?.submitted ? 'selected' : ''}>Ready for publishing</option></select></div><p class="small">${e(entry?.author_name || state.member?.name || 'Your account')} is credited for this contribution.</p></aside></div></form></main></div>`;
  }
  function mount() {
    mounted?.destroy();
    mounted = null;
    const form = document.querySelector('#contribution-form');
    if (!form) return;
    const root = form.querySelector('.entry-writing'),
      source = form.querySelector('#entry-body'),
      layout = form.querySelector('.contribution-writing'),
      preview = form.querySelector('#entry-preview');
    const update = () => {
      state.dirty = true;
      if (!preview.hidden) {
        preview.innerHTML = markdown(source.value);
        hydrateImages();
      }
    };
    loadRichEditor()
      .then(({ mountRichEditor }) => {
        if (root.isConnected)
          mounted = mountRichEditor({
            root,
            textarea: source,
            resolveImage,
            onChange: update,
            onUpload: (file) => upload(file, form.dataset.releaseId, { insert: false }),
            onError: (error) => toast(error.message, true),
          });
      })
      .catch((error) => toast(error.message, true));
    const modes = () => {
      const mode = layout.dataset.view || 'visual';
      source.hidden = mode !== 'source';
      root.querySelector('[data-rich-canvas]').hidden = !['visual', 'split'].includes(mode);
      root.querySelector('.rich-toolbar').hidden = !['visual', 'split'].includes(mode);
      preview.hidden = !['preview', 'split'].includes(mode);
      if (!preview.hidden) {
        preview.innerHTML = markdown(source.value);
        hydrateImages();
      }
    };
    modes();
    form.querySelectorAll('[data-entry-view]').forEach((b) =>
      b.addEventListener('click', () => {
        if (layout.dataset.view === 'source' && b.dataset.entryView !== 'source')
          mounted?.setMarkdown(source.value);
        layout.dataset.view = b.dataset.entryView;
        form
          .querySelectorAll('[data-entry-view]')
          .forEach((x) => x.classList.toggle('active', x === b));
        modes();
      }),
    );
    source.addEventListener('input', update);
    bindSourceFiles({
      source,
      upload: (file) => upload(file, form.dataset.releaseId, { insert: false }),
      onChange: update,
      onError: (error) => toast(error.message, true),
    });
    form.addEventListener('input', () => (state.dirty = true));
    form.addEventListener('change', () => (state.dirty = true));
    form.querySelector('#entry-attachment').addEventListener('change', (event) => {
      const files = [...event.target.files];
      if (mounted && layout.dataset.view !== 'source') mounted.insertFiles(files);
      else
        (async () => {
          for (const file of files) await upload(file, form.dataset.releaseId);
          update();
        })().catch((error) => toast(error.message, true));
      event.target.value = '';
    });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (form.querySelector('[data-uploading=true]')) {
        form.querySelector('.error').textContent = 'Wait for the upload to finish before saving.';
        return;
      }
      const button = event.submitter;
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      form.querySelector('.error').textContent = '';
      try {
        const values = Object.fromEntries(new FormData(form));
        const id = form.dataset.id;
        const result = await db(
          'docs_entries',
          id ? '?id=eq.' + id + '&revision=eq.' + form.dataset.revision : '',
          {
            method: id ? 'PATCH' : 'POST',
            headers: { Prefer: 'return=representation' },
            body: {
              ...values,
              submitted: values.submitted === 'true',
              ...(!id ? { release_id: form.dataset.releaseId } : {}),
            },
          },
        );
        if (!result?.length)
          throw Error('This contribution changed elsewhere. Copy your edits before reloading.');
        state.dirty = false;
        await load();
        location.hash = '#/edit/' + form.dataset.releaseId;
        await render();
        toast('Contribution saved.');
      } catch (error) {
        if (form.isConnected) form.querySelector('.error').textContent = error.message;
        else toast(error.message, true);
      } finally {
        button.disabled = false;
        button.removeAttribute('aria-busy');
      }
    });
  }
  return {
    view,
    mount,
    route,
    get editor() {
      return mounted;
    },
    destroy() {
      mounted?.destroy();
      mounted = null;
    },
  };
}
