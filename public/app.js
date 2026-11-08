import { icon } from './vendor/icons.js';
import { assistantAvatarMarkup } from './assistant-avatar.js';
import { moods } from './vendor/assistant-moods.js';
import { makerFeature } from './ui/maker.js';
import { createSearchService, searchResultsPage, bindSearchPage } from './search.js';
import { accountMenu, settingsLinks } from './ui/account.js';
import { documentActions, editorMenu, bindEditorMenus } from './ui/editor-actions.js';
import { pwaFeature } from './pwa.js';
import { sourcesFeature } from './sources.js';
import { workspaceFeatures } from './workspace-features.js';
import { routeHash, routeUrl, canonicalizeRoute, publishedRoute } from './router.js';
import { prepareUpload } from './vendor/uploads.js';
import { config } from './config.js';
import { teamsFeature } from './teams.js';
import { upcomingFeature } from './upcoming.js';
import { createFeedback } from './ui/feedback.js';
import { createContributionEditor, sectionStatus } from './editor/contribution.js';
import { bindEditorAssets } from './editor/assets.js';
import { bindResourcePreviews } from './ui/previews.js';
import { createNavigation } from './ui/navigation.js';
import { homePage } from './pages/home.js';
import { bindSourceFiles } from './editor/clipboard.js';
import { createLoading } from './ui/loading.js';
import {
  escapeHtml as e,
  slugify,
  markdown,
  markdownWithOutline,
  canEdit as canEditRole,
  canPublish as canPublishRole,
  versionKey,
  compareVersions,
  filterPages,
} from './lib.js';
bindEditorMenus();
let richEditorModule;
const loadRichEditor = () => (richEditorModule ||= import('./vendor/rich-editor.js'));
let documentRichEditor = null;
function richToolbar() {
  const buttons = [
    ['heading', 'Heading', 'heading'],
    ['bold', 'Bold', 'bold'],
    ['italic', 'Italic', 'italic'],
    ['strike', 'Strikethrough', 'strike'],
    ['bulletList', 'Bulleted list', 'list'],
    ['orderedList', 'Numbered list', 'ordered'],
    ['blockquote', 'Quote', 'quote'],
    ['codeBlock', 'Code block', 'code'],
    ['table', 'Insert table', 'table'],
    ['link', 'Link', 'link'],
  ];
  return `<div class="rich-toolbar" role="toolbar" aria-label="Text formatting">${buttons.map(([command, label, key]) => `<button type="button" data-rich-command="${command}" aria-label="${label}" aria-pressed="false" title="${label}">${icon(key)}</button>`).join('')}<span class="toolbar-divider" aria-hidden="true"></span><button type="button" data-editor-asset="file" aria-label="Insert image or file" title="Insert image or file">${icon('paperclip')}</button><button type="button" data-editor-asset="drawing" aria-label="Insert drawing" title="Insert drawing">${icon('edit')}</button></div>`;
}
const app = document.querySelector('#app'),
  modal = document.querySelector('#modal');
const feedback = createFeedback();
const toast = (message, error = false) => feedback.toast(message, error);
const vehicleLoading = createLoading({ app, element: document.querySelector('#vehicle-loader') });
const withVehicleLoader = (work) => vehicleLoading.during(work);
const names = {
  release: 'Release notes',
  sop: 'SOPs',
  documentation: 'Documentation',
};
const displayPlatformName = (name) => String(name || '');
const descriptions = {
  release: 'What’s new, what’s improved, and what’s next across Hoora.',
  sop: 'Clear, repeatable processes. Everything you need to get it right.',
  documentation: 'Explore guides, references, and the details behind our work.',
};
const sharedDocumentTarget = (value = routeHash()) => {
  const target = String(value || '').split('?')[0];
  return /^#\/(?:doc|artifact|release-notes)\//.test(target) ? String(value) : '';
};
const completeLoginRoute = () => {
  const target = sharedDocumentTarget(sessionStorage.getItem('hoora-return-to'));
  sessionStorage.removeItem('hoora-return-to');
  return target || '#/home';
};
const state = {
  session: null,
  member: null,
  types: [],
  published: [],
  pages: [],
  verticals: [],
  folders: [],
  query: '',
  kind: '',
  vertical: '',
  section: '',
  status: '',
  members: [],
  projects: [],
  projectSections: null,
  releases: [],
  entries: [],
  requests: [],
  unreadNoticeCount: 0,
  pendingRequestCount: 0,
  teams: [],
  teamMembers: [],
  teamPermissions: [],
  pageTeamAccess: [],
  dirty: false,
};
let renderId = 0;
const navigation = createNavigation({
  app,
  state,
  contextRail: (route) =>
    settingsRoutes.includes(route)
      ? settingsSidebar(route)
      : route === 'contributions'
        ? sidebar(true)
        : '',
});
const assistantMessages = [];
let assistantOpen = false;
let assistantBusy = false;
const assistantCache = new Map();
const assistantAvatar = (className = '') =>
  `<span class="assistant-inline-avatar ${className}" aria-hidden="true">${assistantAvatarMarkup}</span>`;
// Hoora Assist's face: thinking while it searches, a reaction to each answer, a new
// expression on every tap, and sleepy when left alone. Poses morph through blobatar's CSS.
const tapMoods = [
  'happy',
  'wink',
  'surprised',
  'love',
  'smug',
  'shy',
  'unsure',
  'sleepy',
  'sad',
  'scared',
  'mad',
  'sick',
];
const moodProperties = [...new Set(Object.values(moods).flatMap((mood) => Object.keys(mood.vars)))];
let assistantExpression = 'idle';
let tapMood = -1;
let moodTimer = 0;
let sleepTimer = 0;
function paintMood() {
  const mood = moods[assistantExpression] || moods.idle;
  for (const face of document.querySelectorAll('.assistant-blobatar')) {
    face.getBoundingClientRect(); // a face drawn this frame morphs instead of snapping
    for (const property of moodProperties) face.style.removeProperty(property);
    for (const [property, value] of Object.entries(mood.vars))
      face.style.setProperty(property, value);
    face.style.setProperty('--mo-head', mood.head);
    face.style.setProperty('--mo-eye', mood.eye);
    face.classList.toggle('mo-expr', assistantExpression !== 'idle');
  }
}
function setAssistantMood(name, holdFor = 0) {
  window.clearTimeout(moodTimer);
  assistantExpression = name;
  paintMood();
  if (holdFor)
    moodTimer = window.setTimeout(
      () => setAssistantMood(assistantBusy ? 'thinking' : 'idle'),
      holdFor,
    );
}
function nextTapMood() {
  tapMood = (tapMood + 1) % tapMoods.length;
  setAssistantMood(tapMoods[tapMood], 1800);
}
function restartSleepTimer() {
  window.clearTimeout(sleepTimer);
  if (assistantOpen)
    sleepTimer = window.setTimeout(() => {
      if (!assistantBusy) setAssistantMood('sleepy');
    }, 45000);
}
// Answers are plain text with light Markdown: escape first, then format.
const assistantText = (text) =>
  e(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^- /gm, '• ')
    .replace(/\n/g, '<br>');
function assistantUI() {
  const route = routeHash();
  if (
    route.startsWith('#/login') ||
    route.startsWith('#/install') ||
    route.startsWith('#/new') ||
    route.startsWith('#/edit/') ||
    route.startsWith('#/contribute/') ||
    (route.startsWith('#/upcoming') &&
      (route.split('?')[0].endsWith('/settings') ||
        new URLSearchParams(route.split('?')[1]).get('create') === '1')) ||
    route.startsWith('#/artifact/') ||
    route.startsWith('#/preview/')
  )
    return '';
  const messageMarkup = assistantMessages.length
    ? assistantMessages
        .map((m) => {
          if (m.thinking)
            return `<div class="assistant-message assistant thinking" role="status" aria-live="polite">${assistantAvatar('thinking-avatar')}<span class="assistant-working"><span class="assistant-working-label">Thinking<span class="assistant-thinking-dots" aria-hidden="true"></span></span></span></div>`;
          const sources = m.sources?.length
            ? `<nav class="assistant-actions" aria-label="Related documentation"><span class="assistant-actions-label">Sources</span>${m.sources.map((s) => `<a class="assistant-action" href="${e(s.url)}">${icon('book')}<span>[${s.number}] ${e(s.title)}</span>${icon('chevron')}</a>`).join('')}</nav>`
            : '';
          const tickets = m.tickets?.length
            ? `<nav class="assistant-actions" aria-label="Related Jira tickets"><span class="assistant-actions-label">Related tickets</span>${m.tickets.map((t) => `<a class="assistant-action assistant-ticket" href="${e(t.url)}" target="_blank" rel="noopener noreferrer">${icon('external')}<span>${e(t.key)}</span>${icon('chevron')}</a>`).join('')}</nav>`
            : '';
          const avatar = m.role === 'assistant' ? assistantAvatar('assistant-response-avatar') : '';
          return `<div class="assistant-message ${m.role}">${avatar}<div class="assistant-response-body"><div class="assistant-copy">${assistantText(m.text)}</div>${sources}${tickets}</div></div>`;
        })
        .join('')
    : `<div class="assistant-message assistant assistant-welcome">${assistantAvatar('assistant-response-avatar')}<div class="assistant-response-body"><div class="assistant-copy"><strong>${e(
        `${new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 18 ? 'Good afternoon' : 'Good evening'}${state.member?.name ? `, ${state.member.name}` : ''}!`,
      )}</strong><span>How can I help you today with releases, SOPs, or documentation?</span></div></div></div>`;
  return `<div class="assistant-shell"><button type="button" class="assistant-trigger" data-assistant="toggle" aria-label="Hoora Assist" aria-expanded="${assistantOpen}">${assistantAvatar()}<span>Hoora Assist</span></button><section class="assistant-panel" aria-label="Hoora Assist knowledge assistant" ${assistantOpen ? '' : 'hidden'}><div class="assistant-header"><div class="assistant-brand"><button type="button" class="assistant-face" data-assistant="mood" aria-label="Change Hoora Assist’s expression">${assistantAvatar()}</button><div><strong>Hoora Assist</strong><small>Ask me about releases, SOPs and documentation.</small></div></div><button class="iconbtn" type="button" data-assistant="toggle" aria-label="Close assistant">${icon('close')}</button></div><div class="assistant-messages" aria-live="polite">${messageMarkup}</div><form class="assistant-form" id="assistant-form"><div class="assistant-composer"><label class="sr-only" for="assistant-question">Your question</label><input id="assistant-question" name="question" maxlength="500" autocomplete="off" placeholder="Ask about a release, SOP or document…" required><button type="submit" aria-label="Send question" title="Send">${icon('arrow')}</button></div></form></section></div>`;
}
function syncAssistantViewport() {
  const viewport = window.visualViewport;
  document.documentElement.style.setProperty(
    '--assistant-height',
    (viewport?.height || innerHeight) + 'px',
  );
  document.documentElement.style.setProperty('--assistant-top', (viewport?.offsetTop || 0) + 'px');
  document.body.classList.toggle(
    'assistant-open',
    assistantOpen && matchMedia('(max-width:700px)').matches,
  );
}
window.visualViewport?.addEventListener('resize', syncAssistantViewport);
window.visualViewport?.addEventListener('scroll', syncAssistantViewport);
window.addEventListener('resize', syncAssistantViewport);
function renderAssistant() {
  const old = document.querySelector('.assistant-shell');
  if (!old) return;
  const input = old.querySelector('input'),
    draft = input?.value || '',
    focused = document.activeElement === input;
  const scroll = old.querySelector('.assistant-messages'),
    atBottom = !scroll || scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 80,
    scrollTop = scroll?.scrollTop || 0;
  old.outerHTML = assistantUI();
  const next = document.querySelector('#assistant-question');
  if (next) {
    next.value = draft;
    if (focused && assistantOpen) next.focus({ preventScroll: true });
  }
  const messages = document.querySelector('.assistant-messages');
  if (messages) messages.scrollTop = atBottom ? messages.scrollHeight : scrollTop;
  syncAssistantViewport();
  window.requestAnimationFrame(paintMood);
}
const canEdit = (role) =>
  canEditRole(role) ||
  role === 'manager' ||
  (role === 'viewer' &&
    state.teamMembers.some(
      (m) =>
        m.email === state.member?.email?.toLowerCase() &&
        ['manager', 'publisher', 'contributor'].includes(m.role),
    ));
const canPublish = (role) => canPublishRole(role) || role === 'manager' || canEdit(role);
const canEditEntry = (entry) =>
  state.member?.role === 'admin' || entry?.author_id === state.member?.id;
const teams = teamsFeature({
  state,
  db: (...args) => db(...args),
  e,
  dialog: (...args) => dialog(...args),
  toast,
  load,
  render,
  icon,
  row,
});
const searchService = createSearchService((...args) => db(...args));
const pwa = pwaFeature({ appApi, getToken, toast });
window.addEventListener('hoora-app-installed', () => {
  if (state.member?.password_setup_complete) pwa.recordInstall().catch(() => {});
  if (routeHash().split('?')[0] === '#/install') render();
});
const sources = sourcesFeature({
  state,
  db: (...args) => db(...args),
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
});
const features = workspaceFeatures({
  icon,
  state,
  db: (...args) => db(...args),
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
});
const upcoming = upcomingFeature({
  state,
  appApi,
  e,
  icon,
  dialog,
  modal,
  toast,
  render,
  rail: () => releaseSidebar({ upcomingActive: true }),
});
const contributionEditor = createContributionEditor({
  state,
  e,
  icon,
  toneIcon,
  date: (value) => date(value),
  options,
  editorMenu,
  richToolbar,
  markdown,
  loadRichEditor,
  resolveImage: resolveEditorImage,
  upload: uploadFile,
  db: (...args) => db(...args),
  load,
  toast,
  hydrateImages,
  canEdit,
  canEditEntry,
  canPublish,
  onPublished: (id) => appApi('/api/ai-index', { documentId: id }).catch(() => {}),
});
bindEditorAssets({
  getEditor: () =>
    document.querySelector('#contribution-form') ? contributionEditor.editor : documentRichEditor,
  upload: uploadFile,
  resolveImage: resolveEditorImage,
  toast,
});
bindResourcePreviews();
try {
  state.session = JSON.parse(localStorage.getItem('hoora-session'));
} catch {
  localStorage.removeItem('hoora-session');
}
const date = (s) =>
  s
    ? new Date(s).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : '';
