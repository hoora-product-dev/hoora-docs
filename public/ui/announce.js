/**
 * Announce: a hidden page for administrators at /announce. It shows the release email and
 * copies it for pasting into a new Outlook message. Hoora Docs never sends the email itself.
 */
export function announceFeature({ e, icon, appApi, toast, busy, releases }) {
  const previews = new Map();
  let current = null;

  const preview = async (id) => {
    if (!previews.has(id))
      previews.set(
        id,
        appApi('/api/notifications', { id, action: 'preview' }, { readOnly: true }).catch(
          (error) => {
            previews.delete(id);
            throw error;
          },
        ),
      );
    return previews.get(id);
  };

  async function view(params) {
    const list = releases()
      .filter((record) => record.published)
      .sort(
        (a, b) => new Date(b.published.published_at || 0) - new Date(a.published.published_at || 0),
      );
    if (!list.length)
      return `<main id="main" class="settings-content announce-page"><div class="view-heading"><div><h1>Announce a release</h1><p>Publish a release first. Its email appears here.</p></div></div></main>`;
    const chosen = list.find((record) => record.page.id === params.get('release')) || list[0];
    current = { id: chosen.page.id, email: await preview(chosen.page.id) };
    const label = (record) =>
      `${record.project.name} · v${String(record.version).replace(/^v/i, '')}`;
    return `<main id="main" class="settings-content announce-page"><div class="view-heading"><div><h1>Announce a release</h1><p>Copy the email, paste it into a new Outlook message, then send it yourself. Nothing is sent from Hoora Docs.</p></div></div><div class="announce-bar"><div class="field"><label for="announce-release">Release</label><select id="announce-release">${list
      .map(
        (record) =>
          `<option value="${e(record.page.id)}" ${record === chosen ? 'selected' : ''}>${e(label(record))}</option>`,
      )
      .join(
        '',
      )}</select></div><div class="announce-actions"><button type="button" class="btn primary" data-action="announce-copy">${icon('copy')}Copy email</button></div></div><div class="announce-subject"><small>Subject</small><span>${e(current.email.subject)}</span><button type="button" class="btn text" data-action="announce-copy-subject">Copy</button></div><iframe class="announce-preview" title="Email preview" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"></iframe><p class="announce-hint">In Outlook, add <strong>Hoora</strong> in <strong>BCC</strong> and press Send.</p></main>`;
  }

  function hydrate() {
    const frame = document.querySelector('.announce-preview');
    if (!frame || !current) return;
    frame.addEventListener('load', () => {
      const page = frame.contentDocument?.documentElement;
      if (page) frame.style.height = page.scrollHeight + 'px';
    });
    // Links in the preview open in a new tab instead of inside the frame.
    frame.srcdoc = current.email.html.replace('<head>', '<head><base target="_blank">');
    document.querySelector('#announce-release')?.addEventListener('change', (event) => {
      location.hash = '#/announce?release=' + encodeURIComponent(event.target.value);
    });
  }

  /**
   * Outlook on the web pastes content from other sites with "Merge formatting": every text
   * color, size and font becomes its own default, so white text on the dark header turns
   * black. Content copied inside Outlook carries a text/olk-copy marker, and Outlook keeps
   * the source formatting of anything that has it. A copy event is the only way a page can
   * put that marker on the clipboard.
   */
  function copyForOutlook(html, text) {
    const fill = (event) => {
      event.preventDefault();
      event.clipboardData.setData('text/html', html);
      event.clipboardData.setData('text/plain', text);
      event.clipboardData.setData('text/olk-copy', 'MailCompose');
    };
    document.addEventListener('copy', fill);
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      document.removeEventListener('copy', fill);
    }
  }

  async function copyEmail() {
    const { body, text } = current.email;
    if (!copyForOutlook(body, text)) {
      if (!window.ClipboardItem || !navigator.clipboard?.write)
        throw new Error('Copying is not supported in this browser.');
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([body], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        }),
      ]);
    }
    toast('Email copied. Paste it into a new Outlook message.');
  }

  async function action(name, button) {
    if (!current) return false;
    if (name === 'announce-copy') await busy(button, copyEmail);
    else if (name === 'announce-copy-subject')
      await busy(button, async () => {
        await navigator.clipboard.writeText(current.email.subject);
        toast('Subject copied.');
      });
    else return false;
    return true;
  }

  return { view, hydrate, action };
}
