import { serverClient, requireMember } from '../server/supabase.js';
import { failure, filterIdFromUrl, jiraConfigured, jiraRequest, searchTickets, ticketSummary, ticketDetail } from '../server/jira.js';
export const maxDuration = 60;
const uuid = value => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value || '');
export function canViewRelease(release, user, member) {
  return member.role === 'admin' || (release.enabled && user.email_confirmed_at && release.allowed_emails.includes(String(user.email || '').trim().toLowerCase()));
}
export function validateRelease(body) {
  const title=String(body.title || '').trim(), version=String(body.version || '').trim();
  if (!title || title.length>100 || !version || version.length>50) throw failure('Enter a release name and version.');
  const filter_id=filterIdFromUrl(body.filterUrl);
  const raw=Array.isArray(body.allowedEmails) ? body.allowedEmails : String(body.allowedEmails || '').split(/[\s,;]+/);
  const allowed_emails=[...new Set(raw.map(v=>String(v).trim().toLowerCase()).filter(Boolean))];
  if (allowed_emails.length>200 || allowed_emails.some(v=>! /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@hoora\.me$/.test(v))) throw failure('Enter up to 200 valid @hoora.me work emails.');
  const release_date=body.releaseDate || null;
  if (release_date && (!/^\d{4}-\d{2}-\d{2}$/.test(release_date) || !Number.isFinite(Date.parse(release_date)) || new Date(release_date).toISOString().slice(0,10)!==release_date)) throw failure('Enter a valid target release date.');
  const enabled=body.enabled === true;
  if (enabled && !release_date) throw failure('Set a target date before sharing this release.');
  return { title,version,filter_id,release_date,allowed_emails,enabled };
}
const publicRecord = (r, admin) => ({ id:r.id, slug:r.slug, title:r.title, version:r.version, releaseDate:r.release_date, updatedAt:r.updated_at, ...(admin ? {filterUrl:`https://hooratechteam.atlassian.net/issues?filter=${r.filter_id}`,allowedEmails:r.allowed_emails,enabled:r.enabled} : {}) });

export default async function handler(req,res) {
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('Vary','Authorization');
  if (req.method!=='POST') return res.status(405).json({error:'Method not allowed.'});
  if (!req.headers.authorization?.startsWith('Bearer ')) return res.status(401).json({error:'Please sign in.'});
  try {
    const call=serverClient(), {user,member}=await requireMember(req,call);
    if (Number(req.headers['content-length'] || 0)>20000) throw failure('Request too large.',413);
    const body=typeof req.body==='string' ? JSON.parse(req.body) : req.body || {};
    if (JSON.stringify(body).length>20000) throw failure('Request too large.',413);
    const admin=member.role==='admin', action=body.action || 'list';
    if (!['list','tickets','ticket','save','delete','connection'].includes(action)) throw failure('Invalid action.');
    if (['save','delete','connection'].includes(action) && !admin) throw failure('Administrator access required.',403);
    if (action==='connection') return res.status(200).json({configured:jiraConfigured()});
    if (action==='list') {
      const rows=await call('/rest/v1/docs_upcoming_releases?select=*&order=release_date.asc.nullslast,created_at.desc');
      return res.status(200).json({releases:rows.filter(r=>canViewRelease(r,user,member)).map(r=>publicRecord(r,admin)), ...(admin ? {configured:jiraConfigured()} : {})});
    }
    let record;
    if (body.id) {
      if (!uuid(body.id)) throw failure('Release unavailable.',404);
      record=(await call('/rest/v1/docs_upcoming_releases?id=eq.'+body.id+'&select=*'))[0];
      if (!record || !canViewRelease(record,user,member)) throw failure('Release unavailable or access has not been granted.',404);
    }
    if (action==='save') {
      const input=validateRelease(body);
      if (input.enabled) {
        const filter=await jiraRequest('/filter/'+input.filter_id);
        if (String(filter.id)!==input.filter_id) throw failure('Unable to verify the saved filter.',422);
        // Also verify issue-read scope before making a page available to stakeholders.
        await jiraRequest('/search/jql',{jql:`filter = ${input.filter_id}`,fields:['summary'],maxResults:1});
      }
      const now=new Date().toISOString();
      let saved;
      if (record) {
        if (body.updatedAt!==record.updated_at) throw failure('This release changed. Refresh it before saving.',409);
        const rows=await call('/rest/v1/docs_upcoming_releases?id=eq.'+record.id+'&updated_at=eq.'+encodeURIComponent(record.updated_at),{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({...input,updated_at:now})});
        saved=rows[0]; if (!saved) throw failure('This release changed. Refresh it before saving.',409);
      } else {
        const slug=(input.title+'-'+input.version).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,100)+'-'+crypto.randomUUID().slice(0,8);
        saved=(await call('/rest/v1/docs_upcoming_releases',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({...input,slug,created_by:user.id,updated_at:now})}))[0];
      }
      return res.status(200).json({release:publicRecord(saved,true)});
    }
    if (!record) throw failure('Release unavailable.',404);
    if (action==='delete') {
      if (body.updatedAt!==record.updated_at) throw failure('This release changed. Refresh it before deleting.',409);
      const rows=await call('/rest/v1/docs_upcoming_releases?id=eq.'+record.id+'&updated_at=eq.'+encodeURIComponent(record.updated_at),{method:'DELETE',headers:{Prefer:'return=representation'}});
      if (!rows.length) throw failure('This release changed. Refresh it before deleting.',409);
      return res.status(200).json({ok:true});
    }
    await call('/rest/v1/rpc/docs_upcoming_rate_limit',{method:'POST',body:JSON.stringify({actor:user.id})});
    if (action==='ticket') {
      if (!/^[A-Z][A-Z0-9_]{0,30}-[1-9]\d{0,12}$/.test(body.key || '')) throw failure('Invalid ticket.');
      const issues=await searchTickets(record.filter_id,String(body.key || ''));
      if (!body.key || !issues.length || issues[0].key!==body.key) throw failure('This ticket is no longer in the release filter.',404);
      return res.status(200).json({ticket:ticketDetail(issues[0])});
    }
    const issues=(await searchTickets(record.filter_id)).map(ticketSummary);
    const options=field=>[...new Map(issues.flatMap(i=>i[field]).map(v=>[v.id,v])).values()].sort((a,b)=>a.label.localeCompare(b.label));
    return res.status(200).json({release:publicRecord(record,admin),tickets:issues,verticals:options('verticals'),owners:options('owners'),fetchedAt:new Date().toISOString()});
  } catch(error) {
    const status=error.status || 500;
    if (/rate limit/i.test(error.message)) return res.status(429).json({error:'Too many requests. Please wait a minute.'});
    const message=error.public || [401,403].includes(status) ? error.message : 'Upcoming releases could not be loaded. Please try again.';
    return res.status(status).json({error:message});
  }
}