const verticalName = (id) => state.verticals.find((v) => v.id === id)?.name || 'General';
function saveSession(session) {
  state.session = session;
  if (session) localStorage.setItem('hoora-session', JSON.stringify(session));
  else {
    localStorage.removeItem('hoora-session');
    localStorage.removeItem('hoora-avatar');
    sessionStorage.removeItem('hoora-avatar');
  }
}
function memberAvatar() {
  const cached = state.member?.id ? localStorage.getItem(`hoora-avatar:${state.member.id}`) : null;
  const photo = state.member?.avatar_data || cached;
  return photo && /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(photo)
    ? `<img src="${photo}" alt="" class="member-photo">`
    : e((state.member?.name || state.member?.email || 'HO').slice(0, 2).toUpperCase());
}
let refreshing;
const authHeaders = (token) => (token ? { Authorization: 'Bearer ' + token } : {});
async function getToken() {
  if (!state.session) return config.key.startsWith('sb_publishable_') ? null : config.key;
  if ((state.session.expires_at || 0) > Date.now() / 1000 + 60) return state.session.access_token;
  if (!refreshing)
    refreshing = (async () => {
      const r = await fetch(config.url + '/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        headers: { apikey: config.key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: state.session.refresh_token }),
      });
      const d = await r.json();
      if (!r.ok) {
        saveSession(null);
        sessionStorage.removeItem('hoora-outlook-token');
        searchService.clear();
        state.member = null;
        throw new Error('Your session expired. Please sign in again.');
      }
      saveSession({ ...d, expires_at: Date.now() / 1000 + d.expires_in });
      return d.access_token;
    })().finally(() => (refreshing = null));
  return refreshing;
}
async function api(path, { method = 'GET', body, headers = {}, authRetry = 0 } = {}) {
  const token = await getToken();
  const r = await fetch(config.url + path, {
    method,
    headers: {
      apikey: config.key,
      ...authHeaders(token),
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let d;
  try {
    d = text ? JSON.parse(text) : null;
  } catch {
    d = null;
  }
  if (!r.ok && /JWT issued at future/i.test(d?.message || d?.msg || '') && authRetry < 2) {
    await new Promise((resolve) => setTimeout(resolve, 1000 * (authRetry + 1)));
    return api(path, { method, body, headers, authRetry: authRetry + 1 });
  }
  if (!r.ok && d?.code === '23505')
    throw new Error('This name, version or page URL is already in use. Choose a different one.');
  if (!r.ok)
    throw new Error(
      d?.message || d?.msg || d?.error_description || 'Unable to connect. Please try again.',
    );
  return d;
}
const db = (table, query = '', options = {}) => api('/rest/v1/' + table + query, options);
async function admin(body) {
  const token = await getToken();
  const r = await fetch('/api/admin', {
    method: body ? 'POST' : 'GET',
    headers: {
      ...authHeaders(token),
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'User management failed.');
  return d;
}
async function load() {
  searchService.clear();
  const [types, verticals, published] = await Promise.all([
    db('docs_types', '?select=*&order=name'),
    db('docs_verticals', '?select=*&order=name'),
    db('docs_published_index', '?select=*&order=published_at.desc'),
  ]);
  state.types = types;
  Object.keys(names).forEach((k) => delete names[k]);
  types.forEach((t) => {
    names[t.key] = t.name;
  });
  state.verticals = verticals;
  state.published = published;
  state.aliases = await db('docs_slug_aliases', '?select=*');
  state.member = null;
  state.pages = [];
  state.folders = [];
  state.projects = [];
  state.projectSections = [];
  state.entries = [];
  state.releases = [];
  state.requests = [];
  state.unreadNoticeCount = 0;
  state.pendingRequestCount = 0;
  state.teams = [];
  state.teamMembers = [];
  state.teamPermissions = [];
  state.pageTeamAccess = [];
  if (state.session) {
    const members = await db('docs_members', `?id=eq.${state.session.user.id}&select=*`);
    state.member = members[0]?.active ? members[0] : null;
    if (state.member && state.member.password_setup_complete) {
      [state.teams, state.teamMembers, state.teamPermissions, state.pageTeamAccess] =
        await Promise.all([
          db('docs_teams', '?select=*&order=name'),
          db('docs_team_members', '?select=*&order=email'),
          db('docs_team_permissions', '?select=*&order=created_at.desc'),
          db('docs_page_team_access', '?select=page_id,team_id'),
        ]);
      [state.pages, state.folders] = await Promise.all([
        canEdit(state.member.role)
          ? db(
              'docs_pages',
              '?select=id,title,slug,kind,vertical_id,folder_id,summary,version,tags,created_by,updated_by,revision,created_at,updated_at,format,artifact_path,visibility,custom_fields,team_id,deleted_at,purge_after,source_url,source_type,file_metadata&order=updated_at.desc',
            )
          : Promise.resolve(state.published.map((p) => ({ ...p, updated_at: p.published_at }))),
        db('docs_folders', '?select=*&order=name'),
      ]);
      const writableIds = new Set(state.pages.map((p) => p.id));
      if (canEdit(state.member.role))
        state.pages.push(
          ...state.published
            .filter((p) => !writableIds.has(p.id))
            .map((p) => ({ ...p, _readOnly: true, updated_at: p.published_at })),
        );
      [state.projects, state.releases, state.entries, state.requests] = await Promise.all([
        db('docs_projects', '?select=*&order=name'),
        db('docs_releases', '?select=*'),
        db(
          'docs_entries',
          '?select=id,release_id,vertical_id,submitted,author_id,author_name,updated_by,updated_name,revision,created_at,updated_at&order=created_at',
        ),
        db('docs_requests', '?select=*&order=created_at.desc'),
      ]);
      state.pendingRequestCount = state.requests.filter(
        (r) =>
          r.status === 'pending' &&
          (state.member.role === 'admin' ||
            (state.member.role === 'publisher' && r.kind === 'publish')),
      ).length;
      try {
        const [notices, reads] = await Promise.all([
          db('docs_notices', '?select=id,page_id'),
          db('docs_notice_reads', '?select=notice_id'),
        ]);
        const seen = new Set(reads.map((r) => r.notice_id));
        state.unreadNoticeCount = notices.filter(
          (n) => !seen.has(n.id) && state.published.some((p) => p.id === n.page_id),
        ).length;
      } catch {
        state.unreadNoticeCount = 0;
      }
      state.projectSections = await db('docs_project_sections', '?select=*&order=sort_order.asc');
    }
  }
}
async function hydrateRoute(route, id) {
  if (!id) return;
  if (route === 'doc' || route === 'artifact') {
    const slug = decodeURIComponent(id),
      alias = state.aliases?.find((a) => a.slug === slug);
    const index = state.published.findIndex(
      (p) => p.slug === slug || (alias && p.id === alias.page_id),
    );
    if (index < 0) return;
    const rows = await db('docs_published', '?id=eq.' + state.published[index].id + '&select=*');
    if (rows[0]) state.published[index] = rows[0];
  } else if (route === 'edit' || route === 'preview' || route === 'contribute') {
    const index = state.pages.findIndex((p) => p.id === id);
    if (index < 0 || state.pages[index]._readOnly) return;
    const rows = await db('docs_pages', '?id=eq.' + id + '&select=*');
    if (rows[0]) {
      rows[0]._canPublish = await db('rpc/docs_can_publish_page_for', '', {
        method: 'POST',
        body: { document_id: id, viewer_id: state.member.id },
      });
      state.pages[index] = rows[0];
    }
    if (state.releases.some((r) => r.id === id)) {
      const entries = await db(
        'docs_entries',
        '?release_id=eq.' + id + '&select=*&order=created_at',
      );
      state.entries = [...state.entries.filter((n) => n.release_id !== id), ...entries];
    }
  }
}
/** The primary area (home, releases, library, search…) the current route belongs to. */
function primaryArea() {
  const [path, query = ''] = routeHash().replace(/^#/, '').split('?');
  const [section = 'home', id] = path.split('/').filter(Boolean);
  if (['releases', 'release-notes', 'contribute', 'upcoming'].includes(section)) return 'releases';
  if (section === 'doc' && state.published.some((p) => p.slug === id && p.kind === 'release'))
    return 'releases';
  if (['workspace', 'browse', 'doc', 'edit', 'new', 'contributions', 'preview'].includes(section))
    return new URLSearchParams(query).get('kind') === 'release' ||
      (['edit', 'preview'].includes(section) && state.releases.some((r) => r.id === id))
      ? 'releases'
      : 'library';
  return section;
}
function header() {
  if (
    (routeHash().startsWith('#/artifact/') || routeHash().startsWith('#/preview/')) &&
    state.nativeTitle &&
    document.body.dataset.route !== 'edit'
  )
    return `<header class="topbar artifact-app-header"><a class="btn text" href="${e(state.nativeBack)}">${icon('back')}Back</a><strong>${e(state.nativeTitle)}</strong>${state.nativeDraft ? '<span class="badge draft">Draft preview</span>' : ''}<div><button class="iconbtn" data-action="native-fullscreen" aria-label="Enter fullscreen">${icon('expand')}</button><button class="iconbtn" data-action="download-artifact" aria-label="Download original HTML">${icon('download')}</button></div></header>`;
  const route = routeHash().split('?')[0];
  const auth = route === '#/login' || route === '#/app-welcome';
  const native = route.startsWith('#/artifact/') || route.startsWith('#/preview/');
  const area = primaryArea();
  const signedIn = state.member && !auth && !native;
  const primary = signedIn
    ? `<nav class="topbar-nav" aria-label="Primary">${[
        ['home', '#/home', 'Home'],
        ['releases', '#/releases', 'Release notes'],
        ['library', canEdit(state.member.role) ? '#/workspace' : '#/browse', 'Library'],
      ]
        .map(
          ([key, href, label]) =>
            `<a href="${href}" class="${area === key ? 'active' : ''}" ${area === key ? 'aria-current="page"' : ''}>${label}</a>`,
        )
        .join('')}</nav>`
    : '';
  const theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  const unread = state.unreadNoticeCount;
  const bell = `<a class="iconbtn notification-bell" href="#/notifications" aria-label="Notifications${unread ? `, ${unread} unread` : ''}">${icon('bell')}${unread ? `<span class="notification-count" aria-hidden="true">${unread > 99 ? '99+' : unread}</span>` : ''}</a>`;
  const right = signedIn
    ? `${['home', 'search'].includes(area) ? '' : `<a class="topbar-search" href="#/search" aria-label="Search Hoora Docs">${icon('search')}<span>Search</span><kbd>Ctrl K</kbd></a>`}${bell}${accountMenu({ state, e, icon, avatar: memberAvatar(), theme })}`
    : `<button class="iconbtn" data-action="theme" aria-label="Switch light or dark theme">${icon(theme === 'dark' ? 'sun' : 'moon')}</button>${!state.member && !auth ? '<a class="btn dark" data-header-login href="#/login">Sign in</a>' : ''}`;
  return `<header class="topbar"><div class="topbar-left">${!auth && !native ? `<button class="iconbtn mobile-menu" data-action="menu" aria-label="Open section navigation">${icon('menu')}</button>` : ''}<a class="product-brand" href="#/home"><img class="logo-light" src="/hoora-light.png" alt="Hoora"><img class="logo-dark" src="/hoora-dark.png" alt="Hoora"></a>${primary}</div><div class="topbar-right">${right}</div></header>`;
}
function enhanceRail() {
  navigation.prepare();
  const rail = app.querySelector('.layout>.sidebar');
  document.body.classList.toggle('has-rail', !!rail);
  if (!rail) {
    document.body.classList.remove('rail-collapsed');
    return;
  }
  const pinned = localStorage.getItem('hoora-rail-pinned') !== 'false';
  document.body.classList.toggle('rail-collapsed', !pinned);
  const railLogo =
    document.documentElement.dataset.theme === 'dark' ? '/hoora-dark.png' : '/hoora-light.png';
  rail.insertAdjacentHTML(
    'afterbegin',
    `<div class="rail-brand"><a href="#/home" aria-label="Hoora Docs home"><img class="rail-logo" src="${railLogo}" alt="Hoora"><span class="rail-product-name">Docs</span></a><button type="button" class="iconbtn rail-toggle" data-action="rail-toggle" aria-label="${pinned ? 'Allow sidebar to collapse' : 'Keep sidebar expanded'}" title="${pinned ? 'Allow sidebar to collapse' : 'Keep sidebar expanded'}">${icon(pinned ? 'panelClose' : 'panelOpen')}</button></div>`,
  );
  if (!document.documentElement.dataset.railPointerListener) {
    document.documentElement.dataset.railPointerListener = 'true';
    document.addEventListener(
      'pointerout',
      (event) => {
        const rail = event.target.closest?.('.sidebar');
        if (rail && !rail.contains(event.relatedTarget))
          document.body.classList.remove('rail-hover-suppressed');
      },
      { passive: true },
    );
  }
}

/** Settings pages share one sidebar: personal items first, administration after. */
const settingsRoutes = [
  'account',
  'teams',
  'requests',
  'users',
  'folders',
  'activity',
  'feedback',
  'archive',
];
const maker = makerFeature({
  state,
  e,
  icon,
  dialog: (...args) => dialog(...args),
  modal,
  toast: (...args) => toast(...args),
  db: (...args) => db(...args),
  upload: uploadFeedbackScreenshot,
  isInstalled: () => isStandaloneApp(),
});
/** A screenshot for a report: compressed to WebP, stored in the reporter's own folder. */
async function uploadFeedbackScreenshot(file) {
  const image = await prepareUpload(file);
  if (image.type !== 'image/webp') throw new Error('Choose an image for the screenshot.');
  const path = `feedback/${state.member.id}/${crypto.randomUUID()}.webp`;
  const r = await fetch(config.url + '/storage/v1/object/hoora-docs/' + path, {
    method: 'POST',
    headers: { apikey: config.key, ...authHeaders(await getToken()), 'Content-Type': 'image/webp' },
    body: image,
  });
  if (!r.ok)
    throw new Error(
      (await r.json().catch(() => ({}))).message || 'The screenshot could not be uploaded.',
    );
  return path;
}
function settingsSidebar(route) {
  const links = settingsLinks(state.member, state.pendingRequestCount);
  const personal = links.filter(([key]) => ['account', 'teams', 'requests'].includes(key));
  const admin = links.filter(([key]) => !['account', 'teams', 'requests'].includes(key));
  const link = ([key, glyph, label, count]) =>
    `<a class="sidelink ${route === key ? 'active' : ''}" href="#/${key}" ${route === key ? 'aria-current="page"' : ''}>${icon(glyph)}<span>${label}</span>${count ? `<small class="nav-count">${Math.min(99, count)}</small>` : ''}</a>`;
  return `<aside class="sidebar settings-sidebar" aria-label="Settings"><div class="rail-label">Settings</div>${personal.map(link).join('')}${admin.length ? `<div class="rail-label">Administration</div>${admin.map(link).join('')}` : ''}</aside>`;
}

/** Phones and the installed app: primary destinations in a bottom tab bar. */
function footer() {
  const route = routeHash().split('?')[0].split('/')[1] || 'home';
  // Writing screens keep the full height; their breadcrumbs lead back.
  if (
    !state.member ||
    [
      'login',
      'install',
      'app-welcome',
      'artifact',
      'preview',
      'new',
      'edit',
      'contribute',
    ].includes(route)
  )
    return '';
  const area = primaryArea();
  const library = canEdit(state.member.role) ? '#/workspace' : '#/browse';
  const tabs = [
    ['#/home', 'grid', 'Home'],
    ['#/releases', 'release', 'Releases'],
    [library, 'book', 'Library'],
    ['#/search', 'search', 'Search'],
  ];
  return `<nav class="tabbar" aria-label="Primary">${tabs.map(([href, glyph, label]) => `<a href="${href}" class="${area === { Home: 'home', Releases: 'releases', Library: 'library', Search: 'search' }[label] ? 'active' : ''}">${icon(glyph)}<span>${label}</span></a>`).join('')}</nav>`;
}
function sidebar(workspace = false) {
  const role = state.member?.role;
  const base = workspace ? '#/workspace' : '#/browse';
  const docs = (workspace ? state.pages : state.published).filter(
    (p) => !p.deleted_at && p.kind !== 'release',
  );
  const count = (kind) => docs.filter((p) => p.kind === kind).length;
  const folderLinks = (parent = null, depth = 0) =>
    state.folders
      .filter((f) => f.parent_id === parent)
      .map(
        (f) =>
          `<a class="sidelink ${state.folder === f.id ? 'active' : ''}" style="--depth:${depth}" href="${base}?folder=${e(f.slug || f.id)}">${icon('folder')}<span>${e(f.name)}</span></a>${depth < 12 ? folderLinks(f.id, depth + 1) : ''}`,
      )
      .join('');
  const collections = state.types
    .filter((t) => t.key !== 'release')
    .map(
      (t) =>
        `<a class="sidelink ${state.kind === t.key ? 'active' : ''}" href="${base}?kind=${t.key}">${toneIcon(t.icon, t.color)}<span>${e(t.name)}</span><small>${count(t.key)}</small></a>`,
    )
    .join('');
  const folders = folderLinks();
  const teamLinks = state.teams
    .map(
      (t) =>
        `<a class="sidelink ${state.team === t.id ? 'active' : ''}" href="${base}?team=${e(t.slug)}">${icon('users')}<span>${e(t.name)}</span></a>`,
    )
    .join('');
  return `<aside class="sidebar library-sidebar" aria-label="Library navigation"><a class="sidelink ${!state.kind && !state.folder && !state.team ? 'active' : ''}" href="${base}">${icon('grid')}<span>All documents</span><small>${docs.length}</small></a>${collections}${teamLinks ? `<div class="rail-label">Teams</div>${teamLinks}` : ''}${folders ? `<div class="rail-label">Folders</div>${folders}` : ''}${workspace && canEdit(role) ? `<a class="sidelink my-contributions" href="#/contributions">${icon('edit')}<span>My contributions</span></a>` : ''}</aside>`;
}

function row(p, internal = false) {
  const pub = state.published.find((x) => x.id === p.id),
    type = state.types.find((t) => t.key === p.kind) || {};
  const edit = internal && canEdit(state.member?.role) && !p._readOnly;
  const href = `#/${edit ? 'edit/' + p.id : 'doc/' + p.slug}`;
  // Only exceptions are labelled: drafts, unpublished edits and restricted access.
  const status = internal
    ? !pub
      ? 'Draft'
      : pub.revision !== p.revision
        ? 'Unpublished changes'
        : ''
    : '';
  const access = pageAccess(p) === 'private' ? '' : accessText(p);
  const flags = [status, access].filter(Boolean);
  return `<div class="document-row">${toneIcon(p.format === 'html' ? 'code' : type.icon, type.color)}<div class="document-row-content"><a href="${href}">${e(p.title)}</a>${flags.length ? flags.map((flag) => `<span class="badge draft">${e(flag)}</span>`).join('') : ''}<p>${e(p.summary || (p.format === 'html' ? 'HTML artifact' : type.name || 'Document'))}</p></div><time>${date(p.updated_at || p.published_at)}</time><a class="iconbtn" href="${href}" aria-label="${edit ? 'Edit' : 'Read'} ${e(p.title)}">${icon('chevron')}</a></div>`;
}

function empty(title, text, action = '') {
  return `<div class="empty">${icon('book')}<h3>${e(title)}</h3><p>${e(text)}</p>${action}</div>`;
}
function workspace() {
  const pages = filterPages(state.pages, state)
    .filter((p) => !p.deleted_at && p.kind !== 'release')
    .filter((p) => !state.team || p.team_id === state.team)
    .filter(
      (p) =>
        !state.status ||
        (state.status === 'draft'
          ? !state.published.some((x) => x.id === p.id)
          : state.published.some((x) => x.id === p.id)),
    );
  const title =
    (state.folder
      ? state.folders.find((f) => f.id === state.folder)?.name
      : state.team
        ? state.teams.find((t) => t.id === state.team)?.name
        : names[state.kind]) || 'All documents';
  return `<div class="layout">${sidebar(true)}<main id="main" class="library-content"><div class="view-heading library-heading"><div><h1>${e(title)}</h1></div>${canEdit(state.member.role) ? `<div class="toolbar-actions"><a class="btn dark" href="#/new" aria-label="New document">${icon('plus')}<span>New<span class="wide-only"> document</span></span></a>${editorMenu(icon, `<button type="button" data-action="quick-asset">${icon('link')}<span>Add link or PDF</span></button><button type="button" data-action="import-document">${icon('upload')}<span>Import a file</span></button>`)}</div>` : ''}</div><div class="library-tools"><label class="search compact">${icon('search')}<input id="workspace-search" type="search" placeholder="Search this collection…" aria-label="Search workspace" value="${e(state.query)}"></label><select id="status-filter" aria-label="Filter by publication status"><option value="">All statuses</option><option value="draft" ${state.status === 'draft' ? 'selected' : ''}>Drafts</option><option value="published" ${state.status === 'published' ? 'selected' : ''}>Published</option></select></div><div class="document-table"><div id="document-list">${pages.map((p) => row(p, true)).join('') || empty('No documents here yet', 'Create a document or choose another collection.')}</div></div></main></div>`;
}

function login() {
  const microsoft =
    '<button class="btn email-choice" type="button" data-action="microsoft-login">' +
    icon('microsoft') +
    'Continue with Microsoft</button>';
  return (
    '<main id="main" class="signin-page"><div class="signin-card"><h1>Continue to Hoora Docs</h1><section id="login-methods"><button class="btn microsoft" type="button" data-action="microsoft-login">' +
    icon('microsoft') +
    'Continue with Microsoft</button><div class="signin-divider">or</div><button class="btn email-choice" type="button" data-action="email-login">Continue with email</button><p class="signin-note">First time here? Use Microsoft.</p></section><form id="login-form" hidden><div class="field"><label for="email">Work email</label><input id="email" name="email" type="email" autocomplete="username" placeholder="you@hoora.me" required></div><div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required></div><p id="form-error" class="error" role="alert"></p><button class="btn dark" id="login-submit" type="submit">Continue</button><div class="signin-divider">or</div>' +
    microsoft +
    '<p class="signin-note">First time here? Use Microsoft.</p></form></div></main>'
  );
}

function appWelcome() {
  const available =
      'Notification' in window && 'PushManager' in window && 'serviceWorker' in navigator,
    denied = available && Notification.permission === 'denied';
  return `<main id="main" class="signin-page app-welcome-page"><section class="signin-card app-welcome-card"><span class="app-welcome-icon">${icon('bell')}</span><h1>${denied ? 'Notifications are off' : 'Stay in the loop'}</h1><p>${denied ? 'Notifications are blocked in this browser. You can enable them later in browser settings.' : 'Get a small alert when your team shares a release or document update.'}</p><button type="button" class="btn dark app-welcome-primary" data-action="${available && !denied ? 'app-enable-notifications' : 'app-continue'}">${available && !denied ? 'Turn on notifications' : 'Continue to Hoora Docs'}</button>${available && !denied ? '<button type="button" class="app-welcome-dismiss" data-action="app-continue">Not now</button>' : ''}</section></main>`;
}
function isStandaloneApp() {
  return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}
function finishAppWelcome() {
  if (state.member) {
    localStorage.setItem(`hoora-pwa-onboarding:${state.member.id}`, 'complete');
    localStorage.setItem('hoora-pwa-onboarding-complete', 'true');
  }
  location.hash = completeLoginRoute();
}
function installPage() {
  const standalone =
    matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const signedIn = !!state.member;
  const primaryAction = standalone
    ? signedIn
      ? 'enable-install-notifications'
      : 'install-notifications-login'
    : 'install-app';
  const primaryLabel = standalone
    ? signedIn
      ? 'Enable notifications'
      : 'Continue with Microsoft'
    : 'Install Now';
  const primaryIcon = standalone ? (signedIn ? 'bell' : 'microsoft') : 'download';
  return `<main id="main" class="install-page"><section class="install-card"><div class="install-mark-wrap"><img class="install-mark" src="/hoora-mark.png" alt=""></div><h1>Hoora Docs</h1><p class="install-lede">Install on your phone or computer for faster access and a cleaner app experience.</p><button class="btn install-primary" type="button" data-action="${primaryAction}">${icon(primaryIcon)}${primaryLabel}</button><div class="install-divider"><span>OR</span></div><a class="btn install-browser" href="#/releases">Continue in Browser ${icon('arrow')}</a></section></main>`;
}
function home() {
  return homePage({
    state,
    e,
    icon,
    platformName: displayPlatformName,
    versionKey,
    date,
    link: (page) => publishedRoute(page, state.projects),
  });
}

function artifactFrame(page, draft = false, full = false) {
  return `<section class="artifact-card ${full ? 'artifact-full' : ''}"><div class="artifact-toolbar"><div class="browser-dots"><span></span><span></span><span></span></div><span class="artifact-filename">${e(
    page.artifact_path
      ?.split('/')
      .at(-1)
      ?.replace(/^[a-f0-9-]{37}/, '') || 'HTML artifact',
  )}</span><span class="isolation-label">Isolated preview</span><button class="iconbtn" data-action="reload-artifact" aria-label="Reload artifact">${icon('reload')}</button>${!draft && !full ? `<a class="iconbtn" href="#/artifact/${e(page.slug)}" aria-label="Open artifact in full page">${icon('expand')}</a>` : ''}<button class="iconbtn" data-action="download-artifact" aria-label="Download original HTML">${icon('download')}</button></div><div class="artifact-viewport" data-artifact="${page.id}" data-draft="${draft}"><div class="artifact-loading">${icon('code')}<span>Opening your artifact…</span></div></div><div class="artifact-bottom"><span>HTML artifact</span><span>Interactive content runs separately from Hoora Docs.</span></div></section>`;
}
function documentReaderSidebar(page, peers, draft = false) {
  const type = state.types.find((item) => item.key === page.kind);
  return `<aside class="sidebar document-reader-sidebar" aria-label="Document navigation">
    <a class="document-nav-home" href="#/browse">${icon('back')} All documents</a>
    <div class="document-nav-collection">${toneIcon(type?.icon || 'documentation', type?.color || 'slate')}<span>${e(type?.name || names[page.kind] || 'Documents')}</span></div>
    <nav aria-label="Collection pages">${peers.map((item) => `<a class="document-nav-page ${item.id === page.id ? 'active' : ''}" ${item.id === page.id ? 'aria-current="page"' : ''} href="${draft && item.id === page.id ? `#/preview/${item.id}` : `#/doc/${e(item.slug)}`}">${e(item.title)}</a>`).join('')}</nav>
    <div class="document-nav-footer"><a href="#/browse?kind=${encodeURIComponent(page.kind)}">Browse this collection ${icon('chevron')}</a></div>
  </aside>`;
}
function documentOutline(outline, draft = false) {
  const links = outline
    .map(
      (item) =>
        `<button type="button" class="document-outline-link level-${item.level}" data-scroll-section="${e(item.id.slice(8))}">${e(item.title)}</button>`,
    )
    .join('');
  return {
    desktop: `<aside class="document-outline" aria-label="On this page"><div class="document-outline-inner"><h2>On this page</h2>${links || '<p>No sections on this page.</p>'}${draft ? '' : `<div class="document-outline-share"><button type="button" data-action="copy-link">${icon('link')} Copy page link</button></div>`}</div></aside>`,
    mobile: outline.length
      ? `<details class="document-mobile-outline"><summary>On this page</summary>${links}</details>`
      : '',
  };
}
function documentPage(p, draft = false) {
  const content = markdownWithOutline(p.body),
    outline = documentOutline(content.outline, draft);
  const peers = state.published.filter(
    (item) => item.kind === p.kind && (!draft || item.id !== p.id),
  );
  if (draft) peers.push(p);
  peers.sort((a, b) => a.title.localeCompare(b.title));
  const index = peers.findIndex((item) => item.id === p.id),
    previous = peers[index - 1],
    next = peers[index + 1];
  const type = state.types.find((item) => item.key === p.kind);
  const folder = state.folders.find((item) => item.id === p.folder_id);
  return `<div class="layout document-reader-layout">${documentReaderSidebar(p, peers, draft)}<main id="main" class="document-reader">
   <div class="document-article"><nav class="document-breadcrumbs" aria-label="Breadcrumb"><a href="#/browse">Library</a>${icon('chevron')}<a href="#/browse?kind=${encodeURIComponent(p.kind)}">${e(type?.name || names[p.kind] || 'Documents')}</a>${folder && folder.name !== (type?.name || names[p.kind]) ? `${icon('chevron')}<span>${e(folder.name)}</span>` : ''}</nav>
   <div class="document-article-actions">${draft ? '<span class="badge draft">Saved draft preview</span>' : `<span class="access-label">${icon(pageAccess(p) === 'public' ? 'web' : 'lock')}${e(accessText(p))}</span>`}<div>${draft ? `<a class="btn outline" href="#/edit/${p.id}">Back to editing</a>` : `<button class="btn text" data-action="share">${icon('link')}Share</button>${state.pages.some((d) => d.id === p.id && !d._readOnly) && canEdit(state.member?.role) ? `<a class="btn outline" href="#/edit/${p.id}">Edit page</a>` : ''}`}</div></div>
   <header class="document-article-heading"><h1>${e(p.title)}</h1>${p.summary ? `<p>${e(p.summary)}</p>` : ''}<div class="document-article-meta"><span>${draft ? 'Saved' : 'Published'} ${date(draft ? p.updated_at : p.published_at)}</span>${p.version ? `<span>${e(p.version)}</span>` : ''}${p.owner_name ? `<span>Owner: ${e(p.owner_name)}</span>` : ''}${!draft && p.published_by_name && p.published_by_name !== p.owner_name ? `<span>By ${e(p.published_by_name)}</span>` : ''}</div></header>
   ${customFieldList(p)}${sources.preview(p)}${outline.mobile}${p.format === 'html' ? `${draft ? '' : `<a class="open-artifact" href="#/artifact/${e(p.slug)}">${icon('expand')}Open full-page HTML preview</a>`}${artifactFrame(p, draft)}` : ''}<div class="prose document-prose">${content.html}</div>
   ${draft ? '' : features.pageTools(p)}<nav class="document-pagination" aria-label="More in this collection">${previous ? `<a href="#/doc/${e(previous.slug)}"><small>Previous page</small><span>${icon('back')}${e(previous.title)}</span></a>` : '<span></span>'}${next ? `<a href="#/doc/${e(next.slug)}"><small>Next page</small><span>${e(next.title)}${icon('chevron')}</span></a>` : '<span></span>'}</nav>
   </div>${outline.desktop}</main></div>`;
}
function article(slug, full = false) {
  const alias = state.aliases?.find((a) => a.slug === slug);
  const p = state.published.find((p) => p.slug === slug || (alias && p.id === alias.page_id));
  if (p && p.kind === 'release' && routeHash().startsWith('#/doc/'))
    history.replaceState(
      null,
      '',
      routeUrl(publishedRoute(p, state.projects)) +
        (routeHash().includes('?') ? '?' + routeHash().split('?')[1] : ''),
    );
  else if (p && p.slug !== slug) history.replaceState(null, '', routeUrl('#/doc/' + p.slug));
  if (!p) {
    if (!state.member) {
      sessionStorage.setItem('hoora-return-to', routeHash());
      return `<main id="main" class="access-gate">${icon('lock')}<h1>Sign in to continue</h1><p>Hoora Docs is an employee workspace. Sign in with your Hoora Microsoft account to view this content.</p><a class="btn dark" href="#/login">Continue with Microsoft</a></main>`;
    }
    return `<main id="main" class="article">${empty('Document unavailable', 'This page may have been removed or unpublished.', '<a class="btn outline" href="#/workspace">Open library</a>')}</main>`;
  }
  document.title = p.title + ' — Hoora Docs';
  if (full && p.format === 'html') return nativeArtifact(p, false);
  if (p.kind === 'release') return releaseDocumentNew(p);
  return documentPage(p);
}

function options(items, selected, placeholder) {
  return (
    `<option value="">${placeholder}</option>` +
    items
      .map(
        (x) =>
          `<option value="${x.id}" ${x.id === selected ? 'selected' : ''}>${e(x.name)}</option>`,
      )
      .join('')
  );
}
function editor(id) {
  if (state.releases.some((r) => r.id === id)) {
    const params = new URLSearchParams(routeHash().split('?')[1]);
    if (params.has('settings')) return releaseDetails(id);
    return contributionEditor.view(id, params.get('section'));
  }
  const p = state.pages.find((x) => x.id === id) || {
    id: crypto.randomUUID(),
    title: '',
    slug: '',
    kind: 'documentation',
    body: '',
    summary: '',
    tags: [],
    version: '',
    format: 'markdown',
    team_id: state.team || null,
    artifact_path: null,
  };
  const isNew = !id,
    published = state.published.find((x) => x.id === p.id);
  if (!isNew && !state.pages.some((x) => x.id === id))
    return empty(
      'Document not found',
      'Return to your workspace.',
      '<a href="#/workspace">Workspace</a>',
    );
  if (p.deleted_at)
    return empty(
      'This document is archived',
      'Restore it from the archive before editing.',
      '<a href="#/archive">Open archive</a>',
    );
  if (!canEdit(state.member.role) || p._readOnly)
    return `<div class="layout">${sidebar(true)}<main id="main" class="article"><h1>${e(p.title)}</h1><div class="notice">You have read-only access.</div>${p.format === 'html' ? artifactFrame(p, true) : ''}<div class="prose">${markdown(p.body)}</div></main></div>`;
  const html = p.format === 'html';
  return `<div class="layout editor-layout">${sidebar(true)}<main id="main" class="editor"><div class="editor-top"><nav class="breadcrumbs"><a href="#/workspace">Documents</a>${icon('chevron')}<span>${isNew ? 'New document' : e(p.title)}</span></nav><div class="editor-top-actions">${documentActions({ icon, published, publishedLink: published ? publishedRoute(published, state.projects) : '', isNew, id: p.id, role: state.member.role, canPublish: isNew ? canPublish(state.member.role) : p._canPublish === true, html: p.format === 'html' })}</div></div><form id="editor-form" data-id="${p.id}" data-new="${isNew}" data-revision="${p.revision || 0}"><div class="editor-grid"><div class="editor-main"><div class="editor-heading"><div class="field title-field"><label class="sr-only" for="title">Document title</label><input id="title" name="title" required maxlength="250" value="${e(p.title)}" placeholder="Untitled document"></div><div class="field summary-field"><label class="sr-only" for="summary">Short description</label><textarea id="summary" name="summary" maxlength="500" rows="2" placeholder="Add a short description…">${e(p.summary)}</textarea></div></div><input type="hidden" id="format" name="format" value="${p.format || 'markdown'}"><input type="hidden" id="artifact_path" name="artifact_path" value="${e(p.artifact_path || '')}"><section id="markdown-editor" ${html ? 'hidden' : ''}><div class="editor-mode-tabs"><div><button type="button" class="active" data-editor-view="write">Write</button><button type="button" data-editor-view="split">Split view</button><button type="button" data-editor-view="preview">Preview</button><button type="button" data-editor-view="source">Markdown source</button></div><button type="button" class="btn text" data-action="import-markdown">${icon('upload')}Import .md</button></div><div class="writing-layout" data-view="write"><div class="source-editor">${richToolbar()}<div class="rich-canvas" data-rich-canvas></div><label class="sr-only" for="body">Markdown source</label><textarea id="body" name="body" class="rich-source" spellcheck="false" placeholder="Paste Markdown here…">${e(p.body)}</textarea></div><div id="live-preview" class="prose live-preview">${p.body ? markdown(p.body) : '<p class="preview-placeholder">Your formatted document will appear here.</p>'}</div></div><div class="editor-footnote"><span>Markdown</span><span id="word-count">${p.body.trim() ? p.body.trim().split(/\s+/).length : 0} words</span></div></section><section id="html-editor" ${!html ? 'hidden' : ''}><div class="artifact-dropzone" id="html-dropzone"><div class="upload-symbol">${icon('code')}</div><h3>HTML artifact</h3><p>Drop an HTML file, or paste its source below.</p><button type="button" class="btn dark" data-action="upload-html">${icon('upload')}${p.artifact_path ? 'Replace HTML file' : 'Choose HTML file'}</button><small>Single .html or .htm file · Up to 10 MB</small></div>${
    p.artifact_path
      ? `<div class="current-artifact">${icon('code')}<span>${e(
          p.artifact_path
            .split('/')
            .at(-1)
            .replace(/^[a-f0-9-]{37}/, ''),
        )}</span><span class="badge">Uploaded</span></div>${artifactFrame(p, true)}`
      : ''
  }<div class="html-paste"><div class="html-paste-heading"><div><strong>HTML source</strong></div><button type="button" class="btn outline" data-action="paste-html">Use pasted HTML</button></div><label class="sr-only" for="html-source">HTML source</label><textarea id="html-source" spellcheck="false" placeholder="<!doctype html>\n<html>\n  <head><title>My artifact</title></head>\n  <body>...</body>\n</html>"></textarea></div></section><input type="file" id="file-upload" hidden accept=".png,.jpg,.jpeg,.webp,.pdf,.txt,.md,.csv,.docx,.xlsx"><input type="file" id="markdown-upload" hidden accept=".md,.markdown,.txt"><input type="file" id="html-upload" hidden accept=".html,.htm,text/html"></div><aside class="document-properties"><h2>Document settings</h2><div class="document-type-picker"><span>Format</span><div><button type="button" data-doc-format="markdown" aria-pressed="${!html}" class="${!html ? 'active' : ''}">${icon('documentation')}Markdown</button><button type="button" data-doc-format="html" aria-pressed="${html}" class="${html ? 'active' : ''}">${icon('code')}HTML artifact</button></div></div>${teams.field(p)}<div class="field"><label for="kind">Collection</label><select id="kind" name="kind">${Object.entries(
    names,
  )
    .filter(([key]) => key !== 'release')
    .map(([k, n]) => `<option value="${k}" ${p.kind === k ? 'selected' : ''}>${n}</option>`)
    .join(
      '',
    )}</select></div><div class="field"><label for="vertical_id">Vertical</label><select id="vertical_id" name="vertical_id">${options(state.verticals, p.vertical_id, 'General')}</select></div><div class="field"><label for="folder_id">Folder</label><select id="folder_id" name="folder_id">${options(state.folders, p.folder_id, 'No folder')}</select></div><div class="field"><label for="version">Version / reference</label><input id="version" name="version" value="${e(p.version)}" maxlength="100" placeholder="e.g. v2.4.0"></div><div class="field"><label for="slug">Page URL</label><input id="slug" name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" value="${e(p.slug)}" placeholder="document-title"></div><div class="field"><label for="tags">Tags</label><input id="tags" name="tags" value="${e(p.tags.join(', '))}" placeholder="product, onboarding"><small>Comma-separated.</small></div>${typeFields(p)}${visibilityField(p)}<div class="properties-help">${icon('lock')}Private draft until published.</div></aside></div><p id="form-error" class="error" role="alert"></p><div class="editor-actions"><span class="statusbar" id="save-status">${isNew ? 'Draft not saved' : 'Saved ' + date(p.updated_at)}</span></div></form></main></div>`;
}

const teamRoles = [
  ['viewer', 'Viewer'],
  ['contributor', 'Editor'],
  ['publisher', 'Publisher'],
  ['manager', 'Manager'],
];
async function users() {
  state.members = await admin();
  const capabilityName = {
    read: 'Read',
    contribute: 'Contribute',
    edit: 'Edit',
    publish: 'Publish',
    manage: 'Manage',
    delete: 'Delete',
  };
  const scopeName = (permission) =>
    permission.scope_type === 'collection'
      ? names[permission.collection_key] || permission.collection_key
      : permission.scope_type === 'folder'
        ? state.folders.find((item) => item.id === permission.folder_id)?.name
        : state.projects.find((item) => item.id === permission.project_id)?.name;
  const groups = new Map();
  for (const permission of state.teamPermissions) {
    const key = permission.team_id + ':' + permission.capability;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(permission);
  }
  const capabilityRows = [...groups.values()]
    .map((list) => {
      const team = state.teams.find((item) => item.id === list[0].team_id);
      return `<tr><td>${e(team?.name || 'Unknown team')}</td><td>${e(capabilityName[list[0].capability] || list[0].capability)}</td><td><span class="scope-list">${list
        .map(
          (permission) =>
            `<span>${e(scopeName(permission) || permission.scope_type)}${permission.expires_at ? ` <small>until ${e(date(permission.expires_at))}</small>` : ''}<button type="button" class="scope-remove" data-action="remove-team-permission" data-id="${permission.id}" aria-label="Remove ${e(scopeName(permission) || '')}">${icon('close')}</button></span>`,
        )
        .join('')}</span></td></tr>`;
    })
    .join('');
  const byEmail = new Map(state.members.map((m) => [m.email.toLowerCase(), m]));
  const initials = (m) =>
    e(
      String(m.name || m.email)
        .split(/\s+/)
        .map((part) => part[0])
        .join('')
        .slice(0, 2)
        .toUpperCase(),
    );
  // Rows are compact so a team of hundreds stays readable on the board.
  const card = (m, team, role) =>
    `<div class="person-card" draggable="true" data-email="${e(m.email)}" data-team="${team ? e(team.id) : ''}"><span class="person-avatar" aria-hidden="true">${initials(m)}</span><span class="person-text"><button type="button" class="person-name" data-member="${m.id}">${e(m.name || m.email)}</button><small>${e(m.email)}${m.role === 'admin' ? ' · Administrator' : ''}${m.active ? '' : ' · Disabled'}</small></span>${team ? `<select class="person-role" data-team-role="${e(team.id)}" data-email="${e(m.email)}" aria-label="Role of ${e(m.name || m.email)} in ${e(team.name)}">${teamRoles.map(([value, label]) => `<option value="${value}" ${role === value ? 'selected' : ''}>${label}</option>`).join('')}</select><button type="button" class="scope-remove" data-board-remove="${e(team.id)}" data-email="${e(m.email)}" aria-label="Remove ${e(m.name || m.email)} from ${e(team.name)}">${icon('close')}</button>` : ''}</div>`;
  const assigned = new Set(state.teamMembers.map((tm) => tm.email.toLowerCase()));
  const unassigned = state.members.filter((m) => !assigned.has(m.email.toLowerCase()));
  const table = (team) => {
    const rows = state.teamMembers.filter(
      (tm) => tm.team_id === team.id && byEmail.has(tm.email.toLowerCase()),
    );
    return `<section class="board-column team-table" data-drop-team="${e(team.id)}" aria-label="${e(team.name)}"><header><strong>${e(team.name)}</strong><span>${rows.length} ${rows.length === 1 ? 'person' : 'people'}</span></header><div class="board-cards">${rows.map((tm) => card(byEmail.get(tm.email.toLowerCase()), team, tm.role)).join('') || '<p class="board-empty">Drop people here</p>'}</div></section>`;
  };
  const pool = `<aside class="people-pool board-column" data-drop-team="" aria-label="Unassigned"><header><strong>Unassigned</strong><span>${unassigned.length}</span></header><input class="people-search" type="search" placeholder="Find a person…" autocomplete="off" aria-label="Find a person" data-people-search><div class="board-cards">${unassigned.map((m) => card(m)).join('') || '<p class="board-empty">Everyone has a team</p>'}</div><form class="board-assign" data-board-assign><strong>Add to a team</strong><input name="email" list="people-emails" placeholder="Name or email" aria-label="Person" required><datalist id="people-emails">${state.members.map((m) => `<option value="${e(m.email)}">${e(m.name || '')}</option>`).join('')}</datalist><select name="team" aria-label="Team" required><option value="">Team…</option>${state.teams.map((t) => `<option value="${e(t.id)}">${e(t.name)}</option>`).join('')}</select><button class="btn outline" type="submit">Add</button></form></aside>`;
  const canvas = `<div class="people-board team-board"><div class="team-board-toolbar" role="toolbar" aria-label="Board view"><button type="button" class="iconbtn" data-canvas-zoom="-0.1" aria-label="Zoom out">−</button><output data-canvas-level>100%</output><button type="button" class="iconbtn" data-canvas-zoom="0.1" aria-label="Zoom in">+</button><button type="button" class="btn text" data-canvas-fit>Fit</button><button type="button" class="btn text" data-canvas-full aria-pressed="false">Full screen</button></div>${pool}<div class="team-canvas" data-canvas tabindex="0" aria-label="Teams board. Drag empty space to move around."><div class="canvas-world">${state.teams.map(table).join('')}</div></div></div>`;
  return `<div class="layout">${settingsSidebar('users')}<main id="main" class="settings-content people-content"><div class="view-heading"><div><h1>People & access</h1><p>Everyone joins as a viewer in Unassigned. Drag people onto a team and set their role there.</p></div><button class="btn dark" data-action="add-member">${icon('plus')}Add member</button></div>${canvas}<section class="settings-section"><div class="section-heading"><div><h2>Team permissions</h2><p>Release platforms and collections a team can publish to. Team documents are always editable by their own publishers.</p></div><button class="btn outline" data-action="add-team-permission">${icon('plus')}Add permission</button></div><div class="tablewrap"><table><thead><tr><th>Team</th><th>Can</th><th>In</th></tr></thead><tbody>${capabilityRows || '<tr><td colspan="3">No team permissions yet.</td></tr>'}</tbody></table></div></section><details class="role-explainer"><summary>What each role can do</summary><dl class="role-list"><div><dt>Viewer</dt><dd>Reads release notes, upcoming releases and every document shared with them.</dd></div><div><dt>Editor</dt><dd>Writes and edits drafts for their team.</dd></div><div><dt>Publisher</dt><dd>Writes and publishes their team’s documents, and release notes on platforms the team has publish permission for.</dd></div><div><dt>Manager</dt><dd>Everything a publisher can do, plus managing the team’s people and sharing its documents.</dd></div><div><dt>Administrator</dt><dd>Organization role with full control. Set it from a person’s name.</dd></div></dl></details></main></div>`;
}
/** People board: drag between columns, or use the role and "Add person" menus. */
function bindPeopleBoard() {
  const board = document.querySelector('.people-board');
  if (!board) return;
  const save = async (work, message) => {
    try {
      await work();
      await load();
      await render();
      toast(message);
    } catch (error) {
      toast(error.message, true);
    }
  };
  const roleOf = (team, email) =>
    state.teamMembers.find(
      (tm) => tm.team_id === team && tm.email.toLowerCase() === email.toLowerCase(),
    )?.role || 'viewer';
  const add = (team, email, role = 'viewer') =>
    db('docs_team_members', '', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: [{ team_id: team, email: email.toLowerCase(), role, added_by: state.member.id }],
    });
  const remove = (team, email) =>
    db(
      'docs_team_members',
      `?team_id=eq.${team}&email=eq.${encodeURIComponent(email.toLowerCase())}`,
      {
        method: 'DELETE',
      },
    );
  board.addEventListener('dragstart', (event) => {
    const card = event.target.closest('.person-card');
    if (!card) return;
    event.dataTransfer.setData(
      'text/plain',
      JSON.stringify({ email: card.dataset.email, from: card.dataset.team }),
    );
    event.dataTransfer.effectAllowed = 'copyMove';
    card.classList.add('dragging');
  });
  board.addEventListener('dragend', (event) =>
    event.target.closest('.person-card')?.classList.remove('dragging'),
  );
  board.addEventListener('dragover', (event) => {
    const column = event.target.closest('.board-column');
    if (!column) return;
    event.preventDefault();
    board
      .querySelectorAll('.drop-target')
      .forEach((item) => item !== column && item.classList.remove('drop-target'));
    column.classList.add('drop-target');
  });
  board.addEventListener('dragleave', (event) => {
    const column = event.target.closest('.board-column');
    if (column && !column.contains(event.relatedTarget)) column.classList.remove('drop-target');
  });
  board.addEventListener('drop', (event) => {
    const column = event.target.closest('.board-column');
    if (!column) return;
    event.preventDefault();
    column.classList.remove('drop-target');
    let data;
    try {
      data = JSON.parse(event.dataTransfer.getData('text/plain'));
    } catch {
      return;
    }
    const to = column.dataset.dropTeam;
    if (data.from === to) return;
    // Dragging moves a person; hold Ctrl (⌘ on Mac) to also keep them in their current team.
    const keep = event.ctrlKey || event.metaKey;
    save(
      async () => {
        if (to) await add(to, data.email, data.from ? roleOf(data.from, data.email) : 'viewer');
        if (data.from && (!to || !keep)) await remove(data.from, data.email);
      },
      to ? 'Team updated.' : 'Moved to Unassigned.',
    );
  });
  board.addEventListener('change', (event) => {
    const role = event.target.closest('[data-team-role]');
    if (role)
      save(
        () =>
          db(
            'docs_team_members',
            `?team_id=eq.${role.dataset.teamRole}&email=eq.${encodeURIComponent(role.dataset.email.toLowerCase())}`,
            {
              method: 'PATCH',
              body: { role: role.value },
            },
          ),
        'Role updated.',
      );
  });
  board.addEventListener('input', (event) => {
    if (!event.target.matches('[data-people-search]')) return;
    const query = event.target.value.trim().toLowerCase();
    board.querySelectorAll('.person-card').forEach((card) => {
      card.hidden = query && !card.textContent.toLowerCase().includes(query);
    });
  });
  board.addEventListener('click', (event) => {
    const button = event.target.closest('[data-board-remove]');
    if (button)
      save(() => remove(button.dataset.boardRemove, button.dataset.email), 'Removed from team.');
  });
  board.querySelector('[data-board-assign]')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const email = String(form.get('email') || '')
      .trim()
      .toLowerCase();
    if (!state.members.some((m) => m.email.toLowerCase() === email)) {
      toast('Choose someone from the list.', true);
      return;
    }
    save(() => add(form.get('team'), email), 'Added to team.');
  });

  // Whiteboard: drag empty space to move around, zoom with the toolbar or Ctrl + wheel.
  const canvas = board.querySelector('[data-canvas]'),
    world = canvas?.querySelector('.canvas-world'),
    level = board.querySelector('[data-canvas-level]');
  if (!canvas || !world) return;
  const saved = Number(sessionStorage.getItem('hoora-board-zoom'));
  let zoom = saved >= 0.4 && saved <= 1.5 ? saved : 1;
  const setZoom = (value) => {
    zoom = Math.min(1.5, Math.max(0.4, Math.round(value * 10) / 10));
    world.style.zoom = String(zoom);
    level.textContent = Math.round(zoom * 100) + '%';
    sessionStorage.setItem('hoora-board-zoom', String(zoom));
  };
  setZoom(zoom);
  board
    .querySelectorAll('[data-canvas-zoom]')
    .forEach((button) =>
      button.addEventListener('click', () => setZoom(zoom + Number(button.dataset.canvasZoom))),
    );
  board.querySelector('[data-canvas-fit]').addEventListener('click', () => {
    world.style.zoom = '1';
    setZoom(
      Math.min(canvas.clientWidth / world.scrollWidth, canvas.clientHeight / world.scrollHeight, 1),
    );
    canvas.scrollTo(0, 0);
  });
  const full = board.querySelector('[data-canvas-full]');
  full.addEventListener('click', () => {
    const on = !board.classList.contains('is-full');
    board.classList.toggle('is-full', on);
    document.body.classList.toggle('board-full', on);
    full.setAttribute('aria-pressed', String(on));
    full.textContent = on ? 'Exit full screen' : 'Full screen';
  });
  canvas.addEventListener(
    'wheel',
    (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setZoom(zoom + (event.deltaY < 0 ? 0.1 : -0.1));
    },
    { passive: false },
  );
  let pan = null;
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('.team-table')) return;
    pan = { x: event.clientX, y: event.clientY, left: canvas.scrollLeft, top: canvas.scrollTop };
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add('is-panning');
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!pan) return;
    canvas.scrollLeft = pan.left - (event.clientX - pan.x);
    canvas.scrollTop = pan.top - (event.clientY - pan.y);
  });
  const stop = () => {
    pan = null;
    canvas.classList.remove('is-panning');
  };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);
}
function folders() {
  return structureView();
}
function currentPublishedPage() {
  const parts = routeHash().split('?')[0].split('/').filter(Boolean);
  if (parts[0] === '#' || parts[0] === '') parts.shift();
  if (parts[0] === 'doc')
    return state.published.find((item) => item.slug === decodeURIComponent(parts[1] || ''));
  if (parts[0] === 'release-notes')
    return releaseRecords(true).find(
      (r) => publishedRoute(r.page, state.projects) === `#/release-notes/${parts[1]}/${parts[2]}`,
    )?.page;
  return null;
}

