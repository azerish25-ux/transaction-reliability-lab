// P08E runs the compiled production transport, webhook client and persistence code.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { ApiClient } = require('../../.evidence/ts/api.js');
const c = require('../../.evidence/ts/p08e-core.js');
const cases=[]; const test=(id,run)=>cases.push({id,run});
const owner='10000000-0000-0000-0000-000000000001', other='10000000-0000-0000-0000-000000000002';
const endpointId='20000000-0000-0000-0000-000000000001', deliveryId='30000000-0000-0000-0000-000000000001', key='40000000-0000-0000-0000-000000000001';
const timestamp='2030-01-01T00:00:00Z'; const fakeSecret='A'.repeat(43);
const endpoint={id:endpointId,ownerId:owner,destinationId:'sandbox-receiver',destinationUrl:'http://receiver:8081/events',enabled:true,version:1,createdAt:timestamp,updatedAt:timestamp,rotatedAt:null};
const delivery={id:deliveryId,endpointId,ownerId:owner,destinationId:'sandbox-receiver',eventId:key,eventType:'payment.settled',state:'FAILED',cycle:1,attempts:1,totalAttempts:1,nextAttemptAt:timestamp,createdAt:timestamp,updatedAt:timestamp,deliveredAt:null,lastError:'HTTP_400'};
const attempt={cycle:1,attempt:1,attemptedAt:timestamp,httpStatus:400,outcome:'PERMANENT_FAILURE',durationMs:2,errorCode:'HTTP_400',responseSummary:'',requestTimestamp:null,secretKeyVersion:1,nextAttemptAt:null};
const create={kind:'CREATE'}, rotate={kind:'ROTATE',endpointId,expectedVersion:1}, state={kind:'STATE',endpointId,enabled:false,expectedVersion:1}, retry={kind:'RETRY',deliveryId,expectedCycle:1,reason:'receiver recovered'};
function result(command=create,replayed=false) { return {command:{commandId:key,kind:command.kind,endpointId,deliveryId:command.kind==='RETRY'?deliveryId:null,appliedVersion:command.kind==='CREATE'?1:command.kind==='RETRY'?null:2,appliedCycle:command.kind==='RETRY'?2:null,completedAt:timestamp,replayed},signingSecret:!replayed && ['CREATE','ROTATE'].includes(command.kind)?fakeSecret:null}; }
function storage() {const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};}
function client(replies,calls=[]) { return new ApiClient(async (url,options)=>{
  if(url.endsWith('/auth/csrf')) return Response.json({headerName:'X-XSRF-TOKEN',token:'scoped-p08e-csrf'});
  calls.push({url,method:options.method,body:options.body,key:options.headers.get('Idempotency-Key'),csrf:options.headers.get('X-XSRF-TOKEN'),credentials:options.credentials,redirect:options.redirect});
  const reply=replies.shift();if(reply instanceof Error) throw reply;return reply;
});}
const ok=body=>Response.json(body,{status:200});
const problem=(status,code)=>Response.json({code,message:code},{status});

