export function routeHash(){
 if(location.hash.startsWith('#/'))return location.hash;
 const path=location.pathname.replace(/^\/docs\//,'/doc/');
 return '#'+(path==='/'||path==='/app'?'/releases':path)+location.search;
}
export function routeUrl(hash){
 if(!hash?.startsWith('#/'))return hash;
 return hash.slice(1).replace(/^\/doc\//,'/docs/');
}
export function canonicalizeRoute(){
 if(new URLSearchParams(location.search).has('code')||new URLSearchParams(location.search).has('auth_callback'))return;
 const next=routeUrl(routeHash());
 if(location.pathname+location.search+location.hash!==next)history.replaceState(null,'',next);
}