function markSamplePages() {
  const isSample = (slug) =>
    state.published.some((page) => page.slug === slug && page.tags?.includes('sample'));
  const page = currentPublishedPage();
  if (page && isSample(page.slug)) {
    document
      .querySelector('.native-release-overline, .document-article-actions')
      ?.insertAdjacentHTML('beforeend', '<span class="sample-label">Sample content</span>');
  }
}
/** Google-style sharing: general access, then extra teams and people. */
async function shareCurrentPage() {
  const page = currentPublishedPage();
  if (!page) throw new Error('Open a published page before sharing it.');
  const link = location.origin + routeUrl(publishedRoute(page, state.projects));
  const linkRow = `<div class="share-link"><span>${e(link)}</span><button type="button" class="btn outline" data-action="copy-link">${icon('link')}Copy link</button></div>`;
  const draft = state.pages.find((item) => item.id === page.id);
  const owner = state.teams.find((team) => team.id === page.team_id);
  const canManage =
    page.kind !== 'release' &&
    (state.member?.role === 'admin' ||
      draft?.created_by === state.member?.id ||
      (owner && teams.manages(owner)));
  if (!canManage) {
    dialog(
      `<h2>Share</h2><p class="small">${e(page.title)}</p>${linkRow}<p class="share-summary">${icon('lock')}<span>Visible to <strong>${e(accessText(page))}</strong>. Everyone signs in with their Hoora account.</span></p><form><div class="dialog-actions"><button type="button" class="btn outline" data-close>Done</button></div></form>`,
    );
    return;
  }
  const [people, teamGrants] = await Promise.all([
    db('docs_page_access', `?page_id=eq.${page.id}&select=email&order=email`),
    db('docs_page_team_access', `?page_id=eq.${page.id}&select=team_id`),
  ]);
  const access = pageAccess(page);
  const sharedTeams = new Set(teamGrants.map((grant) => grant.team_id));
  const option = (value, title, detail) =>
    `<label class="share-option"><input type="radio" name="access_mode" value="${value}" ${access === value ? 'checked' : ''}><span><strong>${title}</strong><small>${detail}</small></span></label>`;
  dialog(
    `<h2>Share</h2><p class="small">${e(page.title)}</p>${linkRow}<form class="share-form"><fieldset class="share-general"><legend>General access</legend>${option('private', 'Everyone at Hoora', 'Anyone who signs in can open it.')}${owner ? option('team', `${e(owner.name)}`, 'The owning team, plus the teams and people below.') : ''}${option('restricted', 'Only the teams and people below', 'Nobody else, apart from the author and administrators.')}</fieldset><div class="share-targets" ${access === 'private' ? 'hidden' : ''}><fieldset class="share-teams"><legend>Teams</legend>${state.teams
      .filter((team) => team.id !== page.team_id)
      .map(
        (team) =>
          `<label><input type="checkbox" name="team" value="${team.id}" ${sharedTeams.has(team.id) ? 'checked' : ''}><span>${e(team.name)}</span></label>`,
      )
      .join(
        '',
      )}</fieldset><div class="field"><label for="share-emails">People</label><textarea id="share-emails" name="emails" rows="3" placeholder="name@hoora.me, another@hoora.me">${e(people.map((row) => row.email).join(', '))}</textarea></div></div><p class="error" role="alert"></p><div class="dialog-actions"><button type="button" class="btn outline" data-close>Cancel</button><button type="submit" class="btn primary">Save</button></div></form>`,
    async (form) => {
      const allowed_emails = String(form.get('emails') || '')
        .split(/[\s,;]+/)
        .map((email) => email.trim())
        .filter(Boolean);
      await db('rpc/docs_set_access', '', {
        method: 'POST',
        body: {
          document_id: page.id,
          access_mode: form.get('access_mode'),
          allowed_emails,
          team_ids: form.getAll('team'),
        },
      });
      await load();
      await render();
      toast('Sharing updated.');
    },
  );
  modal.querySelectorAll('[name=access_mode]').forEach((radio) =>
    radio.addEventListener('change', () => {
      modal.querySelector('.share-targets').hidden =
        modal.querySelector('[name=access_mode]:checked').value === 'private';
    }),
  );
}

