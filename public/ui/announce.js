/**
 * Announce: a hidden page for administrators at /announce. It shows the release email and
 * copies it for pasting into a new Outlook message. Hoora Docs never sends the email itself.
 * Below it, the same release as a Teams message, sent from here as a one-to-one chat.
 */
export function announceFeature({ e, icon, appApi, toast, busy, confirm, releases }) {
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
    return `<main id="main" class="settings-content announce-page"><div class="view-heading"><div><h1>Announce a release</h1><p>Copy the email, paste it into a new Outlook message, then send it yourself. The Teams message below is sent from here.</p></div></div><div class="announce-bar"><div class="field"><label for="announce-release">Release</label><select id="announce-release">${list
      .map(
        (record) =>
          `<option value="${e(record.page.id)}" ${record === chosen ? 'selected' : ''}>${e(label(record))}</option>`,
      )
      .join(
        '',
      )}</select></div><div class="announce-actions"><button type="button" class="btn primary" data-action="announce-copy">${icon('copy')}Copy email</button></div></div><div class="announce-subject"><small>Subject</small><span>${e(current.email.subject)}</span><button type="button" class="btn text" data-action="announce-copy-subject">Copy</button></div><iframe class="announce-preview" title="Email preview" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"></iframe><p class="announce-hint">In Outlook, add <strong>Hoora</strong> in <strong>BCC</strong> and press Send.</p>${teamsSection(current.email.teams)}</main>`;
  }

  // Who "Send to everyone" reaches: everyone with Hoora Releases, or Rahul through the flow.
  const audience = (teams) =>
    teams.everyone?.people !== undefined
      ? `everyone at Hoora who has Hoora Releases in Teams (${teams.everyone.people} ${teams.everyone.people === 1 ? 'person' : 'people'})`
      : `${teams.everyone?.only} (test flow)`;
  const time = (value) =>
    new Date(value).toLocaleString('en-IN', {
      hour: 'numeric',
      minute: '2-digit',
      day: 'numeric',
      month: 'short',
    });

  // The Teams message: who it comes from, a preview, then Test (to yourself, 10 a day) and
  // Send to everyone (once a day per release, whoever sends it).
  function teamsSection(teams) {
    if (!teams) return '';
    const { used = 0, limit = 10 } = teams.tests || {};
    const hint = !teams.ready
      ? 'Teams sending is not set up yet.'
      : teams.last
        ? `Sent to everyone${teams.last.by ? ' by <strong>' + e(teams.last.by.replace(/\s+/g, ' ')) + '</strong>' : ''} at ${e(time(teams.last.at))}. It can be sent again after ${e(time(teams.last.next))}.`
        : `Test sends it to you only (${used} of ${limit} used in the last 24 hours). Send to everyone reaches ${e(audience(teams))}, once a day.`;
    const canTest = teams.ready && used < limit;
    const canSend = teams.ready && !teams.last;
    return `<section class="announce-teams" aria-labelledby="announce-teams-title"><div class="announce-section-head"><h2 id="announce-teams-title">Teams message</h2><p>Arrives as a one-to-one chat from <strong>${e(teams.sender)}</strong>.</p></div><iframe class="announce-preview announce-teams-preview" title="Teams message preview" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"></iframe><div class="announce-send"><p class="announce-hint">${hint}</p><div class="announce-actions"><button type="button" class="btn outline" data-action="announce-teams-test" ${canTest ? '' : 'disabled'}>Test on Teams</button><button type="button" class="btn primary" data-action="announce-teams-send" ${canSend ? '' : 'disabled'}>${icon('chat')}Send to everyone</button></div></div></section>`;
  }

  // A preview frame is as tall as its content, also when the content reflows later (images
  // loading, the page resizing), so it never shows a scroll bar of its own.
  function fit(frame, html) {
    frame.addEventListener('load', () => {
      const page = frame.contentDocument?.documentElement;
      if (!page) return;
      const size = () => (frame.style.height = page.scrollHeight + 'px');
      size();
      if (window.ResizeObserver) new ResizeObserver(size).observe(frame.contentDocument.body);
    });
    frame.srcdoc = html;
  }

  function hydrate() {
    const frame = document.querySelector('.announce-preview');
    if (!frame || !current) return;
    // Links in the preview open in a new tab instead of inside the frame.
    fit(frame, current.email.html.replace('<head>', '<head><base target="_blank">'));
    const teams = document.querySelector('.announce-teams-preview');
    if (teams && current.email.teams) fit(teams, current.email.teams.preview);
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

  // A test goes to yourself only, so it is sent straight away.
  async function testTeams() {
    const { used, limit } = await appApi(
      '/api/notifications',
      { id: current.id, action: 'teams-test' },
      { readOnly: true },
    );
    toast(`Test sent to you on Teams (${used} of ${limit} in the last 24 hours).`);
    previews.delete(current.id);
    current.email.teams.tests = { used, limit };
    const button = document.querySelector('[data-action="announce-teams-test"]');
    if (button && used >= limit) button.disabled = true;
  }

  // Sending to everyone asks first: the message reaches real people in Teams.
  function sendTeams() {
    const { teams, subject } = current.email;
    const release = subject.replace(/ is now live$/, '');
    confirm(
      'Send to everyone on Teams?',
      `${release} goes to ${audience(teams)} as a one-to-one Teams chat from ${teams.sender}. A release can be sent to everyone once a day.`,
      async () => {
        const { sent, failed = [] } = await appApi(
          '/api/notifications',
          { id: current.id, action: 'teams-send' },
          { readOnly: true },
        );
        const count = (list) => (list.length === 1 ? list[0] : list.length + ' people');
        toast(
          `Sent on Teams to ${count(sent)}.` +
            (failed.length ? ` Not delivered to ${count(failed)}.` : ''),
          failed.length > 0,
        );
        // Sent: the button stays off for this release for 24 hours.
        previews.delete(current.id);
        const button = document.querySelector('[data-action="announce-teams-send"]');
        if (button) button.disabled = true;
        const hint = document.querySelector('.announce-send .announce-hint');
        if (hint)
          hint.textContent = 'Sent to everyone just now. It can be sent again after 24 hours.';
      },
    );
  }

  async function action(name, button) {
    if (!current) return false;
    if (name === 'announce-copy') await busy(button, copyEmail);
    else if (name === 'announce-teams-test') await busy(button, testTeams);
    else if (name === 'announce-teams-send') sendTeams();
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
