export function detectSource(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw Error('Paste a complete HTTPS link.');
  }
  if (url.protocol !== 'https:' || url.username || url.password)
    throw Error('Use an HTTPS link without embedded credentials.');
  const host = url.hostname.toLowerCase(),
    path = url.pathname.toLowerCase();
  if (host === 'docs.google.com') {
    if (path.startsWith('/document/')) return { type: 'GOOGLE_DOC', label: 'Google Docs' };
    if (path.startsWith('/spreadsheets/')) return { type: 'GOOGLE_SHEET', label: 'Google Sheets' };
    if (path.startsWith('/presentation/')) return { type: 'GOOGLE_SLIDE', label: 'Google Slides' };
  }
  if (host.endsWith('.sharepoint.com') || ['onedrive.live.com', '1drv.ms'].includes(host)) {
    if (/\/:?(?:x|excel)(?:[/:]|$)|\.xlsx?$/.test(path))
      return { type: 'MICROSOFT_SHEET', label: 'Microsoft Excel' };
    if (/\/:?(?:p|powerpoint)(?:[/:]|$)|\.pptx?$/.test(path))
      return { type: 'MICROSOFT_SLIDE', label: 'Microsoft PowerPoint' };
    return { type: 'MICROSOFT_DOC', label: 'Microsoft document' };
  }
  if (
    ['app.powerbi.com', 'lookerstudio.google.com', 'public.tableau.com'].includes(host) ||
    host.endsWith('.metabaseapp.com')
  )
    return { type: 'DASHBOARD', label: 'Dashboard' };
  return { type: 'OTHER_URL', label: 'External link' };
}
export function sourcesFeature({
  files,
  state,
  db,
  e,
  dialog,
  modal,
  toast,
  getToken,
  config,
  prepareUpload,
  slugify,
  load,
  render,
}) {
  function open() {
    const choices = state.teams.filter(
      (t) =>
        state.member.role === 'admin' ||
        t.manager_id === state.member.id ||
        state.teamMembers.some(
          (m) =>
            m.team_id === t.id &&
            m.email === state.member.email.toLowerCase() &&
            m.role === 'publisher',
        ),
    );
    dialog(
      `<h2>Add an asset</h2><p class="small">Share an existing resource with your team.</p><form><div class="field"><label for="asset-source">What are you adding?</label><select id="asset-source" name="mode"><option value="link">Add link</option><option value="pdf">Upload PDF</option></select></div><div class="field" id="asset-url-field"><label for="asset-url">URL</label><input id="asset-url" type="url" name="source_url" placeholder="https://…" required><small id="asset-provider">Google, Microsoft, dashboards and other HTTPS resources.</small></div><div class="field" id="asset-pdf-field" hidden><label for="asset-pdf">PDF file</label><input id="asset-pdf" type="file" accept="application/pdf,.pdf"><small>10 MB per upload. Larger PDFs get a compression attempt.</small></div><div class="field"><label for="asset-title">Title</label><input id="asset-title" name="title" required maxlength="250"></div><div class="field"><label for="asset-description">Description</label><textarea id="asset-description" name="summary" maxlength="500" placeholder="What does this resource contain, and when should someone use it?"></textarea></div><div class="form-columns"><div class="field"><label for="asset-kind">Collection</label><select id="asset-kind" name="kind">${state.types
        .filter((t) => t.key !== 'release')
        .map((t) => `<option value="${e(t.key)}">${e(t.name)}</option>`)
        .join(
          '',
        )}</select></div><div class="field"><label for="asset-team">Team</label><select id="asset-team" name="team_id" ${!['admin', 'publisher'].includes(state.member.role) ? 'required' : ''}>${['admin', 'publisher'].includes(state.member.role) ? '<option value="">Company workspace</option>' : '<option value="">Choose team</option>'}${choices.map((t) => `<option value="${t.id}">${e(t.name)}</option>`).join('')}</select></div></div><p class="small">Owner: ${e(state.member.name)} · assigned from your account.</p><p class="error" role="alert"></p><div class="dialog-actions"><button type="button" class="btn outline" data-close>Cancel</button><button class="btn dark">Publish asset</button></div></form>`,
      async (f) => {
        const id = crypto.randomUUID(),
          title = f.get('title').trim(),
          team_id = f.get('team_id') || null;
        let source = { type: 'MARKDOWN' };
        if (f.get('mode') === 'link') source = detectSource(f.get('source_url'));
        const base = slugify(title) || 'document';
        let slug = base;
        // Check visible slugs for a helpful suggestion; the unique database constraint is authoritative.
        for (
          let n = 2;
          state.pages.some((p) => p.slug === slug) || state.published.some((p) => p.slug === slug);
          n++
        )
          slug = base + '-' + n;
        let file;
        if (f.get('mode') === 'pdf') {
          file = modal.querySelector('#asset-pdf').files[0];
          if (!file) throw Error('Choose a PDF.');
          if ((await file.slice(0, 5).text()) !== '%PDF-') throw Error('Choose a valid PDF file.');
          file = await prepareUpload(file);
        }
        await db('docs_pages', '', {
          method: 'POST',
          body: {
            id,
            title,
            slug,
            kind: f.get('kind'),
            summary: f.get('summary'),
            team_id,
            source_type: file ? 'MARKDOWN' : source.type,
            source_url: file ? null : f.get('source_url'),
          },
        });
        try {
          if (file) {
            const path = id + '/' + crypto.randomUUID() + '.pdf',
              token = await getToken();
            const response = await fetch(config.url + '/storage/v1/object/hoora-docs/' + path, {
              method: 'POST',
              headers: {
                apikey: config.key,
                Authorization: 'Bearer ' + token,
                'Content-Type': 'application/pdf',
              },
              body: file,
            });
            if (!response.ok) throw Error('The PDF could not be uploaded. Your draft was kept.');
            await db('docs_pages', '?id=eq.' + id, {
              method: 'PATCH',
              body: {
                source_type: 'PDF',
                file_metadata: {
                  filename: file.name,
                  mime_type: 'application/pdf',
                  size: file.size,
                  storage_path: path,
                  uploaded_by: state.member.id,
                  uploaded_at: new Date().toISOString(),
                },
              },
            });
          }
          await db('rpc/docs_publish', '', { method: 'POST', body: { page_id: id } });
        } catch (error) {
          await load();
          await render();
          throw error;
        }
        await load();
        location.hash = '#/doc/' + slug;
        toast('Asset published successfully. Use Share to copy its link.');
      },
    );
    modal.querySelector('#asset-source').onchange = (event) => {
      const pdf = event.target.value === 'pdf';
      modal.querySelector('#asset-pdf-field').hidden = !pdf;
      modal.querySelector('#asset-url-field').hidden = pdf;
      modal.querySelector('#asset-url').required = !pdf;
    };
    modal.querySelector('#asset-url').oninput = (event) => {
      try {
        const source = detectSource(event.target.value);
        modal.querySelector('#asset-provider').textContent = source.label + ' detected';
        const title = modal.querySelector('#asset-title');
        if (!title.value) title.value = new URL(event.target.value).hostname.replace(/^www\./, '');
      } catch {
        modal.querySelector('#asset-provider').textContent = 'Paste a complete HTTPS URL.';
      }
    };
    modal.querySelector('#asset-pdf').onchange = (event) => {
      const file = event.target.files[0];
      if (file)
        modal.querySelector('#asset-title').value = file.name
          .replace(/\.pdf$/i, '')
          .replace(/[-_]/g, ' ');
    };
  }
  function preview(page) {
    if (page.source_type === 'PDF')
      return `<section class="pdf-viewer" data-pdf-page="${page.id}"><div class="pdf-toolbar"><strong>${e(page.file_metadata?.filename || 'PDF document')}</strong><button class="btn outline" data-pdf-prev>Previous</button><span data-pdf-position>Loading PDF…</span><button class="btn outline" data-pdf-next>Next</button><button class="iconbtn" data-pdf-zoom-out aria-label="Zoom out">−</button><button class="iconbtn" data-pdf-zoom-in aria-label="Zoom in">+</button><button class="btn outline" data-pdf-full>Fullscreen</button><button class="btn outline" data-pdf-download>Download</button></div><div class="pdf-canvas"><canvas aria-label="PDF page"></canvas></div><p class="error" role="alert"></p></section>`;
    if (!page.source_url) return '';
    let source;
    try {
      source = detectSource(page.source_url);
    } catch {
      return '<p class="error">This resource link is unavailable.</p>';
    }
    return `<section class="external-resource"><span class="badge">${e(source.label)}</span><h2>${e(page.title)}</h2><p>Open the original resource with your Google or Microsoft account. Its own sharing permissions still apply.</p><a class="btn dark" href="${e(page.source_url)}" target="_blank" rel="noopener noreferrer" data-external-page="${page.id}">Open ${e(source.label)}</a></section>`;
  }
  async function hydrate() {
    for (const root of document.querySelectorAll('[data-pdf-page]')) {
      const page = state.published.find((p) => p.id === root.dataset.pdfPage);
      if (!page?.file_metadata) continue;
      try {
        const pdf = await files.get(page.file_metadata.storage_path).catch(() => {
          throw Error('PDF access is unavailable. Sign in again or ask the team manager.');
        });
        const { mountPdf } = await import('./vendor/pdf-viewer.js');
        if (root.isConnected)
          await mountPdf(
            root,
            new Uint8Array(await pdf.arrayBuffer()),
            page.file_metadata.filename,
          );
      } catch (error) {
        root.querySelector('.error').textContent = error.message;
      }
    }
  }
  return { open, preview, hydrate };
}