async function render() {
  const rid = ++renderId;
  document.title = routeHash().split('?')[0] === '#/install' ? 'Install Hoora Docs' : 'Hoora Docs';
  state.nativeTitle = null;
  const [pathname, search = ''] = routeHash().replace(/^#/, '').split('?');
  const routeParts = pathname.split('/').filter(Boolean);
  let [route, id] = routeParts;
  if (route === 'release-notes') {
    const version = decodeURIComponent(id || ''),
      projectSlug = decodeURIComponent(routeParts[2] || '');
    const match = releaseRecords(true).find(
      (r) =>
        publishedRoute(r.page, state.projects) ===
        `#/release-notes/${encodeURIComponent(version)}/${encodeURIComponent(projectSlug)}`,
    );
    route = 'doc';
    id = match?.page.slug || '__release_unavailable__';
  }
  const params = new URLSearchParams(search);
  state.kind = params.get('kind') || '';
  state.vertical = params.get('vertical') || '';
  state.folder = params.get('folder') || '';
  state.folder = state.folders.find((f) => f.slug === state.folder)?.id || state.folder;
  state.team = params.get('team') || '';
  state.team = state.teams.find((t) => t.slug === state.team)?.id || state.team;
  state.section = params.get('section') || '';
  state.project = params.get('project') || '';
  state.project =
    state.projects.find((p) => p.slug === state.project)?.id ||
    state.published.find(
      (p) => p.project_id && slugify(p.release_snapshot?.project || '') === state.project,
    )?.project_id ||
    state.project;
  state.version = params.get('version') || '';
  state.view = params.get('view') || '';
  document.body.dataset.route = route || 'releases';
  if (isStandaloneApp()) {
    const setupDone =
      state.member &&
      localStorage.getItem(`hoora-pwa-onboarding:${state.member.id}`) === 'complete';
    if (!state.member) {
      if (route !== 'login') {
        sessionStorage.setItem(
          'hoora-return-to',
          sharedDocumentTarget(routeHash()) ||
            (localStorage.getItem('hoora-pwa-onboarding-complete') === 'true'
              ? '#/home'
              : '#/app-welcome'),
        );
        location.hash = '#/login';
        return render();
      }
      if (!sessionStorage.getItem('hoora-return-to'))
        sessionStorage.setItem(
          'hoora-return-to',
          sharedDocumentTarget(routeHash()) ||
            (localStorage.getItem('hoora-pwa-onboarding-complete') === 'true'
              ? '#/home'
              : '#/app-welcome'),
        );
    } else if (
      route === 'login' ||
      (!setupDone && route !== 'app-welcome') ||
      (setupDone && (route === 'app-welcome' || route === 'install'))
    ) {
      location.hash = setupDone ? completeLoginRoute() : '#/app-welcome';
      return render();
    }
  }
  const internal = [
    'workspace',
    'upcoming',
    'contribute',
    'new',
    'edit',
    'users',
    'folders',
    'account',
    'requests',
    'preview',
    'teams',
    'notifications',
    'contributions',
    'archive',
    'activity',
    'app-welcome',
  ].includes(route);
  const authExempt = ['login', 'install', 'app-welcome'];
  if (!state.member && !authExempt.includes(route)) {
    const target = sharedDocumentTarget(routeHash());
    if (target) sessionStorage.setItem('hoora-return-to', target);
    else sessionStorage.removeItem('hoora-return-to');
    if (route !== 'login') {
      location.hash = '#/login';
      return render();
    }
  }
  if (state.member && !state.member.password_setup_complete && route !== 'install') {
    app.innerHTML = header() + onboarding() + footer();
    enhanceRail();
    bind();
    syncAssistantViewport();
    return;
  }
  if (state.member) pwa.sync(state.member.id);
  if (internal && !state.member) {
    app.innerHTML =
      header() +
      (state.session
        ? `<main class="article" id="main">${empty('Your account doesn’t have access', 'Ask a Hoora Docs administrator to activate your team membership.', '<button class="btn outline" data-action="logout">Sign out</button>')}</main>`
        : login()) +
      footer();
    enhanceRail();
    bind();
    return;
  }
  try {
    await hydrateRoute(route, id);
    let view;
    switch (route) {
      case 'home':
        view = home();
        break;
      case 'login':
        view = state.member ? workspace() : login();
        break;
      case 'install':
        view = installPage();
        break;
      case 'app-welcome':
        view = appWelcome();
        break;
      case 'releases':
        view = releaseHub();
        break;
      case 'contribute':
        view = contributionEditor.view(id, params.get('section'));
        break;
      case 'upcoming':
        view = await upcoming.view(id, params, {
          ticket: routeParts[2] === 'tickets' ? routeParts[3] : null,
          settings: routeParts[2] === 'settings',
        });
        break;
      case 'requests':
        view = requestsView();
        break;
      case 'search':
        view = await searchResultsPage({
          state,
          service: searchService,
          e,
          names,
          query: params.get('q') || '',
          params,
        });
        break;
      case 'notifications':
        view = await features.inbox();
        break;
      case 'contributions':
        view = features.contributions();
        break;
      case 'archive':
        view = features.archive();
        break;
      case 'feedback':
        view = `<main id="main" class="settings-content feedback-page"><div class="view-heading"><div><h1>Feedback</h1><p>Bugs, feature ideas and thanks sent from Hoora Docs.</p></div></div>${await maker.inbox()}</main>`;
        break;
      case 'activity':
        view = await features.activity();
        break;
      case 'teams':
        view = await teams.view(id);
        break;
      case 'workspace':
        view = workspace();
        break;
      case 'doc':
        view = article(decodeURIComponent(id || ''));
        break;
      case 'artifact':
        view = article(decodeURIComponent(id || ''), true);
        break;
      case 'new':
      case 'edit':
        view =
          route === 'new' && params.get('kind') === 'release'
            ? contributionEditor.view(null, null, { create: true, projectId: state.project })
            : editor(route === 'edit' ? id : null);
        break;
      case 'users':
        if (state.member.role !== 'admin') throw new Error('Administrator access required.');
        view = await users();
        break;
      case 'preview':
        view = draftPreview(id);
        break;
      case 'folders':
        if (state.member.role !== 'admin') throw new Error('Administrator access required.');
        view = folders();
        break;
      case 'account':
        view = account();
        break;
      case 'browse':
        view = publicView(false);
        break;
      default:
        view = releaseHub();
    }
    if (rid !== renderId) return;
    app.innerHTML = header() + view + footer() + assistantUI();
    if (
      ![
        'new',
        'edit',
        'preview',
        'artifact',
        'contribute',
        'users',
        'install',
        'login',
        'app-welcome',
      ].includes(route)
    )
      document.querySelector('main#main')?.insertAdjacentHTML('beforeend', maker.pageEnd());
    enhanceRail();
    updateReleaseSectionTabs();
    if (route === 'doc' && state.section)
      requestAnimationFrame(() =>
        document.getElementById('section-' + state.section)?.scrollIntoView({ block: 'start' }),
      );
    canonicalizeRoute();
    markSamplePages();
    bind();
    hydrateArtifacts();
    hydrateImages();
    sources.hydrate();
    features.hydrate();
    const viewed = route === 'doc' ? state.published.find((p) => p.slug === id) : null;
    if (viewed && state.member)
      db('rpc/docs_track', '', {
        method: 'POST',
        body: { document_id: viewed.id, event: 'asset_viewed' },
      }).catch(() => {});
  } catch (err) {
    app.innerHTML =
      header() +
      `<main class="article" id="main"><div class="content-error">${e(err.message)}</div><a class="btn outline" href="#/workspace">Back to workspace</a></main>` +
      footer();
    enhanceRail();
    bind();
  }
}
function formError(err) {
  const el = document.querySelector('#form-error');
  if (el) el.textContent = err.message;
  else toast(err.message, true);
}
async function busy(button, fn) {
  return feedback.busy(button, fn, formError);
}
function dialog(html, callback) {
  modal.className = '';
  modal.innerHTML = html;
  modal.showModal();
  modal.querySelector('[data-close]')?.addEventListener('click', () => modal.close());
  modal.querySelector('form')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const b = ev.submitter;
    b.disabled = true;
    try {
      await callback(new FormData(ev.target));
      modal.close();
    } catch (err) {
      const error = modal.querySelector('.error');
      if (error) error.textContent = err.message;
      else toast(err.message, true);
    } finally {
      b.disabled = false;
    }
  });
}
async function confirmAction(title, description, action) {
  dialog(
    `<h2>${e(title)}</h2><p class="small">${e(description)}</p><form><p class="error" role="alert"></p><div class="dialog-actions"><button type="button" class="btn outline" data-close>Cancel</button><button class="btn danger" type="submit">Confirm</button></div></form>`,
    action,
  );
}
function memberDialog(id) {
  const m = state.members.find((x) => x.id === id);
  dialog(
    `<h2>${m ? 'Manage member' : 'Welcome someone new.'}</h2><p class="small">${m ? e(m.email) : 'Create a login and choose what they can do.'}</p><form id="member-form"><div class="field"><label for="member-name">Name</label><input id="member-name" name="name" required maxlength="100" value="${e(m?.name || '')}"></div>${!m ? '<div class="field"><label for="member-email">Email</label><input id="member-email" name="email" type="email" required></div><div class="field"><label for="member-password">Temporary password</label><input id="member-password" name="password" type="password" autocomplete="new-password" minlength="12" required><small>At least 12 characters. Share securely with this person.</small></div>' : ''}<div class="field"><label for="member-role">Role</label><select id="member-role" name="role">${['viewer', 'publisher', 'manager', 'admin'].map((r) => `<option value="${r}" ${m?.role === r ? 'selected' : ''}>${roleName(r)}</option>`).join('')}</select></div>${m ? `<div class="field"><label for="member-active">Account access</label><select id="member-active" name="active"><option value="true" ${m.active ? 'selected' : ''}>Active</option><option value="false" ${!m.active ? 'selected' : ''}>Disabled</option></select></div>` : ''}<p class="error" role="alert"></p><div class="dialog-actions"><button type="button" class="btn outline" data-close>Cancel</button><button class="btn primary">${m ? 'Save changes' : 'Create account'}</button></div></form>${m && m.id !== state.member.id ? `<div class="toolbar"><button class="btn outline" id="reset-member-password">Reset password</button><button class="btn danger" id="delete-member">Remove member</button></div>` : ''}`,
    async (f) => {
      await admin({
        ...Object.fromEntries(f),
        action: m ? 'update' : 'create',
        id: m?.id,
        active: f.get('active') !== 'false',
      });
      toast(m ? 'Member updated.' : 'Account created.');
      await render();
    },
  );
  modal.querySelector('#delete-member')?.addEventListener('click', () => {
    modal.close();
    confirmAction(
      'Remove this member?',
      'Their login and team access will be removed. Documents they authored will be kept.',
      async () => {
        await admin({ action: 'delete', id: m.id });
        await render();
        toast('Member removed.');
      },
    );
  });
  modal.querySelector('#reset-member-password')?.addEventListener('click', () => {
    modal.close();
    dialog(
      `<h2>Reset password</h2><p class="small">Set a new temporary password for ${e(m.email)}.</p><form><div class="field"><label for="reset-password">New password</label><input id="reset-password" name="password" type="password" minlength="12" autocomplete="new-password" required></div><p class="error" role="alert"></p><div class="dialog-actions"><button type="button" data-close class="btn outline">Cancel</button><button class="btn primary">Reset password</button></div></form>`,
      async (f) => {
        await admin({
          action: 'password',
          id: m.id,
          password: f.get('password'),
        });
        toast('Password updated. Share it securely.');
      },
    );
  });
}
function teamPermissionDialog() {
  if (state.member?.role !== 'admin') throw new Error('Administrator access required.');
  dialog(
    `<h2>Add team capability</h2><p class="small">Assign a capability to a team at collection, folder, or release-platform level.</p><form><div class="field"><label for="permission-team">Team</label><select id="permission-team" name="team_id" required>${state.teams.map((team) => `<option value="${team.id}">${e(team.name)}</option>`).join('')}</select></div><div class="field"><label for="permission-scope">Scope</label><select id="permission-scope" name="scope_type"><option value="collection">Collection</option><option value="folder">Folder</option><option value="project">Release platform</option></select></div><div class="field"><label for="permission-collection">Collection</label><select id="permission-collection" name="collection_key"><option value="release">Releases / Upcoming</option><option value="sop">SOPs</option><option value="documentation">Documentation</option></select></div><div class="field"><label for="permission-folder">Folder</label><select id="permission-folder" name="folder_id"><option value="">Choose a folder</option>${state.folders.map((folder) => `<option value="${folder.id}">${e(folder.name)}</option>`).join('')}</select></div><div class="field"><label for="permission-project">Release platform</label><select id="permission-project" name="project_id"><option value="">Choose a platform</option>${state.projects.map((project) => `<option value="${project.id}">${e(displayPlatformName(project.name))}</option>`).join('')}</select></div><div class="field"><label for="permission-capability">Capability</label><select id="permission-capability" name="capability"><option value="read">Read</option><option value="contribute">Contribute</option><option value="edit">Edit</option><option value="publish">Publish</option><option value="manage">Manage</option><option value="delete">Delete</option></select></div><div class="field"><label for="permission-expiry">Expiry (optional)</label><input id="permission-expiry" name="expires_at" type="date"></div><p class="error" role="alert"></p><div class="dialog-actions"><button type="button" class="btn outline" data-close>Cancel</button><button class="btn dark">Save capability</button></div></form>`,
    async (form) => {
      const scopeType = form.get('scope_type');
      const body = {
        team_id: form.get('team_id'),
        scope_type: scopeType,
        collection_key: scopeType === 'collection' ? form.get('collection_key') : null,
        folder_id: scopeType === 'folder' ? form.get('folder_id') || null : null,
        project_id: scopeType === 'project' ? form.get('project_id') || null : null,
        capability: form.get('capability'),
        granted_by: state.member.id,
        expires_at: form.get('expires_at')
          ? new Date(form.get('expires_at') + 'T23:59:59Z').toISOString()
          : null,
      };
      if (
        (scopeType === 'folder' && !body.folder_id) ||
        (scopeType === 'project' && !body.project_id)
      )
        throw new Error('Choose the selected scope.');
      await db('docs_team_permissions', '', { method: 'POST', body });
      await load();
      await render();
      toast('Team capability saved.');
    },
  );
}
const draftSaves = new WeakMap();
async function saveDraft() {
  const form = document.querySelector('#editor-form');
  if (!form) throw Error('Open the document editor before saving.');
  const pending = (draftSaves.get(form) || Promise.resolve())
    .catch(() => {})
    .then(() => persistDraft(form));
  draftSaves.set(form, pending);
  try {
    return await pending;
  } finally {
    if (draftSaves.get(form) === pending) draftSaves.delete(form);
  }
}
async function persistDraft(f) {
  if (!f.isConnected) throw Error('Reopen the document editor before saving.');
  if (!f.reportValidity()) throw new Error('Complete the required fields.');
  const initialValues = JSON.stringify([...new FormData(f)]);
  const d = Object.fromEntries(new FormData(f));
  d.custom_fields = Object.create(null);
  for (const key of Object.keys(d)) {
    if (key.startsWith('field:')) {
      d.custom_fields[key.slice(6)] = d[key];
      delete d[key];
    }
  }
  d.team_id = d.team_id || null;
  d.vertical_id = d.vertical_id || null;
  d.folder_id = d.folder_id || null;
  d.artifact_path = d.artifact_path || null;
  if (d.format === 'html') d.source_type = 'HTML';
  else if (state.pages.find((p) => p.id === f.dataset.id)?.source_type === 'HTML')
    d.source_type = 'MARKDOWN';
  d.tags = d.tags
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);
  const isNew = f.dataset.new === 'true';
  const response = await db(
    'docs_pages',
    isNew ? '' : `?id=eq.${f.dataset.id}&revision=eq.${f.dataset.revision}`,
    {
      method: isNew ? 'POST' : 'PATCH',
      body: { ...d, ...(isNew ? { id: f.dataset.id } : {}) },
      headers: { Prefer: 'return=representation' },
    },
  );
  if (!response?.length)
    throw new Error(
      'Someone else updated this document. Copy your edits, then reload to review their changes.',
    );
  f.dataset.new = 'false';
  if (isNew && f.isConnected) {
    history.replaceState(null, '', routeUrl('#/edit/' + f.dataset.id));
    const crumb = document.querySelector('.editor-top .breadcrumbs>span');
    if (crumb) crumb.textContent = response[0].title;
  }
  f.dataset.revision = response[0].revision;
  state.dirty = JSON.stringify([...new FormData(f)]) !== initialValues;
  const i = state.pages.findIndex((p) => p.id === f.dataset.id);
  if (i >= 0) state.pages[i] = response[0];
  else state.pages.unshift(response[0]);
  if (
    isNew &&
    f.isConnected &&
    !document.querySelector('[data-action="publish"][aria-busy="true"]')
  ) {
    const actions = document.querySelector('.editor-top-actions');
    const focusSave = actions?.querySelector('button[type="submit"]') === document.activeElement;
    const published = state.published.find((page) => page.id === f.dataset.id);
    if (actions)
      actions.innerHTML = documentActions({
        icon,
        published,
        publishedLink: published ? publishedRoute(published, state.projects) : '',
        isNew: false,
        id: f.dataset.id,
        role: state.member.role,
        canPublish: canPublish(state.member.role),
      });
    if (focusSave) actions?.querySelector('button[type="submit"]')?.focus();
  }
  const status = f.querySelector('#save-status');
  if (status) status.textContent = state.dirty ? 'Unsaved changes' : 'Saved just now';
  return f.dataset.id;
}
async function uploadFile(file, releaseId = null, uploadOptions = {}) {
  if (!releaseId && document.querySelector('#contribution-form'))
    releaseId = await contributionEditor.ensureRelease();
  const ownerForm = document.querySelector(releaseId ? '#contribution-form' : '#editor-form');
  const ownerId = releaseId || ownerForm?.dataset.id;
  if (!ownerId) throw new Error('Open an editor before adding a file.');
  state.dirty = true;
  file = await prepareUpload(file);
  if (!releaseId && ownerForm.dataset.new === 'true') {
    const title = ownerForm.elements.title,
      slug = ownerForm.elements.slug;
    if (!title.value.trim()) title.value = 'Untitled document';
    if (!slug.value.trim()) slug.value = 'untitled-' + ownerId.slice(0, 8);
    await saveDraft();
  }
  const path =
    ownerId + '/' + crypto.randomUUID() + '-' + file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const token = await getToken();
  const r = await fetch(config.url + '/storage/v1/object/hoora-docs/' + path, {
    method: 'POST',
    headers: {
      apikey: config.key,
      ...authHeaders(token),
      'Content-Type': file.type || 'application/octet-stream',
    },
    body: file,
  });
  if (!r.ok) {
    const d = await r.json();
    throw new Error(d.message || 'Upload failed.');
  }
  const uploaded = { src: 'attachment:' + path, path, file, alt: file.name };
  if (uploadOptions.insert === false) return uploaded;
  if (!ownerForm?.isConnected)
    throw new Error('The file was uploaded. Reopen the original editor to add its link.');
  const ta = ownerForm.querySelector(releaseId ? '#entry-body' : '#body');
  const image = file.type.startsWith('image/');
  const text =
    '\n\n' +
    (image ? '!' : '') +
    '[' +
    file.name.replace(/[\[\]]/g, '') +
    '](attachment:' +
    path +
    ')\n';
  ta.setRangeText(
    text,
    ta.selectionStart ?? ta.value.length,
    ta.selectionEnd ?? ta.value.length,
    'end',
  );
  if (releaseId) contributionEditor.editor?.setMarkdown(ta.value);
  else documentRichEditor?.setMarkdown(ta.value);
  state.dirty = true;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  updateLivePreview();
  hydrateImages();
  toast(image ? 'Image added.' : 'File added.');
  return uploaded;
}
let oauthClient;
async function oauth() {
  if (!oauthClient) {
    const { createOAuthClient } = await import('./vendor/oauth.js');
    oauthClient = createOAuthClient(config.url, config.key);
  }
  return oauthClient;
}
async function appApi(path, body) {
  const token = await getToken();
  const r = await fetch(path, {
    method: 'POST',
    headers: {
      ...authHeaders(token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Unable to complete this action.');
  return data;
}
async function completeMicrosoftSignIn() {
  const params = new URLSearchParams(location.search);
  if (!params.has('code') && !params.has('error')) return;
  try {
    if (params.has('error'))
      throw new Error(params.get('error_description') || 'Microsoft sign-in was cancelled.');
    const { data, error } = await (await oauth()).auth.exchangeCodeForSession(params.get('code'));
    if (error) throw error;
    const { provider_token, provider_refresh_token, ...session } = data.session;
    saveSession(session);
    const verified = await appApi('/api/sso', { providerToken: provider_token });
    if (verified.avatar && session.user?.id) {
      try {
        localStorage.setItem(`hoora-avatar:${session.user.id}`, verified.avatar);
      } catch {}
    }
    const outlookReturn = sessionStorage.getItem('hoora-outlook-return');
    if (outlookReturn) {
      sessionStorage.setItem('hoora-outlook-token', provider_token);
      sessionStorage.removeItem('hoora-outlook-return');
    }
    history.replaceState(
      null,
      '',
      outlookReturn ? '/#/edit/' + outlookReturn : '/' + completeLoginRoute(),
    );
  } catch (err) {
    saveSession(null);
    state.authError = err.message;
    history.replaceState(null, '', '/#/login');
  } finally {
    sessionStorage.removeItem('hoora-oauth');
    sessionStorage.removeItem('hoora-oauth-user');
  }
}
async function startMicrosoftSignIn(mail = false) {
  const { error } = await (
    await oauth()
  ).auth.signInWithOAuth({
    provider: 'azure',
    options: {
      scopes:
        'email profile https://graph.microsoft.com/User.Read' +
        (mail ? ' https://graph.microsoft.com/Mail.Send' : ''),
      redirectTo: location.origin + '/?auth_callback=1',
    },
  });
  if (error) throw error;
}
function updateLivePreview() {
  const body = document.querySelector('#body');
  if (!body) return;
  const preview = document.querySelector('#live-preview');
  if (preview)
    preview.innerHTML = body.value
      ? markdown(body.value)
      : '<p class="preview-placeholder">Your formatted document will appear here.</p>';
  const count = document.querySelector('#word-count');
  if (count)
    count.textContent = (body.value.trim() ? body.value.trim().split(/\s+/).length : 0) + ' words';
  hydrateImages();
}
function updateEditorFormat() {
  const html = document.querySelector('#format')?.value === 'html';
  const md = document.querySelector('#markdown-editor'),
    artifact = document.querySelector('#html-editor');
  if (md) md.hidden = html;
  if (artifact) artifact.hidden = !html;
  document.querySelectorAll('[data-doc-format]').forEach((b) => {
    const selected = b.dataset.docFormat === (html ? 'html' : 'markdown');
    b.classList.toggle('active', selected);
    b.setAttribute('aria-pressed', String(selected));
  });
}
async function hydrateArtifacts() {
  for (const viewport of document.querySelectorAll('[data-artifact]')) {
    if (viewport.dataset.loaded === 'true') continue;
    viewport.dataset.loaded = 'true';
    try {
      const data = await appApi('/api/artifact', {
        id: viewport.dataset.artifact,
        draft: viewport.dataset.draft === 'true',
      });
      if (!viewport.isConnected) continue;
      const frame = document.createElement('iframe');
      frame.setAttribute('sandbox', 'allow-scripts allow-downloads');
      frame.referrerPolicy = 'no-referrer';
      frame.title = 'HTML artifact preview';
      frame.src = data.url;
      viewport.replaceChildren(frame);
    } catch (err) {
      viewport.innerHTML = `<div class="artifact-loading"><p class="error">${e(err.message)}</p><button class="btn outline" data-action="reload-artifact">Try again</button></div>`;
      viewport.dataset.loaded = 'false';
    }
  }
}
async function uploadHtml(file) {
  if (!/\.html?$/i.test(file.name)) throw new Error('Choose a .html or .htm file.');
  if (file.size > 10 * 1024 * 1024) throw new Error('HTML artifacts must be 10 MB or less.');
  const title = document.querySelector('#title'),
    slug = document.querySelector('#slug');
  if (!title.value) {
    title.value = file.name.replace(/\.html?$/i, '').replace(/[-_]/g, ' ');
    slug.value = slugify(title.value);
  }
  document.querySelector('#format').value = 'html';
  const id = await saveDraft();
  const name = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.html?$/i, '.html');
  const path = id + '/' + crypto.randomUUID() + '-' + name;
  const token = await getToken();
  const r = await fetch(config.url + '/storage/v1/object/hoora-docs/' + path, {
    method: 'POST',
    headers: {
      apikey: config.key,
      ...authHeaders(token),
      'Content-Type': 'text/html',
    },
    body: file,
  });
  if (!r.ok) {
    const d = await r.json();
    throw new Error(d.message || 'Unable to upload HTML.');
  }
  document.querySelector('#artifact_path').value = path;
  await saveDraft();
  state.dirty = false;
  if (routeHash() !== '#/edit/' + id) location.hash = '#/edit/' + id;
  else await render();
  toast('HTML artifact uploaded. Preview it, then publish when ready.');
}
async function pasteHtmlArtifact() {
  const source = document.querySelector('#html-source')?.value.trim() || '';
  if (!source) throw new Error('Paste HTML source before uploading.');
  if (!/<(?:!doctype\s+html|html|head|body)\b/i.test(source))
    throw new Error('Paste a complete standalone HTML page.');
  const title = document.querySelector('#title');
  if (!title.value.trim()) {
    const parsed = new DOMParser().parseFromString(source, 'text/html');
    title.value = (parsed.querySelector('title')?.textContent?.trim() || 'Untitled artifact').slice(
      0,
      250,
    );
    document.querySelector('#slug').value = slugify(title.value);
  }
  const name = (slugify(title.value) || 'pasted-artifact') + '.html';
  await uploadHtml(new File([source], name, { type: 'text/html' }));
}
async function importMarkdown(file) {
  if (file.size > 500000) throw new Error('Choose a Markdown file smaller than 500 KB.');
  const text = await file.text();
  document.querySelector('#body').value = text;
  documentRichEditor?.setMarkdown(text);
  const title = document.querySelector('#title');
  if (!title.value) {
    title.value = (
      /^#\s+(.+)$/m.exec(text)?.[1] || file.name.replace(/\.(md|markdown|txt)$/i, '')
    ).slice(0, 250);
    document.querySelector('#slug').value = slugify(title.value);
  }
  document.querySelector('#format').value = 'markdown';
  updateEditorFormat();
  updateLivePreview();
  state.dirty = true;
  toast('Markdown imported. Review the preview and save your draft.');
}
async function importDocument(file, teamId = null) {
  if (!/\.(html?|md|markdown|txt)$/i.test(file.name))
    throw new Error('Choose a Markdown, text, or HTML file.');
  const html = /\.html?$/i.test(file.name);
  if (file.size > (html ? 10 * 1024 * 1024 : 500000))
    throw new Error(
      html ? 'HTML files must be 10 MB or less.' : 'Markdown files must be smaller than 500 KB.',
    );
  const text = html ? '' : await file.text();
  const title = (
    html
      ? file.name.replace(/\.html?$/i, '')
      : /^#\s+(.+)$/m.exec(text)?.[1] || file.name.replace(/\.(md|markdown|txt)$/i, '')
  )
    .replace(/[_]/g, ' ')
    .slice(0, 250);
  const id = crypto.randomUUID();
  const baseSlug = slugify(title) || 'document';
  let importedSlug = baseSlug;
  for (let n = 2; state.pages.some((p) => p.slug === importedSlug); n++)
    importedSlug = baseSlug + '-' + n;
  await db('docs_pages', '', {
    method: 'POST',
    body: {
      id,
      title,
      slug: importedSlug,
      team_id: teamId,
      kind: 'documentation',
      body: text,
      format: html ? 'html' : 'markdown',
    },
  });
  await load();
  location.hash = '#/edit/' + id;
  await render();
  if (html) await uploadHtml(file);
  else toast('Markdown imported as a private draft.');
}
function bindEnhancements() {
  documentRichEditor?.destroy();
  documentRichEditor = null;
  const source = document.querySelector('#body');
  const root = document.querySelector('#markdown-editor .source-editor');
  if (source && root) {
    loadRichEditor()
      .then(({ mountRichEditor }) => {
        if (root.isConnected)
          documentRichEditor = mountRichEditor({
            root,
            textarea: source,
            onChange: updateLivePreview,
            resolveImage: resolveEditorImage,
            onUpload: (file) => uploadFile(file, null, { insert: false }),
            onError: (error) => toast(error.message, true),
          });
      })
      .catch(() => toast('The visual editor could not load. Markdown source is still available.'));
    source.addEventListener('input', (event) => {
      if (event.isTrusted) {
        documentRichEditor?.setMarkdown(source.value);
        updateLivePreview();
      }
    });
  }
  if (state.authError && document.querySelector('#form-error')) {
    document.querySelector('#form-error').textContent = state.authError;
    state.authError = null;
  }
  document.querySelectorAll('[data-doc-format]').forEach((b) =>
    b.addEventListener('click', () => {
      document.querySelector('#format').value = b.dataset.docFormat;
      updateEditorFormat();
      state.dirty = true;
    }),
  );
  document.querySelectorAll('[data-editor-view]').forEach((b) =>
    b.addEventListener('click', () => {
      const previous = document.querySelector('.writing-layout')?.dataset.view;
      if (previous === 'source' && b.dataset.editorView !== 'source')
        documentRichEditor?.setMarkdown(document.querySelector('#body').value);
      document.querySelector('.writing-layout').dataset.view = b.dataset.editorView;
      document
        .querySelectorAll('[data-editor-view]')
        .forEach((x) => x.classList.toggle('active', x === b));
      updateLivePreview();
    }),
  );
  document.querySelector('#body')?.addEventListener('input', updateLivePreview);
  document.querySelector('#html-upload')?.addEventListener('change', (ev) => {
    if (ev.target.files[0]) busy(null, () => uploadHtml(ev.target.files[0]));
  });
  document.querySelector('#markdown-upload')?.addEventListener('change', (ev) => {
    if (ev.target.files[0]) busy(null, () => importMarkdown(ev.target.files[0]));
  });
  const zone = document.querySelector('#html-dropzone');
  zone?.addEventListener('dragover', (ev) => {
    ev.preventDefault();
    zone.classList.add('dragging');
  });
  zone?.addEventListener('dragleave', () => zone.classList.remove('dragging'));
  zone?.addEventListener('drop', (ev) => {
    ev.preventDefault();
    zone.classList.remove('dragging');
    if (ev.dataTransfer.files[0]) busy(null, () => uploadHtml(ev.dataTransfer.files[0]));
  });
  document
    .querySelectorAll('[data-format]')
    .forEach((b) => b.addEventListener('click', () => queueMicrotask(updateLivePreview)));
}
document.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-action]');
  if (!b) return;
  const action = b.dataset.action;
  if (action === 'microsoft-login') busy(b, startMicrosoftSignIn);
  if (action === 'email-login') {
    document.querySelector('#login-methods').hidden = true;
    document.querySelector('#login-form').hidden = false;
    document.querySelector('#email')?.focus();
  }
  if (action === 'install-app')
    busy(b, async () => {
      const accepted = await pwa.install();
      if (accepted) {
        toast('Hoora Docs is being installed. Enable notifications next to receive updates.');
        setTimeout(() => {
          if (routeHash().split('?')[0] === '#/install') render();
        }, 600);
      }
    });
  if (action === 'enable-install-notifications')
    busy(b, async () => {
      await pwa.enable();
      render();
    });
  if (action === 'install-notifications-login') {
    sessionStorage.setItem('hoora-return-to', '#/install');
    location.hash = '#/login';
  }
  if (action === 'app-continue') finishAppWelcome();
  if (action === 'app-enable-notifications')
    busy(b, async () => {
      try {
        await pwa.enable();
      } catch (error) {
        toast(
          error.message || 'Notifications could not be enabled. You can turn them on later.',
          true,
        );
      }
      finishAppWelcome();
    });
  if (action === 'search') {
    const field =
      document.querySelector('#public-search') || document.querySelector('#workspace-search');
    if (field) {
      field.focus();
      field.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } else location.hash = '#/browse';
  }
  if (action === 'upload-html') document.querySelector('#html-upload').click();
  if (action === 'paste-html') busy(b, pasteHtmlArtifact);
  if (action === 'import-markdown') document.querySelector('#markdown-upload').click();
  if (action === 'reload-artifact') {
    const view =
      b.closest('.artifact-card')?.querySelector('[data-artifact]') || b.closest('[data-artifact]');
    if (view) {
      view.dataset.loaded = 'false';
      hydrateArtifacts();
    }
  }
  if (action === 'download-artifact') {
    const view = (
      b.closest('.artifact-card') || document.querySelector('.artifact-card')
    ).querySelector('[data-artifact]');
    busy(b, async () => {
      const data = await appApi('/api/artifact', {
        id: view.dataset.artifact,
        draft: view.dataset.draft === 'true',
      });
      const a = document.createElement('a');
      a.href = data.url + '&download=1';
      a.download = 'hoora-artifact.html';
      a.click();
    });
  }
  if (action === 'import-document') {
    dialog(
      `<h2>Bring your knowledge with you</h2><p class="small">Import a Markdown document or upload an HTML artifact. It starts as a private draft.</p>${teams.field({ team_id: state.team })}<div class="import-file-area"><label for="document-import">Choose a file</label><input id="document-import" type="file" accept=".md,.markdown,.txt,.html,.htm"><small>Markdown up to 500 KB. Standalone HTML up to 10 MB.</small></div><div class="dialog-actions"><button data-close class="btn outline">Cancel</button></div>`,
    );
    modal.querySelector('#document-import').addEventListener('change', async (ev) => {
      if (!ev.target.files[0]) return;
      const file = ev.target.files[0];
      const teamId = modal.querySelector('#document-team').value || null;
      if (!teamId && !['admin', 'publisher'].includes(state.member.role)) {
        toast('Choose a team before importing.', true);
        return;
      }
      modal.close();
      await busy(b, () => importDocument(file, teamId));
    });
  }
});
function bind() {
  bindReleaseDetails();
  bindPeopleBoard();
  bindSearchPage({ state, service: searchService, e, names });
  if (!document.querySelector('.assistant-panel')) assistantOpen = false;
  syncAssistantViewport();
  document.querySelectorAll('form').forEach((form) =>
    form.addEventListener(
      'invalid',
      (event) => {
        const details = event.target.closest('details');
        if (details) details.open = true;
      },
      true,
    ),
  );
  contributionEditor.mount();
  bindEnhancements();
  bindWorkspace();
  document.querySelector('#login-form')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    busy(ev.submitter, async () => {
      const form = new FormData(ev.target);
      try {
        const session = await api('/auth/v1/token?grant_type=password', {
          method: 'POST',
          body: { email: form.get('email'), password: form.get('password') },
        });
        sessionStorage.removeItem('hoora-avatar');
        saveSession({ ...session, expires_at: Date.now() / 1000 + session.expires_in });
        await load();
        location.hash = completeLoginRoute();
        await render();
      } catch (error) {
        const message = String(error?.message || '');
        document.querySelector('#form-error').textContent =
          /invalid login credentials|user not found/i.test(message)
            ? 'Unable to continue. Check your password, or use Microsoft if this is your first visit.'
            : message;
      }
    });
  });
  for (const id of ['public-search', 'workspace-search'])
    document.getElementById(id)?.addEventListener('input', (ev) => {
      state.query = ev.target.value;
      const internal = id === 'workspace-search';
      const pages = filterPages(internal ? state.pages : state.published, state)
        .filter(
          (p) => !p.deleted_at && p.kind !== 'release' && (!state.team || p.team_id === state.team),
        )
        .filter(
          (p) =>
            !internal ||
            !state.status ||
            (state.status === 'draft'
              ? !state.published.some((x) => x.id === p.id)
              : state.published.some((x) => x.id === p.id)),
        );
      document.querySelector('#document-list').innerHTML = pages.length
        ? pages.map((p) => row(p, internal)).join('')
        : empty('No matching documents', 'Try a different keyword or collection.');
    });
  document.querySelector('#status-filter')?.addEventListener('change', (ev) => {
    state.status = ev.target.value;
    render();
  });
  document.querySelectorAll('[data-kind]').forEach((b) =>
    b.addEventListener('click', () => {
      const workspace = routeHash().includes('/workspace');
      location.hash =
        '#/' +
        (workspace ? 'workspace' : 'browse') +
        '?kind=' +
        b.dataset.kind +
        (state.vertical ? '&vertical=' + state.vertical : '');
    }),
  );
  document
    .querySelectorAll('[data-member]')
    .forEach((b) => b.addEventListener('click', () => memberDialog(b.dataset.member)));
  document
    .querySelectorAll('[data-folder]')
    .forEach((b) =>
      b.addEventListener('click', () => manageLegacyOrganization('folder', b.dataset.folder)),
    );
  document
    .querySelectorAll('[data-vertical]')
    .forEach((b) =>
      b.addEventListener('click', () => organizationDialog('vertical', b.dataset.vertical)),
    );
  document.querySelectorAll('[data-delete-folder]').forEach((b) =>
    b.addEventListener('click', () =>
      confirmAction(
        'Delete folder?',
        'Documents in this folder will be kept and moved to “No folder”.',
        async () => {
          await db('docs_folders', '?id=eq.' + b.dataset.deleteFolder, {
            method: 'DELETE',
          });
          await load();
          await render();
          toast('Folder deleted.');
        },
      ),
    ),
  );
  document.querySelector('#editor-form')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (document.querySelector('#editor-form [data-uploading=true]')) {
      toast('Wait for the upload to finish before saving.', true);
      return;
    }
    busy(ev.submitter, async () => {
      await saveDraft();
      toast('Draft saved.');
    });
  });
  document.querySelector('#editor-form')?.addEventListener('input', () => (state.dirty = true));
  document.querySelector('#title')?.addEventListener('input', (ev) => {
    if (
      document.querySelector('#editor-form').dataset.new === 'true' &&
      !document.querySelector('#slug').dataset.edited
    )
      document.querySelector('#slug').value = slugify(ev.target.value);
  });
  document
    .querySelector('#slug')
    ?.addEventListener('input', (event) => (event.target.dataset.edited = 'true'));
  document.querySelectorAll('[data-format]').forEach((b) =>
    b.addEventListener('click', () => {
      const t = document.querySelector('#body'),
        a = t.selectionStart,
        z = t.selectionEnd,
        s = t.value.slice(a, z) || 'text';
      const values = {
        heading: '\n## ' + s + '\n',
        bold: '**' + s + '**',
        list: '\n- ' + s + '\n',
        quote: '\n> ' + s + '\n',
        italic: '*' + s + '*',
        link: '[' + s + '](https://example.com)',
        code: '\n```\n' + s + '\n```\n',
      };
      t.setRangeText(values[b.dataset.format], a, z, 'end');
      t.focus();
      state.dirty = true;
    }),
  );
  document.querySelector('#file-upload')?.addEventListener('change', (ev) => {
    const files = [...ev.target.files];
    ev.target.value = '';
    if (documentRichEditor && document.querySelector('.writing-layout')?.dataset.view !== 'source')
      documentRichEditor.insertFiles(files);
    else
      busy(null, async () => {
        for (const file of files) await uploadFile(file);
      });
  });
  document.querySelector('#password-form')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    busy(ev.submitter, async () => {
      await api('/auth/v1/user', {
        method: 'PUT',
        body: { password: new FormData(ev.target).get('password') },
      });
      ev.target.reset();
      toast('Your password has been updated.');
    });
  });
}
function onboarding() {
  return `<main id="main" class="onboarding"><div class="onboarding-card"><img src="/hoora-mark.png" width="44" alt="Hoora"><span class="badge published">Microsoft account verified</span><h1>Make yourself at home.</h1><p class="subtitle">Create a password for Hoora Docs. You can then use Microsoft or your email and this password to sign in.</p><p class="small">${e(state.member.email)} · This does not change your Microsoft password.</p>${passwordForm(true)}</div></main>`;
}
function passwordForm(first = false) {
  return `<form id="setup-password-form"><div class="field"><label for="setup-password">${first ? 'Create password' : 'New Hoora Docs password'}</label><input id="setup-password" name="password" type="password" minlength="12" maxlength="128" autocomplete="new-password" required><small>Use 12–128 characters.</small></div><div class="field"><label for="confirm-password">Confirm password</label><input id="confirm-password" name="confirmPassword" type="password" minlength="12" maxlength="128" autocomplete="new-password" required></div><p id="form-error" class="error" role="alert"></p><button class="btn primary">${first ? 'Set password & continue' : 'Update password'}</button></form>`;
}
function account() {
  return `<div class="layout">${settingsSidebar('account')}<main id="main" class="content account-content"><h1>Your account</h1><p class="subtitle">${e(state.member.name)} · ${e(state.member.email)}</p><section class="setting-card"><div class="section-top"><h2>Workspace access</h2><span class="badge">${e(roleName(state.member.role))}</span></div><p>${state.member.role === 'viewer' ? 'You can read team documents. Request publisher access to write documents and contribute to releases.' : 'Your workspace role controls what you can edit and publish.'}</p>${state.member.role === 'viewer' ? '<button class="btn outline" data-action="request-access">Request publisher access</button>' : ''}</section><section class="setting-card"><h2>Password</h2>${passwordForm()}</section>${state.member.auth_source === 'microsoft' ? '<section class="setting-card"><h2>Microsoft account</h2><p>Company sign-in and Outlook use your Microsoft work account.</p><a class="btn outline" href="https://myaccount.microsoft.com/" target="_blank" rel="noopener noreferrer">Manage Microsoft account</a></section>' : ''}</main></div>`;
}
function releaseHub() {
  return releaseTimeline();
}

