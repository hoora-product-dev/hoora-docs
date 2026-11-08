// The end of every page: an install prompt for people without the app, and the
// developer credit, which opens a way to report an issue or meet the developer.
const portfolio = 'https://rahul-tripathi.web.app';
const placeholders = {
  bug: 'What happened, and on which page?',
  feature: 'What would make Hoora Docs better for you?',
  appreciation: 'What did you like?',
};

export function makerFeature({ state, e, icon, dialog, modal, toast, db, upload, isInstalled }) {
  function pageEnd() {
    const install = isInstalled()
      ? ''
      : `<a class="install-nudge" href="#/install"><img src="/app-icon-192.png" alt="" width="32" height="32"><span><strong>Hoora Docs app</strong><small>Faster, with release alerts</small></span><span class="install-nudge-action">Install</span></a>`;
    return `<footer class="page-end">${install}<button type="button" class="maker-credit" data-action="about-maker"><span>Help improve Hoora Docs</span></button></footer>`;
  }

  function about() {
    dialog(
      `<div class="maker-head"><img src="/app-icon-192.png" alt="" width="36" height="36"><div><h2>Hoora Docs</h2><p>Developed by Rahul Tripathi</p></div><button type="button" class="iconbtn" data-close aria-label="Close">${icon('close')}</button></div><div class="maker-options"><button type="button" data-action="report-issue">${icon('chat')}<span class="maker-option-text"><strong>Report an issue</strong><small>Bug, idea or thanks</small></span>${icon('chevron')}</button><a href="${portfolio}" target="_blank" rel="noopener noreferrer">${icon('user')}<span class="maker-option-text"><strong>Meet the developer</strong><small>Portfolio</small></span>${icon('external')}</a></div>`,
    );
  }

  function report() {
    if (modal.open) modal.close();
    dialog(
      `<h2>Report an issue</h2><p class="small">Goes straight to Rahul Tripathi.</p><form class="feedback-form"><fieldset class="feedback-kinds"><legend class="sr-only">Type of report</legend><label><input type="radio" name="kind" value="bug" checked><span>Bug</span></label><label><input type="radio" name="kind" value="feature"><span>Feature</span></label><label><input type="radio" name="kind" value="appreciation"><span>Appreciation</span></label></fieldset><div class="field"><label for="feedback-message">Details</label><textarea id="feedback-message" name="message" rows="5" minlength="3" maxlength="4000" required placeholder="${placeholders.bug}"></textarea></div><label class="feedback-attach"><input id="feedback-screenshot" name="screenshot" type="file" accept="image/*">${icon('paperclip')}<span data-attach-label>Add screenshot</span><small>optional</small></label><p class="error" role="alert"></p><div class="dialog-actions"><button type="button" class="btn outline" data-close>Cancel</button><button class="btn dark" type="submit">Send report</button></div></form>`,
      async (form) => {
        const file = form.get('screenshot');
        const screenshotPath = file?.size ? await upload(file) : null;
        await db('docs_feedback', '', {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: {
            kind: form.get('kind'),
            message: String(form.get('message') || '').trim(),
            screenshot_path: screenshotPath,
            page_path: (location.pathname + location.search).slice(0, 300),
            device: navigator.userAgent.slice(0, 300),
          },
        });
        toast('Thank you. Your report reached Rahul Tripathi.');
      },
    );
    const message = modal.querySelector('#feedback-message');
    const attach = modal.querySelector('#feedback-screenshot');
    attach.addEventListener('change', () => {
      modal.querySelector('[data-attach-label]').textContent =
        attach.files[0]?.name || 'Add screenshot';
    });
    modal.querySelectorAll('input[name="kind"]').forEach((radio) =>
      radio.addEventListener('change', () => {
        message.placeholder = placeholders[radio.value];
      }),
    );
  }

  /** Administrators: every report, newest first, with its screenshot on request. */
  async function inbox() {
    if (state.member.role !== 'admin') throw Error('Administrator access required.');
    const [reports, people] = await Promise.all([
      db('docs_feedback', '?select=*&order=created_at.desc&limit=200'),
      db('docs_members', '?select=id,name,email'),
    ]);
    const kinds = { bug: 'Bug', feature: 'Feature request', appreciation: 'Appreciation' };
    const rows = reports
      .map((r) => {
        const person = people.find((p) => p.id === r.user_id);
        return `<article class="feedback-item ${r.status === 'resolved' ? 'resolved' : ''}"><div class="feedback-meta"><span class="badge ${r.kind === 'bug' ? 'draft' : 'published'}">${kinds[r.kind]}</span><small>${e(person?.name || person?.email || 'Former member')} · ${new Date(r.created_at).toLocaleString('en-IN')}${r.page_path ? ` · ${e(r.page_path)}` : ''}</small></div><p>${e(r.message)}</p><div class="toolbar-actions">${r.screenshot_path ? `<button type="button" class="btn outline" data-action="feedback-screenshot" data-path="${e(r.screenshot_path)}">${icon('paperclip')}View screenshot</button>` : ''}${r.status === 'new' ? `<button type="button" class="btn outline" data-action="feedback-resolve" data-id="${r.id}">${icon('check')}Mark resolved</button>` : '<span class="small">Resolved</span>'}</div></article>`;
      })
      .join('');
    return (
      rows ||
      '<div class="empty"><h2>No reports yet</h2><p>Bugs, feature ideas and thanks from your team will appear here.</p></div>'
    );
  }

  return { pageEnd, about, report, inbox };
}
