// P05 payment client/intent behavior with actual compiled production modules and injected Fetch transport.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {ApiClient,ApiError,OutcomeUnknown}=require('../../.evidence/ts/api.js');
const {IntentStore}=require('../../.evidence/ts/intent-store.js');
const cases=[];const test=(id,run)=>cases.push({id,run});
const alice='00000000-0000-0000-0000-000000000001';
const source='10000000-0000-0000-0000-000000000001';
const recipient='LG-20000000000000000000000000000001';
const intent={sourceId:source.toUpperCase(),recipientRef:` ${recipient.toUpperCase()} `,amountMinor:'2500',currency:'CAD'};
const receipt={id:'e0000000-0000-0000-0000-000000000001',kind:'PAYMENT',state:'PENDING',amountMinor:'2500',currency:'CAD'};
const csrf=token=>Response.json({headerName:'X-XSRF-TOKEN',token});
const storage=()=>{const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)}};

test('P05TS01-payment-normalizes-and-sends-stable-key',async()=>{let observed;const api=new ApiClient(async(url,options)=>{if(url.endsWith('/auth/csrf'))return csrf('p05-1');observed={url,body:JSON.parse(options.body),key:options.headers.get('Idempotency-Key')};return Response.json(receipt,{status:202,headers:{'Idempotency-Replayed':'false'}})});const result=await api.payment(intent,'payment-key-0001');assert.equal(result.status,202);assert.deepEqual(observed,{url:'/api/v1/payments',body:{sourceId:source,recipientRef:recipient,amountMinor:'2500',currency:'CAD'},key:'payment-key-0001'});});

test('P05TS02-unknown-acceptance-outcome-retains-key-and-intent',async()=>{const mem=storage();let attempts=0;const requests=[];const api=new ApiClient(async(url,options)=>{if(url.endsWith('/auth/csrf'))return csrf('p05-2');requests.push([options.headers.get('Idempotency-Key'),options.body]);if(++attempts===1)throw new TypeError('response lost');return Response.json(receipt,{status:202,headers:{'Idempotency-Replayed':'true'}})});const store=new IntentStore(mem,alice);await assert.rejects(store.executePayment(api,intent,()=> 'payment-key-0002'),OutcomeUnknown);assert.equal(store.current().state,'UNCERTAIN');const result=await store.retryPayment(api);assert.equal(result.replayed,true);assert.equal(store.current().state,'CONFIRMED');assert.deepEqual(requests[0],requests[1]);});

test('P05TS03-deterministic-payment-rejection-is-final',async()=>{const store=new IntentStore(storage(),alice);const api=new ApiClient(async url=>url.endsWith('/auth/csrf')?csrf('p05-3'):Response.json({code:'INSUFFICIENT_FUNDS'},{status:422}));await assert.rejects(store.executePayment(api,intent,()=> 'payment-key-0003'),e=>e instanceof ApiError&&e.status===422);assert.equal(store.current().state,'REJECTED');});

test('P05TS04-payment-read-list-and-exact-money',async()=>{const record={id:receipt.id,direction:'OUTGOING',accountId:source,counterpartyRef:recipient,amountMinor:'1000000000000',currency:'CAD',state:'SETTLED',version:'2',adjustmentState:'NONE',journalId:'f0000000-0000-0000-0000-000000000001',projectionState:'SETTLED',projectionVersion:'2',createdAt:'2026-09-26T00:00:00Z',updatedAt:'2026-09-26T00:00:01Z'};const paths=[];const api=new ApiClient(async url=>{paths.push(url);return Response.json(url.includes('?')?{items:[record],limit:1,offset:0,hasMore:false}:record)});assert.equal((await api.paymentById(receipt.id)).amountMinor,'1000000000000');assert.equal((await api.payments(1,0)).items[0].projectionVersion,'2');assert.deepEqual(paths,[`/api/v1/payments/${receipt.id}`,'/api/v1/payments?limit=1&offset=0']);});

test('P05TS05-new-intent-blocked-before-uncertain-payment-resolution',async()=>{const store=new IntentStore(storage(),alice);store.prepare('payments',intent,()=> 'payment-key-0005');store.transition('UNCERTAIN');assert.throws(()=>store.prepare('transfers',intent,()=> 'transfer-key-after-uncertain'));});

const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
(async()=>{let failures=0;const rows=[];for(const c of cases){try{await c.run();console.log('PASS',c.id);rows.push(`<testcase name="${c.id}"/>`)}catch(e){failures++;console.error('FAIL',c.id,e.stack||e.message);rows.push(`<testcase name="${c.id}"><failure message="${escape(e.message)}"/></testcase>`)}}fs.mkdirSync('.evidence/client',{recursive:true});fs.writeFileSync('.evidence/client/payment-results.xml',`<testsuite name="p05-payment-client" tests="${cases.length}" failures="${failures}" errors="0" skipped="0">${rows.join('\n')}</testsuite>`);console.log(`P05_CLIENT_SUMMARY tests=${cases.length} failures=${failures}`);process.exitCode=failures?1:0})();
