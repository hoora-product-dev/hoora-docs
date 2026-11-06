import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const base=process.env.HOORA_TEST_BASE_URL||'http://localhost:5173';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route(base+'/__upcoming-ui-test',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/vendor/ui.css"></head><body data-route="upcoming"><div id="app"></div><dialog id="modal"></dialog></body></html>'}));
 await page.goto(base+'/__upcoming-ui-test');
 await page.evaluate(async()=>{
  const {upcomingFeature}=await import('/upcoming.js');const {escapeHtml}=await import('/lib.js');
  window.upcomingState={member:{role:'admin'}};window.upcomingCalls=[];
  const r={id:'df7328d8-c004-4596-b9b1-b2d3a1ccc598',slug:'customer-5-12',title:'Customer App',version:'5.12.0',releaseDate:'2026-11-20',filterUrl:'https://hooratechteam.atlassian.net/issues?filter=12576',enabled:true,allowedEmails:['viewer@hoora.me'],updatedAt:'2026-11-07T00:00:00Z'};
  const tickets=[{key:'HCUS-1',title:'Booking improvements',status:'Ready for Dev',verticals:[{id:'a',label:'Auto Care'}],owners:[{id:'p',label:'Product Owner One'}]},{key:'HCUS-2',title:'Garage scheduling',status:'In progress',verticals:[{id:'g',label:'Garage Services'}],owners:[{id:'q',label:'Product Owner Two'}]},{key:'HCUS-3',title:'Product catalog',status:'Backlog',verticals:[],owners:[]}];
  const modal=document.querySelector('#modal');
  const dialog=(html,callback)=>{modal.innerHTML=html;modal.showModal();if(callback)modal.querySelector('form').addEventListener('submit',async event=>{event.preventDefault();try{await callback(new FormData(event.target));modal.close();}catch(e){modal.querySelector('.error').textContent=e.message;}});};
  window.upcomingUI=upcomingFeature({state:window.upcomingState,e:escapeHtml,icon:()=>'<span class="icon" aria-hidden="true">›</span>',modal,dialog,toast:()=>{},render:async()=>{},appApi:async(path,body)=>{window.upcomingCalls.push(body);if(body.action==='list')return {releases:[r],configured:true};if(body.action==='tickets')return {release:r,tickets,verticals:[{id:'a',label:'Auto Care'},{id:'g',label:'Garage Services'}],owners:[{id:'p',label:'Product Owner One'},{id:'q',label:'Product Owner Two'}],fetchedAt:'2026-11-07T00:00:00Z'};if(body.action==='save')return {release:r};if(body.action==='ticket')return {ticket:{...tickets.find(t=>t.key===body.key),description:{type:'doc',content:[{type:'heading',attrs:{level:2},content:[{type:'text',text:'Booking details'}]},{type:'paragraph',content:[{type:'text',text:'<img src=x onerror=alert(1)>',marks:[{type:'link',attrs:{href:'javascript:alert(1)'}}]}]}]},labels:[],fixVersions:[],updatedAt:'2026-11-07T00:00:00Z'}};throw Error('Unexpected action');}});
  window.showUpcoming=async slug=>{document.querySelector('#app').innerHTML=await window.upcomingUI.view(slug,new URLSearchParams());};
  await window.showUpcoming('customer-5-12');
 });
 assert.equal(await page.locator('.upcoming-ticket').count(),3);
 await page.getByLabel('Vertical',{exact:true}).selectOption('a');assert.equal(await page.locator('.upcoming-ticket').count(),1);
 await page.getByLabel('Product Owner',{exact:true}).selectOption('q');assert.equal(await page.locator('.upcoming-ticket').count(),0);
 await page.getByLabel('Product Owner',{exact:true}).selectOption('p');await page.getByRole('button',{name:/Booking improvements/}).click();
 await page.getByRole('heading',{name:'Booking details'}).waitFor();assert.equal(await page.locator('.upcoming-ticket-description img').count(),0);assert.equal(await page.locator('.upcoming-ticket-description a[href^="javascript:"]').count(),0);assert.ok((await page.locator('.upcoming-ticket-description').innerText()).includes('<img'));await page.getByRole('button',{name:'Close ticket'}).click();
 await page.getByLabel('Vertical',{exact:true}).selectOption('__unassigned__');await page.getByLabel('Product Owner',{exact:true}).selectOption('');assert.equal(await page.locator('.upcoming-ticket').count(),1);
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/upcoming-mobile.png',fullPage:true});
 await page.evaluate(()=>window.showUpcoming());await page.getByRole('button',{name:'New release',exact:true}).click();await page.getByLabel('Release name',{exact:true}).fill('Partner App');await page.getByLabel('Version',{exact:true}).fill('1.7.0');await page.getByLabel('Target release date').fill('2026-11-25');await page.getByLabel('Jira filter link').fill('https://hooratechteam.atlassian.net/issues?filter=12576');await page.getByLabel('Approved viewers',{exact:true}).fill('viewer@hoora.me');await page.getByLabel('Share with approved viewers').check();await page.getByRole('button',{name:'Save release',exact:true}).click();await page.locator('dialog').waitFor({state:'hidden'});
 const saved=await page.evaluate(()=>window.upcomingCalls.find(c=>c.action==='save'));assert.equal(saved.version,'1.7.0');assert.equal(saved.enabled,true);assert.equal(saved.releaseDate,'2026-11-25');
 await page.evaluate(async()=>{window.upcomingState.member.role='viewer';await window.showUpcoming('customer-5-12');});assert.equal(await page.getByRole('button',{name:'Manage',exact:true}).count(),0);assert.equal(await page.locator('[data-upcoming=new]').count(),0);
 assert.deepEqual(errors,[]);console.log('PASS Upcoming releases: two combined filters, unassigned fields, safe rich descriptions, mobile layout, admin form and viewer controls.');
}finally{await browser.close();}
