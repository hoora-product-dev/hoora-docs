export function upcomingFeature({state,appApi,e,icon,dialog,modal,toast,render}) {
  let releases=[],configured=false,current=null,tickets=[],verticals=[],owners=[],request=0;
  const api=body=>appApi('/api/upcoming',body);
  const date=value=>value?new Date(value+'T12:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}):'Date not set';
  const admin=()=>state.member?.role==='admin';
  const path=r=>'#/upcoming/'+encodeURIComponent(r.slug);
  function empty(text){return `<div class="upcoming-empty">${icon('clock')}<p>${e(text)}</p></div>`;}
  function aside(){return `<aside class="sidebar" aria-label="Upcoming release navigation"><a class="sidelink" href="#/upcoming">${icon('clock')}<span>Upcoming releases</span></a><a class="sidelink" href="#/releases">${icon('release')}<span>Published releases</span></a>${admin()?'<div class="rail-label">Administration</div><button class="sidelink" data-upcoming="new">New upcoming release</button>':''}</aside>`;}
  function options(values,selected,label){return `<option value="">${label}</option><option value="__unassigned__" ${selected==='__unassigned__'?'selected':''}>Not assigned</option>${values.map(v=>`<option value="${e(v.id)}" ${v.id===selected?'selected':''}>${e(v.label)}</option>`).join('')}`;}
  function rows(vertical='',owner='') {
    const matches=(values,id)=>!id || (id==='__unassigned__'? !values.length:values.some(v=>v.id===id));
    const found=tickets.filter(t=>matches(t.verticals,vertical)&&matches(t.owners,owner));
    return `<p class="upcoming-count" role="status">${found.length} ${found.length===1?'ticket':'tickets'}</p><div class="upcoming-tickets">${found.map(t=>`<button type="button" class="upcoming-ticket" data-upcoming="ticket" data-key="${e(t.key)}"><span class="upcoming-ticket-key">${e(t.key)}</span><span class="upcoming-ticket-title">${e(t.title)}</span>${icon('chevron')}</button>`).join('') || empty('No tickets match these filters.')}</div>`;
  }
  async function view(slug,params) {
    const generation=++request;
    const result=await api({action:'list'});
    if(generation!==request)return '';
    releases=result.releases;configured=result.configured===true;current=null;tickets=[];
    const heading=`<div class="reader-heading"><div><h1>Upcoming releases</h1></div>${admin()?'<button class="btn outline" data-upcoming="new">New release</button>':''}</div>`;
    const notice=admin()&&!configured?'<p class="upcoming-connection" role="status">Jira connection pending. You can save release drafts; sharing becomes available after the read-only connection is configured.</p>':'';
    if(!slug)return `<div class="layout">${aside()}<main id="main" class="upcoming-page">${heading}${notice}<div class="upcoming-release-list">${releases.map(r=>`<article class="upcoming-release-card"><a href="${path(r)}"><span class="upcoming-release-version">${e(r.version)}</span><h2>${e(r.title)}</h2><p>Target release · ${e(date(r.releaseDate))}</p>${admin()?`<small>${r.enabled?'Shared with approved viewers':'Draft'}</small>`:''}</a>${admin()?`<button class="iconbtn" data-upcoming="edit" data-id="${e(r.id)}" aria-label="Manage ${e(r.title)}">${icon('settings')}</button>`:''}</article>`).join('')||empty('No upcoming releases are available to your account.')}</div></main></div>`;
    current=releases.find(r=>r.slug===slug);
    if(!current)return `<div class="layout">${aside()}<main id="main" class="upcoming-page">${heading}${empty('This release is unavailable or access has not been granted.')}</main></div>`;
    const r=current; document.title=r.title+' · '+r.version+' — Upcoming — Hoora Docs';
    let ticketContent;
    try {
      const result=await api({action:'tickets',id:r.id});
      if(generation!==request)return '';
      tickets=result.tickets;verticals=result.verticals;owners=result.owners;
      ticketContent=`<div class="upcoming-filters"><div class="field"><label for="upcoming-vertical">Vertical</label><select id="upcoming-vertical">${options(verticals,params.get('vertical')||'','All verticals')}</select></div><div class="field"><label for="upcoming-owner">Product Owner</label><select id="upcoming-owner">${options(owners,params.get('owner')||'','All product owners')}</select></div></div><div id="upcoming-results">${rows(params.get('vertical')||'',params.get('owner')||'')}</div><p class="upcoming-synced">Updated from Jira · ${e(new Date(result.fetchedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}))}</p>`;
    } catch(error) { ticketContent=`<div class="upcoming-load-error" role="alert"><p>${e(error.message)}</p><button class="btn outline" data-upcoming="refresh">Try again</button></div>`; }
    return `<div class="layout">${aside()}<main id="main" class="upcoming-page"><header class="upcoming-release-header"><div><p class="upcoming-release-version">${e(r.version)}</p><h1>${e(r.title)}</h1><p>Target release · ${e(date(r.releaseDate))}</p></div><div class="toolbar-actions"><button class="btn outline" data-upcoming="copy">${icon('link')}Copy link</button>${admin()?`<button class="btn outline" data-upcoming="edit" data-id="${e(r.id)}">${icon('edit')}Manage</button>`:''}</div></header>${notice}${ticketContent}</main></div>`;
  }
  function editor(id) {
    if(!admin())return;
    const r=releases.find(r=>r.id===id)||{};
    dialog(`<h2>${r.id?'Manage release':'New upcoming release'}</h2><form id="upcoming-form" data-id="${e(r.id||'')}"><div class="field"><label for="upcoming-title">Release name</label><input id="upcoming-title" name="title" maxlength="100" required value="${e(r.title||'')}"></div><div class="form-columns"><div class="field"><label for="upcoming-version">Version</label><input id="upcoming-version" name="version" maxlength="50" required placeholder="5.12.0" value="${e(r.version||'')}"></div><div class="field"><label for="upcoming-date">Target release date</label><input type="date" id="upcoming-date" name="releaseDate" value="${e(r.releaseDate||'')}"></div></div><div class="field"><label for="upcoming-filter">Jira filter link</label><input type="url" id="upcoming-filter" name="filterUrl" required placeholder="https://hooratechteam.atlassian.net/issues?filter=12576" value="${e(r.filterUrl||'')}"></div><div class="field"><label for="upcoming-emails">Approved viewers</label><textarea id="upcoming-emails" name="allowedEmails" rows="4" placeholder="name@hoora.me">${e((r.allowedEmails||[]).join('\n'))}</textarea><small>One work email per line. Viewers must sign in with an active Hoora Docs account. Administrators always have access.</small></div><label class="upcoming-share-check"><input type="checkbox" name="enabled" ${r.enabled?'checked':''} ${configured?'':'disabled'}> Share with approved viewers</label><p class="error" id="upcoming-form-error" role="alert"></p><div class="dialog-actions">${r.id?'<button class="btn text danger" type="button" data-upcoming="delete" data-id="'+e(r.id)+'">Delete release</button>':''}<button type="button" class="btn outline" data-upcoming="cancel">Cancel</button><button type="submit" class="btn dark">Save release</button></div></form>`, async data => { const values=Object.fromEntries(data); const result=await api({action:'save',...values,id:r.id,updatedAt:r.updatedAt,enabled:values.enabled==='on'}); location.hash=path(result.release); await render(); toast('Upcoming release saved.'); });
  }
  // Render Jira's document format with an explicit element allowlist; never insert Jira HTML.
  function documentHtml(node,depth=0) {
    if(!node||depth>40)return '';
    if(typeof node==='string')return `<p>${e(node)}</p>`;
    const content=(node.content||[]).map(n=>documentHtml(n,depth+1)).join('');
    if(node.type==='text'){
      let text=e(node.text||'');
      for(const mark of node.marks||[]){if(mark.type==='strong')text='<strong>'+text+'</strong>';if(mark.type==='em')text='<em>'+text+'</em>';if(mark.type==='code')text='<code>'+text+'</code>';if(mark.type==='strike')text='<s>'+text+'</s>';if(mark.type==='link'){try{const u=new URL(mark.attrs.href);if(u.protocol==='https:')text=`<a href="${e(u.href)}" target="_blank" rel="noopener noreferrer">${text}</a>`;}catch{}}}
      return text;
    }
    const tags={doc:'div',paragraph:'p',bulletList:'ul',orderedList:'ol',listItem:'li',blockquote:'blockquote',codeBlock:'pre',table:'table',tableRow:'tr',tableCell:'td',tableHeader:'th',panel:'blockquote',expand:'details'};
    if(node.type==='heading'){const level=Math.min(6,Math.max(2,Number(node.attrs?.level)||2));return `<h${level}>${content}</h${level}>`;}
    if(node.type==='hardBreak')return '<br>';
    if(node.type==='rule')return '<hr>';
    if(node.type==='mention')return e(node.attrs?.text||'Mention');
    if(node.type==='emoji')return e(node.attrs?.text||node.attrs?.shortName||'');
    if(node.type==='status')return e(node.attrs?.text||'');
    if(node.type==='date'){const value=Number(node.attrs?.timestamp);return Number.isFinite(value)?e(new Date(value).toLocaleDateString()):'';}
    if(['inlineCard','blockCard'].includes(node.type)){try{const u=new URL(node.attrs?.url);if(u.protocol==='https:')return `<a href="${e(u.href)}" target="_blank" rel="noopener noreferrer">${e(u.href)}</a>`;}catch{}return '';}
    if(node.type==='media')return '<p class="muted">Media attachment · available in Jira</p>';
    const tag=tags[node.type];return tag?`<${tag}>${node.type==='expand'?'<summary>'+e(node.attrs?.title||'Details')+'</summary>':''}${content}</${tag}>`:content;
  }
  async function openTicket(key) {
    if(!current)return;
    const releaseId=current.id;
    dialog('<div class="upcoming-ticket-loading" role="status">Loading ticket…</div>');
    modal.dataset.upcomingTicket=key;
    try {
      const {ticket:t}=await api({action:'ticket',id:releaseId,key});
      if(!modal.open||modal.dataset.upcomingTicket!==key||current?.id!==releaseId||document.body.dataset.route!=='upcoming')return;
      const facts=[['Status',t.status],['Type',t.type],['Priority',t.priority],['Vertical',t.verticals.map(v=>v.label).join(', ')||'Not assigned'],['Product Owner',t.owners.map(v=>v.label).join(', ')||'Not assigned'],['Assignee',t.assignee||'Not assigned'],['Reporter',t.reporter],['Project',t.project],['Due date',t.dueDate],['Fix versions',(t.fixVersions||[]).join(', ')],['Labels',(t.labels||[]).join(', ')],['Updated',t.updatedAt?new Date(t.updatedAt).toLocaleString():'']];
      dialog(`<div class="upcoming-ticket-heading"><div><p class="muted">${e(t.key)}</p><h2>${e(t.title)}</h2></div><button class="iconbtn" data-upcoming="cancel" aria-label="Close ticket">${icon('close')}</button></div><dl class="upcoming-ticket-facts">${facts.filter(([,value])=>value).map(([label,value])=>`<div><dt>${e(label)}</dt><dd>${e(value)}</dd></div>`).join('')}</dl><div class="prose upcoming-ticket-description">${t.description?documentHtml(t.description):'<p class="muted">No description added.</p>'}</div>`);
      modal.dataset.upcomingTicket=key;
    } catch(error){if(modal.open&&modal.dataset.upcomingTicket===key)dialog(`<h2>Ticket unavailable</h2><p role="alert">${e(error.message)}</p><div class="dialog-actions"><button class="btn outline" data-upcoming="cancel">Close</button></div>`);}
  }
  document.addEventListener('change',event=>{
    if(!['upcoming-vertical','upcoming-owner'].includes(event.target.id))return;
    const vertical=document.querySelector('#upcoming-vertical').value,owner=document.querySelector('#upcoming-owner').value;
    document.querySelector('#upcoming-results').innerHTML=rows(vertical,owner);
    const url=new URL(location.href);url.searchParams.delete('vertical');url.searchParams.delete('owner');if(vertical)url.searchParams.set('vertical',vertical);if(owner)url.searchParams.set('owner',owner);history.replaceState(null,'',url.pathname+url.search);
  });
  document.addEventListener('click',async event=>{
    const b=event.target.closest('[data-upcoming]');if(!b)return;
    const action=b.dataset.upcoming,id=b.dataset.id;
    if(action==='new'||action==='edit')return editor(id);
    if(action==='cancel'){delete modal.dataset.upcomingTicket;modal.close();return;}
    if(action==='refresh')return render();
    if(action==='ticket')return openTicket(b.dataset.key);
    if(action==='copy'){try{await navigator.clipboard.writeText(location.origin+'/upcoming/'+current.slug);toast('Link copied. Only approved viewers can open it.');}catch{toast('Unable to copy the link.');}return;}
    if(action==='delete'){
      const r=releases.find(r=>r.id===id);if(!r||!admin())return;
      dialog(`<h2>Delete upcoming release?</h2><p>${e(r.title)} will be removed from Hoora Docs. Jira tickets will remain available in Jira.</p><p id="upcoming-delete-error" class="error" role="alert"></p><div class="dialog-actions"><button class="btn outline" data-upcoming="cancel">Cancel</button><button class="btn dark" data-upcoming="confirm-delete" data-id="${e(id)}">Delete release</button></div>`);return;
    }
    if(action==='confirm-delete'){
      const r=releases.find(r=>r.id===id);if(!r||!admin())return;b.disabled=true;
      try{await api({action:'delete',id,updatedAt:r.updatedAt});modal.close();location.hash='#/upcoming';await render();toast('Upcoming release deleted.');}catch(error){document.querySelector('#upcoming-delete-error').textContent=error.message;b.disabled=false;}
    }
  });
  return {view,documentHtml};
}