function requestsView() {
  return `<div class="layout">${settingsSidebar('requests')}<main class="content" id="main"><h1>Requests & approvals</h1><p class="subtitle">Review publication requests and manage access to your workspace.</p>${state.requests.map((r) => `<article class="request-card"><div class="section-top"><h2>${r.kind === 'access' ? 'Editor access' : 'Publication approval'}</h2><span class="badge ${r.status === 'approved' ? 'published' : 'draft'}">${e(r.status)}</span></div><p class="small">Requested by ${e(r.requester_name)} · ${date(r.created_at)}</p>${r.page_id ? `<a class="request-document" href="#/edit/${r.page_id}">${e(state.pages.find((p) => p.id === r.page_id)?.title || 'Document')}</a>` : ''}<p>${e(r.reason)}</p>${r.resolution ? `<p class="small">Reviewer response: ${e(r.resolution)}</p>` : ''}${r.status === 'pending' && (state.member.role === 'admin' || (r.kind === 'publish' && state.member.role === 'publisher')) ? `<div class="toolbar-actions"><button class="btn primary" data-action="resolve-request" data-id="${r.id}" data-approve="true">${r.kind === 'publish' ? 'Approve & publish' : 'Approve publisher access'}</button><button class="btn outline" data-action="resolve-request" data-id="${r.id}" data-approve="false">Decline</button></div>` : ''}</article>`).join('') || empty('No requests yet', 'Your access and publication requests will appear here.')}</main></div>`;
}
async function emailPreview(id) {
  const preview = await appApi('/api/notifications', { id, action: 'preview' });
  dialog(
    `<h2>Email announcement</h2><p class="small">Test mode · Only <strong>rahul@hoora.me</strong> will receive this email. Publishing never sends an email automatically.</p><p class="small">Subject: ${e(preview.subject)}</p><iframe class="email-preview" title="Outlook email preview" sandbox=""></iframe><p class="error" role="alert"></p><div class="dialog-actions"><button class="btn outline" data-close>Close</button><button class="btn outline" data-action="connect-outlook" data-id="${id}">Connect Outlook</button><button class="btn primary" data-action="send-test-email" data-id="${id}" data-request="${crypto.randomUUID()}">Send test to Rahul</button></div>`,
  );
  modal.querySelector('iframe').srcdoc = preview.html;
}
function bindWorkspace() {
  document.querySelector('#setup-password-form')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    busy(ev.submitter, async () => {
      const f = new FormData(ev.target);
      if (f.get('password') !== f.get('confirmPassword'))
        throw new Error('The passwords do not match.');
      await appApi('/api/onboarding', Object.fromEntries(f));
      await load();
      state.dirty = false;
      location.hash = completeLoginRoute();
      await render();
      toast('Your Hoora Docs password is set.');
    });
  });
  bindSourceFiles({
    source: document.querySelector('#body'),
    upload: (file) => uploadFile(file, null, { insert: false }),
    onChange: () => {
      state.dirty = true;
      documentRichEditor?.setMarkdown(document.querySelector('#body').value);
      updateLivePreview();
    },
    onError: (error) => toast(error.message, true),
  });
}
async function resolveEditorImage(src) {
  const path = src.slice('attachment:'.length);
  if (!src.startsWith('attachment:') || !/^[a-zA-Z0-9/_.-]+$/.test(path))
    throw new Error('Invalid image attachment');
  const token = await getToken();
  const response = await fetch(config.url + '/storage/v1/object/authenticated/hoora-docs/' + path, {
    headers: { apikey: config.key, ...authHeaders(token) },
  });
  if (!response.ok) throw new Error('Image unavailable');
  const blob = await response.blob();
  if (!['image/webp', 'image/png', 'image/jpeg'].includes(blob.type))
    throw new Error('Invalid image');
  return blob;
}
async function hydrateImages() {
  for (const img of document.querySelectorAll('img[data-storage-image]:not([src])')) {
    try {
      const path = img.dataset.storageImage;
      if (!/^[a-zA-Z0-9/_.-]+$/.test(path)) continue;
      const blob = await resolveEditorImage('attachment:' + path);
      const url = URL.createObjectURL(blob);
      img.src = url;
      img.addEventListener('load', () => URL.revokeObjectURL(url), {
        once: true,
      });
    } catch {
      img.alt += ' (image unavailable)';
    }
  }
}
document.addEventListener('click', async (ev) => {
  const scroll = ev.target.closest('[data-scroll-id]');
  if (scroll) {
    ev.preventDefault();
    document
      .getElementById(scroll.dataset.scrollId)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  const b = ev.target.closest('[data-action]');
  if (!b) return;
  const a = b.dataset.action,
    id = b.dataset.id;
  if (a === 'theme') {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    const apply = () => {
      document.documentElement.dataset.theme = theme;
      localStorage.setItem('hoora-theme', theme);
      b.innerHTML =
        icon(theme === 'dark' ? 'sun' : 'moon') +
        (b.closest('.account-menu')
          ? `<span>${theme === 'dark' ? 'Light theme' : 'Dark theme'}</span>`
          : '');
      const railLogo = document.querySelector('.rail-logo');
      if (railLogo) railLogo.src = theme === 'dark' ? '/hoora-dark.png' : '/hoora-light.png';
    };
    if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const bounds = b.getBoundingClientRect(),
        x = bounds.left + bounds.width / 2,
        y = bounds.top + bounds.height / 2;
      document.documentElement.style.setProperty('--theme-x', `${x}px`);
      document.documentElement.style.setProperty('--theme-y', `${y}px`);
      document.startViewTransition(apply);
    } else apply();
    return;
  }
  if (a === 'new-project') {
    dialog(
      '<h2>New release collection</h2><form><div class="field"><label for="project-name">Application / collection name</label><input id="project-name" name="name" required maxlength="100" placeholder="e.g. Customer App"></div><div class="field"><label for="project-description">Description</label><textarea id="project-description" name="description" maxlength="500"></textarea></div><p class="error" role="alert"></p><div class="dialog-actions"><button type="button" class="btn outline" data-close>Cancel</button><button class="btn primary">Create collection</button></div></form>',
      async (f) => {
        await db('docs_projects', '', {
          method: 'POST',
          body: Object.fromEntries(f),
        });
        await load();
        await render();
      },
    );
    return;
  }
  if (a === 'new-release') {
    location.hash =
      '#/new?' +
      new URLSearchParams({
        kind: 'release',
        ...(state.project ? { project: state.project } : {}),
      });
    return;
  }
  if (a === 'delete-entry') {
    confirmAction(
      'Remove this section note?',
      'The note is removed from the editor. The published release keeps showing it until you publish an update.',
      async () => {
        await db('docs_entries', '?id=eq.' + id, { method: 'DELETE' });
        state.dirty = false;
        await load();
        await render();
        toast('Section note removed. Publish an update to remove it from the published release.');
      },
    );
    return;
  }
  if (a === 'request-access' || a === 'request-publish') {
    requestDialog(a === 'request-access' ? 'access' : 'publish', id);
    return;
  }
  if (a === 'resolve-request') {
    const approve = b.dataset.approve === 'true';
    dialog(
      `<h2>${approve ? 'Approve request' : 'Decline request'}</h2><form><div class="field"><label for="review-note">Response (optional)</label><textarea id="review-note" name="note" maxlength="2000"></textarea></div><p class="error" role="alert"></p><div class="dialog-actions"><button type="button" class="btn outline" data-close>Cancel</button><button class="btn primary">${approve ? 'Confirm approval' : 'Decline request'}</button></div></form>`,
      async (f) => {
        await api('/rest/v1/rpc/docs_resolve_request', {
          method: 'POST',
          body: { request_id: id, approve, note: f.get('note') },
        });
        await load();
        await render();
        toast('Request ' + (approve ? 'approved.' : 'declined.'));
      },
    );
    return;
  }
  if (a === 'publish-release' || a === 'unpublish-release') {
    await busy(b, async () => {
      await api('/rest/v1/rpc/' + (a === 'publish-release' ? 'docs_publish' : 'docs_unpublish'), {
        method: 'POST',
        body: { page_id: id },
      });
      if (a === 'publish-release') appApi('/api/ai-index', { documentId: id }).catch(() => {});
      await load();
      await render();
      toast(
        a === 'publish-release'
          ? 'Release published. No email has been sent.'
          : 'Release unpublished.',
      );
    });
    return;
  }
  if (a === 'delete-release') {
    confirmAction(
      'Delete this release?',
      'The release, contributions, and organization page will be permanently removed.',
      async () => {
        await appApi('/api/content', { action: 'delete', id });
        await load();
        location.hash = '#/releases';
        toast('Release deleted.');
      },
    );
    return;
  }
  if (a === 'email-preview') {
    await busy(b, () => emailPreview(id));
    return;
  }
  if (a === 'connect-outlook') {
    await busy(b, async () => {
      sessionStorage.setItem('hoora-outlook-return', id);
      await startMicrosoftSignIn(true);
    });
    return;
  }
  if (a === 'send-test-email') {
    await busy(b, async () => {
      const providerToken = sessionStorage.getItem('hoora-outlook-token');
      if (!providerToken)
        throw new Error('Connect Outlook first to grant permission to send this test email.');
      await appApi('/api/notifications', {
        id,
        action: 'send-test',
        requestId: b.dataset.request,
        providerToken,
      });
      toast('Test email sent only to rahul@hoora.me.');
      modal.close();
    });
    return;
  }
});

