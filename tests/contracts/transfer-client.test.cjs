// P04 client/intent behavior with the actual compiled production modules and injected Fetch transport.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {ApiClient, ApiError, OutcomeUnknown} = require('../../.evidence/ts/api.js');
const {IntentStore} = require('../../.evidence/ts/intent-store.js');
const cases=[];
const test=(id,run)=>cases.push({id,run});
const alice='00000000-0000-0000-0000-000000000001';
const source='10000000-0000-0000-0000-000000000001';
const recipient='LG-20000000000000000000000000000001';
const intent={sourceId:source.toUpperCase(),recipientRef:`  ${recipient.toUpperCase()}  `,amountMinor:'8000',currency:'CAD'};
const receipt={id:'f0000000-0000-0000-0000-000000000001',kind:'TRANSFER',state:'SETTLED',journalId:'f1000000-0000-0000-0000-000000000001',amountMinor:'8000',currency:'CAD'};
const csrf=token=>Response.json({headerName:'X-XSRF-TOKEN',token});
const storage=()=>{const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};};

test('P04TS01-transfer-normalizes-and-sends-key',async()=>{
 let observed;
 const api=new ApiClient(async(url,options)=>{
  if(url.endsWith('/auth/csrf'))return csrf('csrf-1');
  observed={url,body:JSON.parse(options.body),key:options.headers.get('Idempotency-Key'),csrf:options.headers.get('X-XSRF-TOKEN')};
  return Response.json(receipt,{status:201,headers:{'Idempotency-Replayed':'false'}});
 });
 const result=await api.transfer(intent,'transfer-key-0001');
 assert.equal(result.status,201);assert.equal(result.replayed,false);assert.deepEqual(result.body,receipt);
 assert.deepEqual(observed,{url:'/api/v1/transfers',body:{sourceId:source,recipientRef:recipient,amountMinor:'8000',currency:'CAD'},key:'transfer-key-0001',csrf:'csrf-1'});
});

test('P04TS02-unknown-outcome-retains-exact-key-and-intent',async()=>{
 const mem=storage();let attempts=0;const requests=[];
 const api=new ApiClient(async(url,options)=>{
  if(url.endsWith('/auth/csrf'))return csrf('csrf-2');
  requests.push([options.headers.get('Idempotency-Key'),options.body]);attempts++;
  if(attempts===1)throw new TypeError('response disappeared after commit');
  return Response.json(receipt,{status:201,headers:{'Idempotency-Replayed':'true'}});
 });
 const store=new IntentStore(mem,alice);
 await assert.rejects(store.executeTransfer(api,intent,()=> 'transfer-key-0002'),OutcomeUnknown);
 assert.equal(store.current().state,'UNCERTAIN');assert.equal(store.current().key,'transfer-key-0002');
 const result=await store.retryTransfer(api);assert.equal(result.replayed,true);assert.equal(store.current().state,'CONFIRMED');
 assert.deepEqual(requests[0],requests[1]);
});

test('P04TS03-deterministic-rejection-is-not-uncertain',async()=>{
 const store=new IntentStore(storage(),alice);
 const api=new ApiClient(async(url)=>url.endsWith('/auth/csrf')?csrf('csrf-3'):Response.json({code:'INSUFFICIENT_FUNDS'},{status:422,headers:{'Idempotency-Replayed':'false'}}));
 await assert.rejects(store.executeTransfer(api,intent,()=> 'transfer-key-0003'),e=>e instanceof ApiError&&e.status===422&&e.problem.code==='INSUFFICIENT_FUNDS');
 assert.equal(store.current().state,'REJECTED');
});

test('P04TS04-5xx-with-key-remains-unknown',async()=>{
 const api=new ApiClient(async(url)=>url.endsWith('/auth/csrf')?csrf('csrf-4'):Response.json({code:'OUTCOME_UNKNOWN'},{status:503}));
 await assert.rejects(api.transfer(intent,'transfer-key-0004'),OutcomeUnknown);
});

test('P04TS05-transfer-read-and-pagination-are-owner-paths',async()=>{
 const paths=[];const record={...receipt,sourceId:source,recipientRef:recipient,createdAt:'2026-09-26T21:00:00Z'};
 const api=new ApiClient(async(url)=>{paths.push(url);return Response.json(url.includes('?')?{items:[record],limit:2,offset:0,hasMore:false}:record);});
 assert.deepEqual(await api.transferById(receipt.id),record);assert.equal((await api.transfers(2,0)).items[0].recipientRef,recipient);
 assert.deepEqual(paths,[`/api/v1/transfers/${receipt.id}`,'/api/v1/transfers?limit=2&offset=0']);
 assert.throws(()=>api.transfers(0,0));assert.throws(()=>api.transferById('not-a-uuid'));
});

test('P04TS06-exact-large-minor-string-never-becomes-number',async()=>{
 let body;const api=new ApiClient(async(url,options)=>{if(url.endsWith('/auth/csrf'))return csrf('csrf-6');body=JSON.parse(options.body);return Response.json({...receipt,amountMinor:'1000000000000'},{status:201});});
 await api.transfer({...intent,amountMinor:'1000000000000'},'transfer-key-0006');assert.equal(body.amountMinor,'1000000000000');assert.equal(typeof body.amountMinor,'string');
});

test('P04TS07-new-instruction-blocked-until-uncertain-resolved',async()=>{
 const store=new IntentStore(storage(),alice);store.prepare('transfers',intent,()=> 'transfer-key-0007');store.transition('UNCERTAIN');
 assert.throws(()=>store.prepare('transfers',intent,()=> 'transfer-key-0008'));
});

const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
(async()=>{let failures=0;const rows=[];for(const c of cases){try{await c.run();console.log('PASS',c.id);rows.push(`<testcase name="${c.id}"/>`);}catch(e){failures++;console.error('FAIL',c.id,e.stack||e.message);rows.push(`<testcase name="${c.id}"><failure message="${escape(e.message)}"/></testcase>`);}}
 fs.mkdirSync('.evidence/client',{recursive:true});fs.writeFileSync('.evidence/client/transfer-results.xml',`<testsuite name="p04-transfer-client" tests="${cases.length}" failures="${failures}" errors="0" skipped="0">${rows.join('\n')}</testsuite>`);
 console.log(`P04_CLIENT_SUMMARY tests=${cases.length} failures=${failures}`);process.exitCode=failures?1:0;})();
