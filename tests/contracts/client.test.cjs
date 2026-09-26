// Boundary: actual production TypeScript modules, injected Fetch responses and storage.
// This is NOT Pact provider verification, a real Spring API test, or a browser journey.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {parseAmount, formatMinor, minor, available, currency} = require('../../.evidence/ts/money.js');
const {ApiClient, ApiError, OutcomeUnknown} = require('../../.evidence/ts/api.js');
const {IntentStore} = require('../../.evidence/ts/intent-store.js');
const cases = [];
const test = (id, run) => cases.push({id,run});
for (const [code, text, expected] of [['CAD','0.29','29'],['USD','1.99','199'],['JPY','8','8'],['KWD','0.001','1'],['CAD','10000000000.00','1000000000000']]) {
 test(`TSMONEY-${code}-${expected}`,()=>assert.equal(parseAmount(text,code),expected));
}
for (const text of ['0','-1','+1',' 1','1 ','01','1e2','.2','1.','NaN','Infinity','1.999','10000000000.01']) test(`TSMONEY-reject-${text}`,()=>assert.throws(()=>parseAmount(text,'CAD')));
test('TSMONEY-JPY-precision',()=>assert.throws(()=>parseAmount('1.0','JPY')));
test('TSMONEY-KWD-precision',()=>assert.throws(()=>parseAmount('1.0001','KWD')));
test('TSMONEY-max-balance',()=>assert.equal(formatMinor('9223372036854775807','CAD'),'92233720368547758.07'));
test('TSMONEY-bigint-json',()=>assert.equal(JSON.stringify({amountMinor:parseAmount('0.29','CAD')}),'{"amountMinor":"29"}'));
test('TSMONEY-grouping',()=>assert.equal(formatMinor('12345678901','KWD',true),'12,345,678.901'));
test('TSMONEY-availability',()=>assert.equal(available('10000','8000'),'2000'));
test('TSMONEY-overreserved',()=>assert.throws(()=>available('1','2')));
test('TSMONEY-number-rejected',()=>assert.throws(()=>minor(12)));
test('TSMONEY-unsupported',()=>assert.throws(()=>currency('EUR')));
test('TSMONEY-prototype',()=>assert.throws(()=>currency('__proto__')));
test('TSMONEY-roundtrip-model',()=> { let v=74021n;for(let i=0;i<10000;i++){v=(v*48271n)%2147483647n;for(const c of ['CAD','USD','JPY','KWD'])assert.equal(parseAmount(formatMinor(v.toString(),c),c),v.toString());}});
const alice='00000000-0000-0000-0000-000000000001',bob='00000000-0000-0000-0000-000000000002';
const intent={sourceId:alice,recipientRef:'recipient-bob',amountMinor:'29',currency:'CAD'};
const storage=()=> {const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};};
test('TSINTENT-persist-before-send',()=>{const s=new IntentStore(storage(),alice);const r=s.prepare('payments',intent,()=> 'operation-key-1');assert.equal(s.current().key,r.key);assert.equal(s.current().state,'PREPARED');});
test('TSINTENT-uncertain-reload-same-key',()=>{const mem=storage();let s=new IntentStore(mem,alice);s.prepare('payments',intent,()=> 'operation-key-1');s.transition('UNCERTAIN');s=new IntentStore(mem,alice);assert.equal(s.current().key,'operation-key-1');assert.deepEqual(s.current().intent,intent);assert.throws(()=>s.prepare('payments',intent));});
test('TSINTENT-owner-isolation',()=>{const mem=storage();new IntentStore(mem,alice).prepare('payments',intent);assert.equal(new IntentStore(mem,bob).current(),undefined);});
test('TSINTENT-no-forget-uncertain',()=>{const s=new IntentStore(storage(),alice);s.prepare('transfers',intent);s.transition('UNCERTAIN');assert.throws(()=>s.forgetConfirmed());});
test('TSINTENT-confirmed-new-instruction',()=>{const s=new IntentStore(storage(),alice);s.prepare('transfers',intent,()=> 'operation-key-1');s.transition('CONFIRMED');s.prepare('transfers',intent,()=> 'operation-key-2');assert.equal(s.current().key,'operation-key-2');});
const csrf=()=>Response.json({headerName:'X-XSRF-TOKEN',token:'unit-test-csrf'});
test('TSAPI-money-string-cookie-csrf',async()=>{let checked=false;const api=new ApiClient(async(url,options)=>{if(url.endsWith('/auth/csrf'))return csrf();assert.equal(options.headers.get('X-XSRF-TOKEN'),'unit-test-csrf');assert.equal(options.credentials,'same-origin');assert.equal(options.headers.get('Idempotency-Key'),'operation-key-1');assert.equal(JSON.parse(options.body).amountMinor,'29');checked=true;return Response.json({operationId:'stable'},{status:202});});assert.equal((await api.command('/payments',intent,'operation-key-1')).status,202);assert.equal(checked,true);});
test('TSAPI-unknown-outcome-replay',async()=>{const bodies=[];const api=new ApiClient(async(url,options)=>{if(url.endsWith('/auth/csrf'))return csrf();bodies.push([options.body,options.headers.get('Idempotency-Key')]);if(bodies.length===1)throw new TypeError('Response connection lost');return Response.json({operationId:'stable'},{status:202,headers:{'Idempotency-Replayed':'true'}});});await assert.rejects(api.command('/payments',intent,'operation-key-1'),OutcomeUnknown);const response=await api.command('/payments',intent,'operation-key-1');assert.equal(response.replayed,true);assert.deepEqual(bodies[0],bodies[1]);});
test('TSAPI-malformed-accepted-response-uncertain',async()=>{const api=new ApiClient(async(url)=>url.endsWith('/auth/csrf')?csrf():new Response('truncated',{status:202}));await assert.rejects(api.command('/payments',intent,'operation-key-1'),OutcomeUnknown);});
test('TSAPI-conflict-not-success',async()=>{const api=new ApiClient(async(url)=>url.endsWith('/auth/csrf')?csrf():Response.json({code:'IDEMPOTENCY_CONFLICT',message:'Conflicting intent',correlationId:'test'},{status:409}));await assert.rejects(api.command('/payments',intent,'operation-key-1'),e=>e instanceof ApiError&&e.status===409&&e.problem.code==='IDEMPOTENCY_CONFLICT');});
test('TSAPI-expiry-forgets-csrf-not-intent',async()=>{let acquired=0;const api=new ApiClient(async(url)=>{if(url.endsWith('/auth/csrf')){acquired++;return csrf();}return Response.json({code:'UNAUTHENTICATED'},{status:401});});for(let i=0;i<2;i++)await assert.rejects(api.command('/payments',intent,'operation-key-1'),ApiError);assert.equal(acquired,2);});
test('TSAPI-no-cross-origin',()=>assert.throws(()=>new ApiClient(fetch,'https://example.test')));
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
(async()=>{const requested=process.argv[2];const selected=requested?cases.filter(c=>c.id===requested):cases;if(!selected.length)throw Error('No test discovery');let failures=0;const results=[];for(const c of selected){try{await c.run();console.log('PASS',c.id);results.push(`<testcase name="${escape(c.id)}"/>`);}catch(e){failures++;console.error('FAIL',c.id,e.message);results.push(`<testcase name="${escape(c.id)}"><failure message="${escape(e.message)}"/></testcase>`);}}fs.mkdirSync('.evidence/client',{recursive:true});fs.writeFileSync('.evidence/client/results.xml',`<testsuite name="typescript-client-unit" tests="${selected.length}" failures="${failures}" errors="0" skipped="0">${results.join('\n')}</testsuite>`);console.log(`SUMMARY tests=${selected.length} passed=${selected.length-failures} failed=${failures} runtime=node-client-unit`);process.exitCode=failures?1:0;})();