test('P08ETS01-normalize-commands-and-reject-arbitrary-destinations',()=>{
  assert.deepEqual(c.normalizeWebhookCommand(create),create);
  for(const value of [{...create,destinationUrl:'https://example.test'},{...create,signingSecret:fakeSecret},{kind:'DELETE'}]) assert.throws(()=>c.normalizeWebhookCommand(value));
  assert.equal(c.normalizeWebhookCommand({...retry,reason:'  receiver recovered  '}).reason,retry.reason);
});
test('P08ETS02-version-and-cycle-bounds-are-exact',()=>{
  for(const expectedVersion of [0,-1,1.1,NaN,Number.MAX_SAFE_INTEGER]) assert.throws(()=>c.normalizeWebhookCommand({...rotate,expectedVersion}));
  for(const expectedCycle of [0,-1,2147483647,1.5]) assert.throws(()=>c.normalizeWebhookCommand({...retry,expectedCycle}));
});
test('P08ETS03-real-client-create-carries-csrf-same-origin-and-original-key',async()=>{
  const calls=[];await new c.P08EApi(client([ok(result())],calls),owner).execute(create,key);
  assert.equal(calls[0].url,'/api/v1/webhook-commands');assert.equal(calls[0].method,'POST');assert.equal(calls[0].key,key);assert.equal(calls[0].csrf,'scoped-p08e-csrf');assert.equal(calls[0].credentials,'same-origin');assert.equal(calls[0].redirect,'error');
});
test('P08ETS04-rotation-response-loss-reloads-original-key-and-version',async()=>{
  const mem=storage(),saved=new c.WebhookIntentStore(mem,owner).prepare(rotate,key),calls=[];
  const api=new c.P08EApi(client([new TypeError('lost response'),ok(result(rotate,true))],calls),owner);
  await assert.rejects(api.execute(saved.command,saved.key));new c.WebhookIntentStore(mem,owner).uncertain(key);
  const restored=new c.WebhookIntentStore(mem,owner).current();await api.execute(restored.command,restored.key);
  assert.deepEqual(calls[0],calls[1]);assert.equal(restored.command.expectedVersion,1);
});
test('P08ETS05-state-command-preserves-reviewed-eligibility',async()=>{
  const calls=[];await new c.P08EApi(client([ok(result(state))],calls),owner).execute(state,key);assert.deepEqual(JSON.parse(calls[0].body),state);
});
test('P08ETS06-retry-command-preserves-cycle-and-reason',async()=>{
  const calls=[];await new c.P08EApi(client([ok(result(retry))],calls),owner).execute(retry,key);assert.deepEqual(JSON.parse(calls[0].body),retry);
});
test('P08ETS07-read-only-outcome-never-discloses-secret-or-posts',async()=>{
  const calls=[],store=new c.WebhookIntentStore(storage(),owner),saved=store.prepare(create,key);
  const value=await new c.P08EApi(client([ok(result(create,true))],calls),owner).resolve(saved);
  assert.equal(value.signingSecret,null);assert.equal(calls[0].method,'GET');assert.equal(calls[0].url,`/api/v1/webhook-commands/${key}`);
});
test('P08ETS08-replayed-creation-or-rotation-cannot-redisclose-secret',()=>{
  for(const command of [create,rotate]) assert.throws(()=>c.validateWebhookResult({...result(command,true),signingSecret:fakeSecret},command,key),c.WebhookOutcomeUnknown);
});
test('P08ETS09-first-secret-response-is-required-and-read-response-is-never-secret',()=>{
  assert.throws(()=>c.validateWebhookResult({...result(create),signingSecret:null},create,key),c.WebhookOutcomeUnknown);
  assert.throws(()=>c.validateWebhookResult(result(create),create,key,true),c.WebhookOutcomeUnknown);
});
test('P08ETS10-malformed-or-mismatched-success-is-uncertain',()=>{
  for(const field of [{commandId:other},{endpointId:other},{appliedVersion:3},{replayed:'false'},{kind:'STATE'}]) {
    const response=result(rotate);response.command={...response.command,...field};assert.throws(()=>c.validateWebhookResult(response,rotate,key),c.WebhookOutcomeUnknown);
  }
});
test('P08ETS11-ordinary-endpoint-reads-cannot-contain-secrets',()=>{
  for(const field of ['signingSecret','encryptedSecret','secret']) assert.throws(()=>c.validateWebhookEndpoint({...endpoint,[field]:fakeSecret},owner));
  assert.equal(c.validateWebhookEndpoint(endpoint,owner).rotatedAt,undefined);
});
test('P08ETS12-endpoint-ownership-and-identity-are-validated',()=>{
  assert.throws(()=>c.validateWebhookEndpoint(endpoint,other));assert.throws(()=>c.validateWebhookEndpoint(endpoint,owner,other));
});
test('P08ETS13-delivery-owner-endpoint-and-detail-identity-are-validated',()=>{
  assert.throws(()=>c.validateWebhookDelivery(delivery,other));assert.throws(()=>c.validateWebhookDelivery(delivery,owner,other));
  assert.throws(()=>c.validateWebhookDetail({delivery,attempts:[attempt]},owner,other));
});
test('P08ETS14-unknown-states-and-false-delivery-claims-are-rejected',()=>{
  assert.throws(()=>c.validateWebhookDelivery({...delivery,state:'SETTLED'},owner));assert.throws(()=>c.validateWebhookDelivery({...delivery,state:'DELIVERED'},owner));
  assert.equal(c.validateWebhookDelivery({...delivery,state:'DELIVERED',deliveredAt:timestamp},owner).state,'DELIVERED');
});
test('P08ETS15-running-attempt-is-not-a-completed-attempt',()=>{
  const value=c.validateWebhookDelivery({...delivery,state:'IN_FLIGHT',totalAttempts:0},owner);assert.equal(value.attempts,1);assert.equal(value.totalAttempts,0);
});
test('P08ETS16-real-client-read-pagination-has-bounds',async()=>{
  const calls=[],api=new c.P08EApi(client([ok({items:[],limit:20,offset:20,hasMore:false})],calls),owner);
  assert.equal((await api.endpoints(20,20)).hasMore,false);assert.equal(calls[0].url,'/api/v1/webhook-endpoints?limit=20&offset=20');
  await assert.rejects(api.endpoints(101));await assert.rejects(api.deliveries(endpointId,20,-1));
});
test('P08ETS17-attempt-history-is-sanitized-and-unique',()=>{
  assert.equal(c.validateWebhookDetail({delivery,attempts:[attempt]},owner,deliveryId).attempts[0].responseSummary,undefined);
  assert.throws(()=>c.validateWebhookDetail({delivery,attempts:[attempt,attempt]},owner,deliveryId));
  assert.throws(()=>c.validateWebhookDetail({delivery,attempts:[{...attempt,signature:'not-for-ordinary-reads'}]},owner,deliveryId));
});
test('P08ETS18-owner-scoped-storage-contains-only-request-metadata',()=>{
  const mem=storage(),store=new c.WebhookIntentStore(mem,owner);store.prepare(rotate,key);
  assert.equal(new c.WebhookIntentStore(mem,other).current(),undefined);
  assert.deepEqual(Object.keys(store.current()).sort(),['schema','ownerId','key','command','state','createdAt'].sort());
  assert.equal(mem.getItem(store.storageKey).includes(fakeSecret),false);
});
test('P08ETS19-reload-retains-original-canonical-request',()=>{
  const mem=storage(),store=new c.WebhookIntentStore(mem,owner);store.prepare({...retry,reason:' receiver recovered '},key);store.uncertain(key);
  const restored=new c.WebhookIntentStore(mem,owner).current();assert.equal(restored.key,key);assert.equal(restored.state,'UNCERTAIN');assert.deepEqual(restored.command,retry);
});
test('P08ETS20-unresolved-request-blocks-conflicting-replacement',()=>{
  const store=new c.WebhookIntentStore(storage(),owner);store.prepare(rotate,key);
  assert.equal(store.prepare(rotate,other).key,key);assert.throws(()=>store.prepare({...rotate,expectedVersion:2},other));assert.throws(()=>store.prepare(create,other));
});
test('P08ETS21-storage-failure-prevents-request-preparation',()=>{
  const broken={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};assert.throws(()=>new c.WebhookIntentStore(broken,owner).prepare(create,key));
});
test('P08ETS22-corrupt-or-extra-stored-fields-fail-closed',()=>{
  const mem=storage(),store=new c.WebhookIntentStore(mem,owner);store.prepare(create,key);const saved=store.current();
  for(const value of ['not-json',JSON.stringify({...saved,ownerId:other}),JSON.stringify({...saved,signingSecret:fakeSecret}),JSON.stringify({...saved,command:{...rotate,expectedVersion:0}})]) {mem.setItem(store.storageKey,value);assert.throws(()=>store.current());}
});
test('P08ETS23-completion-cannot-delete-another-command',()=>{
  const store=new c.WebhookIntentStore(storage(),owner);store.prepare(create,key);store.complete(other);assert.equal(store.current().key,key);store.complete(key);assert.equal(store.current(),undefined);
});
test('P08ETS24-admission-failures-do-not-replace-preserved-intent',async()=>{
  const mem=storage(),store=new c.WebhookIntentStore(mem,owner);const saved=store.prepare(rotate,key);
  const api=new c.P08EApi(client([problem(401,'AUTHENTICATION_REQUIRED'),problem(403,'CSRF_INVALID'),problem(429,'RATE_LIMITED')]),owner);
  for(let n=0;n<3;n++){await assert.rejects(api.execute(saved.command,saved.key));store.uncertain(key);assert.equal(store.current().key,key);}
});
test('P08ETS25-server-errors-and-non-json-success-remain-uncertain',async()=>{
  for(const response of [problem(500,'DEPENDENCY_UNAVAILABLE'),problem(503,'DEPENDENCY_UNAVAILABLE'),new Response('not-json',{status:200}),ok({})]) await assert.rejects(new c.P08EApi(client([response]),owner).execute(create,key));
});
test('P08ETS26-malformed-path-identities-and-retry-text-are-rejected',()=>{
  for(const id of ['../admin','//external','x',null]) assert.throws(()=>c.webhookId(id));
  for(const reason of ['', 'x'.repeat(501),'line\nline']) assert.throws(()=>c.normalizeWebhookCommand({...retry,reason}));
});
test('P08ETS27-stale-and-conflicting-commands-do-not-get-new-keys',async()=>{
  const calls=[],api=new c.P08EApi(client([problem(409,'WEBHOOK_CONFLICT'),problem(409,'IDEMPOTENCY_CONFLICT')],calls),owner);
  await assert.rejects(api.execute(state,key));await assert.rejects(api.execute(state,key));assert.equal(calls[0].key,calls[1].key);assert.equal(calls[0].body,calls[1].body);
});
test('P08ETS28-receipt-links-and-read-only-owner-validation',async()=>{
  assert.equal(c.webhookResultPath(result(create,true)),`/webhooks/${endpointId}`);assert.equal(c.webhookResultPath(result(retry,true)),`/webhooks/deliveries/${deliveryId}`);
  const saved=new c.WebhookIntentStore(storage(),other).prepare(create,key);await assert.rejects(new c.P08EApi(client([]),owner).resolve(saved));
});

(async()=>{
  const failures=[]; const started=Date.now();
  for(const item of cases){try{await item.run();console.log(`${item.id}: PASS`);}catch(error){failures.push(item.id);console.error(`${item.id}: FAIL ${String(error.message).slice(0,800)}`);}}
  fs.mkdirSync('.evidence/client',{recursive:true});
  const xml=`<?xml version="1.0" encoding="UTF-8"?><testsuite name="P08E production client" tests="${cases.length}" failures="${failures.length}" errors="0" skipped="0" time="${(Date.now()-started)/1000}">${cases.map(item=>`<testcase classname="p08e-client" name="${item.id}">${failures.includes(item.id)?'<failure message="See sanitized contract diagnostics"/>':''}</testcase>`).join('')}</testsuite>`;
  fs.writeFileSync('.evidence/client/p08e-results.xml',xml+'\n');if(failures.length) process.exitCode=1;
})();
