// P06 cancellation/refund/reversal client behavior with compiled production modules and injected Fetch transport.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {ApiClient,ApiError,OutcomeUnknown}=require('../../.evidence/ts/api.js');
const {IntentStore}=require('../../.evidence/ts/intent-store.js');
const cases=[];const test=(id,run)=>cases.push({id,run});
const alice='00000000-0000-0000-0000-000000000001';
const payment='e0000000-0000-0000-0000-000000000001';
const adjustment='a0000000-0000-0000-0000-000000000001';
const journal='f0000000-0000-0000-0000-000000000001';
const csrf=token=>Response.json({headerName:'X-XSRF-TOKEN',token});
const storage=()=>{const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)}};
const refundReceipt={id:adjustment,paymentId:payment,kind:'REFUND',amountMinor:'1250',currency:'CAD',journalId:journal};

test('P06TS01-cancellation-normalizes-reason-and-preserves-key',async()=>{let observed;const api=new ApiClient(async(url,options)=>{if(url.endsWith('/auth/csrf'))return csrf('p06-1');observed={url,body:JSON.parse(options.body),key:options.headers.get('Idempotency-Key')};return Response.json({id:payment,state:'CANCELLED'},{status:200,headers:{'Idempotency-Replayed':'false'}})});const result=await api.cancelPayment(payment.toUpperCase(),'cancel-key-0601','  duplicate order  ');assert.equal(result.status,200);assert.deepEqual(observed,{url:`/api/v1/payments/${payment}/cancel`,body:{reason:'duplicate order'},key:'cancel-key-0601'});});

test('P06TS02-refund-keeps-exact-minor-units',async()=>{let observed;const api=new ApiClient(async(url,options)=>{if(url.endsWith('/auth/csrf'))return csrf('p06-2');observed={url,body:JSON.parse(options.body)};return Response.json(refundReceipt,{status:201})});assert.throws(()=>api.refundPayment(payment,'001250','refund-key-0602','  returned item  '));assert.equal(observed,undefined);const valid=await api.refundPayment(payment,'1250','refund-key-0602','  returned item  ');assert.equal(valid.body.amountMinor,'1250');assert.deepEqual(observed,{url:`/api/v1/payments/${payment}/refunds`,body:{amountMinor:'1250',reason:'returned item'}});});

test('P06TS03-reversal-requires-bounded-reason',async()=>{const api=new ApiClient(async(url,options)=>url.endsWith('/auth/csrf')?csrf('p06-3'):Response.json({...refundReceipt,kind:'REVERSAL',amountMinor:'2500'},{status:201}));assert.throws(()=>api.reversePayment(payment,'   ','reverse-key-0603'),TypeError);const response=await api.reversePayment(payment,'Administrative correction','reverse-key-0603');assert.equal(response.body.kind,'REVERSAL');});

test('P06TS04-unknown-refund-outcome-retains-identical-intent-and-key',async()=>{const mem=storage();let attempts=0;const requests=[];const api=new ApiClient(async(url,options)=>{if(url.endsWith('/auth/csrf'))return csrf('p06-4');requests.push([url,options.headers.get('Idempotency-Key'),options.body]);if(++attempts===1)throw new TypeError('response lost');return Response.json(refundReceipt,{status:201,headers:{'Idempotency-Replayed':'true'}})});const store=new IntentStore(mem,alice);await assert.rejects(store.executeRefund(api,{paymentId:payment,amountMinor:'1250',reason:'Return'},()=> 'refund-key-0604'),OutcomeUnknown);assert.equal(store.current().state,'UNCERTAIN');const replay=await store.retryRefund(api);assert.equal(replay.replayed,true);assert.equal(store.current().state,'CONFIRMED');assert.deepEqual(requests[0],requests[1]);});

test('P06TS05-deterministic-adjustment-rejection-is-final',async()=>{const store=new IntentStore(storage(),alice);const api=new ApiClient(async url=>url.endsWith('/auth/csrf')?csrf('p06-5'):Response.json({code:'INSUFFICIENT_FUNDS'},{status:422}));await assert.rejects(store.executeRefund(api,{paymentId:payment,amountMinor:'1250'},()=> 'refund-key-0605'),e=>e instanceof ApiError&&e.status===422);assert.equal(store.current().state,'REJECTED');});

test('P06TS06-adjustment-read-and-list-use-owned-payment-path',async()=>{const record={...refundReceipt,reason:'Return',createdAt:'2026-09-27T00:00:00Z'};const paths=[];const api=new ApiClient(async url=>{paths.push(url);return Response.json(url.includes('?')?{items:[record],limit:1,offset:0,hasMore:false}:record)});assert.equal((await api.paymentAdjustment(payment,adjustment)).journalId,journal);assert.equal((await api.paymentAdjustments(payment,1,0)).items[0].kind,'REFUND');assert.deepEqual(paths,[`/api/v1/payments/${payment}/adjustments/${adjustment}`,`/api/v1/payments/${payment}/adjustments?limit=1&offset=0`]);});

test('P06TS07-invalid-identities-and-amounts-never-reach-network',async()=>{let calls=0;const api=new ApiClient(async()=>{calls++;return csrf('p06-7')});assert.throws(()=>api.cancelPayment('not-a-uuid','cancel-key-0607'),TypeError);assert.throws(()=>api.refundPayment(payment,'0','refund-key-0607'),TypeError);assert.throws(()=>api.paymentAdjustment(payment,'not-a-uuid'),TypeError);assert.equal(calls,0);});

test('P06TS08-new-command-blocked-until-uncertain-adjustment-resolves',async()=>{const store=new IntentStore(storage(),alice);store.prepare('payment-reversals',{paymentId:payment,reason:'Correction'},()=> 'reverse-key-0608');store.transition('UNCERTAIN');assert.throws(()=>store.prepare('payments',{sourceId:alice,recipientRef:'LG-20000000000000000000000000000001',amountMinor:'1',currency:'CAD'},()=> 'payment-key-after-uncertain'));});

const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
(async()=>{let failures=0;const rows=[];for(const c of cases){try{await c.run();console.log('PASS',c.id);rows.push(`<testcase name="${c.id}"/>`)}catch(e){failures++;console.error('FAIL',c.id,e.stack||e.message);rows.push(`<testcase name="${c.id}"><failure message="${escape(e.message)}"/></testcase>`)}}fs.mkdirSync('.evidence/client',{recursive:true});fs.writeFileSync('.evidence/client/payment-adjustment-results.xml',`<testsuite name="p06-payment-adjustment-client" tests="${cases.length}" failures="${failures}" errors="0" skipped="0">${rows.join('\n')}</testsuite>`);console.log(`P06_CLIENT_SUMMARY tests=${cases.length} failures=${failures}`);process.exitCode=failures?1:0})();
