/**
 * Release editor: one complete Markdown note per section (vertical).
 * Each section owner pastes their whole note in one go; tickets, evidence and
 * testing notes live inside the Markdown. Publishing publishes every section
 * that is ready.
 */
import { bindSourceFiles } from './clipboard.js';
import { publishedRoute } from '../router.js';
import { slugify } from '../lib.js';

/** Section status relative to the published release snapshot. */
export function sectionStatus(entry, published) {
  if (!entry) return { key: 'empty', label: 'No note yet' };
  if (!entry.submitted) return { key: 'draft', label: 'Draft' };
  const live = published?.release_snapshot?.entries?.find((item) => item.id === entry.id);
  if (live && Date.parse(live.updated_at) >= Date.parse(entry.updated_at))
    return { key: 'published', label: 'Published' };
  return { key: 'ready', label: published ? 'Not published yet' : 'Ready to publish' };
}

export function createContributionEditor({
  state,
  e,
  icon,
  toneIcon,
  date,
  options,
  editorMenu,
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
  canEditEntry,
  canPublish,
  onPublished,
}) {
  let mounted = null;
  const route = (releaseId, sectionKey) =>
    '#/contribute/' + releaseId + (sectionKey ? '?section=' + encodeURIComponent(sectionKey) : '');
  /** Active sections configured for a platform, in their configured order. */
  function sections(projectId, include = []) {
    let choices = state.projectSections
      .filter((section) => section.project_id === projectId && section.active)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((section) => state.verticals.find((vertical) => vertical.id === section.vertical_id))
      .filter(Boolean);
    // A platform without configured sections still needs a usable release editor.
    // Fall back to every active vertical instead of presenting an empty selector.
    if (!choices.length) choices = [...state.verticals];
    for (const id of include)
      if (id && !choices.some((choice) => choice.id === id))
        choices = [...choices, ...state.verticals.filter((vertical) => vertical.id === id)];
    return choices;
  }
  const releaseLabel = (project, page) =>
    `${project?.name || 'Release'} v${String(page?.version || '').replace(/^v/i, '')}`;

  function sectionNav(releaseId, choices, current, published) {
    return choices
      .map((section) => {
        const entry = state.entries.find(
            (item) => item.release_id === releaseId && item.vertical_id === section.id,
          ),
          status = sectionStatus(entry, published);
        return `<a class="section-link ${section.id === current.id ? 'active' : ''}" href="${route(releaseId, slugify(section.name))}" ${section.id === current.id ? 'aria-current="page"' : ''}>${toneIcon(section.icon, section.color)}<span><strong>${e(section.name)}</strong><small class="section-status status-${status.key}">${e(status.label)}</small></span></a>`;
      })
      .join('');
  }

  function newRelease(projectId) {
    const choices = sections(projectId);
    return `<div class="layout editor-layout release-editor-layout"><aside class="sidebar release-sidebar" aria-label="Release navigation"><div class="rail-label">New release</div></aside><main id="main" class="editor release-editor"><div class="editor-top"><nav class="breadcrumbs"><a href="#/releases">Release notes</a>${icon('chevron')}<span>New release</span></nav><div class="editor-top-actions"><button class="btn outline" type="submit" name="intent" value="draft" form="contribution-form">Save draft</button><button class="btn primary" type="submit" name="intent" value="publish" form="contribution-form">Publish</button></div></div><form id="contribution-form" data-release-id="" data-id="" data-revision="0"><div class="release-setup"><div class="field"><label for="release-project">Platform</label><select id="release-project" required>${options(state.projects, projectId, 'Choose a platform')}</select></div><div class="field"><label for="release-version">Version</label><input id="release-version" required maxlength="80" placeholder="5.12.0" inputmode="decimal" autocomplete="off"></div><div class="field"><label for="entry-vertical">Your section</label><select id="entry-vertical" name="vertical_id" required>${options(choices, '', 'Choose a section')}</select></div></div>${writing('', '')}</form></main></div>`;
  }

  function writing(body, sectionName) {
    return `<section class="editor-main entry-writing"><div class="editor-mode-tabs entry-write-tabs"><div role="tablist" aria-label="Editor view"><button type="button" role="tab" data-entry-view="visual" class="active" aria-selected="true">Write</button><button type="button" role="tab" data-entry-view="source" aria-selected="false">Markdown</button><button type="button" role="tab" data-entry-view="preview" aria-selected="false">Preview</button></div><span class="editor-upload-status" role="status"></span></div><div class="contribution-writing" data-view="visual"><div class="source-editor">${richToolbar()}<div class="rich-canvas" data-rich-canvas></div><label class="sr-only" for="entry-body">Markdown source</label><textarea id="entry-body" name="body" class="rich-source" maxlength="100000" spellcheck="false" placeholder="Paste the complete Markdown note here…">${e(body)}</textarea></div><div id="entry-preview" class="prose live-preview" hidden></div></div><input id="entry-attachment" type="file" hidden accept="image/png,image/jpeg,image/webp,.pdf,.txt,.md,.csv,.docx,.xlsx"><p class="error" role="alert"></p></section>`;
  }

  function view(releaseId, sectionKey, setup = {}) {
    if (setup.create === true) {
      if (!['admin', 'publisher'].includes(state.member?.role))
        throw Error('Publisher access is required to start a new release.');
      return newRelease(setup.projectId || '');
    }
    const release = state.releases.find((item) => item.id === releaseId),
      page = state.pages.find((item) => item.id === releaseId);
    if (!release || !page) throw Error('This release is unavailable.');
    if (!canEdit(state.member?.role) || page._readOnly)
      throw Error('You do not have permission to edit this release.');
    const project = state.projects.find((item) => item.id === release.project_id),
      published = state.published.find((item) => item.id === releaseId),
      entries = state.entries.filter((item) => item.release_id === releaseId),
      choices = sections(
        release.project_id,
        entries.map((item) => item.vertical_id),
      );
    if (!choices.length) throw Error('An administrator needs to configure release sections first.');
    const current =
      choices.find((item) => slugify(item.name) === sectionKey) ||
      choices.find((item) =>
        entries.some(
          (entry) => entry.vertical_id === item.id && entry.author_id === state.member.id,
        ),
      ) ||
      choices[0];
    const entry = entries.find((item) => item.vertical_id === current.id);
    const status = sectionStatus(entry, published),
      editable = !entry || canEditEntry(entry),
      publishable = page._canPublish === true,
      label = releaseLabel(project, page),
      publishedLink = published ? publishedRoute(published, state.projects) : '',
      pending =
        published &&
        entries.some((item) => item.submitted && sectionStatus(item, published).key === 'ready');
    const menu =
      (publishedLink
        ? `<a href="${publishedLink}${'?section=' + encodeURIComponent(slugify(current.name))}">${icon('link')}<span>View published</span></a>`
        : '') +
      (state.member.role === 'admin'
        ? `<a href="#/edit/${e(releaseId)}?settings=1">${icon('settings')}<span>Release settings</span></a>`
        : '') +
      (entry && editable
        ? `<button type="button" class="danger" data-action="delete-entry" data-id="${e(entry.id)}">${icon('trash')}<span>Remove ${e(current.name)} note</span></button>`
        : '') +
      (state.member.role === 'admin'
        ? `<button type="button" class="danger" data-action="delete-release" data-id="${e(releaseId)}">${icon('trash')}<span>Delete release</span></button>`
        : '');
    const actions = editable
      ? `<button class="btn outline" type="submit" name="intent" value="draft" form="contribution-form">Save draft</button><button class="btn primary" type="submit" name="intent" value="${publishable ? 'publish' : 'ready'}" form="contribution-form">${publishable ? (published ? 'Publish update' : 'Publish release') : 'Submit for publishing'}</button>`
      : publishable && pending
        ? `<button class="btn primary" type="button" data-action="publish-release" data-id="${e(releaseId)}">Publish update</button>`
        : '';
    const meta = entry
      ? `${e(status.label)} · Updated by ${e(entry.updated_name || entry.author_name || 'a teammate')} on ${date(entry.updated_at)}`
      : 'No note yet for this section';
    const body = editable
      ? `<form id="contribution-form" data-release-id="${e(releaseId)}" data-id="${e(entry?.id || '')}" data-revision="${entry?.revision || 0}" data-section="${e(slugify(current.name))}"><input type="hidden" name="vertical_id" value="${e(current.id)}"><input type="hidden" name="submitted" value="${entry?.submitted ? 'true' : 'false'}">${writing(entry?.body || '', current.name)}<p class="statusbar" id="contribution-save-status" role="status">${entry ? '' : 'Not saved yet'}</p></form>`
      : `<div class="notice">${icon('lock')}<span>${e(entry.author_name || 'Another teammate')} owns this section. They or an administrator can edit it.</span></div><div class="prose release-readonly-note">${markdown(entry.body)}</div>`;
    return `<div class="layout editor-layout release-editor-layout"><aside class="sidebar release-sidebar" aria-label="Release sections"><a class="sidelink" href="${publishedLink || '#/releases'}">${icon('back')}<span>${e(label)}</span></a><div class="rail-label">Sections</div><nav class="section-nav">${sectionNav(releaseId, choices, current, published)}</nav></aside><main id="main" class="editor release-editor"><div class="editor-top"><nav class="breadcrumbs"><a href="#/releases">Release notes</a>${icon('chevron')}<a href="${publishedLink || '#/releases'}">${e(label)}</a></nav><div class="editor-top-actions">${actions}${menu ? editorMenu(icon, menu) : ''}</div></div><nav class="section-tabs" aria-label="Release sections">${choices.map((section) => `<a class="${section.id === current.id ? 'active' : ''}" href="${route(releaseId, slugify(section.name))}">${e(section.name)}</a>`).join('')}</nav><header class="release-editor-heading">${toneIcon(current.icon, current.color)}<div><h1>${e(current.name)}</h1><p>${meta}</p></div></header>${body}</main></div>`;
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
    const existing = state.releases.find(
      (item) =>
        item.project_id === project.value &&
        item.version === version.value.trim().replace(/^v(?=\d)/i, ''),
    );
    if (existing) {
      form.dataset.releaseId = existing.id;
      return existing.id;
    }
    project.disabled = true;
    version.readOnly = true;
    const creatingRelease = (async () => {
      const id = await db('rpc/docs_create_release', '', {
        method: 'POST',
        body: { project: project.value, release_version: version.value, description: '' },
      });
      form.dataset.releaseId = id;
      if (!form.isConnected)
        throw Error('This editor was closed. Your draft is available in release notes.');
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
    form.noValidate = true;
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
    const renderPreview = () => {
      preview.innerHTML = source.value.trim()
        ? markdown(source.value)
        : '<p class="preview-placeholder">Nothing to preview yet.</p>';
      hydrateImages();
    };
    const update = () => {
      state.dirty = true;
      if (!preview.hidden) renderPreview();
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
      root.querySelector('[data-rich-canvas]').hidden = mode !== 'visual';
      root.querySelector('.rich-toolbar').hidden = mode !== 'visual';
      preview.hidden = mode !== 'preview';
      if (!preview.hidden) renderPreview();
    };
    modes();
    form.querySelectorAll('[data-entry-view]').forEach((b) =>
      b.addEventListener('click', () => {
        if (layout.dataset.view === 'source' && b.dataset.entryView !== 'source')
          mounted?.setMarkdown(source.value);
        layout.dataset.view = b.dataset.entryView;
        form.querySelectorAll('[data-entry-view]').forEach((x) => {
          x.classList.toggle('active', x === b);
          x.setAttribute('aria-selected', String(x === b));
        });
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
      if (mounted && layout.dataset.view === 'visual') mounted.insertFiles(files);
      else
        (async () => {
          for (const file of files) await upload(file, await ensureRelease());
          update();
        })().catch((error) => toast(error.message, true));
      event.target.value = '';
    });
    let saving = false;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (saving) return;
      const error = form.querySelector('.error');
      if (form.querySelector('[data-uploading=true]')) {
        error.textContent = 'Wait for the upload to finish before saving.';
        return;
      }
      const intent = event.submitter?.value || 'draft';
      if (layout.dataset.view === 'source') mounted?.setMarkdown(source.value);
      if (!source.value.trim()) {
        error.textContent = 'Paste the release note before saving.';
        return;
      }
      saving = true;
      const buttons = [...document.querySelectorAll('[form="contribution-form"]')];
      buttons.forEach((button) => {
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
      });
      error.textContent = '';
      try {
        const releaseId = await ensureRelease(),
          values = Object.fromEntries(new FormData(form)),
          verticalId = values.vertical_id;
        // A section holds one note: continue an existing note instead of adding a second one.
        let id = form.dataset.id,
          revision = form.dataset.revision;
        if (!id) {
          const existing = await db(
            'docs_entries',
            `?release_id=eq.${releaseId}&vertical_id=eq.${verticalId}&select=id,revision,author_id`,
          );
          if (existing[0] && !canEditEntry(existing[0]))
            throw Error('Another teammate already owns this section in this release.');
          if (existing[0]) [id, revision] = [existing[0].id, existing[0].revision];
        }
        const submitted = intent === 'draft' ? values.submitted === 'true' : true;
        const result = await db('docs_entries', id ? `?id=eq.${id}&revision=eq.${revision}` : '', {
          method: id ? 'PATCH' : 'POST',
          headers: { Prefer: 'return=representation' },
          body: {
            body: source.value,
            vertical_id: verticalId,
            submitted,
            ...(!id ? { release_id: releaseId } : {}),
          },
        });
        if (!result?.length)
          throw Error('This note changed elsewhere. Copy your edits, then reload the page.');
        state.dirty = false;
        if (intent === 'publish') {
          await db('rpc/docs_publish', '', { method: 'POST', body: { page_id: releaseId } });
          onPublished?.(releaseId);
        }
        await load();
        const section = state.verticals.find((item) => item.id === verticalId);
        const published = state.published.find((page) => page.id === releaseId);
        // Routes are canonicalised to paths, so assigning the hash always re-renders.
        location.hash =
          intent === 'publish' && published
            ? publishedRoute(published, state.projects) +
              '?section=' +
              encodeURIComponent(slugify(section?.name || ''))
            : route(releaseId, slugify(section?.name || ''));
        toast(
          intent === 'publish'
            ? 'Release published. Share the link with your team.'
            : intent === 'ready'
              ? 'Saved. A publisher can now publish this section.'
              : 'Draft saved. It is not published until you publish the release.',
        );
      } catch (failure) {
        if (form.isConnected) error.textContent = failure.message;
        else toast(failure.message, true);
      } finally {
        saving = false;
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
    sections,
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
