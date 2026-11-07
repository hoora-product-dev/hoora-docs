import { routeUrl } from './router.js';
export function upcomingFeature({ state, appApi, e, icon, dialog, modal, toast, render, rail }) {
  let releases = [],
    configured = false,
    current = null,
    tickets = [],
    verticals = [],
    owners = [],
    request = 0,
    filters = new URLSearchParams();
  const api = (body) => appApi('/api/upcoming', body),
    admin = () => state.member?.role === 'admin';
  const path = (release) => '#/upcoming/' + encodeURIComponent(release.slug);
  const date = (value) =>
    value
      ? new Date(value + 'T12:00:00').toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })
      : 'Date not set';
  const empty = (text) => `<div class="upcoming-empty">${icon('clock')}<p>${e(text)}</p></div>`;
  const aside = () => rail();
  const frame = (body) =>
    `<div class="layout">${aside()}<main id="main" class="upcoming-page">${body}</main></div>`;
  const query = () => {
    const value = filters.toString();
    return value ? '?' + value : '';
  };
  const listPath = () => path(current) + query();
  function options(values, selected, label) {
    return `<option value="">${label}</option><option value="__unassigned__" ${selected === '__unassigned__' ? 'selected' : ''}>Not assigned</option>${values.map((value) => `<option value="${e(value.id)}" ${value.id === selected ? 'selected' : ''}>${e(value.label)}</option>`).join('')}`;
  }
  function rows(vertical = '', owner = '') {
    const matches = (values, id) =>
      !id || (id === '__unassigned__' ? !values.length : values.some((value) => value.id === id));
    const found = tickets.filter(
      (ticket) => matches(ticket.verticals, vertical) && matches(ticket.owners, owner),
    );
    return `<p class="upcoming-count" role="status">${found.length} ${found.length === 1 ? 'ticket' : 'tickets'}</p><div class="upcoming-tickets">${found.map((ticket) => `<a class="upcoming-ticket" href="${path(current)}/tickets/${encodeURIComponent(ticket.key)}${query()}"><span class="upcoming-ticket-key">${e(ticket.key)}</span><span class="upcoming-ticket-title">${e(ticket.title)}</span>${icon('chevron')}</a>`).join('') || empty('No tickets match these filters.')}</div>`;
  }
  function settingsPage(release = {}) {
    if (!admin()) return frame(empty('Administrator access is required.'));
    const back = release.id ? path(release) : '#/upcoming';
    return frame(
      `<div class="view-heading"><div><a class="native-back" href="${back}">${icon('back')}Upcoming releases</a><h1>${release.id ? 'Manage release' : 'New upcoming release'}</h1></div></div><form id="upcoming-form" class="upcoming-settings-form" data-id="${e(release.id || '')}"><fieldset><div class="field"><label for="upcoming-title">Release name</label><input id="upcoming-title" name="title" maxlength="100" required value="${e(release.title || '')}"></div><div class="form-columns"><div class="field"><label for="upcoming-version">Version</label><input id="upcoming-version" name="version" maxlength="50" required placeholder="5.12.0" value="${e(release.version || '')}"></div><div class="field"><label for="upcoming-date">Target release date</label><input type="date" id="upcoming-date" name="releaseDate" value="${e(release.releaseDate || '')}"></div></div><div class="field"><label for="upcoming-filter">Jira filter link</label><input type="url" id="upcoming-filter" name="filterUrl" required placeholder="https://hooratechteam.atlassian.net/issues?filter=12576" value="${e(release.filterUrl || '')}"></div><div class="field"><label for="upcoming-emails">Approved viewers</label><textarea id="upcoming-emails" name="allowedEmails" rows="5" placeholder="name@hoora.me">${e((release.allowedEmails || []).join('\n'))}</textarea><small>One Hoora work email per line. Administrators already have access.</small></div><label class="upcoming-share-check"><input type="checkbox" name="enabled" ${release.enabled ? 'checked' : ''} ${configured ? '' : 'disabled'}> Share with approved viewers</label>${!configured ? '<p class="small">Configure the read-only Jira connection before sharing.</p>' : ''}</fieldset><p class="error" role="alert"></p><div class="upcoming-settings-actions">${release.id ? `<button class="btn text danger" type="button" data-upcoming="delete" data-id="${e(release.id)}">${icon('trash')}Delete release</button>` : ''}<a class="btn outline" href="${back}">Cancel</a><button type="submit" class="btn dark">Save release</button></div></form>`,
    );
  }
  async function ticketPage(key, generation) {
    const back = listPath();
    try {
      const { ticket } = await api({ action: 'ticket', id: current.id, key });
      if (generation !== request) return '';
      document.title = ticket.key + ' · ' + ticket.title + ' — Hoora Docs';
      const facts = [
        ['Status', ticket.status],
        ['Type', ticket.type],
        ['Priority', ticket.priority],
        ['Vertical', ticket.verticals.map((value) => value.label).join(', ') || 'Not assigned'],
        ['Product Owner', ticket.owners.map((value) => value.label).join(', ') || 'Not assigned'],
        ['Assignee', ticket.assignee || 'Not assigned'],
        ['Reporter', ticket.reporter],
        ['Project', ticket.project],
        ['Due date', ticket.dueDate],
        ['Fix versions', (ticket.fixVersions || []).join(', ')],
        ['Labels', (ticket.labels || []).join(', ')],
        ['Updated', ticket.updatedAt ? new Date(ticket.updatedAt).toLocaleString() : ''],
      ];
      return frame(
        `<article class="upcoming-ticket-page"><a class="native-back" href="${back}">${icon('back')}Back to tickets</a><header class="upcoming-ticket-heading"><div><p class="muted">${e(ticket.key)}</p><h1>${e(ticket.title)}</h1></div></header><dl class="upcoming-ticket-facts">${facts
          .filter(([, value]) => value)
          .map(([label, value]) => `<div><dt>${e(label)}</dt><dd>${e(value)}</dd></div>`)
          .join(
            '',
          )}</dl><div class="prose upcoming-ticket-description">${ticket.description ? documentHtml(ticket.description) : '<p class="muted">No description added.</p>'}</div></article>`,
      );
    } catch (error) {
      return frame(
        `<a class="native-back" href="${back}">${icon('back')}Back to tickets</a><h1>Ticket unavailable</h1><p class="content-error" role="alert">${e(error.message)}</p>`,
      );
    }
  }
  async function view(slug, params = new URLSearchParams(), screen = {}) {
    const generation = ++request,
      result = await api({ action: 'list' });
    if (generation !== request) return '';
    releases = result.releases;
    configured = result.configured === true;
    tickets = [];
    filters = new URLSearchParams();
    for (const name of ['vertical', 'owner'])
      if (params.get(name)) filters.set(name, params.get(name));
    if (params.get('create') === '1') return settingsPage();
    current = slug ? releases.find((release) => release.slug === slug) : releases[0];
    if (!current)
      return frame(
        `<div class="reader-heading"><h1>Upcoming releases</h1>${admin() ? '<a class="btn outline" href="#/upcoming?create=1">' + icon('plus') + 'Add upcoming release</a>' : ''}</div>${empty(slug ? 'This release is unavailable or access has not been granted.' : 'No upcoming releases are available to your account.')}`,
      );
    if (screen.settings) return settingsPage(current);
    if (screen.ticket) return ticketPage(screen.ticket, generation);
    const release = current;
    document.title = release.title + ' · ' + release.version + ' — Upcoming — Hoora Docs';
    let content;
    try {
      const result = await api({ action: 'tickets', id: release.id });
      if (generation !== request) return '';
      tickets = result.tickets;
      verticals = result.verticals;
      owners = result.owners;
      content = `<div class="upcoming-filters"><div class="field"><label for="upcoming-vertical">Vertical</label><select id="upcoming-vertical">${options(verticals, filters.get('vertical') || '', 'All verticals')}</select></div><div class="field"><label for="upcoming-owner">Product Owner</label><select id="upcoming-owner">${options(owners, filters.get('owner') || '', 'All product owners')}</select></div></div><div id="upcoming-results">${rows(filters.get('vertical') || '', filters.get('owner') || '')}</div><p class="upcoming-synced">Updated from Jira · ${e(new Date(result.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</p>`;
    } catch (error) {
      content = `<div class="upcoming-load-error" role="alert"><p>${e(error.message)}</p><button class="btn outline" data-upcoming="refresh">Try again</button></div>`;
    }
    return frame(
      `<header class="upcoming-release-header"><div><p class="upcoming-release-version">Upcoming · ${e(release.version)}</p><h1>${e(release.title)}</h1><p>Target release · ${e(date(release.releaseDate))}</p></div><div class="toolbar-actions"><button class="btn outline" data-upcoming="copy">${icon('link')}Copy link</button>${admin() ? `<a class="btn outline" href="${path(release)}/settings">${icon('settings')}Manage</a>` : ''}</div></header>${releases.length > 1 ? `<div class="field upcoming-release-select"><label for="upcoming-release-select">Release</label><select id="upcoming-release-select">${releases.map((r) => `<option value="${e(r.slug)}" ${r.id === release.id ? 'selected' : ''}>${e(r.title)} · ${e(r.version)}</option>`).join('')}</select></div>` : ''}${content}`,
    );
  }
  // Render Jira's document format with an explicit element allowlist; never insert Jira HTML.
  function documentHtml(node, depth = 0) {
    if (!node || depth > 40) return '';
    if (typeof node === 'string') return `<p>${e(node)}</p>`;
    const content = (node.content || []).map((n) => documentHtml(n, depth + 1)).join('');
    if (node.type === 'text') {
      let text = e(node.text || '');
      for (const mark of node.marks || []) {
        if (mark.type === 'strong') text = '<strong>' + text + '</strong>';
        if (mark.type === 'em') text = '<em>' + text + '</em>';
        if (mark.type === 'code') text = '<code>' + text + '</code>';
        if (mark.type === 'strike') text = '<s>' + text + '</s>';
        if (mark.type === 'link') {
          try {
            const u = new URL(mark.attrs.href);
            if (u.protocol === 'https:')
              text = `<a href="${e(u.href)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
          } catch {}
        }
      }
      return text;
    }
    const tags = {
      doc: 'div',
      paragraph: 'p',
      bulletList: 'ul',
      orderedList: 'ol',
      listItem: 'li',
      blockquote: 'blockquote',
      codeBlock: 'pre',
      table: 'table',
      tableRow: 'tr',
      tableCell: 'td',
      tableHeader: 'th',
      panel: 'blockquote',
      expand: 'details',
    };
    if (node.type === 'heading') {
      const level = Math.min(6, Math.max(2, Number(node.attrs?.level) || 2));
      return `<h${level}>${content}</h${level}>`;
    }
    if (node.type === 'hardBreak') return '<br>';
    if (node.type === 'rule') return '<hr>';
    if (node.type === 'mention') return e(node.attrs?.text || 'Mention');
    if (node.type === 'emoji') return e(node.attrs?.text || node.attrs?.shortName || '');
    if (node.type === 'status') return e(node.attrs?.text || '');
    if (node.type === 'date') {
      const value = Number(node.attrs?.timestamp);
      return Number.isFinite(value) ? e(new Date(value).toLocaleDateString()) : '';
    }
    if (['inlineCard', 'blockCard'].includes(node.type)) {
      try {
        const u = new URL(node.attrs?.url);
        if (u.protocol === 'https:')
          return `<a href="${e(u.href)}" target="_blank" rel="noopener noreferrer">${e(u.href)}</a>`;
      } catch {}
      return '';
    }
    if (node.type === 'media') return '<p class="muted">Media attachment · available in Jira</p>';
    const tag = tags[node.type];
    return tag
      ? `<${tag}>${node.type === 'expand' ? '<summary>' + e(node.attrs?.title || 'Details') + '</summary>' : ''}${content}</${tag}>`
      : content;
  }

  document.addEventListener('input', (event) => {
    if (event.target.closest('#upcoming-form')) state.dirty = true;
  });
  document.addEventListener('change', (event) => {
    if (event.target.closest('#upcoming-form')) state.dirty = true;
    if (event.target.id === 'upcoming-release-select') {
      location.hash = '#/upcoming/' + encodeURIComponent(event.target.value);
      return;
    }
    if (!['upcoming-vertical', 'upcoming-owner'].includes(event.target.id) || !current) return;
    const vertical = document.querySelector('#upcoming-vertical').value,
      owner = document.querySelector('#upcoming-owner').value;
    filters = new URLSearchParams();
    if (vertical) filters.set('vertical', vertical);
    if (owner) filters.set('owner', owner);
    document.querySelector('#upcoming-results').innerHTML = rows(vertical, owner);
    history.replaceState(null, '', routeUrl(listPath()));
  });
  document.addEventListener('submit', async (event) => {
    if (event.target.id !== 'upcoming-form') return;
    event.preventDefault();
    if (!admin()) return;
    const form = event.target,
      button = event.submitter,
      values = Object.fromEntries(new FormData(form)),
      release = releases.find((release) => release.id === form.dataset.id);
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    form.querySelector('fieldset').disabled = true;
    form.querySelector('.error').textContent = '';
    try {
      const result = await api({
        action: 'save',
        ...values,
        id: release?.id,
        updatedAt: release?.updatedAt,
        enabled: values.enabled === 'on',
      });
      state.dirty = false;
      location.hash = path(result.release);
      toast('Upcoming release saved.');
    } catch (error) {
      if (form.isConnected) form.querySelector('.error').textContent = error.message;
      else toast(error.message, true);
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      form.querySelector('fieldset').disabled = false;
    }
  });
  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-upcoming]');
    if (!button) return;
    const action = button.dataset.upcoming,
      id = button.dataset.id;
    if (action === 'cancel') {
      modal.close();
      return;
    }
    if (action === 'refresh') {
      await render();
      return;
    }
    if (action === 'copy') {
      try {
        await navigator.clipboard.writeText(location.origin + routeUrl(path(current)));
        toast('Link copied. Only approved viewers can open it.');
      } catch {
        toast('Unable to copy the link.', true);
      }
      return;
    }
    const release = releases.find((release) => release.id === id);
    if (!admin() || !release) return;
    if (action === 'delete') {
      dialog(
        `<h2>Delete upcoming release?</h2><p>${e(release.title)} will be removed from Hoora Docs. Jira tickets will be kept.</p><p id="upcoming-delete-error" class="error" role="alert"></p><div class="dialog-actions"><button class="btn outline" data-upcoming="cancel">Cancel</button><button class="btn danger" data-upcoming="confirm-delete" data-id="${e(id)}">Delete release</button></div>`,
      );
      return;
    }
    if (action === 'confirm-delete') {
      button.disabled = true;
      try {
        await api({ action: 'delete', id, updatedAt: release.updatedAt });
        modal.close();
        state.dirty = false;
        location.hash = '#/upcoming';
        toast('Upcoming release deleted.');
      } catch (error) {
        document.querySelector('#upcoming-delete-error').textContent = error.message;
        button.disabled = false;
      }
    }
  });
  return { view, documentHtml };
}
