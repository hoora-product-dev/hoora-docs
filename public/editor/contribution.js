/** Release contributions share the document editor's page, modes and upload pipeline. */
import { bindSourceFiles } from './clipboard.js';
import { routeUrl } from '../router.js';
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
  toast,
  hydrateImages,
  canEdit,
  canPublish,
  onPublished,
}) {
  let mounted = null;
  const route = (releaseId, entryId) =>
    '#/contribute/' + releaseId + (entryId ? '?entry=' + encodeURIComponent(entryId) : '');
  function sections(projectId, entry) {
    let choices =
      state.projectSections === null
        ? state.verticals
        : (state.projectSections || [])
            .filter((section) => section.project_id === projectId && section.active)
            .map((section) =>
              state.verticals.find((vertical) => vertical.id === section.vertical_id),
            )
            .filter(Boolean);
    if (entry?.vertical_id && !choices.some((choice) => choice.id === entry.vertical_id))
      choices = [
        ...choices,
        ...state.verticals.filter((vertical) => vertical.id === entry.vertical_id),
      ];
    return choices;
  }
  function view(releaseId, entryId, setup = {}) {
    const creating = setup.create === true,
      release = state.releases.find((item) => item.id === releaseId),
      entry = state.entries.find((item) => item.id === entryId && item.release_id === releaseId);
    if (!creating && (!release || (entryId && !entry)))
      throw Error('This release contribution is unavailable.');
    if (
      !canEdit(state.member?.role) ||
      (creating && !['admin', 'publisher'].includes(state.member?.role)) ||
      state.pages.find((page) => page.id === releaseId)?._readOnly
    )
      throw Error('You do not have permission to edit this release.');
    const projectId = release?.project_id || setup.projectId || '',
      choices = sections(projectId, entry),
      page = state.pages.find((item) => item.id === releaseId),
      project = state.projects.find((item) => item.id === projectId);
    if (!creating && !choices.length)
      throw Error('An administrator needs to configure release sections first.');
    return `<div class="layout editor-layout contribution-editor-layout">${sidebar(true)}<main id="main" class="editor contribution-editor"><div class="editor-top"><nav class="breadcrumbs"><a href="${creating ? '#/releases' : '#/edit/' + e(releaseId)}">${icon('back')}<span>${creating ? 'Releases' : e(project?.name || 'Release') + ' ' + e(page?.version || '')}</span></a><span>${creating ? 'New release' : entry ? 'Edit contribution' : 'New contribution'}</span></nav><div class="editor-top-actions"><button class="btn outline" type="submit" name="intent" value="draft" form="contribution-form">Save draft</button><button class="btn primary" type="submit" name="intent" value="${creating ? 'publish' : 'ready'}" form="contribution-form">${creating ? 'Publish release' : 'Mark ready'}</button></div></div><form id="contribution-form" data-release-id="${e(releaseId || '')}" data-id="${e(entry?.id || '')}" data-revision="${entry?.revision || 0}">${creating ? `<div class="release-setup"><div class="field"><label for="release-project">Platform</label><select id="release-project" required>${options(state.projects, projectId, 'Choose a platform')}</select></div><div class="field"><label for="release-version">Version</label><input id="release-version" required maxlength="80" placeholder="5.12.0"></div><div class="field"><label for="entry-vertical">Section</label><select id="entry-vertical" name="vertical_id" required>${options(choices, entry?.vertical_id, 'Choose a section')}</select></div></div>` : `<div class="editor-section-choice field"><label for="entry-vertical">Section</label><select id="entry-vertical" name="vertical_id" required>${options(choices, entry?.vertical_id, 'Choose a section')}</select></div>`}<div class="editor-grid"><section class="editor-main entry-writing"><div class="editor-heading"><label class="sr-only" for="entry-title">Contribution heading</label><input id="entry-title" name="title" maxlength="200" required value="${e(entry?.title || '')}" placeholder="What changed?"></div><div class="editor-mode-tabs entry-write-tabs"><div><button type="button" data-entry-view="visual" class="active">Write</button><button type="button" data-entry-view="split">Split view</button><button type="button" data-entry-view="preview">Preview</button><button type="button" data-entry-view="source">Markdown source</button></div><span class="editor-upload-status" role="status"></span></div><div class="contribution-writing" data-view="visual"><div class="source-editor">${richToolbar()}<div class="rich-canvas" data-rich-canvas></div><label class="sr-only" for="entry-body">Markdown source</label><textarea id="entry-body" name="body" class="rich-source" maxlength="100000" placeholder="Write or paste Markdown…">${e(entry?.body || '')}</textarea></div><div id="entry-preview" class="prose live-preview" hidden></div></div><input id="entry-attachment" type="file" hidden accept="image/png,image/jpeg,image/webp,.pdf,.txt,.md,.csv,.docx,.xlsx"><p class="error" role="alert"></p><p class="statusbar" id="contribution-save-status" role="status">${entry ? (entry.submitted ? 'Ready for publishing' : 'Draft saved') : 'Not saved yet'}</p></section><aside class="document-properties"><h2>Contribution settings</h2>${creating ? '<input type="hidden" name="submitted" value="false">' : `<div class="field"><label for="entry-status">Status</label><select id="entry-status" name="submitted"><option value="false">Work in progress</option><option value="true" ${entry?.submitted ? 'selected' : ''}>Ready for publishing</option></select></div>`}<div class="field"><label for="entry-tickets">Ticket references</label><input id="entry-tickets" name="tickets" maxlength="1000" value="${e(entry?.tickets || '')}" placeholder="HCUS-123, HCUS-124"></div><p class="small">Credited to ${e(entry?.author_name || state.member?.name || 'your account')}.</p><p class="small">${creating ? 'Save privately, or publish this version when it is ready.' : 'Save your draft while writing. Mark it ready to include it in the next publication.'}</p></aside></div></form></main></div>`;
  }
  const releaseCreations = new WeakMap();
  async function ensureRelease() {
    const form = document.querySelector('#contribution-form');
    if (!form) throw Error('Open the release editor before adding a file.');
    if (form.dataset.releaseId) return form.dataset.releaseId;
    if (releaseCreations.has(form)) return releaseCreations.get(form);
    const project = form.querySelector('#release-project'),
      version = form.querySelector('#release-version'),
      section = form.querySelector('#entry-vertical');
    for (const field of [project, version, section])
      if (!field?.reportValidity()) throw Error('Choose a platform, version and section first.');
    project.disabled = true;
    version.readOnly = true;
    const creatingRelease = (async () => {
      const id = await db('rpc/docs_create_release', '', {
        method: 'POST',
        body: { project: project.value, release_version: version.value, description: '' },
      });
      form.dataset.releaseId = id;
      if (!form.isConnected)
        throw Error('This editor was closed. Your draft is available in releases.');
      state.dirty = true;
      return id;
    })();
    releaseCreations.set(form, creatingRelease);
    try {
      return await creatingRelease;
    } catch (error) {
      project.disabled = false;
      version.readOnly = false;
      throw error;
    } finally {
      releaseCreations.delete(form);
    }
  }
  function mount() {
    mounted?.destroy();
    mounted = null;
    const form = document.querySelector('#contribution-form');
    if (!form) return;
    form.querySelector('#release-project')?.addEventListener('change', (event) => {
      form.querySelector('#entry-vertical').innerHTML = options(
        sections(event.target.value),
        '',
        'Choose a section',
      );
    });
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
            onUpload: async (file) => upload(file, await ensureRelease(), { insert: false }),
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
      upload: async (file) => upload(file, await ensureRelease(), { insert: false }),
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
    let saving = false;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (saving) return;
      if (form.querySelector('[data-uploading=true]')) {
        form.querySelector('.error').textContent = 'Wait for the upload to finish before saving.';
        return;
      }
      const intent = event.submitter?.value || 'draft';
      if (intent === 'publish' && !canPublish(state.member?.role)) return;
      saving = true;
      const buttons = [...document.querySelectorAll('[form="contribution-form"]')];
      buttons.forEach((button) => {
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
      });
      if (intent === 'publish') form.inert = true;
      form.querySelector('.error').textContent = '';
      try {
        const releaseId = await ensureRelease(),
          snapshot = JSON.stringify([...new FormData(form)]),
          values = Object.fromEntries(new FormData(form)),
          id = form.dataset.id;
        const result = await db(
          'docs_entries',
          id ? '?id=eq.' + id + '&revision=eq.' + form.dataset.revision : '',
          {
            method: id ? 'PATCH' : 'POST',
            headers: { Prefer: 'return=representation' },
            body: {
              title: values.title,
              body: values.body,
              vertical_id: values.vertical_id,
              tickets: values.tickets,
              submitted: intent === 'draft' ? values.submitted === 'true' : true,
              ...(!id ? { release_id: releaseId } : {}),
            },
          },
        );
        if (!result?.length)
          throw Error('This contribution changed elsewhere. Copy your edits before reloading.');
        if (!form.isConnected) return;
        form.dataset.id = result[0].id;
        form.dataset.revision = result[0].revision;
        history.replaceState(null, '', routeUrl(route(releaseId, form.dataset.id)));
        state.dirty = snapshot !== JSON.stringify([...new FormData(form)]);
        if (form.elements.submitted.value === values.submitted)
          form.elements.submitted.value = String(result[0].submitted);
        const status = form.querySelector('#contribution-save-status');
        status.textContent = state.dirty
          ? 'New changes not saved'
          : intent === 'draft'
            ? 'Draft saved'
            : 'Ready for publishing';
        if (intent === 'publish') {
          if (state.dirty)
            throw Error('Your draft was saved. Save the latest edits before publishing.');
          await db('rpc/docs_publish', '', { method: 'POST', body: { page_id: releaseId } });
          onPublished?.(releaseId);
        }
        await load();
        if (!form.isConnected) return;
        if (intent !== 'draft' && !state.dirty) {
          location.hash = '#/edit/' + releaseId;
          toast(intent === 'publish' ? 'Release published.' : 'Contribution ready for publishing.');
        } else {
          toast(
            state.dirty
              ? 'Earlier edits saved. Your latest changes are still unsaved.'
              : 'Draft saved.',
          );
        }
      } catch (error) {
        if (form.isConnected) form.querySelector('.error').textContent = error.message;
        else toast(error.message, true);
      } finally {
        saving = false;
        form.inert = false;
        buttons.forEach((button) => {
          button.disabled = false;
          button.removeAttribute('aria-busy');
        });
      }
    });
  }
  return {
    view,
    mount,
    route,
    ensureRelease,
    get editor() {
      return mounted;
    },
    destroy() {
      mounted?.destroy();
      mounted = null;
    },
  };
}
