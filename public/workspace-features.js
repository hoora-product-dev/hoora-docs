import { publishedRoute } from './router.js';
export function workspaceFeatures({
  state,
  db,
  e,
  dialog,
  modal,
  toast,
  load,
  render,
  row,
  teams,
  appApi,
  pwa,
  icon,
}) {
  const manages = (p) =>
    state.member?.role === 'admin' ||
    (p.team_id && teams.manages(state.teams.find((t) => t.id === p.team_id) || {}));
  const noticeTitle = (p) =>
    p?.kind === 'release' && p.release_snapshot?.project
      ? `${p.release_snapshot.project}${p.version ? ' v' + String(p.version).replace(/^v/i, '') : ''} released`
      : p?.title || 'New Hoora Docs update';
  let showAllNotices = false;
  function pageTools(p) {
    if (!state.member) return '';
    return `<div class="knowledge-page-tools">${manages(p) ? `<button class="btn outline" data-hub-action="notify" data-id="${p.id}">Notify readers</button>` : ''}${state.pages.some((d) => d.id === p.id && !d._readOnly) ? `<button class="btn text" data-hub-action="related" data-id="${p.id}">Manage related knowledge</button>` : ''}${manages(p) ? `<button class="btn text" data-hub-action="archive" data-id="${p.id}" title="Move to recycle bin">Archive</button>` : ''}</div><section class="related-knowledge" data-related-page="${p.id}"></section>`;
  }
  async function hydrate() {
    for (const root of document.querySelectorAll('[data-related-page]')) {
      try {
        const id = root.dataset.relatedPage,
          relations = await db(
            'docs_relationships',
            `?or=(source_id.eq.${id},target_id.eq.${id})&select=*`,
          );
        const ids = relations.map((r) => (r.source_id === id ? r.target_id : r.source_id)),
          pages = state.published.filter((p) => ids.includes(p.id));
        if (root.isConnected)
          root.innerHTML = pages.length
            ? `<h2>Related knowledge</h2><div class="related-grid">${pages.map((p) => `<a href="${publishedRoute(p, state.projects)}"><small>${e(state.types.find((t) => t.key === p.kind)?.name || p.kind)}</small><strong>${e(p.title)}</strong></a>`).join('')}</div>`
            : '';
      } catch {
        if (root.isConnected)
          root.innerHTML = '<p class="small">Related knowledge is temporarily unavailable.</p>';
      }
    }
  }
  async function inbox() {
    const [notices, reads] = await Promise.all([
      db('docs_notices', '?select=*&order=created_at.desc&limit=100'),
      db('docs_notice_reads', '?select=notice_id'),
    ]);
    const seen = new Set(reads.map((r) => r.notice_id));
    const unread = notices.filter(
        (n) => !seen.has(n.id) && state.published.some((p) => p.id === n.page_id),
      ),
      visible = (showAllNotices ? notices : unread).filter((n) =>
        state.published.some((p) => p.id === n.page_id),
      );
    state.unreadNoticeCount = unread.length;
    const push = (await pwa.status?.()) || {
        supported: false,
        installed: false,
        permission: 'unsupported',
        subscribed: false,
      },
      pushAction = push.subscribed
        ? '<button class="btn outline" data-hub-action="push-disable">Disable notifications</button>'
        : push.supported && push.permission !== 'denied'
          ? '<button class="btn dark" data-hub-action="push-enable">Enable notifications</button>'
          : '<span class="notification-status">Browser notifications unavailable</span>',
      installAction = push.installed
        ? ''
        : '<button class="btn outline" data-hub-action="install">Install Hoora Docs</button>';
    return `<main id="main" class="settings-content notifications-page"><div class="view-heading"><div><h1>Notifications</h1>${unread.length ? `<p>${unread.length} unread update${unread.length === 1 ? '' : 's'}</p>` : ''}</div><div class="notice-actions">${unread.length ? '<button class="btn outline" data-hub-action="mark-all-read">Mark all as read</button>' : ''}<button class="btn outline" data-hub-action="toggle-notice-history">${showAllNotices ? 'Show unread' : 'Show all'}</button></div></div><div class="notice-list">${
      visible
        .map((n) => {
          const p = state.published.find((p) => p.id === n.page_id);
          return p
            ? `<a class="notice-item ${seen.has(n.id) ? '' : 'unread'}" href="${publishedRoute(p, state.projects)}" data-notice-read="${n.id}"><span class="notice-dot"></span><div><h2>${e(noticeTitle(p))}</h2><p>Sent by ${e(n.sender_name)} · ${new Date(n.created_at).toLocaleString('en-IN')}</p></div><span class="notice-state">${seen.has(n.id) ? 'Read' : 'New'}</span>${icon('chevron')}</a>`
            : '';
        })
        .join('') ||
      `<div class="empty notice-empty"><h2>${showAllNotices ? 'No notifications yet' : 'You’re all caught up'}</h2><p>${showAllNotices ? 'Updates shared with you will appear here.' : 'New updates will appear here when a manager shares them.'}</p></div>`
    }</div><details class="notification-settings"><summary>Notification settings</summary><div class="notification-settings-card"><div><strong>Browser notifications</strong><p>${push.subscribed ? 'Enabled on this browser.' : push.permission === 'denied' ? 'Allow notifications in your browser settings to receive release updates.' : 'Get an alert when a release or document is shared with you.'}</p></div><div class="toolbar-actions">${pushAction}${installAction}</div></div></details></main>`;
  }
  function contributions() {
    const mine = state.pages.filter(
      (p) =>
        !p._readOnly &&
        (p.created_by === state.member.id ||
          state.entries.some((n) => n.release_id === p.id && n.author_id === state.member.id)),
    );
    const published = mine.filter((p) => state.published.some((x) => x.id === p.id));
    return `<main id="main" class="settings-content"><div class="view-heading"><div><h1>My contributions</h1><p>${published.length} published · ${mine.length - published.length} drafts</p></div><a href="#/new" class="btn dark">New document</a></div><div class="document-table">${
      mine
        .filter((p) => !p.archived_at)
        .map((p) => row(p, true))
        .join('') ||
      '<div class="empty"><h2>Your contributions start here</h2><p>Create a guide or add your notes to an application release.</p></div>'
    }</div></main>`;
  }
  function archive() {
    if (state.member.role !== 'admin') throw Error('Administrator access required.');
    const archived = state.pages.filter((p) => p.archived_at);
    return `<main id="main" class="settings-content"><div class="view-heading"><div><h1>Recycle bin</h1><p>Deleted knowledge is hidden immediately and permanently removed after 30 days.</p></div><button class="btn outline" data-hub-action="cleanup">Run cleanup</button></div>${archived.map((p) => `<div class="structure-row"><div><strong>${e(p.title)}</strong><small>Deleted ${new Date(p.deleted_at || p.archived_at).toLocaleDateString('en-IN')} · permanently removed ${p.purge_after ? new Date(p.purge_after).toLocaleDateString('en-IN') : 'after 30 days'}</small></div><button class="btn outline" data-hub-action="restore" data-id="${p.id}">Restore</button><button class="btn text danger" data-hub-action="delete" data-id="${p.id}">Delete permanently</button></div>`).join('') || '<div class="empty"><h2>Recycle bin is empty</h2><p>Deleted documents will remain here for 30 days before cleanup.</p></div>'}</main>`;
  }
  async function activity() {
    if (state.member.role !== 'admin') throw Error('Administrator access required.');
    const [records, people] = await Promise.all([
      db('docs_audit_log', '?select=*&order=created_at.desc&limit=200'),
      db('docs_members', '?select=id,name,email'),
    ]);
    return `<main id="main" class="settings-content"><div class="view-heading"><div><h1>Workspace activity</h1><p>Recent changes, access updates and document use. Edit snapshots are not retained.</p></div></div><div class="tablewrap"><table><thead><tr><th>Action</th><th>Person</th><th>Document</th><th>When</th></tr></thead><tbody>${records.map((r) => `<tr><td>${e(r.action.replace(/_/g, ' '))}</td><td>${e(people.find((p) => p.id === r.user_id)?.name || 'System / removed member')}</td><td>${e(state.pages.find((p) => p.id === r.page_id)?.title || '—')}</td><td>${new Date(r.created_at).toLocaleString('en-IN')}</td></tr>`).join('')}</tbody></table></div></main>`;
  }
  async function recent() {
    if (!state.member) return '';
    const pages = await db('rpc/docs_recent', '?select=id,title,slug', {
      method: 'POST',
      body: {},
    });
    return pages.length
      ? `<section class="recent-knowledge"><h2>Recently viewed</h2><div class="related-grid">${pages
          .slice(0, 4)
          .map(
            (p) =>
              `<a href="${publishedRoute(state.published.find((item) => item.id === p.id) || p, state.projects)}"><strong>${e(p.title)}</strong></a>`,
          )
          .join('')}</div></section>`
      : '';
  }
  async function action(button) {
    const type = button.dataset.hubAction,
      id = button.dataset.id,
      p = state.published.find((p) => p.id === id) || state.pages.find((p) => p.id === id);
    if (type === 'cleanup') {
      const result = await appApi('/api/content', { action: 'cleanup' });
      toast(
        result.cleanupPending
          ? 'Some deleted uploads still need cleanup. Try again shortly.'
          : 'Pending file deletions completed.',
      );
      return;
    }
    if (type === 'toggle-notice-history') {
      showAllNotices = !showAllNotices;
      await render();
      return;
    }
    if (type === 'mark-all-read') {
      const notices = await db('docs_notices', '?select=id'),
        reads = await db('docs_notice_reads', '?select=notice_id'),
        seen = new Set(reads.map((r) => r.notice_id)),
        unread = notices.filter((n) => !seen.has(n.id));
      await Promise.all(
        unread.map((n) =>
          db('docs_notice_reads', '', {
            method: 'POST',
            headers: { Prefer: 'resolution=ignore-duplicates' },
            body: { notice_id: n.id, user_id: state.member.id },
          }),
        ),
      );
      state.unreadNoticeCount = 0;
      showAllNotices = false;
      await render();
      toast('All notifications marked as read.');
      return;
    }
    if (type === 'install') {
      await pwa.install();
      await render();
      return;
    }
    if (type === 'push-enable') {
      await pwa.enable();
      await render();
      return;
    }
    if (type === 'push-disable') {
      await pwa.disable();
      await render();
      return;
    }
    if (type === 'notify') {
      dialog(
        `<h2>Notify readers?</h2><p>Send “${e(noticeTitle(p))}” to readers who can access this release and enabled browser notifications.</p><p class="small">Your name appears in Hoora Docs. You can notify about this release once every three hours. This does not send email.</p><form><p class="error" role="alert"></p><div class="dialog-actions"><button type="button" class="btn outline" data-close>Cancel</button><button class="btn dark">Notify readers</button></div></form>`,
        async () => {
          const result = await appApi('/api/push', { action: 'notify', id });
          toast(`Notification sent to ${result.delivered} browsers.`);
        },
      );
      return;
    }
    if (['archive', 'restore', 'delete'].includes(type)) {
      dialog(
        `<h2>${type === 'restore' ? 'Restore' : type === 'delete' ? 'Delete permanently' : 'Move to recycle bin'} this document?</h2><p>${e(p.title)}</p><p class="small">${type === 'restore' ? 'The document will be visible again according to its team permissions.' : type === 'delete' ? 'This permanently removes the document, published copy, and uploaded files now.' : 'The document will be hidden now and permanently removed after 30 days.'}</p><form><p class="error" role="alert"></p><div class="dialog-actions"><button type="button" class="btn outline" data-close>Cancel</button><button class="btn ${type === 'restore' ? 'dark' : 'danger'}">${type === 'restore' ? 'Restore' : type === 'delete' ? 'Delete permanently' : 'Archive'}</button></div></form>`,
        async () => {
          if (type === 'archive') await appApi('/api/content', { action: 'delete', id });
          else if (type === 'delete') await appApi('/api/content', { action: 'purge', id });
          else
            await db('rpc/docs_archive', '', {
              method: 'POST',
              body: { document_id: id, restore: type === 'restore' },
            });
          await load();
          location.hash = type === 'archive' ? '#/workspace' : '#/archive';
          await render();
          toast(
            'Document ' +
              (type === 'restore' ? 'restored' : type === 'delete' ? 'deleted' : 'archived') +
              '.',
          );
        },
      );
      return;
    }
    if (type === 'related') {
      const relations = await db(
          'docs_relationships',
          `?or=(source_id.eq.${id},target_id.eq.${id})&select=*`,
        ),
        ids = new Set(relations.map((r) => (r.source_id === id ? r.target_id : r.source_id)));
      dialog(
        `<h2>Related knowledge</h2><p class="small">Connections appear on both pages. Readers only see documents they can access.</p><form><div class="related-options">${
          state.published
            .filter((a) => a.id !== id)
            .map(
              (a) =>
                `<label><input type="checkbox" name="related" value="${a.id}" ${ids.has(a.id) ? 'checked' : ''}><span>${e(a.title)}</span></label>`,
            )
            .join('') || '<p>No other published pages yet.</p>'
        }</div><p class="error" role="alert"></p><div class="dialog-actions"><button type="button" class="btn outline" data-close>Cancel</button><button class="btn dark">Save connections</button></div></form>`,
        async (f) => {
          const selected = new Set(f.getAll('related'));
          for (const r of relations) {
            const other = r.source_id === id ? r.target_id : r.source_id;
            if (!selected.has(other))
              await db(
                'docs_relationships',
                `?source_id=eq.${r.source_id}&target_id=eq.${r.target_id}`,
                { method: 'DELETE' },
              );
          }
          for (const other of selected) {
            if (!ids.has(other)) {
              const [source_id, target_id] = [id, other].sort();
              await db('docs_relationships', '', {
                method: 'POST',
                body: { source_id, target_id, created_by: state.member.id },
              });
            }
          }
          await render();
          toast('Related knowledge updated.');
        },
      );
    }
  }
  async function markRead(id) {
    await db('docs_notice_reads', '', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates' },
      body: { notice_id: id, user_id: state.member.id },
    });
    state.unreadNoticeCount = Math.max(0, state.unreadNoticeCount - 1);
  }
  return { pageTools, hydrate, inbox, contributions, archive, activity, recent, action, markRead };
}
