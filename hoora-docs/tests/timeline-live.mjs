import { chromium } from 'playwright';
import { loadEnvFile } from 'node:process';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
loadEnvFile();
const credentials=JSON.parse(await readFile('.credentials.admin.json','utf8'));
const response=await fetch(process.env.SUPABASE_URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:process.env.SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify(credentials)});
assert.ok(response.ok,'Test administrator login works');
const session=await response.json();
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:920}});
await context.addInitScript(s=>localStorage.setItem('hoora-session',JSON.stringify({...s,expires_at:Date.now()/1000+s.expires_in})),session);
const page=await context.newPage(),errors=[],scripts=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('request',request=>{if(request.url().includes('/vendor/'))scripts.push(request.url());});
try{
 await page.goto('http://127.0.0.1:3001/#/releases');
 await page.getByRole('heading',{name:'What’s new at Hoora'}).waitFor({timeout:15000});
 assert.ok(!scripts.some(url=>url.includes('/rich-editor.js')||url.includes('/oauth.js')),'Readers should not load editor or OAuth bundles');
 assert.ok(await page.locator('.timeline-item').count()>=2);
 await page.screenshot({path:'test-results/new-timeline.png'});
 const first=page.locator('.timeline-item h3 a').first();
 await first.click();
 await page.locator('.native-release-document h1').waitFor();
 assert.ok(await page.locator('.native-release-body .contribution').count()>=1);
 assert.ok(await page.locator('.release-outline button').count()>=1);
 await page.screenshot({path:'test-results/new-reader.png'});
 await page.goBack();
 await page.getByRole('heading',{name:'What’s new at Hoora'}).waitFor();
 for(const width of [1440,768,390]){
  await page.setViewportSize({width,height:900});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`Timeline overflow ${width}: ${JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(el=>el.getBoundingClientRect().right>innerWidth+2).slice(0,12).map(el=>[el.tagName,el.className?.baseVal||el.className,Math.round(el.getBoundingClientRect().right)])))}`);
 }
 await page.locator('.timeline-item h3 a').first().click();
 await page.locator('.native-release-document h1').waitFor();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Reader overflow on mobile');
 await page.screenshot({path:'test-results/new-reader-mobile.png'});
 assert.deepEqual(errors,[]);
 console.log('Live release feed and full release reader passed with browser Back, content outline and 390/768/1440 widths. No data was changed.');
}finally{await browser.close()}