function manageLegacyOrganization(type, id) {
  return manageStructure(type, id);
}

function toneIcon(name = 'documentation', color = 'blue') {
  const tone = ['blue', 'green', 'violet', 'orange', 'slate'].includes(color) ? color : 'blue';
  return `<span class="tone-icon tone-${tone}">${icon(name)}</span>`;
}
function roleName(role) {
  return (
    {
      admin: 'Administrator',
      manager: 'Manager',
      publisher: 'Publisher',
      contributor: 'Editor',
      viewer: 'Viewer',
    }[role] || role
  );
}
/** Release notes are organization-wide; documents use their own sharing mode. */
function pageAccess(p) {
  return p.kind === 'release' ? 'private' : p.visibility || 'private';
}
/** Who can see a document, in plain words: "Organization", "Operations Team + 2 teams", … */
function accessText(p) {
  const access = pageAccess(p);
  if (access === 'private') return 'Organization';
  const shared = state.pageTeamAccess.filter((grant) => grant.page_id === p.id).length;
  const extra = shared ? ` + ${shared} ${shared === 1 ? 'team' : 'teams'}` : '';
  if (access === 'team')
    return (state.teams.find((team) => team.id === p.team_id)?.name || 'Team') + extra;
  return shared ? `${shared} ${shared === 1 ? 'team' : 'teams'} and people` : 'Specific people';
}
function typeFields(p) {
  const type = state.types.find((t) => t.key === p.kind);
  return `<div id="custom-fields">${(type?.fields || []).map((label) => `<div class="field"><label>${e(label)}<input name="field:${e(label)}" maxlength="2000" value="${e(p.custom_fields?.[label] || '')}"></label></div>`).join('')}</div>`;
}
function visibilityField(p) {
  return `<p class="properties-help">${icon('lock')}${p.team_id ? 'Team documents start visible to their team only.' : 'Visible to everyone at Hoora.'} Use Share on the published page to change who can see it.</p>`;
}
function customFieldList(p) {
  const pairs = Object.entries(p.custom_fields || {}).filter(([, value]) => value);
  return pairs.length
    ? `<dl class="custom-details">${pairs.map(([label, value]) => `<div><dt>${e(label)}</dt><dd>${e(value)}</dd></div>`).join('')}</dl>`
    : '';
}
function releaseRecords(publishedOnly = false) {
  const drafts = state.member && canEdit(state.member.role) && !publishedOnly;
  const source = drafts ? state.pages : state.published;
  return source
    .filter((p) => p.kind === 'release' && !p.deleted_at)
    .map((p) => {
      const relation = state.releases.find((r) => r.id === p.id);
      const projectId = relation?.project_id || p.project_id || 'other';
      const rawProject = state.projects.find((c) => c.id === projectId) || {
        id: projectId,
        name: p.release_snapshot?.project || 'Other releases',
        icon: p.release_snapshot?.project_icon || 'release',
        color: p.release_snapshot?.project_color || 'violet',
      };
      const project = { ...rawProject, name: displayPlatformName(rawProject.name) };
      const notes =
        drafts && relation
          ? state.entries
              .filter((n) => n.release_id === p.id)
              .map((n) => ({
                ...n,
                vertical: verticalName(n.vertical_id),
                vertical_icon: state.verticals.find((v) => v.id === n.vertical_id)?.icon,
                vertical_color: state.verticals.find((v) => v.id === n.vertical_id)?.color,
                author: n.author_name,
                edited_by: n.updated_name,
              }))
          : p.release_snapshot?.entries || [];
      return {
        page: p,
        project,
        notes,
        draft: drafts,
        version: versionKey(p.version || p.release_snapshot?.version || 'Unversioned'),
        published: state.published.find((x) => x.id === p.id),
      };
    });
}
/** One tree for the whole release area: platforms, the active platform's versions, upcoming. */
function releaseSidebar({ projectId = '', pageId = '', upcomingActive = false } = {}) {
  const records = releaseRecords(true);
  const platforms = [
    ...new Map(
      [
        ...records.map((r) => r.project),
        ...(['admin', 'publisher'].includes(state.member?.role) ? state.projects : []),
      ].map((p) => [p.id, p]),
    ).values(),
  ].sort((a, b) => a.name.localeCompare(b.name));
  const platformLinks = platforms
    .map((p) => {
      const active = p.id === projectId;
      return `<a class="sidelink ${active ? 'active' : ''}" href="#/releases?project=${encodeURIComponent(p.slug || slugify(p.name))}" ${active ? 'aria-current="page"' : ''}>${icon(p.icon)}<span>${e(displayPlatformName(p.name))}</span></a>`;
    })
    .join('');
  return `<aside class="sidebar release-sidebar" aria-label="Release notes"><a class="sidelink ${!projectId && !upcomingActive ? 'active' : ''}" href="#/releases">${icon('grid')}<span>All platforms</span></a>${platformLinks}${state.member ? `<div class="rail-label">Planning${state.member.role === 'admin' ? `<a class="iconbtn" href="#/upcoming?create=1" aria-label="Add upcoming release" title="Add upcoming release">${icon('plus')}</a>` : ''}</div><a class="sidelink ${upcomingActive ? 'active' : ''}" href="#/upcoming">${icon('clock')}<span>Upcoming releases</span></a>` : ''}</aside>`;
}

