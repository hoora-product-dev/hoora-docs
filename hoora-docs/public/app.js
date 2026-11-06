import { prepareUpload } from "./vendor/uploads.js";
import { config } from "./config.js";
import {
  escapeHtml as e,
  slugify,
  markdown,
  markdownWithOutline,
  canEdit,
  canPublish, versionKey, compareVersions,
  filterPages,
} from "./lib.js";
let richEditorModule;
const loadRichEditor = () => richEditorModule ||= import('./vendor/rich-editor.js');
let documentRichEditor = null;
let contributionRichEditor = null;
function richToolbar() {
  const buttons = [
    ["heading", "Heading", "H₂"], ["bold", "Bold", "<strong>B</strong>"],
    ["italic", "Italic", "<em>I</em>"], ["strike", "Strikethrough", "S̶"],
    ["bulletList", "Bulleted list", "• ≡"], ["orderedList", "Numbered list", "1. ≡"],
    ["blockquote", "Quote", "❝"], ["codeBlock", "Code block", "&lt;/&gt;"],
    ["table", "Insert table", "▦"], ["link", "Link", "↗"],
  ];
  return `<div class="rich-toolbar" role="toolbar" aria-label="Text formatting">${buttons.map(([command,label,content])=>`<button type="button" data-rich-command="${command}" aria-label="${label}" aria-pressed="false" title="${label}">${content}</button>`).join("")}</div>`;
}
const app = document.querySelector("#app"),
  modal = document.querySelector("#modal");
const icons = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m16 16 4 4"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  book: '<path d="M12 6c-3-2-7-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V5c-2-1-6-1-9 1Zm0 0v15"/>',
  release: '<path d="m13 2-8 12h7l-1 8 8-12h-7l1-8Z"/>',
  sop: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 3h6v4H9zm0 9 2 2 4-4m-6 8h6"/>',
  documentation: '<path d="M5 3h9l5 5v13H5zM14 3v6h5M9 13h6m-6 4h6"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  users:
    '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-17a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5v2"/>',
  folder: '<path d="M3 7V4h6l3 3h9v13H3V7Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  logout: '<path d="M9 4H4v16h5m5-12 4 4-4 4m-6-4h14"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6"/>',
  settings:
    '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="16" cy="17" r="3"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
};
const icon = (name) =>
  `<span class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.documentation}</svg></span>`;
