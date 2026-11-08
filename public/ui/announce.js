/**
 * Announce: a hidden page for administrators at /announce. It shows the release email,
 * copies it for pasting into Outlook, or places it as a draft in the administrator's own
 * Outlook. Hoora Docs never sends the email itself.
 */
const OUTLOOK_TOKEN = 'hoora-outlook-token';
const OUTLOOK_RETURN = 'hoora-outlook-return';

export function announceFeature({ e, icon, appApi, toast, busy, releases, connectOutlook }) {
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
    return `<main id="main" class="settings-content announce-page"><div class="view-heading"><div><h1>Announce a release</h1><p>Copy the email or open it in Outlook, then send it yourself. Nothing is sent from Hoora Docs.</p></div></div><div class="announce-bar"><div class="field"><label for="announce-release">Release</label><select id="announce-release">${list
      .map(
        (record) =>
          `<option value="${e(record.page.id)}" ${record === chosen ? 'selected' : ''}>${e(label(record))}</option>`,
      )
      .join(
        '',
      )}</select></div><div class="announce-actions"><button type="button" class="btn outline" data-action="announce-copy">${icon('copy')}Copy email</button><button type="button" class="btn primary" data-action="announce-outlook">${icon('mail')}Open in Outlook</button></div></div><div class="announce-subject"><small>Subject</small><span>${e(current.email.subject)}</span><button type="button" class="btn text" data-action="announce-copy-subject">Copy</button></div><iframe class="announce-preview" title="Email preview" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"></iframe><p class="announce-hint">In Outlook, add <strong>Hoora</strong> in <strong>BCC</strong> and press Send.</p></main>`;
  }

  function hydrate() {
    const frame = document.querySelector('.announce-preview');
    if (!frame || !current) return;
    try {
      if (sessionStorage.getItem('hoora-outlook-connected')) {
        sessionStorage.removeItem('hoora-outlook-connected');
        toast('Outlook connected. Click Open in Outlook.');
      }
    } catch {}
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

  async function copyEmail() {
    const { body, text } = current.email;
    if (window.ClipboardItem && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([body], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        }),
      ]);
    } else {
      // Older browsers: copy the rendered preview as a selection.
      const doc = document.querySelector('.announce-preview')?.contentDocument;
      if (!doc) throw new Error('Copying is not supported in this browser.');
      const range = doc.createRange();
      range.selectNodeContents(doc.body);
      const selection = doc.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      if (!doc.execCommand('copy')) throw new Error('Copying is not supported in this browser.');
      selection.removeAllRanges();
    }
    toast('Email copied. Paste it into a new Outlook message.');
  }

  async function openInOutlook(button) {
    let token = null;
    try {
      token = sessionStorage.getItem(OUTLOOK_TOKEN);
    } catch {}
    if (!token) {
      // Microsoft asks once for permission to create drafts, then returns here.
      try {
        sessionStorage.setItem(OUTLOOK_RETURN, current.id);
      } catch {}
      await busy(button, () => connectOutlook());
      return;
    }
    // Open the tab now, while the click still counts as the person's action.
    const tab = window.open('', '_blank');
    await busy(button, async () => {
      try {
        const { webLink } = await appApi('/api/notifications', {
          id: current.id,
          action: 'draft',
          providerToken: token,
        });
        if (tab && webLink) tab.location.href = webLink;
        else tab?.close();
        toast('Draft ready in Outlook. Add Hoora in BCC and send.');
      } catch (error) {
        tab?.close();
        if (/Connect|permission|token|expired|Lifetime/i.test(error.message)) {
          try {
            sessionStorage.removeItem(OUTLOOK_TOKEN);
          } catch {}
          throw new Error('Outlook needs to reconnect. Click Open in Outlook again.');
        }
        throw error;
      }
    });
  }

  async function action(name, button) {
    if (!current) return false;
    if (name === 'announce-copy') await busy(button, copyEmail);
    else if (name === 'announce-copy-subject')
      await busy(button, async () => {
        await navigator.clipboard.writeText(current.email.subject);
        toast('Subject copied.');
      });
    else if (name === 'announce-outlook') await openInOutlook(button);
    else return false;
    return true;
  }

  return { view, hydrate, action };
}
