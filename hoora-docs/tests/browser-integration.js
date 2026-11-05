// Run in Chrome against the configured Supabase test/deployment project.
// Inject window.hooraTestConfig = {url, anon, service, adminToken} in memory; never commit keys.
async function runHooraIntegration() {
 const {url,anon,service,adminToken:admin}=window.hooraTestConfig;
 const results=[],users=[];let pageId,file;
 async function call(path,token=anon,method='GET',body) {
  const r=await fetch(url+path,{method,headers:{apikey:token===service?service:anon,Authorization:'Bearer '+token,'Content-Type':'application/json',Prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:r.status,data:await r.json().catch(()=>null)};
 }
 function check(name,pass,detail){results.push({name,pass,...(!pass?{detail}:{})});}
 try {
  for(const role of ['editor','viewer']) {
   const email='hoora-test-'+crypto.randomUUID()+'@example.com',password=crypto.randomUUID()+'A1!';
   const u=await call('/auth/v1/admin/users',service,'POST',{email,password,email_confirm:true});
   if(!u.data?.id)throw new Error('Unable to create test user');
   users.push({id:u.data.id,role});
   await call('/rest/v1/docs_members',service,'POST',{id:u.data.id,email,name:'Temporary integration test',role});
   const login=await call('/auth/v1/token?grant_type=password',anon,'POST',{email,password});
   users.at(-1).token=login.data.access_token;
  }
  const editor=users.find(u=>u.role==='editor'),viewer=users.find(u=>u.role==='viewer');
  let r=await call('/rest/v1/docs_pages',editor.token,'POST',{title:'Temporary security test',slug:'test-'+crypto.randomUUID(),kind:'release',body:'PRIVATE DRAFT'});
  pageId=r.data?.[0]?.id;check('Editor creates draft',r.status===201,r);if(!pageId)throw new Error('No test document created');
  r=await call('/rest/v1/docs_pages?id=eq.'+pageId);check('Anonymous cannot read drafts',r.status>=400||r.data?.length===0,r);
  r=await call('/rest/v1/rpc/docs_publish',editor.token,'POST',{page_id:pageId});check('Editor cannot publish',r.status>=400,r);
  r=await call('/rest/v1/docs_pages?id=eq.'+pageId,viewer.token,'PATCH',{body:'NOT ALLOWED'});check('Viewer cannot edit',r.status>=400||r.data?.length===0,r);
  r=await call('/rest/v1/docs_members?id=eq.'+editor.id,editor.token,'PATCH',{role:'admin'});check('Editor cannot elevate role',r.status>=400,r);
  r=await call('/rest/v1/rpc/docs_publish',admin,'POST',{page_id:pageId});check('Admin can publish',r.status<300,r);
  r=await call('/rest/v1/docs_published?id=eq.'+pageId);check('Anonymous can read published snapshot',r.data?.[0]?.body==='PRIVATE DRAFT',r);
  await call('/rest/v1/docs_pages?id=eq.'+pageId,editor.token,'PATCH',{body:'UNPUBLISHED EDIT'});
  r=await call('/rest/v1/docs_published?id=eq.'+pageId);check('Draft edits do not leak to public',r.data?.[0]?.body==='PRIVATE DRAFT',r);
  file=pageId+'/security-test.txt';
  r=await fetch(url+'/storage/v1/object/hoora-docs/'+file,{method:'POST',headers:{apikey:anon,Authorization:'Bearer '+editor.token,'Content-Type':'text/plain'},body:'temporary security test'});
  check('Editor can upload attachment',r.status<300,{status:r.status});
  async function fileStatus(){const r=await fetch(url+'/storage/v1/object/authenticated/hoora-docs/'+file,{headers:{apikey:anon,Authorization:'Bearer '+anon}});return r.status;}
  check('Unpublished attachment is private',await fileStatus()>=400);
  await call('/rest/v1/docs_pages?id=eq.'+pageId,editor.token,'PATCH',{body:'Published file [Test](attachment:'+file+')'});
  await call('/rest/v1/rpc/docs_publish',admin,'POST',{page_id:pageId});check('Published attachment can be downloaded',await fileStatus()===200);
  await call('/rest/v1/rpc/docs_unpublish',admin,'POST',{page_id:pageId});
  r=await call('/rest/v1/docs_published?id=eq.'+pageId);check('Unpublish removes public document',r.data?.length===0,r);
  check('Unpublish revokes attachment access',await fileStatus()>=400);
  await call('/rest/v1/docs_members?id=eq.'+editor.id,service,'PATCH',{active:false});
  r=await call('/rest/v1/docs_pages?id=eq.'+pageId,editor.token);check('Disabled member loses data access',r.data?.length===0,r);
 } catch(err) {results.push({name:'Integration execution',pass:false,error:err.message});}
 finally {
  if(file)await call('/storage/v1/object/hoora-docs',service,'DELETE',{prefixes:[file]});
  if(pageId)await call('/rest/v1/docs_pages?id=eq.'+pageId,service,'DELETE');
  for(const user of users)await call('/auth/v1/admin/users/'+user.id,service,'DELETE');
  delete window.hooraTestConfig;
 }
 return results;
}