const names = {
  release: "Release notes",
  sop: "SOPs",
  documentation: "Documentation",
};
Object.assign(icons, {
  code: '<path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-14-2 18"/>',
  edit: '<path d="m15 4 5 5M4 20l4-1L20 7a3 3 0 0 0-4-4L4 15v5Z"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5"/>',
  reload:
    '<path d="M20 7v5h-5M4 17v-5h5m11 0a8 8 0 0 0-14-6m-2 6a8 8 0 0 0 14 6"/>',
  back: '<path d="M19 12H5m6-6-6 6 6 6"/>',
  link: '<path d="m10 13 4-4m-6 6-2 2a3 3 0 0 1-4-4l5-5a3 3 0 0 1 4 0m2 2 2-2a3 3 0 0 1 4 4l-5 5a3 3 0 0 1-4 0"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M3 6h.01M3 12h.01M3 18h.01"/>',
  paperclip:
    '<path d="m8 12 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l9-9a6 6 0 0 1 8 8l-9 9"/>',
  microsoft:
    '<path stroke="none" fill="#f25022" d="M2 2h9v9H2z"/><path stroke="none" fill="#7fba00" d="M13 2h9v9h-9z"/><path stroke="none" fill="#00a4ef" d="M2 13h9v9H2z"/><path stroke="none" fill="#ffb900" d="M13 13h9v9h-9z"/>',
});
Object.assign(icons,{theme:'<circle cx="12" cy="12" r="8"/><path d="M12 4v16"/>',web:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z"/>',phone:'<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 18h4"/>',car:'<path d="m5 7 2-4h10l2 4 2 3v9h-3v-3H6v3H3v-9l2-3Zm0 0h14M7 11h1m8 0h1"/>',tool:'<path d="m14 6 4 4 3-3a7 7 0 0 1-9 8L5 22l-3-3 7-7a7 7 0 0 1 8-9Z"/>',bag:'<path d="M4 7h16v14H4zM8 7V5a4 4 0 0 1 8 0v2"/>',trash:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',mail:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>'});
const descriptions = {
  release: "What’s new, what’s improved, and what’s next across Hoora.",
  sop: "Clear, repeatable processes. Everything you need to get it right.",
  documentation: "Explore guides, references, and the details behind our work.",
};
const state = {
  session: null,
  member: null,
  types: [],
  published: [],
  pages: [],
  verticals: [],
  folders: [],
  query: "",
  kind: "",
  vertical: "",
  status: "",
  members: [],
  projects: [],
  projectSections: null,
  releases: [],
  entries: [],
  requests: [],
  dirty: false,
};
let renderId = 0,
  toastTimer;
try {
  state.session = JSON.parse(localStorage.getItem("hoora-session"));
} catch {
  localStorage.removeItem("hoora-session");
}
const date = (s) =>
  s
    ? new Date(s).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "";
const verticalName = (id) =>
  state.verticals.find((v) => v.id === id)?.name || "General";
function toast(message, error = false) {
  const el = document.querySelector("#toast");
  el.textContent = message;
  el.className = "show" + (error ? " error-toast" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ""), 6500);
}
function saveSession(session) {
  state.session = session;
  if (session) localStorage.setItem("hoora-session", JSON.stringify(session));
  else localStorage.removeItem("hoora-session");
}
let refreshing;
const authHeaders = token => token ? { Authorization: 'Bearer ' + token } : {};
async function getToken() {
  if (!state.session) return config.key.startsWith('sb_publishable_') ? null : config.key;
  if ((state.session.expires_at || 0) > Date.now() / 1000 + 60)
    return state.session.access_token;
  if (!refreshing)
    refreshing = (async () => {
      const r = await fetch(
        config.url + "/auth/v1/token?grant_type=refresh_token",
        {
          method: "POST",
          headers: { apikey: config.key, "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: state.session.refresh_token }),
        },
      );
      const d = await r.json();
      if (!r.ok) {
        saveSession(null);
        sessionStorage.removeItem("hoora-outlook-token");
        state.member = null;
        throw new Error("Your session expired. Please sign in again.");
      }
      saveSession({ ...d, expires_at: Date.now() / 1000 + d.expires_in });
      return d.access_token;
    })().finally(() => (refreshing = null));
  return refreshing;
}
async function api(path, { method = "GET", body, headers = {}, authRetry = 0 } = {}) {
  const token = await getToken();
  const r = await fetch(config.url + path, {
    method,
    headers: {
      apikey: config.key,
      ...authHeaders(token),
      "Content-Type": "application/json",
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
  if(!r.ok && /JWT issued at future/i.test(d?.message||d?.msg||'') && authRetry<2){
    await new Promise(resolve=>setTimeout(resolve,1000*(authRetry+1)));
    return api(path,{method,body,headers,authRetry:authRetry+1});
  }
  if (!r.ok)
    throw new Error(
      d?.message ||
        d?.msg ||
        d?.error_description ||
        "Unable to connect. Please try again.",
    );
  return d;
}
const db = (table, query = "", options = {}) =>
  api("/rest/v1/" + table + query, options);
async function admin(body) {
  const token = await getToken();
  const r = await fetch("/api/admin", {
    method: body ? "POST" : "GET",
    headers: {
      ...authHeaders(token),
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || "User management failed.");
  return d;
}
async function load() {
  const [types,verticals, published] = await Promise.all([
    db("docs_types", "?select=*&order=name"),
    db("docs_verticals", "?select=*&order=name"),
    db("docs_published", "?select=*&order=published_at.desc"),
  ]);
  state.types=types;Object.keys(names).forEach(k=>delete names[k]);types.forEach(t=>{names[t.key]=t.name;});
  state.verticals = verticals;
  state.published = published;
  state.member = null;
  state.pages = [];
  state.folders = [];
  state.projects=[];state.projectSections=null;state.entries=[];state.releases=[];state.requests=[];
  if (state.session) {
    const members = await db(
      "docs_members",
      `?id=eq.${state.session.user.id}&select=*`,
    );
    state.member = members[0]?.active ? members[0] : null;
    if (state.member && state.member.password_setup_complete) {
      [state.pages, state.folders] = await Promise.all([
        canEdit(state.member.role) ? db("docs_pages", "?select=*&order=updated_at.desc") : Promise.resolve(state.published.map(p=>({...p,updated_at:p.published_at}))),
        db("docs_folders", "?select=*&order=name"),
      ]);
      [state.projects, state.releases, state.entries, state.requests] =
        await Promise.all([
          db("docs_projects", "?select=*&order=name"),
          db("docs_releases", "?select=*"),
          db("docs_entries", "?select=*&order=created_at"),
          db("docs_requests", "?select=*&order=created_at.desc"),
        ]);
      try {
        state.projectSections=await db('docs_project_sections','?select=*&order=sort_order.asc');
      } catch(error) {
        if(/docs_project_sections|schema cache|does not exist/i.test(error.message))state.projectSections=null;
        else throw error;
      }
    }
  }
}
function header(){
 if((location.hash.startsWith('#/artifact/')||location.hash.startsWith('#/preview/'))&&state.nativeTitle&&document.body.dataset.route!=="edit")return `<header class="topbar artifact-app-header"><a class="btn text" href="${e(state.nativeBack)}">${icon('back')}Back</a><strong>${e(state.nativeTitle)}</strong>${state.nativeDraft?'<span class="badge draft">Draft preview</span>':''}<div><button class="iconbtn" data-action="native-fullscreen" aria-label="Enter fullscreen">${icon('expand')}</button><button class="iconbtn" data-action="download-artifact" aria-label="Download original HTML">${icon('download')}</button></div></header>`;
 const route=location.hash.split('?')[0];const auth=route==='#/login';const native=route.startsWith('#/artifact/')||route.startsWith('#/preview/');
 return `<header class="topbar"><div class="topbar-left">${!auth&&!native?`<button class="iconbtn mobile-menu" data-action="menu" aria-label="Toggle navigation">${icon('menu')}</button>`:''}<a class="product-brand" href="#/releases"><img src="/hoora-logo.png" alt="Hoora"></a>${!auth&&!native?'<span class="topbar-divider"></span><nav><a href="#/releases">Releases</a><a href="#/workspace">Library</a></nav>':''}</div><div class="topbar-right">${!auth&&!native?`<button class="compact-search" data-action="global-search">${icon('search')}<span>Search documents</span><kbd>⌘ K</kbd></button>`:''}<button class="iconbtn" data-action="theme" aria-label="Switch light or dark theme">${icon('theme')}</button>${state.member?`<details class="account-menu"><summary aria-label="Open account menu"><span class="user-avatar">${e((state.member.name||state.member.email).slice(0,2).toUpperCase())}</span></summary><div><strong>${e(state.member.name)}</strong><small>${e(state.member.email)}</small><a href="#/account">Account settings</a>${state.member.role==='admin'?'<a href="#/users">Manage people</a>':''}<button data-action="logout">Sign out</button></div></details>`:!auth?'<a class="btn dark" href="#/login">Sign in</a>':''}</div></header>`;
}

function footer(){return '';}

function sidebar(workspace=false){
 const role=state.member?.role;const docs=workspace?state.pages:state.published;
 const folderLinks=(parent=null,depth=0)=>state.folders.filter(f=>f.parent_id===parent).map(f=>`<a class="sidelink ${state.folder===f.id?'active':''}" style="--depth:${depth}" href="#/workspace?folder=${f.id}">${toneIcon(f.icon,f.color)}<span>${e(f.name)}</span>${f.visibility==='private'?icon('lock'):''}</a>${depth<12?folderLinks(f.id,depth+1):''}`).join('');
 return `<aside class="sidebar library-sidebar" aria-label="Library navigation"><div class="rail-heading">Library</div><a class="sidelink ${!state.kind&&!state.folder?'active':''}" href="${workspace?'#/workspace':'#/browse'}">${icon('grid')}<span>All documents</span><small>${docs.length}</small></a><div class="rail-label">Collections</div>${state.types.map(t=>`<a class="sidelink ${state.kind===t.key?'active':''}" href="#/${workspace?'workspace':'browse'}?kind=${t.key}">${toneIcon(t.icon,t.color)}<span>${e(t.name)}</span>${!state.member&&t.default_visibility==='private'?icon('lock'):''}</a>`).join('')}${workspace?`<div class="rail-label">Folders${role==='admin'?'<button class="iconbtn" data-action="add-folder" aria-label="Add folder">+</button>':''}</div>${folderLinks()}${!state.folders.length?'<p class="rail-empty">Organize documents in folders.</p>':''}`:''}${role==='admin'?`<div class="rail-label">Administration</div><a class="sidelink" href="#/folders">${icon('settings')}<span>Structure & visibility</span></a><a class="sidelink" href="#/users">${icon('users')}<span>People</span></a><a class="sidelink" href="#/requests">${icon('check')}<span>Requests</span></a>`:''}<div class="rail-bottom">${icon('lock')}<span>${state.member?'Private content stays within your team.':'Sign in to read internal documents.'}</span></div></aside>`;
}

function row(p,internal=false){
 const pub=state.published.find(x=>x.id===p.id),type=state.types.find(t=>t.key===p.kind)||{};const edit=internal&&canEdit(state.member?.role);const access=pageAccess(p);
 return `<div class="document-row">${toneIcon(p.format==='html'?'code':type.icon,type.color)}<div class="document-row-content"><a href="#/${edit?'edit/'+p.id:'doc/'+p.slug}">${e(p.title)}</a><p>${e(p.summary|| (p.format==='html'?'HTML artifact':type.name||'Document'))}</p></div><span class="document-row-status">${internal?`<span class="badge ${pub?'published':'draft'}">${pub?(pub.revision===p.revision?'Published':'Changes pending'):'Draft'}</span>`:''}</span><span class="access-label">${icon(access==='private'?'lock':'web')}${access==='private'?'Team only':'Public'}</span><time>${date(p.updated_at||p.published_at)}</time><a class="iconbtn" href="#/${edit?'edit/'+p.id:'doc/'+p.slug}" aria-label="${edit?'Edit':'Read'} ${e(p.title)}">${icon('chevron')}</a></div>`;
}

function empty(title, text, action = "") {
  return `<div class="empty">${icon("book")}<h3>${e(title)}</h3><p>${e(text)}</p>${action}</div>`;
}
function workspace(){
 const pages=filterPages(state.pages,state).filter(p=>!state.status||(state.status==='draft'?!state.published.some(x=>x.id===p.id):state.published.some(x=>x.id===p.id)));
 const title=state.folder?state.folders.find(f=>f.id===state.folder)?.name:names[state.kind]||'All documents';
 return `<div class="layout">${sidebar(true)}<main id="main" class="library-content"><div class="view-heading"><div><h1>${e(title)}</h1><p>${pages.length} documents${state.member.role==='viewer'?' available to your team':''}</p></div>${canEdit(state.member.role)?'<div class="toolbar-actions"><button class="btn outline" data-action="import-document">'+icon('upload')+'Import</button><a class="btn dark" href="#/new">'+icon('plus')+'New document</a></div>':''}</div><div class="library-tools"><label class="search compact">${icon('search')}<input id="workspace-search" type="search" placeholder="Search this collection…" aria-label="Search workspace" value="${e(state.query)}"></label><select id="status-filter" aria-label="Filter by publication status"><option value="">All statuses</option><option value="draft" ${state.status==='draft'?'selected':''}>Drafts</option><option value="published" ${state.status==='published'?'selected':''}>Published</option></select></div><div class="document-table"><div class="document-table-heading"><span>Document</span><span>Status</span><span>Access</span><span>Updated</span></div><div id="document-list">${pages.map(p=>row(p,true)).join('')||empty('No documents here yet','Create a document or choose another collection.')}</div></div></main></div>`;
}

function login(){return `<main id="main" class="signin-page"><div class="signin-card"><div class="signin-mark">${icon('book')}</div><h1>Sign in to Hoora Docs</h1><p>Release notes, guides, and your team’s knowledge.</p>${config.microsoftEnabled?`<button class="btn microsoft" type="button" data-action="microsoft-login">${icon('microsoft')}Continue with Microsoft</button><div class="signin-divider">or use your Hoora Docs password</div>`:''}<form id="login-form"><div class="field"><label for="email">Work email</label><input id="email" name="email" type="email" autocomplete="username" placeholder="you@hoora.me" required></div><div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required></div><p id="form-error" class="error" role="alert"></p><button class="btn dark" type="submit">Sign in</button></form><p class="signin-note">First visit? Continue with Microsoft to verify your work account and create a password.</p><a href="#/releases" class="signin-public">Browse public releases</a></div><span class="signin-caption">Internal documents are available only to signed-in team members.</span></main>`;}

function artifactFrame(page, draft = false, full = false) {
  return `<section class="artifact-card ${full ? "artifact-full" : ""}"><div class="artifact-toolbar"><div class="browser-dots"><span></span><span></span><span></span></div><span class="artifact-filename">${e(
    page.artifact_path
      ?.split("/")
      .at(-1)
      ?.replace(/^[a-f0-9-]{37}/, "") || "HTML artifact",
  )}</span><span class="isolation-label">Isolated preview</span><button class="iconbtn" data-action="reload-artifact" aria-label="Reload artifact">${icon("reload")}</button>${!draft && !full ? `<a class="iconbtn" href="#/artifact/${e(page.slug)}" aria-label="Open artifact in full page">${icon("expand")}</a>` : ""}<button class="iconbtn" data-action="download-artifact" aria-label="Download original HTML">${icon("download")}</button></div><div class="artifact-viewport" data-artifact="${page.id}" data-draft="${draft}"><div class="artifact-loading">${icon("code")}<span>Opening your artifact…</span></div></div><div class="artifact-bottom"><span>HTML artifact</span><span>Interactive content runs separately from Hoora Docs.</span></div></section>`;
}
function documentReaderSidebar(page, peers, draft = false) {
  const type = state.types.find((item) => item.key === page.kind);
  return `<aside class="sidebar document-reader-sidebar" aria-label="Document navigation">
    <a class="document-nav-home" href="#/browse">${icon("back")} All documents</a>
    <div class="document-nav-collection">${toneIcon(type?.icon || "documentation", type?.color || "slate")}<span>${e(type?.name || names[page.kind] || "Documents")}</span></div>
    <nav aria-label="Collection pages">${peers.map((item) => `<a class="document-nav-page ${item.id === page.id ? "active" : ""}" ${item.id === page.id ? 'aria-current="page"' : ""} href="${draft && item.id === page.id ? `#/preview/${item.id}` : `#/doc/${e(item.slug)}`}">${e(item.title)}</a>`).join("")}</nav>
    <div class="document-nav-footer"><a href="#/browse?kind=${encodeURIComponent(page.kind)}">Browse this collection ${icon("chevron")}</a></div>
  </aside>`;
}
function documentOutline(outline, draft = false) {
  const links = outline.map((item) => `<button type="button" class="document-outline-link level-${item.level}" data-scroll-section="${e(item.id.slice(8))}">${e(item.title)}</button>`).join("");
  return {
    desktop: `<aside class="document-outline" aria-label="On this page"><div class="document-outline-inner"><h2>On this page</h2>${links || '<p>No sections on this page.</p>'}${draft?'':`<div class="document-outline-share"><button type="button" data-action="copy-link">${icon("link")} Copy page link</button></div>`}</div></aside>`,
    mobile: outline.length ? `<details class="document-mobile-outline"><summary>On this page</summary>${links}</details>` : "",
  };
}
function documentPage(p, draft = false) {
 const content=markdownWithOutline(p.body),outline=documentOutline(content.outline,draft);
 const peers=state.published.filter(item=>item.kind===p.kind&&(!draft||item.id!==p.id));
 if(draft)peers.push(p);
 peers.sort((a,b)=>a.title.localeCompare(b.title));
 const index=peers.findIndex(item=>item.id===p.id),previous=peers[index-1],next=peers[index+1];
 const type=state.types.find(item=>item.key===p.kind);
 const folder=state.folders.find(item=>item.id===p.folder_id);
 return `<div class="layout document-reader-layout">${documentReaderSidebar(p,peers,draft)}<main id="main" class="document-reader">
   <div class="document-article"><nav class="document-breadcrumbs" aria-label="Breadcrumb"><a href="#/browse">Library</a>${icon('chevron')}<a href="#/browse?kind=${encodeURIComponent(p.kind)}">${e(type?.name||names[p.kind]||'Documents')}</a>${folder?`${icon('chevron')}<span>${e(folder.name)}</span>`:''}</nav>
   <div class="document-article-actions">${draft?'<span class="badge draft">Saved draft preview</span>':`<span class="access-label">${icon(pageAccess(p)==='private'?'lock':'web')}${pageAccess(p)==='private'?'Team only':'Public'}</span>`}<div>${draft?`<a class="btn outline" href="#/edit/${p.id}">Back to editing</a>`:`<button class="btn text" data-action="copy-link">${icon('link')}Copy link</button>${canEdit(state.member?.role)?`<a class="btn outline" href="#/edit/${p.id}">Edit page</a>`:''}`}</div></div>
   <header class="document-article-heading"><h1>${e(p.title)}</h1>${p.summary?`<p>${e(p.summary)}</p>`:''}<div class="document-article-meta"><span>${draft?'Saved':'Published'} ${date(draft?p.updated_at:p.published_at)}</span>${p.version?`<span>${e(p.version)}</span>`:''}${!draft&&p.published_by_name?`<span>By ${e(p.published_by_name)}</span>`:''}</div></header>
   ${customFieldList(p)}${outline.mobile}${p.format==='html'?`${draft?'':`<a class="open-artifact" href="#/artifact/${e(p.slug)}">${icon('expand')}Open full-page HTML preview</a>`}${artifactFrame(p,draft)}`:''}<div class="prose document-prose">${content.html}</div>
   <nav class="document-pagination" aria-label="More in this collection">${previous?`<a href="#/doc/${e(previous.slug)}"><small>Previous page</small><span>${icon('back')}${e(previous.title)}</span></a>`:'<span></span>'}${next?`<a href="#/doc/${e(next.slug)}"><small>Next page</small><span>${e(next.title)}${icon('chevron')}</span></a>`:'<span></span>'}</nav>
   </div>${outline.desktop}</main></div>`;
}
function article(slug,full=false){
 const p=state.published.find(p=>p.slug===slug);
 if(!p){if(!state.member){sessionStorage.setItem('hoora-return-to',location.hash);return `<main id="main" class="access-gate">${icon('lock')}<h1>Sign in to continue</h1><p>This link may belong to your team’s private library. Sign in with your work account to check access.</p><a class="btn dark" href="#/login">Sign in with your work account</a><a href="#/releases">Browse public releases</a></main>`;}return `<main id="main" class="article">${empty('Document unavailable','This page may have been removed or unpublished.','<a class="btn outline" href="#/workspace">Open library</a>')}</main>`;}
 document.title=p.title+' — Hoora Docs';
 if(full&&p.format==='html')return nativeArtifact(p,false);
 if(p.kind==='release')return releaseDocumentNew(p);
 return documentPage(p);
}

function options(items, selected, placeholder) {
  return (
    `<option value="">${placeholder}</option>` +
    items
      .map(
        (x) =>
          `<option value="${x.id}" ${x.id === selected ? "selected" : ""}>${e(x.name)}</option>`,
      )
      .join("")
  );
}
function editor(id) {
  if (state.releases.some((r) => r.id === id)) return releaseDetail(id);
  const p = state.pages.find((x) => x.id === id) || {
    id: crypto.randomUUID(),
    title: "",
    slug: "",
    kind: "documentation",
    body: "",
    summary: "",
    tags: [],
    version: "",
    format: "markdown",
    artifact_path: null,
  };
  const isNew = !id,
    published = state.published.find((x) => x.id === p.id);
  if (!isNew && !state.pages.some((x) => x.id === id))
    return empty(
      "Document not found",
      "Return to your workspace.",
      '<a href="#/workspace">Workspace</a>',
    );
  if (!canEdit(state.member.role))
    return `<div class="layout">${sidebar(true)}<main id="main" class="article"><h1>${e(p.title)}</h1><div class="notice">You have read-only access.</div>${p.format === "html" ? artifactFrame(p, true) : ""}<div class="prose">${markdown(p.body)}</div></main></div>`;
  const html = p.format === "html";
  return `<div class="layout editor-layout">${sidebar(true)}<main id="main" class="editor"><div class="editor-top"><nav class="breadcrumbs"><a href="#/workspace">Documents</a>${icon("chevron")}<span>${isNew ? "New document" : e(p.title)}</span></nav><div class="editor-top-actions"><span class="badge ${published ? "published" : "draft"}">${published ? "Published" : "Private draft"}</span>${!isNew ? `<button type="button" class="btn outline" data-action="open-draft-preview">Preview draft</button>` : ""}${published ? `<a class="btn outline" href="#/doc/${e(published.slug)}">View published</a>` : ""}<a class="btn outline" href="#/workspace">Close</a></div></div><form id="editor-form" data-id="${p.id}" data-new="${isNew}" data-revision="${p.revision || 0}"><div class="editor-heading"><div class="field title-field"><label class="sr-only" for="title">Document title</label><input id="title" name="title" required maxlength="250" value="${e(p.title)}" placeholder="Untitled document"></div><div class="field summary-field"><label class="sr-only" for="summary">Short description</label><textarea id="summary" name="summary" maxlength="500" rows="2" placeholder="Add a short description so readers know what to expect…">${e(p.summary)}</textarea></div></div><div class="editor-grid"><div class="editor-main"><div class="document-type-picker"><span>Content format</span><div><button type="button" data-doc-format="markdown" aria-pressed="${!html}" class="${!html ? "active" : ""}">${icon("documentation")}Markdown</button><button type="button" data-doc-format="html" aria-pressed="${html}" class="${html ? "active" : ""}">${icon("code")}HTML artifact</button></div></div><input type="hidden" id="format" name="format" value="${p.format || "markdown"}"><input type="hidden" id="artifact_path" name="artifact_path" value="${e(p.artifact_path || "")}"><section id="markdown-editor" ${html ? "hidden" : ""}><div class="editor-mode-tabs"><div><button type="button" class="active" data-editor-view="write">Write</button><button type="button" data-editor-view="split">Split view</button><button type="button" data-editor-view="preview">Preview</button><button type="button" data-editor-view="source">Markdown source</button></div><button type="button" class="btn text" data-action="import-markdown">${icon("upload")}Import .md</button></div><div class="writing-layout" data-view="write"><div class="source-editor">${richToolbar()}<div class="rich-canvas" data-rich-canvas></div><label class="sr-only" for="body">Markdown source</label><textarea id="body" name="body" class="rich-source" spellcheck="false" placeholder="Paste Markdown here, then switch to Write…">${e(p.body)}</textarea></div><div id="live-preview" class="prose live-preview">${p.body ? markdown(p.body) : '<p class="preview-placeholder">Your formatted document will appear here.</p>'}</div></div><div class="editor-footnote"><span>Markdown supported</span><span id="word-count">${p.body.trim() ? p.body.trim().split(/\s+/).length : 0} words</span></div></section><section id="html-editor" ${!html ? "hidden" : ""}><div class="artifact-dropzone" id="html-dropzone"><div class="upload-symbol">${icon("code")}</div><h3>${p.artifact_path ? "Replace your HTML artifact" : "Your artifact. A page of its own."}</h3><p>Drop a standalone HTML file here, or choose one from your computer. Diagrams, interactive reports, and AI artifacts are welcome.</p><button type="button" class="btn dark" data-action="upload-html">${icon("upload")}${p.artifact_path ? "Replace HTML file" : "Choose HTML file"}</button><small>Single .html or .htm file · Up to 10 MB</small></div>${
    p.artifact_path
      ? `<div class="current-artifact">${icon("code")}<span>${e(
          p.artifact_path
            .split("/")
            .at(-1)
            .replace(/^[a-f0-9-]{37}/, ""),
        )}</span><span class="badge">Uploaded</span></div>${artifactFrame(p, true)}`
      : ""
  }</section><input type="file" id="file-upload" hidden accept=".png,.jpg,.jpeg,.webp,.pdf,.txt,.md,.csv,.docx,.xlsx"><input type="file" id="markdown-upload" hidden accept=".md,.markdown,.txt"><input type="file" id="html-upload" hidden accept=".html,.htm,text/html"></div><aside class="document-properties"><h2>Document details</h2><div class="field"><label for="kind">Collection</label><select id="kind" name="kind">${Object.entries(
    names,
  )
    .map(
      ([k, n]) =>
        `<option value="${k}" ${p.kind === k ? "selected" : ""}>${n}</option>`,
    )
    .join(
      "",
    )}</select></div><div class="field"><label for="vertical_id">Vertical</label><select id="vertical_id" name="vertical_id">${options(state.verticals, p.vertical_id, "General")}</select></div><div class="field"><label for="folder_id">Folder</label><select id="folder_id" name="folder_id">${options(state.folders, p.folder_id, "No folder")}</select></div><div class="field"><label for="version">Version / reference</label><input id="version" name="version" value="${e(p.version)}" maxlength="100" placeholder="e.g. v2.4.0"></div><div class="field"><label for="slug">Page URL</label><input id="slug" name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" value="${e(p.slug)}" placeholder="document-title"></div><div class="field"><label for="tags">Tags</label><input id="tags" name="tags" value="${e(p.tags.join(", "))}" placeholder="product, onboarding"><small>Separate with commas.</small></div>${typeFields(p)}${visibilityField(p)}<div class="properties-help">${icon("lock")}Only your team can see a draft. Publishing creates a public copy.</div></aside></div><p id="form-error" class="error" role="alert"></p><div class="editor-actions"><span class="statusbar" id="save-status">${isNew ? "Draft not saved" : "Saved " + date(p.updated_at)}</span><div class="editor-action-buttons">${!isNew ? `<button type="button" class="btn outline" data-action="request-publish" data-id="${p.id}">Request approval</button>` : ""}${published && state.member.role === "admin" ? `<button type="button" class="btn outline" data-action="email-preview" data-id="${p.id}">Email announcement</button>` : ""}${published ? '<button type="button" class="btn outline" data-action="unpublish">Unpublish</button>' : ""}<button class="btn outline" type="submit">Save draft</button>${canPublish(state.member.role) ? `<button type="button" class="btn primary" data-action="publish">${published ? "Publish changes" : "Publish document"}${icon("arrow")}</button>` : ""}</div></div>${published ? '<div class="workspace-note">Your public page stays unchanged until you publish changes.</div>' : ""}${!isNew && state.member.role === "admin" ? '<button type="button" class="btn text danger" data-action="delete-document">Delete document</button>' : ""}</form></main></div>`;
}

async function users(){state.members=await admin();return `<div class="layout">${sidebar(true)}<main id="main" class="settings-content"><div class="view-heading"><div><h1>People</h1><p>Administrators manage access. Publishers create and publish. Viewers read.</p></div><button class="btn dark" data-action="add-member">${icon('plus')}Add member</button></div><div class="tablewrap"><table><thead><tr><th>Team member</th><th>Role</th><th>Access</th><th></th></tr></thead><tbody>${state.members.map(m=>`<tr><td><strong>${e(m.name||m.email)}</strong><small>${e(m.email)}</small></td><td>${roleName(m.role)}</td><td>${m.active?'Active':'Disabled'}</td><td><button class="btn outline" data-member="${m.id}">Manage</button></td></tr>`).join('')}</tbody></table></div><div class="role-explainer"><p><strong>Administrator</strong> Full control of structure, visibility, deletion, people and email announcements.</p><p><strong>Publisher</strong> Create documents and release versions in existing applications, edit contributions, preview and publish. Cannot change structure, delete content or send email.</p><p><strong>Viewer</strong> Read published public and internal documents. Can request publisher access.</p></div></main></div>`; }
function folders(){return structureView();}

async function render() {
  const rid = ++renderId;
  document.title = "Hoora Docs";
  state.nativeTitle=null;
  const [pathname, search = ""] = location.hash.replace(/^#/, "").split("?");
  const [route, id] = pathname.split("/").filter(Boolean);
  const params = new URLSearchParams(search);
  state.kind = params.get("kind") || "";
  state.vertical = params.get("vertical") || "";
  state.folder = params.get("folder") || "";
  state.project=params.get("project")||"";state.version=params.get("version")||"";state.view=params.get("view")||"";
  document.body.dataset.route=route||"releases";
  const internal = [
    "workspace",
    "new",
    "edit",
    "users",
    "folders",
    "account",
    "requests", "preview",
  ].includes(route);
  if (state.member && !state.member.password_setup_complete) {
    app.innerHTML = header() + onboarding() + footer();
    bind();
    return;
  }
  if (internal && !state.member) {
    app.innerHTML =
      header() +
      (state.session
        ? `<main class="article" id="main">${empty("Your account doesn’t have access", "Ask a Hoora Docs administrator to activate your team membership.", '<button class="btn outline" data-action="logout">Sign out</button>')}</main>`
        : login()) +
      footer();
    bind();
    return;
  }
  try {
    let view;
    switch (route) {
      case "login":
        view = state.member ? workspace() : login();
        break;
      case "releases":
        view = releaseHub();
        break;
      case "requests":
        view = requestsView();
        break;
      case "workspace":
        view = workspace();
        break;
      case "doc":
        view = article(decodeURIComponent(id || ""));
        break;
      case "artifact":
        view = article(decodeURIComponent(id || ""), true);
        break;
      case "new":
      case "edit":
        view = editor(route === "edit" ? id : null);
        break;
      case "users":
        if (state.member.role !== "admin")
          throw new Error("Administrator access required.");
        view = await users();
        break;
      case "preview":
        view=draftPreview(id);break;
      case "folders":
        if(state.member.role!=="admin")throw new Error("Administrator access required.");
        view = folders();
        break;
      case "account":
        view = account();
        break;
      case "browse":
        view = publicView(false);
        break;
      default:
        view = releaseBrowser();
    }
    if (rid !== renderId) return;
    app.innerHTML = header() + view + footer();
    bind();
    hydrateArtifacts();
    hydrateImages();
  } catch (err) {
    app.innerHTML =
      header() +
      `<main class="article" id="main"><div class="content-error">${e(err.message)}</div><a class="btn outline" href="#/workspace">Back to workspace</a></main>` +
      footer();
    bind();
  }
}
function formError(err) {
  const el = document.querySelector("#form-error");
  if (el) el.textContent = err.message;
  else toast(err.message, true);
}
async function busy(button, fn) {
  if (button) button.disabled = true;
  try {
    return await fn();
  } catch (err) {
    formError(err);
  } finally {
    if (button) button.disabled = false;
  }
}
function dialog(html, callback) {
  modal.innerHTML = html;
  modal.showModal();
  modal
    .querySelector("[data-close]")
    ?.addEventListener("click", () => modal.close());
  modal.querySelector("form")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const b = ev.submitter;
    b.disabled = true;
    try {
      await callback(new FormData(ev.target));
      modal.close();
    } catch (err) {
      const error = modal.querySelector(".error");
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
    `<h2>${m ? "Manage member" : "Welcome someone new."}</h2><p class="small">${m ? e(m.email) : "Create a login and choose what they can do."}</p><form id="member-form"><div class="field"><label for="member-name">Name</label><input id="member-name" name="name" required maxlength="100" value="${e(m?.name || "")}"></div>${!m ? '<div class="field"><label for="member-email">Email</label><input id="member-email" name="email" type="email" required></div><div class="field"><label for="member-password">Temporary password</label><input id="member-password" name="password" type="password" autocomplete="new-password" minlength="12" required><small>At least 12 characters. Share securely with this person.</small></div>' : ""}<div class="field"><label for="member-role">Role</label><select id="member-role" name="role">${["viewer", "publisher", "admin"].map((r) => `<option value="${r}" ${m?.role === r ? "selected" : ""}>${roleName(r)}</option>`).join("")}</select></div>${m ? `<div class="field"><label for="member-active">Account access</label><select id="member-active" name="active"><option value="true" ${m.active ? "selected" : ""}>Active</option><option value="false" ${!m.active ? "selected" : ""}>Disabled</option></select></div>` : ""}<p class="error" role="alert"></p><div class="dialog-actions"><button type="button" class="btn outline" data-close>Cancel</button><button class="btn primary">${m ? "Save changes" : "Create account"}</button></div></form>${m && m.id !== state.member.id ? `<div class="toolbar"><button class="btn outline" id="reset-member-password">Reset password</button><button class="btn danger" id="delete-member">Remove member</button></div>` : ""}`,
    async (f) => {
      await admin({
        ...Object.fromEntries(f),
        action: m ? "update" : "create",
        id: m?.id,
        active: f.get("active") !== "false",
      });
      toast(m ? "Member updated." : "Account created.");
      await render();
    },
  );
  modal.querySelector("#delete-member")?.addEventListener("click", () => {
    modal.close();
    confirmAction(
      "Remove this member?",
      "Their login and team access will be removed. Documents they authored will be kept.",
      async () => {
        await admin({ action: "delete", id: m.id });
        await render();
        toast("Member removed.");
      },
    );
  });
  modal
    .querySelector("#reset-member-password")
    ?.addEventListener("click", () => {
      modal.close();
      dialog(
        `<h2>Reset password</h2><p class="small">Set a new temporary password for ${e(m.email)}.</p><form><div class="field"><label for="reset-password">New password</label><input id="reset-password" name="password" type="password" minlength="12" autocomplete="new-password" required></div><p class="error" role="alert"></p><div class="dialog-actions"><button type="button" data-close class="btn outline">Cancel</button><button class="btn primary">Reset password</button></div></form>`,
        async (f) => {
          await admin({
            action: "password",
            id: m.id,
            password: f.get("password"),
          });
          toast("Password updated. Share it securely.");
        },
      );
    });
}
async function saveDraft() {
  const f = document.querySelector("#editor-form");
  if (!f.reportValidity()) throw new Error("Complete the required fields.");
  const d = Object.fromEntries(new FormData(f));
  d.custom_fields=Object.create(null);for(const key of Object.keys(d)){if(key.startsWith("field:")){d.custom_fields[key.slice(6)]=d[key];delete d[key];}}
  d.vertical_id = d.vertical_id || null;
  d.folder_id = d.folder_id || null;
  d.artifact_path = d.artifact_path || null;
  d.tags = d.tags
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);
  const isNew = f.dataset.new === "true";
  const response = await db(
    "docs_pages",
    isNew ? "" : `?id=eq.${f.dataset.id}&revision=eq.${f.dataset.revision}`,
    {
      method: isNew ? "POST" : "PATCH",
      body: { ...d, ...(isNew ? { id: f.dataset.id } : {}) },
      headers: { Prefer: "return=representation" },
    },
  );
  if (!response?.length)
    throw new Error(
      "Someone else updated this document. Copy your edits, then reload to review their changes.",
    );
  f.dataset.new = "false";
  f.dataset.revision = response[0].revision;
  state.dirty = false;
  const i = state.pages.findIndex((p) => p.id === f.dataset.id);
  if (i >= 0) state.pages[i] = response[0];
  else state.pages.unshift(response[0]);
  document.querySelector("#save-status").textContent = "Saved just now";
  return f.dataset.id;
}
async function uploadFile(file, releaseId = null) {
  file = await prepareUpload(file);
  if (!releaseId) await saveDraft();
  const f = document.querySelector("#editor-form");
  const path =
    (releaseId || f.dataset.id) +
    "/" +
    crypto.randomUUID() +
    "-" +
    file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const token = await getToken();
  const r = await fetch(config.url + "/storage/v1/object/hoora-docs/" + path, {
    method: "POST",
    headers: {
      apikey: config.key,
      ...authHeaders(token),
      "Content-Type": file.type || "application/octet-stream",
    },
    body: file,
  });
  if (!r.ok) {
    const d = await r.json();
    throw new Error(d.message || "Upload failed.");
  }
  const ta = document.querySelector(releaseId ? "#entry-body" : "#body");
  ta.value +=
    (file.type.startsWith("image/") ? "\n\n![" : "\n\n[") +
    file.name.replace(/[\[\]]/g, "") +
    "](attachment:" +
    path +
    ")\n";
  if (releaseId) contributionRichEditor?.setMarkdown(ta.value);
  else documentRichEditor?.setMarkdown(ta.value);
  if (!releaseId) state.dirty = true;
  updateLivePreview();
  hydrateImages();
  toast("File uploaded. Save the draft to keep the attachment link.");
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
    method: "POST",
    headers: {
      ...authHeaders(token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "Unable to complete this action.");
  return data;
}
async function completeMicrosoftSignIn() {
  const params = new URLSearchParams(location.search);
  if (!params.has("code") && !params.has("error")) return;
  try {
    if (params.has("error"))
      throw new Error(
        params.get("error_description") || "Microsoft sign-in was cancelled.",
      );
    const { data, error } = await (await oauth()).auth.exchangeCodeForSession(
      params.get("code"),
    );
    if (error) throw error;
    const { provider_token, provider_refresh_token, ...session } = data.session;
    saveSession(session);
    await appApi("/api/sso", { providerToken: provider_token });
    const outlookReturn = sessionStorage.getItem("hoora-outlook-return");
    if (outlookReturn) {
      sessionStorage.setItem("hoora-outlook-token", provider_token);
      sessionStorage.removeItem("hoora-outlook-return");
    }
    history.replaceState(
      null,
      "",
      outlookReturn ? "/#/edit/" + outlookReturn : "/"+(sessionStorage.getItem("hoora-return-to")||"#/workspace"),
    );
  } catch (err) {
    saveSession(null);
    state.authError = err.message;
    history.replaceState(null, "", "/#/login");
  } finally {
    sessionStorage.removeItem("hoora-oauth");
    sessionStorage.removeItem("hoora-oauth-user");
  }
}
async function startMicrosoftSignIn(mail = false) {
  const { error } = await (await oauth()).auth.signInWithOAuth({
    provider: "azure",
    options: {
      scopes:
        "email profile https://graph.microsoft.com/User.Read" +
        (mail ? " https://graph.microsoft.com/Mail.Send" : ""),
      redirectTo: location.origin + "/?auth_callback=1",
    },
  });
  if (error) throw error;
}
function updateLivePreview() {
  const body = document.querySelector("#body");
  if (!body) return;
  const preview = document.querySelector("#live-preview");
  if (preview)
    preview.innerHTML = body.value
      ? markdown(body.value)
      : '<p class="preview-placeholder">Your formatted document will appear here.</p>';
  const count = document.querySelector("#word-count");
  if (count)
    count.textContent =
      (body.value.trim() ? body.value.trim().split(/\s+/).length : 0) +
      " words";
  hydrateImages();
}
function updateEditorFormat() {
  const html = document.querySelector("#format")?.value === "html";
  const md = document.querySelector("#markdown-editor"),
    artifact = document.querySelector("#html-editor");
  if (md) md.hidden = html;
  if (artifact) artifact.hidden = !html;
  document.querySelectorAll("[data-doc-format]").forEach((b) => {
    const selected = b.dataset.docFormat === (html ? "html" : "markdown");
    b.classList.toggle("active", selected);
    b.setAttribute("aria-pressed", String(selected));
  });
}
async function hydrateArtifacts() {
  for (const viewport of document.querySelectorAll("[data-artifact]")) {
    if (viewport.dataset.loaded === "true") continue;
    viewport.dataset.loaded = "true";
    try {
      const data = await appApi("/api/artifact", {
        id: viewport.dataset.artifact,
        draft: viewport.dataset.draft === "true",
      });
      if (!viewport.isConnected) continue;
      const frame = document.createElement("iframe");
      frame.setAttribute("sandbox", "allow-scripts allow-downloads");
      frame.referrerPolicy = "no-referrer";
      frame.title = "HTML artifact preview";
      frame.src = data.url;
      viewport.replaceChildren(frame);
    } catch (err) {
      viewport.innerHTML = `<div class="artifact-loading"><p class="error">${e(err.message)}</p><button class="btn outline" data-action="reload-artifact">Try again</button></div>`;
      viewport.dataset.loaded = "false";
    }
  }
}
async function uploadHtml(file) {
  if (!/\.html?$/i.test(file.name))
    throw new Error("Choose a .html or .htm file.");
  if (file.size > 10 * 1024 * 1024)
    throw new Error("HTML artifacts must be 10 MB or less.");
  const title = document.querySelector("#title"),
    slug = document.querySelector("#slug");
  if (!title.value) {
    title.value = file.name.replace(/\.html?$/i, "").replace(/[-_]/g, " ");
    slug.value = slugify(title.value);
  }
  document.querySelector("#format").value = "html";
  const id = await saveDraft();
  const name = file.name
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/\.html?$/i, ".html");
  const path = id + "/" + crypto.randomUUID() + "-" + name;
  const token = await getToken();
  const r = await fetch(config.url + "/storage/v1/object/hoora-docs/" + path, {
    method: "POST",
    headers: {
      apikey: config.key,
      ...authHeaders(token),
      "Content-Type": "text/html",
    },
    body: file,
  });
  if (!r.ok) {
    const d = await r.json();
    throw new Error(d.message || "Unable to upload HTML.");
  }
  document.querySelector("#artifact_path").value = path;
  await saveDraft();
  state.dirty = false;
  if (location.hash !== "#/edit/" + id) location.hash = "#/edit/" + id;
  else await render();
  toast("HTML artifact uploaded. Preview it, then publish when ready.");
}
async function importMarkdown(file) {
  if (file.size > 500000)
    throw new Error("Choose a Markdown file smaller than 500 KB.");
  const text = await file.text();
  document.querySelector("#body").value = text;
  documentRichEditor?.setMarkdown(text);
  const title = document.querySelector("#title");
  if (!title.value) {
    title.value = (
      /^#\s+(.+)$/m.exec(text)?.[1] ||
      file.name.replace(/\.(md|markdown|txt)$/i, "")
    ).slice(0, 250);
    document.querySelector("#slug").value = slugify(title.value);
  }
  document.querySelector("#format").value = "markdown";
  updateEditorFormat();
  updateLivePreview();
  state.dirty = true;
  toast("Markdown imported. Review the preview and save your draft.");
}
async function importDocument(file) {
  if (!/\.(html?|md|markdown|txt)$/i.test(file.name))
    throw new Error("Choose a Markdown, text, or HTML file.");
  const html = /\.html?$/i.test(file.name);
  if (file.size > (html ? 10 * 1024 * 1024 : 500000))
    throw new Error(
      html
        ? "HTML files must be 10 MB or less."
        : "Markdown files must be smaller than 500 KB.",
    );
  const text = html ? "" : await file.text();
  const title = (
    html
      ? file.name.replace(/\.html?$/i, "")
      : /^#\s+(.+)$/m.exec(text)?.[1] ||
        file.name.replace(/\.(md|markdown|txt)$/i, "")
  )
    .replace(/[_]/g, " ")
    .slice(0, 250);
  const id = crypto.randomUUID();
  await db("docs_pages", "", {
    method: "POST",
    body: {
      id,
      title,
      slug: slugify(title) + "-" + id.slice(0, 6),
      kind: "documentation",
      body: text,
      format: html ? "html" : "markdown",
    },
  });
  await load();
  location.hash = "#/edit/" + id;
  await render();
  if (html) await uploadHtml(file);
  else toast("Markdown imported as a private draft.");
}
function bindEnhancements() {
  documentRichEditor?.destroy();
  documentRichEditor = null;
  const source = document.querySelector('#body');
  const root = document.querySelector('#markdown-editor .source-editor');
  if (source && root) {
    loadRichEditor().then(({mountRichEditor})=>{
      if(root.isConnected)documentRichEditor=mountRichEditor({root,textarea:source,onChange:updateLivePreview,resolveImage:resolveEditorImage});
    }).catch(()=>toast('The visual editor could not load. Markdown source is still available.'));
    source.addEventListener('input',event=>{
      if(event.isTrusted) {
        documentRichEditor?.setMarkdown(source.value);
        updateLivePreview();
      }
    });
  }
  if (state.authError && document.querySelector("#form-error")) {
    document.querySelector("#form-error").textContent = state.authError;
    state.authError = null;
  }
  document.querySelectorAll("[data-doc-format]").forEach((b) =>
    b.addEventListener("click", () => {
      document.querySelector("#format").value = b.dataset.docFormat;
      updateEditorFormat();
      state.dirty = true;
    }),
  );
  document.querySelectorAll("[data-editor-view]").forEach((b) =>
    b.addEventListener("click", () => {
      const previous = document.querySelector('.writing-layout')?.dataset.view;
      if(previous==='source' && b.dataset.editorView!=='source')
        documentRichEditor?.setMarkdown(document.querySelector('#body').value);
      document.querySelector(".writing-layout").dataset.view =
        b.dataset.editorView;
      document
        .querySelectorAll("[data-editor-view]")
        .forEach((x) => x.classList.toggle("active", x === b));
      updateLivePreview();
    }),
  );
  document.querySelector("#body")?.addEventListener("input", updateLivePreview);
  document.querySelector("#html-upload")?.addEventListener("change", (ev) => {
    if (ev.target.files[0]) busy(null, () => uploadHtml(ev.target.files[0]));
  });
  document
    .querySelector("#markdown-upload")
    ?.addEventListener("change", (ev) => {
      if (ev.target.files[0])
        busy(null, () => importMarkdown(ev.target.files[0]));
    });
  const zone = document.querySelector("#html-dropzone");
  zone?.addEventListener("dragover", (ev) => {
    ev.preventDefault();
    zone.classList.add("dragging");
  });
  zone?.addEventListener("dragleave", () => zone.classList.remove("dragging"));
  zone?.addEventListener("drop", (ev) => {
    ev.preventDefault();
    zone.classList.remove("dragging");
    if (ev.dataTransfer.files[0])
      busy(null, () => uploadHtml(ev.dataTransfer.files[0]));
  });
  document
    .querySelectorAll("[data-format]")
    .forEach((b) =>
      b.addEventListener("click", () => queueMicrotask(updateLivePreview)),
    );
}
document.addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-action]");
  if (!b) return;
  const action = b.dataset.action;
  if (action === "microsoft-login") busy(b, startMicrosoftSignIn);
  if (action === "search") {
    const field =
      document.querySelector("#public-search") ||
      document.querySelector("#workspace-search");
    if (field) {
      field.focus();
      field.scrollIntoView({ block: "center", behavior: "smooth" });
    } else location.hash = "#/browse";
  }
  if (action === "upload-html") document.querySelector("#html-upload").click();
  if (action === "import-markdown")
    document.querySelector("#markdown-upload").click();
  if (action === "reload-artifact") {
    const view =
      b.closest(".artifact-card")?.querySelector("[data-artifact]") ||
      b.closest("[data-artifact]");
    if (view) {
      view.dataset.loaded = "false";
      hydrateArtifacts();
    }
  }
  if (action === "download-artifact") {
    const view = (b.closest(".artifact-card") || document.querySelector('.artifact-card')).querySelector("[data-artifact]");
    busy(b, async () => {
      const data = await appApi("/api/artifact", {
        id: view.dataset.artifact,
        draft: view.dataset.draft === "true",
      });
      const a = document.createElement("a");
      a.href = data.url + "&download=1";
      a.download = "hoora-artifact.html";
      a.click();
    });
  }
  if (action === "import-document") {
    dialog(
      `<h2>Bring your knowledge with you</h2><p class="small">Import a Markdown document or upload an HTML artifact. It starts as a private draft.</p><div class="import-file-area"><label for="document-import">Choose a file</label><input id="document-import" type="file" accept=".md,.markdown,.txt,.html,.htm"><small>Markdown up to 500 KB. Standalone HTML up to 10 MB.</small></div><div class="dialog-actions"><button data-close class="btn outline">Cancel</button></div>`,
    );
    modal
      .querySelector("#document-import")
      .addEventListener("change", async (ev) => {
        if (!ev.target.files[0]) return;
        const file = ev.target.files[0];
        modal.close();
        await busy(b, () => importDocument(file));
      });
  }
});
function bind() {
  bindEnhancements();
  bindWorkspace();
  document.querySelector("#login-form")?.addEventListener("submit", (ev) => {
    ev.preventDefault();
    busy(ev.submitter, async () => {
      const f = new FormData(ev.target);
      const session = await api("/auth/v1/token?grant_type=password", {
        method: "POST",
        body: { email: f.get("email"), password: f.get("password") },
      });
      saveSession({
        ...session,
        expires_at: Date.now() / 1000 + session.expires_in,
      });
      await load();
      location.hash = sessionStorage.getItem("hoora-return-to") || "#/workspace";
      sessionStorage.removeItem("hoora-return-to");
      await render();
    });
  });
  for (const id of ["public-search", "workspace-search"])
    document.getElementById(id)?.addEventListener("input", (ev) => {
      state.query = ev.target.value;
      const internal = id === "workspace-search";
      const pages = filterPages(
        internal ? state.pages : state.published,
        state,
      ).filter(
        (p) =>
          !internal ||
          !state.status ||
          (state.status === "draft"
            ? !state.published.some((x) => x.id === p.id)
            : state.published.some((x) => x.id === p.id)),
      );
      document.querySelector("#document-list").innerHTML = pages.length
        ? pages.map((p) => row(p, internal)).join("")
        : empty(
            "No matching documents",
            "Try a different keyword or collection.",
          );
    });
  document.querySelector("#status-filter")?.addEventListener("change", (ev) => {
    state.status = ev.target.value;
    render();
  });
  document.querySelectorAll("[data-kind]").forEach((b) =>
    b.addEventListener("click", () => {
      const workspace = location.hash.includes("/workspace");
      location.hash =
        "#/" +
        (workspace ? "workspace" : "browse") +
        "?kind=" +
        b.dataset.kind +
        (state.vertical ? "&vertical=" + state.vertical : "");
    }),
  );
  document
    .querySelectorAll("[data-member]")
    .forEach((b) =>
      b.addEventListener("click", () => memberDialog(b.dataset.member)),
    );
  document
    .querySelectorAll("[data-folder]")
    .forEach((b) =>
      b.addEventListener("click", () =>
        manageLegacyOrganization("folder", b.dataset.folder),
      ),
    );
  document
    .querySelectorAll("[data-vertical]")
    .forEach((b) =>
      b.addEventListener("click", () =>
        organizationDialog("vertical", b.dataset.vertical),
      ),
    );
  document.querySelectorAll("[data-delete-folder]").forEach((b) =>
    b.addEventListener("click", () =>
      confirmAction(
        "Delete folder?",
        "Documents in this folder will be kept and moved to “No folder”.",
        async () => {
          await db("docs_folders", "?id=eq." + b.dataset.deleteFolder, {
            method: "DELETE",
          });
          await load();
          await render();
          toast("Folder deleted.");
        },
      ),
    ),
  );
  document.querySelector("#editor-form")?.addEventListener("submit", (ev) => {
    ev.preventDefault();
    busy(ev.submitter, async () => {
      await saveDraft();
      toast("Draft saved.");
    });
  });
  document
    .querySelector("#editor-form")
    ?.addEventListener("input", () => (state.dirty = true));
  document.querySelector("#title")?.addEventListener("input", (ev) => {
    if (document.querySelector("#editor-form").dataset.new === "true")
      document.querySelector("#slug").value = slugify(ev.target.value);
  });
  document.querySelectorAll("[data-format]").forEach((b) =>
    b.addEventListener("click", () => {
      const t = document.querySelector("#body"),
        a = t.selectionStart,
        z = t.selectionEnd,
        s = t.value.slice(a, z) || "text";
      const values = {
        heading: "\n## " + s + "\n",
        bold: "**" + s + "**",
        list: "\n- " + s + "\n",
        quote: "\n> " + s + "\n",
        italic: "*" + s + "*",
        link: "[" + s + "](https://example.com)",
        code: "\n```\n" + s + "\n```\n",
      };
      t.setRangeText(values[b.dataset.format], a, z, "end");
      t.focus();
      state.dirty = true;
    }),
  );
  document.querySelector("#file-upload")?.addEventListener("change", (ev) => {
    if (ev.target.files[0])
      busy(document.querySelector('[data-action="upload"]'), () =>
        uploadFile(ev.target.files[0]),
      );
  });
  document.querySelector("#password-form")?.addEventListener("submit", (ev) => {
    ev.preventDefault();
    busy(ev.submitter, async () => {
      await api("/auth/v1/user", {
        method: "PUT",
        body: { password: new FormData(ev.target).get("password") },
      });
      ev.target.reset();
      toast("Your password has been updated.");
    });
  });
}
function onboarding() {
  return `<main id="main" class="onboarding"><div class="onboarding-card"><img src="/hoora-mark.png" width="44" alt="Hoora"><span class="badge published">Microsoft account verified</span><h1>Make yourself at home.</h1><p class="subtitle">Create a password for Hoora Docs. You can then use Microsoft or your email and this password to sign in.</p><p class="small">${e(state.member.email)} · This does not change your Microsoft password.</p>${passwordForm(true)}</div></main>`;
}
function passwordForm(first = false) {
  return `<form id="setup-password-form"><div class="field"><label for="setup-password">${first ? "Create password" : "New Hoora Docs password"}</label><input id="setup-password" name="password" type="password" minlength="12" maxlength="128" autocomplete="new-password" required><small>Use 12–128 characters.</small></div><div class="field"><label for="confirm-password">Confirm password</label><input id="confirm-password" name="confirmPassword" type="password" minlength="12" maxlength="128" autocomplete="new-password" required></div><p id="form-error" class="error" role="alert"></p><button class="btn primary">${first ? "Set password & continue" : "Update password"}</button></form>`;
}
function account() {
  return `<div class="layout">${sidebar(true)}<main id="main" class="content account-content"><div class="page-location">Workspace ${icon("chevron")} My account</div><h1>Your account</h1><p class="subtitle">${e(state.member.name)} · ${e(state.member.email)}</p><section class="setting-card"><div class="section-top"><h2>Workspace access</h2><span class="badge">${e(roleName(state.member.role))}</span></div><p>${state.member.role === "viewer" ? "You can read team documents. Request publisher access to write documents and contribute to releases." : "Your workspace role controls what you can edit and publish."}</p>${state.member.role === "viewer" ? '<button class="btn outline" data-action="request-access">Request publisher access</button>' : ""}<a class="btn text" href="#/requests">View requests</a></section><section class="setting-card"><h2>Password</h2>${passwordForm()}</section>${state.member.auth_source === "microsoft" ? '<section class="setting-card"><h2>Microsoft account</h2><p>Company sign-in and Outlook use your Microsoft work account.</p><a class="btn outline" href="https://myaccount.microsoft.com/" target="_blank" rel="noopener noreferrer">Manage Microsoft account</a></section>' : ""}</main></div>`;
}
function releaseHub(){return state.version?releaseBrowser():releaseTimeline();}

function publicReleaseHub(){return releaseBrowser();}

function releaseDetail(id){
 const page=state.pages.find(p=>p.id===id),release=state.releases.find(r=>r.id===id);
 if(!page)return empty('Release unavailable','Choose a version from the release archive.');
 return releaseBrowser({version:page.version,project:release?.project_id||'',focus:id});
}

function requestsView() {
  return `<div class="layout">${sidebar(true)}<main class="content" id="main"><div class="page-location">Workspace ${icon("chevron")} Requests</div><h1>Requests & approvals</h1><p class="subtitle">Review publication requests and manage access to your workspace.</p>${state.requests.map((r) => `<article class="request-card"><div class="section-top"><h2>${r.kind === "access" ? "Editor access" : "Publication approval"}</h2><span class="badge ${r.status === "approved" ? "published" : "draft"}">${e(r.status)}</span></div><p class="small">Requested by ${e(r.requester_name)} · ${date(r.created_at)}</p>${r.page_id ? `<a class="request-document" href="#/edit/${r.page_id}">${e(state.pages.find((p) => p.id === r.page_id)?.title || "Document")}</a>` : ""}<p>${e(r.reason)}</p>${r.resolution ? `<p class="small">Reviewer response: ${e(r.resolution)}</p>` : ""}${r.status === "pending" && (state.member.role === "admin" || (r.kind === "publish" && state.member.role === "admin")) ? `<div class="toolbar-actions"><button class="btn primary" data-action="resolve-request" data-id="${r.id}" data-approve="true">${r.kind === "publish" ? "Approve & publish" : "Approve publisher access"}</button><button class="btn outline" data-action="resolve-request" data-id="${r.id}" data-approve="false">Decline</button></div>` : ""}</article>`).join("") || empty("No requests yet", "Your access and publication requests will appear here.")}</main></div>`;
}
function entryDialog(releaseId, entryId) {
  const entry = state.entries.find((n) => n.id === entryId);
  const projectId = state.releases.find((release) => release.id === releaseId)?.project_id;
  const configured = state.projectSections?.filter((section) => section.project_id === projectId && section.active) || [];
  const choices = state.projectSections === null
    ? state.verticals
    : configured.map((section) => state.verticals.find((vertical) => vertical.id === section.vertical_id)).filter(Boolean);
  if (entry?.vertical_id && !choices.some((vertical) => vertical.id === entry.vertical_id)) {
    const previous = state.verticals.find((vertical) => vertical.id === entry.vertical_id);
    if (previous) choices.push(previous);
  }
  if (!choices.length) {
    throw new Error('An administrator needs to configure a section for this application first.');
  }
  dialog(
    `<h2>${entry ? "Edit contribution" : "Add your release notes"}</h2><p class="small">Your name is recorded automatically. Keep each contribution focused on one vertical.</p><form><div class="field"><label for="entry-vertical">Vertical</label><select id="entry-vertical" name="vertical_id" required>${options(choices, entry?.vertical_id, "Choose a section")}</select></div><div class="field"><label for="entry-title">Contribution heading</label><input id="entry-title" name="title" value="${e(entry?.title || "")}" maxlength="200" required placeholder="e.g. Booking and checkout improvements"></div><div class="field"><label for="entry-tickets">Ticket references</label><input id="entry-tickets" name="tickets" maxlength="1000" value="${e(entry?.tickets || "")}" placeholder="HCUS-123, HCUS-124"></div><div class="field entry-writing"><label>What changed?</label><div class="entry-write-tabs"><button type="button" data-entry-view="visual" class="active">Write</button><button type="button" data-entry-view="preview">Preview</button><button type="button" data-entry-view="source">Markdown source</button></div>${richToolbar()}<div class="rich-canvas" data-rich-canvas></div><label class="sr-only" for="entry-body">Markdown source</label><textarea id="entry-body" name="body" class="rich-source" rows="10" maxlength="100000" placeholder="Paste Markdown here…">${e(entry?.body || "")}</textarea><div id="entry-preview" class="prose entry-preview" hidden></div><small>Formatting is saved as Markdown. Paste Markdown in source mode, then return to Write to see it formatted.</small></div><div class="field"><label for="entry-attachment">Attach an image or document</label><input id="entry-attachment" type="file" accept=".png,.jpg,.jpeg,.webp,.pdf,.txt,.md,.csv,.docx,.xlsx"><small>10 MB per upload. Images become compressed WebP. Videos are not supported. Save your contribution to keep attachment links.</small></div><div class="field"><label for="entry-status">Contribution status</label><select id="entry-status" name="submitted"><option value="false">Work in progress</option><option value="true" ${entry?.submitted ? "selected" : ""}>Ready for publishing</option></select></div><p class="error" role="alert"></p><div class="dialog-actions"><button class="btn outline" type="button" data-close>Cancel</button><button class="btn primary">Save contribution</button></div></form>`,
    async (f) => {
      const data = {
        ...Object.fromEntries(f),
        submitted: f.get("submitted") === "true",
      };
      const result = await db(
        "docs_entries",
        entry ? `?id=eq.${entry.id}&revision=eq.${entry.revision}` : "",
        {
          method: entry ? "PATCH" : "POST",
          body: { ...data, ...(!entry ? { release_id: releaseId } : {}) },
          headers: { Prefer: "return=representation" },
        },
      );
      if (!result?.length)
        throw new Error(
          "This contribution changed. Copy your text, close this dialog, and reopen it.",
        );
      await load();
      await render();
      toast("Contribution saved.");
    },
  );
  contributionRichEditor?.destroy();
  const richRoot=modal.querySelector('.entry-writing');
  const richSource=modal.querySelector('#entry-body');
  loadRichEditor().then(({mountRichEditor})=>{
    if(!modal.open||!richRoot.isConnected)return;
    contributionRichEditor=mountRichEditor({root:richRoot,textarea:richSource,resolveImage:resolveEditorImage,onChange:()=>{
      const preview=modal.querySelector('#entry-preview');
      if(preview&&!preview.hidden)preview.innerHTML=markdown(richSource.value);
    }});
  }).catch(()=>toast('The visual editor could not load. Markdown source is still available.'));
  richSource?.addEventListener('input',event=>{
    if(event.isTrusted)contributionRichEditor?.setMarkdown(richSource.value);
  });
  modal.querySelectorAll('[data-entry-view]').forEach(button=>button.addEventListener('click',()=>{
    const view=button.dataset.entryView;
    if(view!=='source'&&!richSource.hidden)contributionRichEditor?.setMarkdown(richSource.value);
    richRoot.dataset.view=view;
    richRoot.querySelector('[data-rich-canvas]').hidden=view!=='visual';
    richRoot.querySelector('.rich-toolbar').hidden=view!=='visual';
    richSource.hidden=view!=='source';
    const preview=modal.querySelector('#entry-preview');
    preview.hidden=view!=='preview';
    if(view==='preview')preview.innerHTML=markdown(richSource.value);
    modal.querySelectorAll('[data-entry-view]').forEach(b=>b.classList.toggle('active',b===button));
  }));
  richSource.hidden=true;
  modal.addEventListener('close',()=>{contributionRichEditor?.destroy();contributionRichEditor=null;},{once:true});
  modal.querySelector("#entry-attachment").addEventListener("change", (ev) => {
    if (ev.target.files[0])
      busy(modal.querySelector("button.btn.primary"), () =>
        uploadFile(ev.target.files[0], releaseId),
      );
  });
  modal.querySelector("#entry-body").addEventListener("paste", (ev) => {
    const files = [...(ev.clipboardData?.files || [])].filter((f) =>
      f.type.startsWith("image/"),
    );
    if (files.length) {
      ev.preventDefault();
      busy(modal.querySelector("button.btn.primary"), async () => {
        for (const file of files) await uploadFile(file, releaseId);
      });
    }
  });
}
function requestDialog(kind, id) {
  dialog(
    `<h2>${kind === "access" ? "Request publisher access" : "Request publication approval"}</h2><p class="small">${kind === "access" ? "An administrator will review your request." : "An administrator or publisher will review and publish the current draft if approved."}</p><form><div class="field"><label for="request-reason">Message to reviewer</label><textarea id="request-reason" name="reason" maxlength="2000" rows="4" required></textarea></div><p class="error" role="alert"></p><div class="dialog-actions"><button class="btn outline" type="button" data-close>Cancel</button><button class="btn primary">Send request</button></div></form>`,
    async (f) => {
      await api("/rest/v1/rpc/docs_request", {
        method: "POST",
        body: {
          request_kind: kind,
          request_reason: f.get("reason"),
          document_id: id || null,
        },
      });
      await load();
      toast("Request sent for review.");
    },
  );
}
async function emailPreview(id) {
  const preview = await appApi("/api/notifications", { id, action: "preview" });
  dialog(
    `<h2>Email announcement</h2><p class="small">Test mode · Only <strong>rahul@hoora.me</strong> will receive this email. Publishing never sends an email automatically.</p><p class="small">Subject: ${e(preview.subject)}</p><iframe class="email-preview" title="Outlook email preview" sandbox=""></iframe><p class="error" role="alert"></p><div class="dialog-actions"><button class="btn outline" data-close>Close</button><button class="btn outline" data-action="connect-outlook" data-id="${id}">Connect Outlook</button><button class="btn primary" data-action="send-test-email" data-id="${id}" data-request="${crypto.randomUUID()}">Send test to Rahul</button></div>`,
  );
  modal.querySelector("iframe").srcdoc = preview.html;
}
function bindWorkspace() {
  document
    .querySelector("#setup-password-form")
    ?.addEventListener("submit", (ev) => {
      ev.preventDefault();
      busy(ev.submitter, async () => {
        const f = new FormData(ev.target);
        if (f.get("password") !== f.get("confirmPassword"))
          throw new Error("The passwords do not match.");
        await appApi("/api/onboarding", Object.fromEntries(f));
        await load();
        state.dirty = false;
        location.hash = sessionStorage.getItem('hoora-return-to') || "#/workspace";
        sessionStorage.removeItem('hoora-return-to');
        await render();
        toast("Your Hoora Docs password is set.");
      });
    });
  document.querySelector("#body")?.addEventListener("paste", (ev) => {
    const images = [...(ev.clipboardData?.files || [])].filter((f) =>
      f.type.startsWith("image/"),
    );
    if (images.length) {
      ev.preventDefault();
      busy(null, async () => {
        for (const image of images) await uploadFile(image);
      });
    }
  });
}
async function resolveEditorImage(src) {
  const path=src.slice('attachment:'.length);
  if(!src.startsWith('attachment:')||!/^[a-zA-Z0-9/_.-]+$/.test(path))throw new Error('Invalid image attachment');
  const token=await getToken();
  const response=await fetch(config.url+'/storage/v1/object/authenticated/hoora-docs/'+path,{headers:{apikey:config.key,...authHeaders(token)}});
  if(!response.ok)throw new Error('Image unavailable');
  const blob=await response.blob();
  if(!['image/webp','image/png','image/jpeg'].includes(blob.type))throw new Error('Invalid image');
  return blob;
}
async function hydrateImages() {
  for (const img of document.querySelectorAll(
    "img[data-storage-image]:not([src])",
  )) {
    try {
      const path = img.dataset.storageImage;
      if (!/^[a-zA-Z0-9/_.-]+$/.test(path)) continue;
      const blob = await resolveEditorImage('attachment:' + path);
      const url = URL.createObjectURL(blob);
      img.src = url;
      img.addEventListener("load", () => URL.revokeObjectURL(url), {
        once: true,
      });
    } catch {
      img.alt += " (image unavailable)";
    }
  }
}
document.addEventListener("click", async (ev) => {
  const scroll = ev.target.closest("[data-scroll-id]");
  if (scroll) {
    ev.preventDefault();
    document
      .getElementById(scroll.dataset.scrollId)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  const b = ev.target.closest("[data-action]");
  if (!b) return;
  const a = b.dataset.action,
    id = b.dataset.id;
  if (a === "theme") {
    const theme =
      document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("hoora-theme", theme);
    return;
  }
  if (a === "new-project") {
    dialog(
      '<h2>New release collection</h2><form><div class="field"><label for="project-name">Application / collection name</label><input id="project-name" name="name" required maxlength="100" placeholder="e.g. Customer App"></div><div class="field"><label for="project-description">Description</label><textarea id="project-description" name="description" maxlength="500"></textarea></div><p class="error" role="alert"></p><div class="dialog-actions"><button type="button" class="btn outline" data-close>Cancel</button><button class="btn primary">Create collection</button></div></form>',
      async (f) => {
        await db("docs_projects", "", {
          method: "POST",
          body: Object.fromEntries(f),
        });
        await load();
        await render();
      },
    );
    return;
  }
  if (a === "new-release") {
    dialog(
      `<h2>Create a shared release</h2><p class="small">Everyone contributes to this version. Only one release can exist per version in a collection.</p><form><div class="field"><label for="release-project">Collection</label><select id="release-project" name="project" required>${options(state.projects, null, "Choose an application")}</select></div><div class="field"><label for="release-version">Version</label><input id="release-version" name="release_version" required maxlength="80" placeholder="5.11.0"></div><div class="field"><label for="release-description">Release summary</label><textarea id="release-description" name="description" maxlength="500"></textarea></div><p class="error" role="alert"></p><div class="dialog-actions"><button type="button" class="btn outline" data-close>Cancel</button><button class="btn primary">Create release</button></div></form>`,
      async (f) => {
        const id = await api("/rest/v1/rpc/docs_create_release", {
          method: "POST",
          body: Object.fromEntries(f),
        });
        await load();
        location.hash = "#/edit/" + id;
      },
    );
    return;
  }
  if (a === "add-entry" || a === "edit-entry") {
    entryDialog(
      a === "add-entry"
        ? id
        : state.entries.find((n) => n.id === id).release_id,
      a === "edit-entry" ? id : null,
    );
    return;
  }
  if (a === "delete-entry") {
    confirmAction(
      "Delete this contribution?",
      "This removes the current contribution permanently. A published release stays unchanged until republished.",
      async () => {
        await db("docs_entries", "?id=eq." + id, { method: "DELETE" });
        await load();
        await render();
        toast("Contribution deleted.");
      },
    );
    return;
  }
  if (a === "request-access" || a === "request-publish") {
    requestDialog(a === "request-access" ? "access" : "publish", id);
    return;
  }
  if (a === "resolve-request") {
    const approve = b.dataset.approve === "true";
    dialog(
      `<h2>${approve ? "Approve request" : "Decline request"}</h2><form><div class="field"><label for="review-note">Response (optional)</label><textarea id="review-note" name="note" maxlength="2000"></textarea></div><p class="error" role="alert"></p><div class="dialog-actions"><button type="button" class="btn outline" data-close>Cancel</button><button class="btn primary">${approve ? "Confirm approval" : "Decline request"}</button></div></form>`,
      async (f) => {
        await api("/rest/v1/rpc/docs_resolve_request", {
          method: "POST",
          body: { request_id: id, approve, note: f.get("note") },
        });
        await load();
        await render();
        toast("Request " + (approve ? "approved." : "declined."));
      },
    );
    return;
  }
  if (a === "publish-release" || a === "unpublish-release") {
    await busy(b, async () => {
      await api(
        "/rest/v1/rpc/" +
          (a === "publish-release" ? "docs_publish" : "docs_unpublish"),
        { method: "POST", body: { page_id: id } },
      );
      await load();
      await render();
      toast(
        a === "publish-release"
          ? "Release published. No email has been sent."
          : "Release unpublished.",
      );
    });
    return;
  }
  if (a === "delete-release") {
    confirmAction(
      "Delete this release?",
      "The release, contributions, and public page will be permanently removed.",
      async () => {
        await db("docs_pages", "?id=eq." + id, { method: "DELETE" });
        await load();
        location.hash = "#/releases";
        toast("Release deleted.");
      },
    );
    return;
  }
  if (a === "email-preview") {
    await busy(b, () => emailPreview(id));
    return;
  }
  if (a === "connect-outlook") {
    await busy(b, async () => {
      sessionStorage.setItem("hoora-outlook-return", id);
      await startMicrosoftSignIn(true);
    });
    return;
  }
  if (a === "send-test-email") {
    await busy(b, async () => {
      const providerToken = sessionStorage.getItem("hoora-outlook-token");
      if (!providerToken)
        throw new Error(
          "Connect Outlook first to grant permission to send this test email.",
        );
      await appApi("/api/notifications", {
        id,
        action: "send-test",
        requestId: b.dataset.request,
        providerToken,
      });
      toast("Test email sent only to rahul@hoora.me.");
      modal.close();
    });
    return;
  }
});

function manageLegacyOrganization(type,id){return manageStructure(type,id);}

function toneIcon(name='documentation',color='blue'){const tone=['blue','green','violet','orange','slate'].includes(color)?color:'blue';return `<span class="tone-icon tone-${tone}">${icon(name)}</span>`;}
function roleName(role){return {admin:'Administrator',publisher:'Publisher',viewer:'Viewer'}[role]||role;}
function pageAccess(p){if(p.visibility==='private')return 'private';if(p.project_id&&state.projects.find(c=>c.id===p.project_id)?.visibility==='private')return 'private';let folder=state.folders.find(f=>f.id===p.folder_id);let depth=0;while(folder&&depth++<30){if(folder.visibility==='private')return 'private';folder=state.folders.find(f=>f.id===folder.parent_id);}return p.visibility||'private';}
function typeFields(p){const type=state.types.find(t=>t.key===p.kind);return `<div id="custom-fields">${(type?.fields||[]).map(label=>`<div class="field"><label>${e(label)}<input name="field:${e(label)}" maxlength="2000" value="${e(p.custom_fields?.[label]||'')}"></label></div>`).join('')}</div>`;}
function visibilityField(p){return state.member?.role==='admin'?`<div class="field"><label for="visibility">Document access</label><select id="visibility" name="visibility"><option value="private" ${p.visibility!=='public'?'selected':''}>Private · sign-in required</option><option value="public" ${p.visibility==='public'?'selected':''}>Public · anyone with the link</option></select><small>A private parent folder or application always restricts access.</small></div>`:`<p class="properties-help">${icon('lock')}Access is controlled by your administrator.</p>`;}
function customFieldList(p){const pairs=Object.entries(p.custom_fields||{}).filter(([,value])=>value);return pairs.length?`<dl class="custom-details">${pairs.map(([label,value])=>`<div><dt>${e(label)}</dt><dd>${e(value)}</dd></div>`).join('')}</dl>`:'';}
function releaseRecords(publishedOnly=false){
 const drafts=state.member&&canEdit(state.member.role)&&!publishedOnly;const source=drafts?state.pages:state.published;
 return source.filter(p=>p.kind==='release').map(p=>{const relation=state.releases.find(r=>r.id===p.id);const projectId=relation?.project_id||p.project_id||'other';const project=state.projects.find(c=>c.id===projectId)||{id:projectId,name:p.release_snapshot?.project||'Other releases',icon:p.release_snapshot?.project_icon||'release',color:p.release_snapshot?.project_color||'violet'};const notes=drafts&&relation?state.entries.filter(n=>n.release_id===p.id).map(n=>({...n,vertical:verticalName(n.vertical_id),vertical_icon:state.verticals.find(v=>v.id===n.vertical_id)?.icon,vertical_color:state.verticals.find(v=>v.id===n.vertical_id)?.color,author:n.author_name,edited_by:n.updated_name})):p.release_snapshot?.entries||[];return {page:p,project,notes,draft:drafts,version:versionKey(p.version||p.release_snapshot?.version||'Unversioned'),published:state.published.find(x=>x.id===p.id)};});
}
function releaseRail(records,version,project='',publishedOnly=false){
 const filtered=records.filter(r=>!project||r.project.id===project),versions=[...new Set(filtered.map(r=>r.version))].sort(compareVersions);const projects=[...new Map(records.map(r=>[r.project.id,r.project])).values()];
 return `<aside class="sidebar release-sidebar" aria-label="Release versions"><div class="rail-heading">Release notes</div><label class="rail-select"><span class="sr-only">Filter release application</span><select id="release-app"><option value="">All applications</option>${projects.map(p=>`<option value="${e(p.id)}" ${p.id===project?'selected':''}>${e(p.name)}</option>`).join('')}</select></label><div class="rail-label">Versions <span>Newest first</span></div><nav class="version-nav">${versions.map(v=>`<a class="version-link ${v===version?'active':''}" href="#/releases?version=${encodeURIComponent(v)}${project?'&project='+encodeURIComponent(project):''}${publishedOnly?'&view=published':''}"><span>${e(v==='Unversioned'?v:'v'+v)}</span><small>${new Set(filtered.filter(r=>r.version===v).map(r=>r.project.id)).size} apps</small></a>`).join('')||'<p class="rail-empty">No published versions yet.</p>'}</nav>${state.member?.role==='admin'?'<div class="rail-bottom"><a href="#/folders">'+icon('settings')+'Manage structure</a></div>':'<div class="rail-bottom"><span>Looking for a guide?</span><a href="#/workspace">Open the team library</a></div>'}</aside>`;
}
function releaseTimeline(){
 const publishedOnly=state.view==='published'||!state.member||!canEdit(state.member.role);
 const all=releaseRecords(publishedOnly);
 const records=all.filter(r=>(!state.project||r.project.id===state.project)&&r.published).sort((a,b)=>new Date(b.page.published_at||b.page.updated_at)-new Date(a.page.published_at||a.page.updated_at));
 const applications=[...new Map(all.map(r=>[r.project.id,r.project])).values()];
 const days=new Map();
 for(const record of records){const key=(record.page.published_at||record.page.updated_at||'').slice(0,10);if(!days.has(key))days.set(key,[]);days.get(key).push(record);}
 const current=applications.find(p=>p.id===state.project);
 const rail=`<aside class="sidebar release-sidebar" aria-label="Release applications"><div class="rail-heading">Product updates</div><a class="sidelink ${!state.project?'active':''}" href="#/releases">${icon('grid')}<span>All updates</span></a><div class="rail-label">Applications</div>${applications.map(p=>`<a class="sidelink ${state.project===p.id?'active':''}" href="#/releases?project=${encodeURIComponent(p.id)}">${icon(p.icon)}<span>${e(p.name)}</span></a>`).join('')}${state.member?.role==='admin'?`<div class="rail-bottom"><a href="#/folders">${icon('settings')}Manage structure</a></div>`:''}</aside>`;
 return `<div class="layout release-layout timeline-layout">${rail}<main id="main" class="release-reader timeline-reader"><div class="reader-heading"><div><p class="reader-context">Release notes</p><h1>${current?e(current.name):'What’s new at Hoora'}</h1><p>${current?e(current.description||'Every published version of this application.'):'The latest changes across our products, from the people who built them.'}</p></div>${canEdit(state.member?.role)?`<button class="btn dark" data-action="new-release">${icon('plus')}New release</button>`:''}</div><nav class="timeline-apps" aria-label="Filter by application"><a class="${!state.project?'active':''}" href="#/releases">All applications</a>${applications.map(p=>`<a class="${p.id===state.project?'active':''}" href="#/releases?project=${encodeURIComponent(p.id)}">${e(p.name)}</a>`).join('')}</nav><div class="timeline-columns"><div class="timeline-list">${[...days].map(([key,items])=>`<section class="timeline-day"><h2><time datetime="${key}">${date(key)}</time><span>${items.length} ${items.length===1?'release':'releases'}</span></h2>${items.map(r=>{const notes=r.notes||[],sections=[...new Set(notes.map(n=>n.vertical).filter(Boolean))],authors=[...new Set(notes.map(n=>n.author).filter(Boolean))];return `<article class="timeline-item"><div class="timeline-meta">${toneIcon(r.project.icon,r.project.color)}<span>${e(r.project.name)}</span><span class="badge">${e(r.version==='Unversioned'?r.version:'v'+r.version)}</span>${pageAccess({...r.page,project_id:r.project.id})==='private'?`<span class="access-label">${icon('lock')}Company only</span>`:''}</div><h3><a href="#/doc/${e(r.page.slug)}">${e(r.page.title.replace(/^.*? · /,''))}</a></h3>${r.page.summary?`<p>${e(r.page.summary)}</p>`:''}<div class="timeline-sections">${sections.map(s=>`<span>${e(s)}</span>`).join('')}</div><div class="timeline-footer"><span>${authors.length} ${authors.length===1?'contributor':'contributors'} · ${notes.length} updates</span><a href="#/doc/${e(r.page.slug)}">Read release ${icon('chevron')}</a></div></article>`}).join('')}</section>`).join('')||empty('No published releases yet','Choose another application or publish the first release.')}</div><aside class="timeline-aside"><h2>Browse an application</h2>${applications.map(p=>{const latest=records.find(r=>r.project.id===p.id);return latest?`<a href="#/releases?project=${encodeURIComponent(p.id)}">${toneIcon(p.icon,p.color)}<span><strong>${e(p.name)}</strong><small>Latest: ${e(latest.version==='Unversioned'?latest.version:'v'+latest.version)}</small></span>${icon('chevron')}</a>`:''}).join('')}<p>Each application keeps its own versions. This feed brings their published updates together by date.</p></aside></div></main></div>`;
}
function releaseDocumentNew(p){
 const records=releaseRecords(true),record=records.find(r=>r.page.id===p.id);
 const project=record?.project||{id:p.project_id||'',name:p.release_snapshot?.project||'Release notes',icon:p.release_snapshot?.project_icon||'release',color:p.release_snapshot?.project_color||'slate'};
 const notes=record?.notes||p.release_snapshot?.entries||[];
 const versions=records.filter(r=>r.project.id===project.id).sort((a,b)=>compareVersions(a.version,b.version));
 const sections=[...new Set(notes.map(n=>n.vertical||'General'))],authors=[...new Set(notes.map(n=>n.author).filter(Boolean))];
 const rail=`<aside class="sidebar release-sidebar" aria-label="Application versions"><div class="rail-heading">${e(project.name)}</div><a class="sidelink" href="#/releases?project=${encodeURIComponent(project.id)}">${icon('back')}<span>All ${e(project.name)} releases</span></a><div class="rail-label">Versions <span>Newest first</span></div><nav class="version-nav">${versions.map(r=>`<a class="version-link ${r.page.id===p.id?'active':''}" href="#/doc/${e(r.page.slug)}"><span>${e(r.version==='Unversioned'?r.version:'v'+r.version)}</span><small>${date(r.page.published_at||r.page.updated_at)}</small></a>`).join('')}</nav><div class="rail-bottom"><a href="#/releases">${icon('grid')}All product updates</a></div></aside>`;
 const outline=`<aside class="release-outline" aria-label="On this page"><div class="release-outline-inner"><h2>On this page</h2>${sections.map(s=>`<button type="button" data-scroll-section="${e(slugify(s))}">${e(s)}<small>${notes.filter(n=>(n.vertical||'General')===s).length}</small></button>`).join('')}<div class="outline-authors"><h2>Contributors</h2>${authors.map(name=>`<span><span class="mini-avatar">${e(name.slice(0,2).toUpperCase())}</span>${e(name)}</span>`).join('')}</div></div></aside>`;
 return `<div class="layout release-layout native-release-layout">${rail}<main id="main" class="native-release-reader"><div class="native-release-document"><a class="native-back" href="#/releases?project=${encodeURIComponent(project.id)}">${icon('back')}All ${e(project.name)} releases</a><div class="native-release-overline">${toneIcon(project.icon,project.color)}<span>${e(project.name)}</span><span class="badge">${e((record?.version||versionKey(p.version)).startsWith('v')?(record?.version||versionKey(p.version)):'v'+(record?.version||versionKey(p.version)))}</span><span class="access-label">${icon(pageAccess({...p,project_id:project.id})==='private'?'lock':'web')}${pageAccess({...p,project_id:project.id})==='private'?'Company only':'Public'}</span></div><h1>${e(p.title.replace(/^.*? · /,''))}</h1>${p.summary?`<p class="native-release-summary">${e(p.summary)}</p>`:''}<div class="native-release-meta"><span><small>Published</small>${date(p.published_at)}</span>${p.published_by_name?`<span><small>Published by</small>${e(p.published_by_name)}</span>`:''}<span><small>Contributors</small>${authors.length} ${authors.length===1?'person':'people'}</span><button type="button" class="btn outline" data-action="copy-link">${icon('link')}Copy link</button>${canEdit(state.member?.role)?`<a class="btn outline" href="#/release/${p.id}">Edit release</a>`:''}</div><div class="native-release-mobile-outline"><details><summary>On this page</summary>${sections.map(s=>`<button type="button" data-scroll-section="${e(slugify(s))}">${e(s)}</button>`).join('')}</details></div><div class="native-release-body">${notes.length?contributionGroups(notes,false):`<div class="prose">${markdown(p.body)}</div>`}</div><div class="native-release-end"><span>That’s everything in ${e(project.name)} ${e(record?.version||p.version||'')}.</span><a href="#/releases?project=${encodeURIComponent(project.id)}">Browse earlier versions ${icon('chevron')}</a></div></div>${outline}</main></div>`;
}
function releaseBrowser(options={}){
 const publishedOnly=state.view==='published'||!state.member||!canEdit(state.member.role);const records=releaseRecords(publishedOnly);const project=options.project??state.project??'';const available=records.filter(r=>!project||r.project.id===project);const versions=[...new Set(available.map(r=>r.version))].sort(compareVersions);const version=options.version?versionKey(options.version):state.version||versions[0]||'';const shown=available.filter(r=>r.version===version);const projects=[...new Map(records.filter(r=>r.version===version).map(r=>[r.project.id,r.project])).values()];
 return `<div class="layout release-layout">${releaseRail(records,version,project,publishedOnly)}<main id="main" class="release-reader"><div class="reader-heading"><div><p class="reader-context">${publishedOnly?'Published releases':'Team release workspace'}</p><h1>${version?e(version==='Unversioned'?version:'Version '+version):'Release notes'}</h1><p>${shown.length?`${shown.length} application${shown.length===1?'':'s'} · ${shown.reduce((total,r)=>total+r.notes.length,0)} contributions`:'One shared archive for your team’s releases.'}</p></div>${canEdit(state.member?.role)?`<div class="toolbar-actions">${publishedOnly?'<a class="btn outline" href="#/releases">Open workspace</a>':'<a class="btn outline" href="#/releases?view=published">Published view</a>'}<button class="btn dark" data-action="new-release">${icon('plus')}New release</button></div>`:''}</div><nav class="application-tabs" aria-label="Applications in this version"><a class="${!project?'active':''}" href="#/releases?version=${encodeURIComponent(version)}${publishedOnly?'&view=published':''}">All applications</a>${projects.map(p=>`<a class="${p.id===project?'active':''}" href="#/releases?version=${encodeURIComponent(version)}&project=${encodeURIComponent(p.id)}${publishedOnly?'&view=published':''}">${icon(p.icon)}${e(p.name)}</a>`).join('')}</nav>${shown.map(r=>releaseApplication(r)).join('')||empty('No releases in this view',state.member?'Choose another application or create a version to start collecting notes.':'Published releases will appear here. Internal guides require sign-in.')}</main></div>`;
}
function releaseApplication(record){
 const {page,project,notes,draft,published}=record,editable=draft&&canEdit(state.member?.role),adminRole=state.member?.role==='admin';
 return `<section class="application-release" data-release-id="${page.id}"><div class="application-heading">${toneIcon(project.icon,project.color)}<div><h2>${e(project.name)}</h2><span class="access-label">${icon(pageAccess({...page,project_id:project.id})==='private'?'lock':'web')}${pageAccess({...page,project_id:project.id})==='private'?'Team only':'Public'}${draft?`<span class="badge ${published?'published':'draft'}">${published?(published.revision===page.revision?'Published':'Changes pending'):'Draft'}</span>`:''}</span></div>${editable?`<button class="btn outline" data-action="add-entry" data-id="${page.id}">${icon('plus')}Add my notes</button>`:''}</div>${page.summary?`<p class="release-description">${e(page.summary)}</p>`:''}${customFieldList(page)}${editable?`<div class="release-controls"><button class="btn dark" data-action="publish-release" data-id="${page.id}">${published?'Publish changes':'Publish release'}</button><a class="btn outline" href="#/preview/${page.id}">Preview</a>${published?`<a class="btn outline" href="#/doc/${e(published.slug)}">View published</a>`:''}<button class="btn text" data-action="release-details" data-id="${page.id}">Edit details</button>${adminRole&&published?`<button class="btn text" data-action="email-preview" data-id="${page.id}">${icon('mail')}Email announcement</button>`:''}${published?`<button class="btn text" data-action="unpublish-release" data-id="${page.id}">Unpublish</button>`:''}${adminRole?`<button class="btn text danger" data-action="delete-release" data-id="${page.id}">Delete</button>`:''}</div><p class="release-help">Only notes marked ready are included when you publish.</p>`:''}${notes.length?contributionGroups(notes,editable):empty('Add the first contribution','Group the work by vertical and mark it ready when it can be published.')}</section>`;
}
function contributionGroups(notes,editable=false){
 const groups=new Map();for(const note of notes){const name=note.vertical||'General';if(!groups.has(name))groups.set(name,[]);groups.get(name).push(note);}
 return [...groups].map(([name,entries])=>`<section class="release-section" id="section-${slugify(name)}"><div class="release-section-heading">${toneIcon(entries[0].vertical_icon||'grid',entries[0].vertical_color||'slate')}<h3>${e(name)}</h3><span>${entries.length} ${entries.length===1?'contribution':'contributions'}</span></div>${entries.map(n=>`<article class="contribution"><div class="contribution-heading"><h4>${e(n.title)}</h4>${editable?`<span class="badge ${n.submitted?'published':'draft'}">${n.submitted?'Ready':'In progress'}</span>`:''}</div>${n.tickets?`<p class="ticket-refs">${e(n.tickets)}</p>`:''}<div class="prose">${markdown(n.body)}</div><div class="contributor-line"><span class="mini-avatar">${e((n.author||'Team').slice(0,2).toUpperCase())}</span><span>Added by <strong>${e(n.author||'Team member')}</strong></span><span>Edited by ${e(n.edited_by||n.author||'Team member')} · ${date(n.updated_at)}</span>${editable?`<button class="btn text" data-action="edit-entry" data-id="${n.id}">Edit</button>${state.member.role==='admin'?`<button class="btn text danger" data-action="delete-entry" data-id="${n.id}">Delete</button>`:''}`:''}</div></article>`).join('')}</section>`).join('');
}
function releaseDocument(p){const records=releaseRecords(true),record=records.find(r=>r.page.id===p.id)||{page:p,project:{id:'other',name:p.title,icon:'release',color:'violet'},notes:[],published:p,draft:false};return `<div class="layout release-layout">${releaseRail(records,record.version,record.project.id,true)}<main id="main" class="release-reader"><div class="reader-heading"><div><p class="reader-context">Published release</p><h1>${e(p.version?'Version '+versionKey(p.version):p.title)}</h1><p>Published ${date(p.published_at)}</p></div><div class="toolbar-actions"><button class="btn outline" data-action="copy-link">${icon('link')}Copy link</button>${canEdit(state.member?.role)?`<a class="btn dark" href="#/edit/${p.id}">Edit release</a>`:''}</div></div>${releaseApplication(record)}${!p.release_snapshot?`<div class="prose">${markdown(p.body)}</div>`:''}</main></div>`;}
function nativeArtifact(page,draft){state.nativeTitle=page.title;state.nativeBack=draft?'#/edit/'+page.id:'#/doc/'+page.slug;state.nativeDraft=draft;return `<main id="main" class="native-artifact">${artifactFrame(page,draft,true)}</main>`;}
function draftPreview(id){const page=state.pages.find(p=>p.id===id);if(!page||!canEdit(state.member?.role))throw new Error('Publisher access is required to preview drafts.');if(page.format==='html')return nativeArtifact(page,true);if(state.releases.some(r=>r.id===id)){const record=releaseRecords(false).find(r=>r.page.id===id);return `<div class="layout release-layout">${releaseRail(releaseRecords(false),record.version,record.project.id,false)}<main id="main" class="release-reader"><div class="reader-heading"><div><p class="reader-context">Saved draft preview · not published</p><h1>${e(page.title)}</h1></div><a class="btn outline" href="#/edit/${id}">Back to editing</a></div>${contributionGroups(record.notes.filter(n=>n.submitted))}</main></div>`;}return documentPage(page,true);}
function publicView(){const docs=filterPages(state.published,state);return `<div class="layout">${sidebar(!!state.member)}<main id="main" class="library-content"><div class="view-heading"><div><h1>${e(names[state.kind]||'Published documents')}</h1><p>${state.member?'Published knowledge available to your team.':'Public documents. Internal knowledge requires sign-in.'}</p></div></div><label class="search compact"><span class="sr-only">Search documents</span>${icon('search')}<input id="public-search" type="search" value="${e(state.query)}" placeholder="Search documents…"></label><div id="document-list" class="document-table">${docs.map(p=>row(p)).join('')||empty('No public documents in this collection','Sign in with your company account to view internal documents.','<a class="btn dark" href="#/workspace">Open team library</a>')}</div></main></div>`;}
function projectSectionSettings(){
 if(state.projectSections===null)return `<section class="settings-section"><div class="section-heading"><div><h2>Application sections</h2><p>Configuration becomes available after the project sections migration is applied.</p></div></div></section>`;
 return `<section class="settings-section"><div class="section-heading"><div><h2>Application sections</h2><p>Choose reusable release sections for each application. Archived sections stay in older releases.</p></div></div>${state.projects.map(project=>{const rows=state.projectSections.filter(row=>row.project_id===project.id&&row.active);const labels=rows.sort((a,b)=>a.sort_order-b.sort_order).map(row=>state.verticals.find(section=>section.id===row.vertical_id)?.name).filter(Boolean);return `<div class="structure-row"><span class="structure-project-icon">${toneIcon(project.icon,project.color)}</span><div><strong>${e(project.name)}</strong><small>${labels.length?e(labels.join(' · ')):'No sections configured'}</small></div><button class="btn outline" data-action="configure-project-sections" data-id="${project.id}">Configure sections</button></div>`}).join('')}</section>`;
}
function configureProjectSections(projectId){
 if(state.member?.role!=='admin'||state.projectSections===null)throw new Error('Application section configuration is unavailable.');
 const project=state.projects.find(item=>item.id===projectId);
 if(!project)throw new Error('Application not found.');
 const existing=new Map(state.projectSections.filter(row=>row.project_id===projectId).map(row=>[row.vertical_id,row]));
 dialog(`<h2>${e(project.name)} sections</h2><p class="small">Choose which sections contributors can use in future releases. An existing contribution remains readable if its section is removed.</p><form><div class="section-choice-list">${state.verticals.map((section,index)=>{const row=existing.get(section.id);return `<div class="section-choice"><label><input type="checkbox" name="section" value="${section.id}" ${row?.active?'checked':''}>${toneIcon(section.icon,section.color)}<span>${e(section.name)}</span></label><label class="section-order">Order <input type="number" name="order:${section.id}" min="0" max="999" value="${row?.sort_order??index}" aria-label="Order for ${e(section.name)}"></label></div>`}).join('')}</div><p class="error" role="alert"></p><div class="dialog-actions"><button type="button" class="btn outline" data-close>Cancel</button><button class="btn dark">Save sections</button></div></form>`,async form=>{
  const selected=new Set(form.getAll('section'));
  for(const section of state.verticals){
   const row=existing.get(section.id),active=selected.has(section.id);
   const sort_order=Number(form.get(`order:${section.id}`));
   if(!Number.isInteger(sort_order)||sort_order<0||sort_order>999)throw new Error('Section order must be between 0 and 999.');
   if(row)await db('docs_project_sections',`?project_id=eq.${projectId}&vertical_id=eq.${section.id}`,{method:'PATCH',body:{active,sort_order}});
   else if(active)await db('docs_project_sections','',{method:'POST',body:{project_id:projectId,vertical_id:section.id,active:true,sort_order}});
  }
  await load();await render();toast('Application sections updated.');
 });
}
function structureView(){
 const card=(kind,item)=>`<div class="structure-row">${toneIcon(item.icon,item.color)}<div><strong>${e(item.name)}</strong><small>${kind==='vertical'?'Release section':item.visibility==='public'?'Public by default':'Private · sign-in required'}${item.parent_id?' · inside '+e(state.folders.find(f=>f.id===item.parent_id)?.name||'folder'):''}</small></div><button class="btn outline" data-action="manage-${kind}" data-id="${item.id}">Edit</button><button class="iconbtn danger" data-action="remove-${kind}" data-id="${item.id}" aria-label="Delete ${e(item.name)}">${icon('trash')}</button></div>`;
 return `<div class="layout">${sidebar(true)}<main id="main" class="settings-content"><div class="view-heading"><div><h1>Structure & visibility</h1><p>Organize content, choose icons, and control public access.</p></div></div><section class="settings-section"><div class="section-heading"><div><h2>Release applications</h2><p>Each application has its own versions. All applications can share a version view.</p></div><button class="btn dark" data-action="manage-project">New application</button></div>${state.projects.map(p=>card('project',p)).join('')}</section>${projectSectionSettings()}<section class="settings-section"><div class="section-heading"><div><h2>Library folders</h2><p>Nested folders organize SOPs and documentation. A private parent keeps all its contents private.</p></div><button class="btn outline" data-action="manage-folder">New folder</button></div>${state.folders.map(f=>card('folder',f)).join('')||'<p class="muted">No folders yet.</p>'}</section><section class="settings-section"><div class="section-heading"><div><h2>Release sections</h2><p>Vertical headings used within each application’s release.</p></div><button class="btn outline" data-action="manage-vertical">New section</button></div>${state.verticals.map(v=>card('vertical',v)).join('')}</section><section class="settings-section"><div class="section-heading"><div><h2>Document collections & fields</h2><p>Add document types, icons, default access, and optional custom text fields.</p></div><button class="btn outline" data-action="manage-type">New collection</button></div>${state.types.map(t=>`<div class="structure-row">${toneIcon(t.icon,t.color)}<div><strong>${e(t.name)}</strong><small>${t.default_visibility==='public'?'Public':'Private'} by default${t.fields.length?' · '+e(t.fields.join(', ')):''}</small></div><button class="btn outline" data-action="manage-type" data-id="${t.key}">Edit</button>${!['release','sop','documentation'].includes(t.key)?`<button class="iconbtn danger" data-action="remove-type" data-id="${t.key}" aria-label="Delete ${e(t.name)}">${icon('trash')}</button>`:''}</div>`).join('')}</section></main></div>`;
}
function appearanceFields(item={}){return `<div class="form-columns"><div class="field"><label for="structure-icon">Icon</label><select id="structure-icon" name="icon">${['folder','book','documentation','release','phone','web','settings','car','tool','bag','users','grid','check'].map(k=>`<option value="${k}" ${item.icon===k?'selected':''}>${k}</option>`).join('')}</select></div><div class="field"><label for="structure-color">Icon color</label><select id="structure-color" name="color">${['blue','green','violet','orange','slate'].map(c=>`<option ${item.color===c?'selected':''}>${c}</option>`).join('')}</select></div></div>`;}
function manageStructure(kind,id){
 if(state.member.role!=='admin')throw new Error('Administrator access required.');const table={project:'docs_projects',folder:'docs_folders',vertical:'docs_verticals',type:'docs_types'}[kind];const items={project:state.projects,folder:state.folders,vertical:state.verticals,type:state.types}[kind];const item=items.find(x=>(x.id||x.key)===id)||{};
 dialog(`<h2>${id?'Edit':'New'} ${kind==='project'?'application':kind==='vertical'?'release section':kind==='type'?'document collection':'folder'}</h2><form><div class="field"><label for="structure-name">Name</label><input id="structure-name" name="name" required maxlength="80" value="${e(item.name||'')}"></div>${kind==='project'||kind==='vertical'?`<div class="field"><label for="structure-description">Description</label><textarea id="structure-description" name="description" maxlength="500">${e(item.description||'')}</textarea></div>`:''}${appearanceFields(item)}${kind!=='vertical'?`<div class="field"><label for="structure-visibility">${kind==='type'?'Default document access':'Access'}</label><select id="structure-visibility" name="${kind==='type'?'default_visibility':'visibility'}"><option value="private" ${(item.visibility||item.default_visibility)!=='public'?'selected':''}>Private · sign-in required</option><option value="public" ${(item.visibility||item.default_visibility)==='public'?'selected':''}>Public · no sign-in required</option></select></div>`:''}${kind==='folder'?`<div class="field"><label for="parent-folder">Parent folder</label><select name="parent_id" id="parent-folder">${options(state.folders.filter(f=>f.id!==id),item.parent_id,'Top level')}</select></div>`:''}${kind==='type'?`<div class="field"><label for="custom-labels">Custom fields</label><textarea name="fields" id="custom-labels" placeholder="Owner, Sprint, Reference URL">${e((item.fields||[]).join(', '))}</textarea><small>Up to 10 optional text fields, separated by commas.</small></div>`:''}<p class="error" role="alert"></p><div class="dialog-actions"><button type="button" class="btn outline" data-close>Cancel</button><button class="btn dark">Save ${kind==='project'?'application':kind==='vertical'?'section':kind==='type'?'collection':'folder'}</button></div></form>`,async f=>{const body=Object.fromEntries(f);if(kind==='folder')body.parent_id=body.parent_id||null;if(kind==='type'){body.fields=[...new Set(body.fields.split(',').map(s=>s.trim()).filter(Boolean))];if(body.fields.length>10||body.fields.some(s=>s.length>80))throw new Error('Use up to 10 field labels, each at most 80 characters.');if(!id)body.key=slugify(body.name).slice(0,40);}
 await db(table,id?'?'+(kind==='type'?'key':'id')+'=eq.'+encodeURIComponent(id):'',{method:id?'PATCH':'POST',body});await load();await render();toast('Structure updated. Access changes apply immediately.');});
}
function releaseDetails(id){const p=state.pages.find(p=>p.id===id);dialog(`<h2>Release details</h2><form><div class="field"><label for="release-title">Title</label><input id="release-title" name="title" value="${e(p.title)}" required maxlength="250"></div><div class="field"><label for="release-summary">Summary</label><textarea id="release-summary" name="summary" maxlength="500">${e(p.summary)}</textarea></div>${typeFields(p)}${visibilityField(p)}<p class="error" role="alert"></p><div class="dialog-actions"><button type="button" class="btn outline" data-close>Cancel</button><button class="btn dark">Save details</button></div></form>`,async f=>{const body=Object.fromEntries(f);body.custom_fields=Object.create(null);for(const k of Object.keys(body)){if(k.startsWith('field:')){body.custom_fields[k.slice(6)]=body[k];delete body[k];}}const result=await db('docs_pages',`?id=eq.${id}&revision=eq.${p.revision}`,{method:'PATCH',body,headers:{Prefer:'return=representation'}});if(!result.length)throw new Error('This release changed. Reload and try again.');await load();await render();});}
document.addEventListener('click',async ev=>{const b=ev.target.closest('[data-action]');if(!b)return;const action=b.dataset.action,id=b.dataset.id;if(action==='configure-project-sections'){configureProjectSections(id);return;}if(action.startsWith('manage-')){await busy(b,()=>manageStructure(action.slice(7),id));return;}if(action.startsWith('remove-')){const kind=action.slice(7);if(state.member?.role!=='admin')return;confirmAction('Delete this '+kind+'?',kind==='project'?'This permanently removes the application, all its releases, contributions, and published copies.':'Items still referenced by documents cannot be deleted. Deleting a folder keeps its documents and moves child folders to the top level.',async()=>{if(kind==='project')await api('/rest/v1/rpc/docs_delete_project',{method:'POST',body:{project:id}});else await db({folder:'docs_folders',vertical:'docs_verticals',type:'docs_types'}[kind],'?'+(kind==='type'?'key':'id')+'=eq.'+encodeURIComponent(id),{method:'DELETE'});await load();await render();toast('Deleted.');});return;}if(action==='release-details'){releaseDetails(id);return;}if(action==='open-draft-preview'){await busy(b,async()=>{const id=await saveDraft();location.hash='#/preview/'+id;});return;}if(action==='native-fullscreen'){await busy(b,()=>document.querySelector('.native-artifact').requestFullscreen());}});
document.addEventListener('change',ev=>{if(ev.target.id==='release-app')location.hash='#/releases?'+new URLSearchParams({project:ev.target.value,version:state.version||'',...(state.view?{view:state.view}:{})});if(ev.target.id==='kind'){const holder=document.querySelector('#custom-fields');if(holder){const p=state.pages.find(p=>p.id===document.querySelector('#editor-form').dataset.id)||{};holder.outerHTML=typeFields({...p,kind:ev.target.value});}if(document.querySelector('#editor-form')?.dataset.new==='true'&&document.querySelector('#visibility'))document.querySelector('#visibility').value=state.types.find(t=>t.key===ev.target.value)?.default_visibility||'private';}});

function globalSearch(){const source=state.member?state.pages:state.published;dialog('<h2>Search knowledge</h2><label class="search"><span class="sr-only">Search all documents</span><input id="global-query" type="search" placeholder="Search titles, content, or tags…" autofocus></label><div class="global-results" id="global-results"></div><div class="dialog-actions"><button class="btn outline" data-close>Close</button></div>');const results=modal.querySelector('#global-results'),query=modal.querySelector('#global-query');const update=()=>{const matches=filterPages(source,{query:query.value}).slice(0,20);results.innerHTML=matches.map(p=>`<a href="#/${canEdit(state.member?.role)?'edit/'+p.id:'doc/'+p.slug}" data-search-result>${e(p.title)}<small>${e(names[p.kind]||'Document')}${p.version?' · '+e(p.version):''}</small></a>`).join('')||'<p class="muted">No matching documents.</p>';results.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>modal.close()));};query.addEventListener('input',update);update();query.focus();}
document.addEventListener('click',ev=>{if(ev.target.closest('[data-action="global-search"]'))globalSearch();});
document.addEventListener('keydown',ev=>{if((ev.ctrlKey||ev.metaKey)&&ev.key==='k'&&!document.querySelector('#workspace-search,#public-search')){ev.preventDefault();globalSearch();}});

document.addEventListener("click", async (ev) => {
  const file = ev.target.closest("[data-file]");
  if (file) {
    await busy(file, async () => {
      const p = file.dataset.file;
      if (!/^[a-zA-Z0-9/_.-]+$/.test(p)) throw new Error("Invalid attachment");
      const token = await getToken();
      const r = await fetch(
        config.url + "/storage/v1/object/authenticated/hoora-docs/" + p,
        { headers: { apikey: config.key, ...authHeaders(token) } },
      );
      if (!r.ok)
        throw new Error(
          "This attachment is unavailable or you don’t have access.",
        );
      const u = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = u;
      a.download = p
        .split("/")
        .at(-1)
        .replace(/^[a-f0-9-]{37}/, "");
      a.click();
      setTimeout(() => URL.revokeObjectURL(u), 30000);
    });
    return;
  }
  const b = ev.target.closest("[data-action]");
  if (!b) return;
  const action = b.dataset.action;
  if (action === "menu") {
    document.querySelector(".layout")?.classList.toggle("menu-open");
    return;
  }
  if (action === "logout") {
    await busy(b, async () => {
      try {
        await api("/auth/v1/logout", { method: "POST" });
      } finally {
        saveSession(null);
        sessionStorage.removeItem("hoora-outlook-token");
        state.member = null;
        state.pages = [];
        state.folders = [];
        state.dirty = false;
        location.hash = "#/";
        await load();
        await render();
      }
    });
    return;
  }
  if (action === "copy-link") {
    await busy(b, async () => {
      await navigator.clipboard.writeText(location.href);
      toast("Link copied.");
    });
    return;
  }
  if (action === "add-member") {
    memberDialog();
    return;
  }
  if (action === "add-folder" || action === "add-vertical") {
    manageLegacyOrganization(action.slice(4));
    return;
  }
  if (action === "preview") {
    dialog(
      `<h2>Document preview</h2><div class="preview-box prose">${markdown(document.querySelector("#body").value)}</div><div class="dialog-actions"><button class="btn outline" data-close>Back to editing</button></div>`,
    );
    return;
  }
  if (action === "upload") {
    document.querySelector("#file-upload").click();
    return;
  }
  if (action === "publish") {
    await busy(b, async () => {
      const id = await saveDraft();
      await api("/rest/v1/rpc/docs_publish", {
        method: "POST",
        body: { page_id: id },
      });
      await load();
      location.hash = "#/edit/" + id;
      await render();
      toast("Published. Access follows the document and folder settings.");
    });
    return;
  }
  if (action === "unpublish") {
    confirmAction(
      "Unpublish this document?",
      "The published copy and its attachments will stop being available. Your team’s draft will be kept.",
      async () => {
        await api("/rest/v1/rpc/docs_unpublish", {
          method: "POST",
          body: { page_id: document.querySelector("#editor-form").dataset.id },
        });
        await load();
        await render();
        toast("Document unpublished.");
      },
    );
    return;
  }
  if (action === "delete-document") {
    confirmAction(
      "Delete this document?",
      "The draft, public copy, and contributions will be removed. This cannot be undone.",
      async () => {
        await db(
          "docs_pages",
          "?id=eq." + document.querySelector("#editor-form").dataset.id,
          { method: "DELETE" },
        );
        state.dirty = false;
        await load();
        location.hash = "#/workspace";
        toast("Document deleted.");
      },
    );
    return;
  }
});
document.addEventListener(
  "click",
  (ev) => {
    const link = ev.target.closest('a[href^="#/"]');
    if (state.dirty && link && link.hash !== location.hash) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      const destination = link.hash;
      confirmAction(
        "Leave without saving?",
        "Your unsaved edits will be discarded. Save your draft first if you want to keep them.",
        async () => {
          state.dirty = false;
          location.hash = destination;
        },
      );
    }
  },
  true,
);
window.addEventListener("hashchange", async () => {
  state.query = "";
  state.status = "";
  state.dirty = false;
  const route = location.hash;
  try {
    await load();
    if (route === location.hash) await render();
  } catch (err) {
    toast(err.message, true);
  }
  window.scrollTo(0, 0);
});
window.addEventListener("beforeunload", (ev) => {
  if (state.dirty) {
    ev.preventDefault();
    ev.returnValue = "";
  }
});
window.addEventListener("keydown", (ev) => {
  if ((ev.ctrlKey || ev.metaKey) && ev.key === "k") {
    ev.preventDefault();
    (
      document.querySelector("#public-search") ||
      document.querySelector("#workspace-search")
    )?.focus();
  }
  if (
    (ev.ctrlKey || ev.metaKey) &&
    ev.key === "s" &&
    document.querySelector("#editor-form")
  ) {
    ev.preventDefault();
    busy(null, async () => {
      await saveDraft();
      toast("Draft saved.");
    });
  }
});
document.addEventListener('click',event=>{
  const button=event.target.closest('[data-scroll-section]');
  if(!button)return;
  const target=document.getElementById('section-'+button.dataset.scrollSection);
  target?.scrollIntoView({block:'start',behavior:'smooth'});
  target?.focus({preventScroll:true});
});
window.addEventListener("storage", (ev) => {
  if (ev.key === "hoora-session") {
    try {
      state.session = JSON.parse(ev.newValue);
    } catch {
      state.session = null;
    }
    load()
      .then(render)
      .catch((err) => toast(err.message, true));
  }
});
try {
  await completeMicrosoftSignIn();
  if (!config.url || !config.key)
    throw new Error(
      "Hoora Docs is not configured. Set the Supabase environment variables and redeploy.",
    );
  await load();
  await render();
} catch (err) {
  app.innerHTML =
    header() +
    `<main class="article" id="main"><h1>Let’s get connected.</h1><div class="content-error">${e(err.message)}</div><p class="small">Please refresh to try again, or contact your administrator.</p></main>` +
    footer();
  bind();
}
