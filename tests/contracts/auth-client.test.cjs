// Actual TypeScript client modules with injected transport. Live HTTP is verified by AuthenticationAccountsIT.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {ApiClient, ApiError} = require('../../.evidence/ts/api.js');
const cases=[];
const test=(id,run)=>cases.push({id,run});
const session={id:'00000000-0000-0000-0000-000000000001',email:'alice@example.test',displayName:'Alice',role:'CUSTOMER',expiresAt:'2026-09-26T21:00:00Z'};
test('P03TS01-login-refreshes-csrf',async()=>{
 let generation=0,seen=[];
 const api=new ApiClient(async(url,options)=>{
  if(url.endsWith('/auth/csrf'))return Response.json({headerName:'X-XSRF-TOKEN',token:`csrf-${++generation}`});
  seen.push(options.headers.get('X-XSRF-TOKEN'));
  return Response.json(url.endsWith('/auth/login')?session:{id:'new-account'});
 });
 assert.deepEqual(await api.login('alice@example.test','synthetic-unit-password'),session);
 await api.createAccount('Primary','CAD');assert.deepEqual(seen,['csrf-1','csrf-2']);assert.equal(generation,2);
});
test('P03TS02-logout-204-and-csrf-refresh',async()=>{
 let generation=0;
 const api=new ApiClient(async(url)=>url.endsWith('/auth/csrf')?Response.json({headerName:'X-XSRF-TOKEN',token:`csrf-${++generation}`}):new Response(null,{status:204}));
 await api.logout();assert.equal(generation,2);
});
test('P03TS03-direct-login-command-invalidates-old-csrf',async()=>{
 let generation=0;
 const api=new ApiClient(async(url)=>url.endsWith('/auth/csrf')?Response.json({headerName:'X-XSRF-TOKEN',token:`csrf-${++generation}`}):Response.json(session));
 await api.command('/auth/login',{});await api.command('/accounts',{});assert.equal(generation,2);
});
test('P03TS04-problem-title-is-readable',async()=>{
 const api=new ApiClient(async()=>Response.json({code:'NOT_FOUND',title:'Resource not found',correlationId:'test-id'},{status:404}));
 await assert.rejects(api.get('/accounts/missing'),e=>e instanceof ApiError&&e.message==='Resource not found'&&e.problem.correlationId==='test-id');
});
test('P03TS05-account-money-remains-string',async()=>{
 const account={id:'account',name:'CAD',currency:'CAD',postedMinor:'9007199254740993',reservedMinor:'1',availableMinor:'9007199254740992'};
 const api=new ApiClient(async()=>Response.json({items:[account],limit:50,offset:0,hasMore:false}));
 assert.equal((await api.accounts()).items[0].postedMinor,'9007199254740993');
});
test('P03TS06-register-is-not-implicit-login',async()=>{
 const paths=[];
 const api=new ApiClient(async(url)=>{paths.push(url);return url.endsWith('/auth/csrf')?Response.json({headerName:'X-XSRF-TOKEN',token:'csrf'}):Response.json({id:session.id,email:session.email,displayName:session.displayName,role:'CUSTOMER'},{status:201});});
 await api.register({email:session.email,password:'synthetic-unit-password',displayName:'Alice'});
 assert.deepEqual(paths,['/api/v1/auth/csrf','/api/v1/auth/register']);
});
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
(async()=>{
 let failures=0;const rows=[];
 for(const c of cases){try{await c.run();console.log('PASS',c.id);rows.push(`<testcase name="${c.id}"/>`);}catch(e){failures++;console.error('FAIL',c.id,e.message);rows.push(`<testcase name="${c.id}"><failure message="${escape(e.message)}"/></testcase>`);}}
 fs.mkdirSync('.evidence/client',{recursive:true});fs.writeFileSync('.evidence/client/auth-results.xml',`<testsuite name="p03-client" tests="${cases.length}" failures="${failures}" errors="0" skipped="0">${rows.join('\n')}</testsuite>`);
 console.log(`P03_CLIENT_SUMMARY tests=${cases.length} failures=${failures}`);process.exitCode=failures?1:0;
})();