/** Releases an editor can still act on: never published, or with sections not yet published. */
function releaseWorkQueue(projectId = '') {
  if (!state.member || !canEdit(state.member.role)) return [];
  return state.pages
    .filter((page) => page.kind === 'release' && !page._readOnly && !page.deleted_at)
    .map((page) => {
      const release = state.releases.find((item) => item.id === page.id);
      const project = state.projects.find((item) => item.id === release?.project_id);
      const published = state.published.find((item) => item.id === page.id);
      const entries = state.entries.filter((item) => item.release_id === page.id);
      const statuses = entries.map((entry) => sectionStatus(entry, published).key);
      const waiting = statuses.filter((key) => key !== 'published').length;
      return { page, release, project, published, entries, waiting };
    })
    .filter(
      (item) =>
        item.release &&
        item.project &&
        (!projectId || item.project.id === projectId) &&
        (!item.published || item.waiting),
    )
    .sort((a, b) => compareVersions(versionKey(a.page.version), versionKey(b.page.version)));
}

function releaseTimeline() {
  const all = releaseRecords(true);
  const applicationSource = [
    ...all.map((r) => r.project),
    ...(['admin', 'publisher'].includes(state.member?.role) ? state.projects : []),
  ];
  const applications = [...new Map(applicationSource.map((p) => [p.id, p])).values()],
    current = applications.find((p) => p.id === state.project);
  const records = all
    .filter((r) => !current || r.project.id === current.id)
    .sort((a, b) => new Date(b.page.published_at) - new Date(a.page.published_at));
  const days = new Map();
  for (const record of records) {
    const day = record.page.published_at.slice(0, 10);
    if (!days.has(day)) days.set(day, []);
    days.get(day).push(record);
  }
  const platformName = (p) => displayPlatformName(p.name);
  const queue = releaseWorkQueue(current?.id);
  const canStart = ['admin', 'publisher'].includes(state.member?.role);
  const rail = releaseSidebar({ projectId: current?.id || '' });
  const work = queue.length
    ? `<section class="release-queue" aria-labelledby="release-queue-title"><div class="release-queue-heading"><h2 id="release-queue-title">In progress</h2></div>${queue
        .map(
          (item) =>
            `<a class="release-queue-item" href="#/contribute/${e(item.page.id)}">${toneIcon(item.project.icon, item.project.color)}<span><strong>${e(platformName(item.project))} · v${e(versionKey(item.page.version))}</strong><small>${item.published ? `${item.waiting} unpublished` : `Draft · ${item.entries.length}/${contributionEditor.sections(item.project.id).length} sections`}</small></span>${icon('chevron')}</a>`,
        )
        .join('')}</section>`
    : '';
  return `<div class="layout release-layout timeline-layout">${rail}<main id="main" class="release-reader timeline-reader"><div class="reader-heading"><div><h1>${current ? e(platformName(current)) : 'Release notes'}</h1></div>${canStart ? `<button class="btn dark" data-action="new-release">${icon('plus')}New release</button>` : ''}</div>${work}<div class="timeline-list">${
    [...days]
      .map(
        ([day, items]) =>
          `<section class="timeline-day"><h2><time datetime="${day}">${date(day)}</time></h2><div class="timeline-day-items">${items
            .map((r) => {
              const version = r.version === 'Unversioned' ? 'Update' : 'v' + r.version,
                link = publishedRoute(r.page, state.projects);
              return `<a class="timeline-item" href="${link}">${toneIcon(r.project.icon, r.project.color)}<div class="release-row-copy"><h3>${e(platformName(r.project))} <span>· ${e(version)}</span></h3></div><span class="release-row-open" aria-hidden="true">${icon('chevron')}</span></a>`;
            })
            .join('')}</div></section>`,
      )
      .join('') || empty('No published releases yet', 'Published versions will appear here.')
  }</div></main></div>`;
}

function updateReleaseSectionTabs() {
  const nav = document.querySelector('.version-section-tabs');
  if (!nav) return;
  const sections = [...document.querySelectorAll('.native-release-body .release-section')];
  const tabs = [...nav.querySelectorAll('[data-section-key]')];
  if (!sections.length) return;
  if (nav.dataset.filtered === 'true') return;
  const navRect = nav.getBoundingClientRect(),
    stickyTop = parseFloat(getComputedStyle(nav).top) || 0;
  const threshold = navRect.bottom + 48;
  let current = '';
  if (navRect.top <= stickyTop + 1)
    for (const section of sections)
      if (section.getBoundingClientRect().top <= threshold)
        current = section.id.slice('section-'.length);
  if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2)
    current = sections.at(-1).id.slice('section-'.length);
  tabs.forEach((tab) => {
    const active = tab.dataset.sectionKey === current;
    tab.classList.toggle('active', active);
    if (active) tab.setAttribute('aria-current', 'location');
    else tab.removeAttribute('aria-current');
  });
}
window.addEventListener('scroll', updateReleaseSectionTabs, { passive: true });

/** One published section: the complete Markdown note its owner pasted. */
function releaseSection(note, { heading = true, editHref = '' } = {}) {
  const name = note.vertical || 'General';
  const vertical = state.verticals.find(
    (item) => item.id === note.vertical_id || item.name === name,
  );
  const by = note.edited_by || note.author || 'Hoora team';
  return `<section class="release-section" id="section-${slugify(name)}" tabindex="-1">${heading ? `<div class="release-section-heading">${toneIcon(note.vertical_icon || vertical?.icon || 'grid', note.vertical_color || vertical?.color || 'slate')}<h2>${e(name)}</h2><span class="release-section-meta">${e(by)}${note.updated_at ? ' · ' + date(note.updated_at) : ''}</span>${editHref ? `<a class="btn text release-section-edit" href="${editHref}" aria-label="Edit ${e(name)} note">${icon('edit')}<span>Edit</span></a>` : ''}</div>` : ''}<article class="release-change release-change-complete"><div class="prose release-change-copy">${markdown(note.body || '')}</div></article></section>`;
}

/** The only place versions are listed inside a release: a compact switcher by the title. */
function versionSwitcher(project, page) {
  const versions = releaseRecords(true)
    .filter((r) => r.project.id === project.id)
    .sort((a, b) => compareVersions(a.version, b.version));
  const current = 'v' + e(versionKey(page.version));
  if (versions.length < 2) return `<span class="native-release-version">${current}</span>`;
  return `<label class="version-switch"><span class="sr-only">Version</span><select data-version-switch aria-label="Version">${versions
    .map(
      (r) =>
        `<option value="${e(publishedRoute(r.page, state.projects))}" ${r.page.id === page.id ? 'selected' : ''}>v${e(r.version)}</option>`,
    )
    .join('')}</select></label>`;
}
function releaseDocumentNew(p) {
  const records = releaseRecords(true),
    record = records.find((r) => r.page.id === p.id);
  const project = record?.project || {
    id: p.project_id || '',
    name: p.release_snapshot?.project || 'Release notes',
    icon: p.release_snapshot?.project_icon || 'release',
    color: p.release_snapshot?.project_color || 'slate',
  };
  const allNotes = record?.notes || p.release_snapshot?.entries || [];
  const selectedSection = allNotes.some(
    (note) => slugify(note.vertical || 'General') === state.section,
  )
    ? state.section
    : '';
  const notes = selectedSection
    ? allNotes.filter((note) => slugify(note.vertical || 'General') === selectedSection)
    : allNotes;
  const rail = releaseSidebar({ projectId: project.id, pageId: p.id });
  const editable =
    canEdit(state.member?.role) && state.pages.some((page) => page.id === p.id && !page._readOnly);
  const editHref = (name) =>
    '#/contribute/' + e(p.id) + (name ? '?section=' + encodeURIComponent(slugify(name)) : '');
  const releaseLink = publishedRoute(p, state.projects);
  const configured = editable
    ? contributionEditor
        .sections(project.id)
        .filter((section) => !allNotes.some((note) => note.vertical === section.name))
    : [];
  const tabs =
    allNotes.length > 1
      ? `<nav class="version-section-tabs" data-filtered="${selectedSection ? 'true' : 'false'}" aria-label="Release sections"><a class="${!selectedSection ? 'active' : ''}" data-section-key="" href="${releaseLink}">${icon('grid')}<span>All</span></a>${allNotes
          .map((note) => {
            const name = note.vertical || 'General',
              slug = slugify(name),
              vertical = state.verticals.find((item) => item.name === name);
            return `<a class="${selectedSection === slug ? 'active' : ''}" data-section-key="${e(slug)}" href="${releaseLink}?section=${encodeURIComponent(slug)}">${toneIcon(note.vertical_icon || vertical?.icon || 'grid', note.vertical_color || vertical?.color || 'slate')}<span>${e(name)}</span></a>`;
          })
          .join('')}</nav>`
      : '';
  const missing =
    configured.length && !selectedSection
      ? `<section class="release-missing" aria-label="Sections without a note"><h2>Not in this release yet</h2>${configured.map((section) => `<a href="${editHref(section.name)}">${toneIcon(section.icon, section.color)}<span>${e(section.name)}</span><small>${icon('plus')}Add note</small></a>`).join('')}</section>`
      : '';
  return `<div class="layout release-layout native-release-layout">${rail}<main id="main" class="native-release-reader"><div class="native-release-document"><header class="native-release-header"><h1 class="native-release-title"><span class="native-release-platform">${e(project.name)}</span>${versionSwitcher(project, p)}</h1><div class="native-release-meta"><div class="native-release-facts"><time datetime="${e(p.published_at)}">Released ${date(p.published_at)}</time></div><div class="native-release-actions"><button type="button" class="btn outline" data-action="copy-link">${icon('link')}Copy link</button></div></div></header>${tabs}<div class="native-release-body">${notes.length ? notes.map((note) => releaseSection(note, { heading: true, editHref: editable ? editHref(note.vertical) : '' })).join('') : `<div class="prose">${markdown(p.body)}</div>`}${missing}</div>${features.pageTools(p)}</div></main></div>`;
}

