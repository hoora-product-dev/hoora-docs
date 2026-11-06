// Private pages and API responses are deliberately never put in an offline cache.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
  if(event.request.mode==='navigate')event.respondWith(fetch(event.request).catch(()=>new Response('<!doctype html><title>Hoora Docs · Offline</title><meta name="viewport" content="width=device-width"><main style="font:16px system-ui;max-width:480px;margin:15vh auto;padding:24px"><h1>You’re offline</h1><p>Connect to the internet to open your team’s knowledge securely.</p><a href="/app">Try again</a></main>',{headers:{'Content-Type':'text/html;charset=utf-8'}})));
});
self.addEventListener('push',event=>{
  let data;try{data=event.data.json();}catch{data={};}
  event.waitUntil(self.registration.showNotification(data.title||'Hoora Docs',{body:data.body||'Open Hoora Docs for the latest updates.',icon:'/app-icon-192.png',badge:'/app-icon-192.png',tag:data.tag||'hoora-update',data:{url:typeof data.url==='string'&&(/^\/docs\/[a-z0-9-]+$/.test(data.url)||/^\/release-notes\/[a-z0-9][a-z0-9.-]*\/[a-z0-9-]+$/.test(data.url))?data.url:'/notifications'}}));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const url=new URL(event.notification.data?.url||'/notifications',self.location.origin);
  if(url.origin===self.location.origin)event.waitUntil(self.clients.openWindow(url.href));
});