function nativeArtifact(page, draft) {
  state.nativeTitle = page.title;
  state.nativeBack = draft ? '#/edit/' + page.id : '#/doc/' + page.slug;
  state.nativeDraft = draft;
  return `<main id="main" class="native-artifact">${artifactFrame(page, draft, true)}</main>`;
}
function draftPreview(id) {
  const page = state.pages.find((p) => p.id === id);
  if (!page || page._readOnly || !canEdit(state.member?.role))
    throw new Error('Publisher access is required to preview drafts.');
  if (page.format === 'html') return nativeArtifact(page, true);
  // Release sections are previewed inside the release editor.
  if (state.releases.some((r) => r.id === id)) return contributionEditor.view(id);
  return documentPage(page, true);
}
function publicView() {
  const docs = filterPages(state.published, state).filter((p) => p.kind !== 'release');
  const title = state.team
    ? state.teams.find((t) => t.id === state.team)?.name
    : names[state.kind] || 'All documents';
  return `<div class="layout">${sidebar(false)}<main id="main" class="library-content"><div class="view-heading"><div><h1>${e(title || 'All documents')}</h1></div></div><div class="library-tools"><label class="search compact"><span class="sr-only">Search documents</span>${icon('search')}<input id="public-search" type="search" value="${e(state.query)}" placeholder="Search documents…"></label></div><div id="document-list" class="document-table">${docs.map((p) => row(p)).join('') || empty('Nothing here yet', 'Documents shared with you will appear here.')}</div></main></div>`;
}
function projectSectionSettings() {
  return `<section class="settings-section"><div class="section-heading"><div><h2>Application sections</h2><p>Choose reusable release sections for each application. Archived sections stay in older releases.</p></div></div>${state.projects
    .map((project) => {
      const rows = state.projectSections.filter(
        (row) => row.project_id === project.id && row.active,
      );
      const labels = rows
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((row) => state.verticals.find((section) => section.id === row.vertical_id)?.name)
        .filter(Boolean);
      return `<div class="structure-row"><span class="structure-project-icon">${toneIcon(project.icon, project.color)}</span><div><strong>${e(project.name)}</strong><small>${labels.length ? e(labels.join(' · ')) : 'No sections configured'}</small></div><button class="btn outline" data-action="configure-project-sections" data-id="${project.id}">Configure sections</button></div>`;
    })
    .join('')}</section>`;
}
function configureProjectSections(projectId) {
  if (state.member?.role !== 'admin')
    throw new Error('Application section configuration is unavailable.');
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) throw new Error('Application not found.');
  const existing = new Map(
    state.projectSections
      .filter((row) => row.project_id === projectId)
      .map((row) => [row.vertical_id, row]),
  );
  dialog(
    `<h2>${e(project.name)} sections</h2><p class="small">Choose which sections contributors can use in future releases. An existing contribution remains readable if its section is removed.</p><form><div class="section-choice-list">${state.verticals
      .map((section, index) => {
        const row = existing.get(section.id);
        return `<div class="section-choice"><label><input type="checkbox" name="section" value="${section.id}" ${row?.active ? 'checked' : ''}>${toneIcon(section.icon, section.color)}<span>${e(section.name)}</span></label><label class="section-order">Order <input type="number" name="order:${section.id}" min="0" max="999" value="${row?.sort_order ?? index}" aria-label="Order for ${e(section.name)}"></label></div>`;
      })
      .join(
        '',
      )}</div><p class="error" role="alert"></p><div class="dialog-actions"><button type="button" class="btn outline" data-close>Cancel</button><button class="btn dark">Save sections</button></div></form>`,
    async (form) => {
      const selected = new Set(form.getAll('section'));
      for (const section of state.verticals) {
        const row = existing.get(section.id),
          active = selected.has(section.id);
        const sort_order = Number(form.get(`order:${section.id}`));
        if (!Number.isInteger(sort_order) || sort_order < 0 || sort_order > 999)
          throw new Error('Section order must be between 0 and 999.');
        if (row)
          await db(
            'docs_project_sections',
            `?project_id=eq.${projectId}&vertical_id=eq.${section.id}`,
            { method: 'PATCH', body: { active, sort_order } },
          );
        else if (active)
          await db('docs_project_sections', '', {
            method: 'POST',
            body: { project_id: projectId, vertical_id: section.id, active: true, sort_order },
          });
      }
      await load();
      await render();
      toast('Application sections updated.');
    },
  );
}
function structureView() {
  const card = (kind, item) =>
    `<div class="structure-row">${toneIcon(item.icon, item.color)}<div><strong>${e(item.name)}</strong><small>${kind === 'vertical' ? 'Release section' : 'Organization access'}${item.parent_id ? ' · inside ' + e(state.folders.find((f) => f.id === item.parent_id)?.name || 'folder') : ''}</small></div><button class="btn outline" data-action="manage-${kind}" data-id="${item.id}">Edit</button><button class="iconbtn danger" data-action="remove-${kind}" data-id="${item.id}" aria-label="Delete ${e(item.name)}">${icon('trash')}</button></div>`;
  return `<div class="layout">${settingsSidebar('folders')}<main id="main" class="settings-content"><div class="view-heading"><div><h1>Structure & visibility</h1><p>Organize content, choose icons, and control Hoora organization access.</p></div></div><section class="settings-section"><div class="section-heading"><div><h2>Release applications</h2><p>Each application has its own versions. All applications can share a version view.</p></div><button class="btn dark" data-action="manage-project">New application</button></div>${state.projects.map((p) => card('project', p)).join('')}</section>${projectSectionSettings()}<section class="settings-section"><div class="section-heading"><div><h2>Library folders</h2><p>Nested folders organize SOPs and documentation. All content requires organization access.</p></div><button class="btn outline" data-action="manage-folder">New folder</button></div>${state.folders.map((f) => card('folder', f)).join('') || '<p class="muted">No folders yet.</p>'}</section><section class="settings-section"><div class="section-heading"><div><h2>Release sections</h2><p>Vertical headings used within each application’s release.</p></div><button class="btn outline" data-action="manage-vertical">New section</button></div>${state.verticals.map((v) => card('vertical', v)).join('')}</section><section class="settings-section"><div class="section-heading"><div><h2>Document collections & fields</h2><p>Add document types, icons, default access, and optional custom text fields.</p></div><button class="btn outline" data-action="manage-type">New collection</button></div>${state.types.map((t) => `<div class="structure-row">${toneIcon(t.icon, t.color)}<div><strong>${e(t.name)}</strong><small>Organization access${t.fields.length ? ' · ' + e(t.fields.join(', ')) : ''}</small></div><button class="btn outline" data-action="manage-type" data-id="${t.key}">Edit</button>${!['release', 'sop', 'documentation'].includes(t.key) ? `<button class="iconbtn danger" data-action="remove-type" data-id="${t.key}" aria-label="Delete ${e(t.name)}">${icon('trash')}</button>` : ''}</div>`).join('')}</section></main></div>`;
}
function appearanceFields(item = {}) {
  return `<div class="form-columns"><div class="field"><label for="structure-icon">Icon</label><select id="structure-icon" name="icon">${['folder', 'book', 'documentation', 'release', 'phone', 'web', 'settings', 'car', 'tool', 'bag', 'users', 'grid', 'check'].map((k) => `<option value="${k}" ${item.icon === k ? 'selected' : ''}>${k}</option>`).join('')}</select></div><div class="field"><label for="structure-color">Icon color</label><select id="structure-color" name="color">${['blue', 'green', 'violet', 'orange', 'slate'].map((c) => `<option ${item.color === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div></div>`;
}
function manageStructure(kind, id) {
  if (state.member.role !== 'admin') throw new Error('Administrator access required.');
  const table = {
    project: 'docs_projects',
    folder: 'docs_folders',
    vertical: 'docs_verticals',
    type: 'docs_types',
  }[kind];
  const items = {
    project: state.projects,
    folder: state.folders,
    vertical: state.verticals,
    type: state.types,
  }[kind];
  const item = items.find((x) => (x.id || x.key) === id) || {};
  dialog(
    `<h2>${id ? 'Edit' : 'New'} ${kind === 'project' ? 'application' : kind === 'vertical' ? 'release section' : kind === 'type' ? 'document collection' : 'folder'}</h2><form><div class="field"><label for="structure-name">Name</label><input id="structure-name" name="name" required maxlength="80" value="${e(item.name || '')}"></div>${kind === 'project' || kind === 'vertical' ? `<div class="field"><label for="structure-description">Description</label><textarea id="structure-description" name="description" maxlength="500">${e(item.description || '')}</textarea></div>` : ''}${appearanceFields(item)}${kind !== 'vertical' ? `<div class="field"><label for="structure-visibility">${kind === 'type' ? 'Default document access' : 'Access'}</label><select id="structure-visibility" name="${kind === 'type' ? 'default_visibility' : 'visibility'}"><option value="private" selected>Everyone at Hoora</option></select></div>` : ''}${
      kind === 'folder'
        ? `<div class="field"><label for="parent-folder">Parent folder</label><select name="parent_id" id="parent-folder">${options(
            state.folders.filter((f) => f.id !== id),
            item.parent_id,
            'Top level',
          )}</select></div>`
        : ''
    }${kind === 'type' ? `<div class="field"><label for="custom-labels">Custom fields</label><textarea name="fields" id="custom-labels" placeholder="Owner, Sprint, Reference URL">${e((item.fields || []).join(', '))}</textarea><small>Up to 10 optional text fields, separated by commas.</small></div>` : ''}<p class="error" role="alert"></p><div class="dialog-actions"><button type="button" class="btn outline" data-close>Cancel</button><button class="btn dark">Save ${kind === 'project' ? 'application' : kind === 'vertical' ? 'section' : kind === 'type' ? 'collection' : 'folder'}</button></div></form>`,
    async (f) => {
      const body = Object.fromEntries(f);
      if (kind === 'folder') body.parent_id = body.parent_id || null;
      if (kind === 'type') {
        body.fields = [
          ...new Set(
            body.fields
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean),
          ),
        ];
        if (body.fields.length > 10 || body.fields.some((s) => s.length > 80))
          throw new Error('Use up to 10 field labels, each at most 80 characters.');
        if (!id) body.key = slugify(body.name).slice(0, 40);
      }
      await db(
        table,
        id ? '?' + (kind === 'type' ? 'key' : 'id') + '=eq.' + encodeURIComponent(id) : '',
        { method: id ? 'PATCH' : 'POST', body },
      );
      await load();
      await render();
      toast('Structure updated. Access changes apply immediately.');
    },
  );
}
function releaseDetails(id) {
  const page = state.pages.find((page) => page.id === id);
  if (!page || !canEdit(state.member?.role) || page._readOnly)
    throw Error('You cannot edit this release.');
  return `<div class="layout">${releaseSidebar({ projectId: state.releases.find((r) => r.id === id)?.project_id || '' })}<main id="main" class="settings-content"><div class="view-heading"><div><a class="native-back" href="#/edit/${e(id)}">${icon('back')}Release</a><h1>Release settings</h1></div></div><form id="release-details-form" class="upcoming-settings-form" data-id="${e(id)}" data-revision="${page.revision}"><div class="field"><label for="release-title">Title</label><input id="release-title" name="title" value="${e(page.title)}" required maxlength="250"></div><div class="field"><label for="release-summary">Summary</label><textarea id="release-summary" name="summary" maxlength="500">${e(page.summary)}</textarea></div><div class="field"><label for="release-slug">Page URL</label><input id="release-slug" name="slug" value="${e(page.slug)}" pattern="[a-z0-9]+(-[a-z0-9]+)*" required></div>${typeFields(page)}${visibilityField(page)}<p id="form-error" class="error" role="alert"></p><div class="upcoming-settings-actions"><a class="btn outline" href="#/edit/${e(id)}">Cancel</a><button type="submit" class="btn dark">Save settings</button></div></form></main></div>`;
}
function bindReleaseDetails() {
  const form = document.querySelector('#release-details-form');
  if (!form) return;
  form.addEventListener('input', () => (state.dirty = true));
  form.addEventListener('change', () => (state.dirty = true));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await busy(event.submitter, async () => {
      form.querySelector('.error').textContent = '';
      const snapshot = JSON.stringify([...new FormData(form)]),
        body = Object.fromEntries(new FormData(form));
      body.custom_fields = Object.create(null);
      for (const key of Object.keys(body))
        if (key.startsWith('field:')) {
          body.custom_fields[key.slice(6)] = body[key];
          delete body[key];
        }
      const result = await db(
        'docs_pages',
        `?id=eq.${form.dataset.id}&revision=eq.${form.dataset.revision}`,
        { method: 'PATCH', body, headers: { Prefer: 'return=representation' } },
      );
      if (!result.length) throw Error('This release changed. Reload and try again.');
      if (!form.isConnected) return;
      form.dataset.revision = result[0].revision;
      state.dirty = snapshot !== JSON.stringify([...new FormData(form)]);
      await load();
      if (!state.dirty) location.hash = '#/edit/' + form.dataset.id;
      toast(
        state.dirty
          ? 'Earlier edits saved. Your latest changes are still unsaved.'
          : 'Release settings saved.',
      );
    });
  });
}
document.addEventListener('click', async (ev) => {
  const b = ev.target.closest('[data-action]');
  if (!b) return;
  const action = b.dataset.action,
    id = b.dataset.id;
  if (action === 'configure-project-sections') {
    configureProjectSections(id);
    return;
  }
  if (action.startsWith('manage-')) {
    await busy(b, () => manageStructure(action.slice(7), id));
    return;
  }
  if (action.startsWith('remove-')) {
    const kind = action.slice(7);
    if (state.member?.role !== 'admin') return;
    confirmAction(
      'Delete this ' + kind + '?',
      kind === 'project'
        ? 'This permanently removes the application, all its releases, contributions, and published copies.'
        : 'Items still referenced by documents cannot be deleted. Deleting a folder keeps its documents and moves child folders to the top level.',
      async () => {
        if (kind === 'project') await appApi('/api/content', { action: 'delete-project', id });
        else
          await db(
            { folder: 'docs_folders', vertical: 'docs_verticals', type: 'docs_types' }[kind],
            '?' + (kind === 'type' ? 'key' : 'id') + '=eq.' + encodeURIComponent(id),
            { method: 'DELETE' },
          );
        await load();
        await render();
        toast('Deleted.');
      },
    );
    return;
  }

  if (action === 'open-draft-preview') {
    if (document.querySelector('#editor-form [data-uploading=true]')) {
      toast('Wait for the upload to finish before previewing.', true);
      return;
    }
    await busy(b, async () => {
      const id = await saveDraft();
      location.hash = '#/preview/' + id;
    });
    return;
  }
  if (action === 'native-fullscreen') {
    await busy(b, () => document.querySelector('.native-artifact').requestFullscreen());
  }
});
document.addEventListener('change', (ev) => {
  if (ev.target.matches('[data-version-switch]')) location.hash = ev.target.value;
  if (ev.target.id === 'release-app')
    location.hash =
      '#/releases?' +
      new URLSearchParams({
        project: ev.target.value,
        version: state.version || '',
        ...(state.view ? { view: state.view } : {}),
      });
  if (ev.target.id === 'kind') {
    const holder = document.querySelector('#custom-fields');
    if (holder) {
      const p =
        state.pages.find((p) => p.id === document.querySelector('#editor-form').dataset.id) || {};
      holder.outerHTML = typeFields({ ...p, kind: ev.target.value });
    }
  }
});

function globalSearch() {
  if (routeHash().startsWith('#/search')) {
    document.querySelector('#global-query')?.focus();
    return;
  }
  const go = () => {
    state.dirty = false;
    location.hash = '#/search';
  };
  if (state.dirty)
    confirmAction(
      'Leave without saving?',
      'Save your draft before searching to keep your changes.',
      go,
    );
  else go();
}
document.addEventListener('click', (ev) => {
  if (ev.target.closest('[data-action="global-search"]')) globalSearch();
});
document.addEventListener('keydown', (ev) => {
  if (
    (ev.ctrlKey || ev.metaKey) &&
    ev.key === 'k' &&
    !document.querySelector('#workspace-search,#public-search')
  ) {
    ev.preventDefault();
    globalSearch();
  }
});

document.addEventListener('click', async (ev) => {
  const file = ev.target.closest('[data-file]');
  if (file) {
    await busy(file, async () => {
      const p = file.dataset.file;
      if (!/^[a-zA-Z0-9/_.-]+$/.test(p)) throw new Error('Invalid attachment');
      const token = await getToken();
      const r = await fetch(config.url + '/storage/v1/object/authenticated/hoora-docs/' + p, {
        headers: { apikey: config.key, ...authHeaders(token) },
      });
      if (!r.ok) throw new Error('This attachment is unavailable or you don’t have access.');
      const u = URL.createObjectURL(await r.blob());
      const a = document.createElement('a');
      a.href = u;
      a.download = p
        .split('/')
        .at(-1)
        .replace(/^[a-f0-9-]{37}/, '');
      a.click();
      setTimeout(() => URL.revokeObjectURL(u), 30000);
    });
    return;
  }
  const b = ev.target.closest('[data-action]');
  if (!b) return;
  const action = b.dataset.action;
  if (action === 'rail-toggle') {
    const pinned = document.body.classList.contains('rail-collapsed');
    localStorage.setItem('hoora-rail-pinned', String(pinned));
    document.body.classList.toggle('rail-collapsed', !pinned);
    document.body.classList.toggle('rail-hover-suppressed', !pinned);
    b.innerHTML = icon(pinned ? 'panelClose' : 'panelOpen');
    b.setAttribute('aria-label', pinned ? 'Allow sidebar to collapse' : 'Keep sidebar expanded');
    b.title = pinned ? 'Allow sidebar to collapse' : 'Keep sidebar expanded';
    return;
  }
  if (action === 'about-maker') return maker.about();
  if (action === 'report-issue') return maker.report();
  if (action === 'feedback-resolve' && state.member?.role === 'admin') {
    await busy(b, async () => {
      await db('docs_feedback', '?id=eq.' + b.dataset.id, {
        method: 'PATCH',
        body: { status: 'resolved' },
      });
      await render();
    });
    return;
  }
  if (action === 'feedback-screenshot' && state.member?.role === 'admin') {
    const blob = await resolveEditorImage('attachment:' + b.dataset.path);
    const url = URL.createObjectURL(blob);
    dialog(
      `<h2>Screenshot</h2><img class="feedback-shot" src="${url}" alt="Screenshot attached to the report"><div class="dialog-actions"><button type="button" class="btn outline" data-close>Close</button></div>`,
    );
    modal.addEventListener('close', () => URL.revokeObjectURL(url), { once: true });
    return;
  }
  if (action === 'menu') {
    navigation.setOpen(!document.querySelector('.layout')?.classList.contains('menu-open'));
    return;
  }
  if (action === 'logout') {
    await busy(b, async () => {
      try {
        await pwa.disconnect().catch(() => {});
        await api('/auth/v1/logout', { method: 'POST' });
      } finally {
        saveSession(null);
        sessionStorage.removeItem('hoora-outlook-token');
        state.member = null;
        state.pages = [];
        state.folders = [];
        state.dirty = false;
        location.hash = '#/';
        await load();
        await render();
      }
    });
    return;
  }
  if (action === 'copy-link') {
    await busy(b, async () => {
      const page = currentPublishedPage();
      await navigator.clipboard.writeText(
        page ? location.origin + routeUrl(publishedRoute(page, state.projects)) : location.href,
      );
      if (page && state.member)
        db('rpc/docs_track', '', {
          method: 'POST',
          body: { document_id: page.id, event: 'asset_shared' },
        }).catch(() => {});
      toast('Link copied.');
    });
    return;
  }
  if (action === 'native-share') {
    await busy(b, async () => {
      const page = currentPublishedPage();
      if (!page || !navigator.share) return;
      try {
        await navigator.share({
          title: page.title,
          url: location.origin + routeUrl(publishedRoute(page, state.projects)),
        });
        if (state.member)
          await db('rpc/docs_track', '', {
            method: 'POST',
            body: { document_id: page.id, event: 'asset_shared' },
          });
      } catch (error) {
        if (error.name !== 'AbortError') throw error;
      }
    });
    return;
  }
  if (action === 'share') {
    await busy(b, shareCurrentPage);
    return;
  }
  if (action === 'add-member') {
    memberDialog();
    return;
  }
  if (action === 'add-team-permission') {
    teamPermissionDialog();
    return;
  }
  if (action === 'remove-team-permission') {
    if (state.member?.role !== 'admin') return;
    confirmAction(
      'Remove this capability?',
      'The team will immediately lose this scoped permission.',
      async () => {
        await db('docs_team_permissions', '?id=eq.' + encodeURIComponent(b.dataset.id), {
          method: 'DELETE',
        });
        await load();
        await render();
        toast('Team capability removed.');
      },
    );
    return;
  }
  if (action === 'add-folder' || action === 'add-vertical') {
    manageLegacyOrganization(action.slice(4));
    return;
  }
  if (action === 'upload') {
    document.querySelector('#file-upload').click();
    return;
  }
  if (action === 'publish') {
    if (document.querySelector('#editor-form [data-uploading=true]')) {
      toast('Wait for the upload to finish before publishing.', true);
      return;
    }
    await busy(b, async () => {
      const id = await saveDraft();
      if (state.dirty)
        throw Error('Your draft was saved. Save the latest edits before publishing.');
      await api('/rest/v1/rpc/docs_publish', {
        method: 'POST',
        body: { page_id: id },
      });
      appApi('/api/ai-index', { documentId: id }).catch(() => {});
      location.hash = '#/edit/' + id;
      toast('Published. Access follows the document and folder settings.');
    });
    return;
  }
  if (action === 'unpublish') {
    confirmAction(
      'Unpublish this document?',
      'The published copy and its attachments will stop being available. Your team’s draft will be kept.',
      async () => {
        await api('/rest/v1/rpc/docs_unpublish', {
          method: 'POST',
          body: { page_id: document.querySelector('#editor-form').dataset.id },
        });
        await load();
        await render();
        toast('Document unpublished.');
      },
    );
    return;
  }
  if (action === 'delete-document') {
    confirmAction(
      'Delete this document?',
      'The draft, organization copy, and contributions will be removed. This cannot be undone.',
      async () => {
        await appApi('/api/content', {
          action: 'delete',
          id: document.querySelector('#editor-form').dataset.id,
        });
        state.dirty = false;
        await load();
        location.hash = '#/workspace';
        toast('Document deleted.');
      },
    );
    return;
  }
});
document.addEventListener(
  'click',
  (ev) => {
    const link = ev.target.closest('a[href^="#/"]');
    if (state.dirty && link && link.hash !== routeHash()) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      const destination = link.hash;
      confirmAction(
        'Leave without saving?',
        'Your unsaved edits will be discarded. Save your draft first if you want to keep them.',
        async () => {
          state.dirty = false;
          location.hash = destination;
        },
      );
    }
  },
  true,
);
window.addEventListener('hashchange', async () => {
  state.query = '';
  state.status = '';
  state.dirty = false;
  const route = routeHash();
  try {
    await withVehicleLoader(async () => {
      await load();
      if (route === routeHash()) await render();
    });
  } catch (err) {
    toast(err.message, true);
  }
  window.scrollTo(0, 0);
});
window.addEventListener('popstate', () => {
  if (!location.hash) window.dispatchEvent(new Event('hashchange'));
});
window.addEventListener('beforeunload', (ev) => {
  if (state.dirty) {
    ev.preventDefault();
    ev.returnValue = '';
  }
});
window.addEventListener('keydown', (ev) => {
  if ((ev.ctrlKey || ev.metaKey) && ev.key === 'k') {
    ev.preventDefault();
    globalSearch();
  }
  if ((ev.ctrlKey || ev.metaKey) && ev.key === 's' && document.querySelector('#editor-form')) {
    ev.preventDefault();
    busy(null, async () => {
      await saveDraft();
      toast('Draft saved.');
    });
  }
});
document.addEventListener('click', (event) => {
  const topButton = event.target.closest('[data-scroll-top]');
  if (topButton) {
    document
      .querySelector('.native-release-header')
      ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    return;
  }
  const button = event.target.closest('[data-scroll-section]');
  if (!button) return;
  const target = document.getElementById('section-' + button.dataset.scrollSection);
  target?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  target?.focus({ preventScroll: true });
});
window.addEventListener('storage', (ev) => {
  if (ev.key === 'hoora-session') {
    try {
      state.session = JSON.parse(ev.newValue);
    } catch {
      state.session = null;
    }
    withVehicleLoader(async () => {
      await load();
      await render();
    }).catch((err) => toast(err.message, true));
  }
});

document.addEventListener('click', (ev) => {
  const button = ev.target.closest('[data-team-action]');
  if (button) busy(button, () => teams.action(button));
});

document.addEventListener('click', async (event) => {
  const b = event.target.closest('[data-hub-action]');
  if (b) busy(b, () => features.action(b));
  if (event.target.closest('[data-action="quick-asset"]')) sources.open();
  const notice = event.target.closest('[data-notice-read]');
  if (notice && state.member) {
    event.preventDefault();
    try {
      await features.markRead(notice.dataset.noticeRead);
    } catch (error) {
      toast('Could not mark this notification as read.', true);
    }
    location.hash = notice.getAttribute('href');
  }
  const external = event.target.closest('[data-external-page]');
  if (external && state.member)
    db('rpc/docs_track', '', {
      method: 'POST',
      body: { document_id: external.dataset.externalPage, event: 'external_opened' },
    }).catch(() => {});
});

document.addEventListener('click', (event) => {
  // The header face and the face beside each reply both change expression on tap.
  if (
    event.target.closest('[data-assistant="mood"], .assistant-message .assistant-inline-avatar')
  ) {
    nextTapMood();
    restartSleepTimer();
    return;
  }
  if (!event.target.closest('[data-assistant="toggle"]')) return;
  assistantOpen = !assistantOpen;
  renderAssistant();
  nextTapMood();
  restartSleepTimer();
  if (assistantOpen) document.querySelector('#assistant-question')?.focus({ preventScroll: true });
  else document.querySelector('.assistant-trigger')?.focus({ preventScroll: true });
});
document.addEventListener('keydown', (event) => {
  if (!assistantOpen) return;
  if (event.key === 'Escape') {
    assistantOpen = false;
    renderAssistant();
    document.querySelector('.assistant-trigger')?.focus();
  }
  if (event.key === 'Tab' && matchMedia('(max-width:700px)').matches) {
    const controls = [
      ...document.querySelectorAll(
        '.assistant-panel button,.assistant-panel input,.assistant-panel a',
      ),
    ].filter((el) => !el.disabled && el.getClientRects().length);
    const first = controls[0],
      last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }
});
document.addEventListener('submit', async (event) => {
  if (event.target.id !== 'assistant-form') return;
  event.preventDefault();
  if (assistantBusy) return;
  const input = event.target.elements.question,
    question = input.value.trim();
  if (!question) return;
  const page = currentPublishedPage();
  const cacheKey = `${state.member?.id || 'member'}:${page?.id || 'workspace'}:${question
    .toLocaleLowerCase()
    .replace(/\s+/g, ' ')}`;
  assistantBusy = true;
  window.clearTimeout(sleepTimer);
  setAssistantMood('thinking');
  let reaction = 'happy';
  const thinkingStartedAt = performance.now();
  assistantMessages.push({ role: 'user', text: question }, { role: 'assistant', thinking: true });
  input.value = '';
  renderAssistant();
  const form = document.querySelector('#assistant-form'),
    submit = form?.querySelector('button');
  if (submit) submit.disabled = true;
  try {
    const cached = assistantCache.get(cacheKey);
    let data;
    if (cached && Date.now() - cached.createdAt < 5 * 60 * 1000) {
      data = cached.data;
      await new Promise((resolve) => setTimeout(resolve, 220));
    } else {
      const token = await getToken();
      const response = await fetch('/api/assistant', {
        method: 'POST',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, currentDocumentId: page?.id || null }),
      });
      data = await response.json();
      if (!response.ok) throw Error(data.error || 'The assistant is unavailable.');
      assistantCache.set(cacheKey, { data, createdAt: Date.now() });
    }
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, 450 - (performance.now() - thinkingStartedAt))),
    );
    assistantMessages.pop();
    if (!data.sources?.length && !data.tickets?.length) reaction = 'unsure';
    assistantMessages.push({
      role: 'assistant',
      text: data.answer,
      sources: data.sources || [],
      tickets: data.tickets || [],
    });
  } catch (error) {
    assistantMessages.pop();
    assistantMessages.push({ role: 'assistant', text: error.message || 'Please try again.' });
    reaction = 'sad';
  }
  assistantBusy = false;
  renderAssistant();
  setAssistantMood(reaction, 2400);
  restartSleepTimer();
  document.querySelector('.assistant-messages')?.scrollTo({ top: 99999, behavior: 'smooth' });
  document.querySelector('#assistant-question')?.focus();
});

try {
  await withVehicleLoader(async () => {
    await completeMicrosoftSignIn();
    if (!config.url || !config.key)
      throw new Error(
        'Hoora Docs is not configured. Set the Supabase environment variables and redeploy.',
      );
    await load();
    await render();
  });
} catch (err) {
  app.innerHTML =
    header() +
    `<main class="article" id="main"><h1>Let’s get connected.</h1><div class="content-error">${e(err.message)}</div><p class="small">Please refresh to try again, or contact your administrator.</p></main>` +
    footer();
  bind();
}
