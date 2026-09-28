// Executed against compiled production code, not a duplicate client implementation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { ApiClient, ApiError, OutcomeUnknown } = require('../../.evidence/ts/api.js');
const { IntentStore } = require('../../.evidence/ts/intent-store.js');
const { intentRecoveryPath } = require('../../.evidence/ts/p08b-core.js');
const s = require('../../.evidence/ts/schedule-api.js');
const cases = []; const test = (id, run) => cases.push({ id, run });
const owner='00000000-0000-0000-0000-000000000001', id='e0000000-0000-0000-0000-000000000001';
const definition={sourceId:'10000000-0000-0000-0000-000000000001',recipientRef:'LG-20000000000000000000000000000001',amountMinor:'1250',currency:'CAD',intendedLocal:'2030-01-10T09:30:00',zoneId:'America/Halifax',recurrence:'DAILY'};
const create={action:'CREATE',definition}; const edit={action:'EDIT',scheduleId:id,expectedVersion:1,definition};
const storage=()=>{const m=new Map(); return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};};
function client(replies, requests=[]) {return new ApiClient(async (url, options)=>{
  if(url.endsWith('/auth/csrf')) return Response.json({headerName:'X-XSRF-TOKEN',token:'scoped-test-csrf'});
  requests.push({url,method:options.method,body:options.body,key:options.headers.get('Idempotency-Key'),csrf:options.headers.get('X-XSRF-TOKEN'),credentials:options.credentials,redirect:options.redirect});
  const next=replies.shift(); if(next instanceof Error) throw next; return typeof next==='function'?next():next;
});}
const success=(action='CREATE',replayed=false)=>Response.json({id,version:action==='EDIT'?2:1,eventVersion:2,status:action==='PAUSE'?'PAUSED':action==='CANCEL'?'CANCELLED':'ACTIVE'},{status:action==='CREATE'?201:200,headers:{'Idempotency-Replayed':String(replayed)}});
const problem=(status,code)=>Response.json({code,message:code},{status});

test('P08DTS01-normalized-wall-time-has-no-browser-zone-conversion',()=>{
  assert.equal(s.normalizeLocal('2030-01-10T09:30'),'2030-01-10T09:30:00');
  assert.equal(s.normalizeLocal('2028-02-29T23:59:59'),'2028-02-29T23:59:59');
  for(const value of ['2027-02-29T10:00','2030-13-01T10:00','2030-01-32T10:00','2030-01-10T24:00','2030-01-10T10:00:00Z','2030-01-10T10:00:00.001']) assert.throws(()=>s.normalizeLocal(value));
});
test('P08DTS02-exact-minor-money-and-supported-currency',()=>{
  assert.equal(s.normalizeScheduleDefinition(definition).amountMinor,'1250');
  for(const amountMinor of ['0','-1','1.5','1e3','1000000000001']) assert.throws(()=>s.normalizeScheduleDefinition({...definition,amountMinor}));
  assert.throws(()=>s.normalizeScheduleDefinition({...definition,currency:'XXX'}));
});
test('P08DTS03-zone-and-recurrence-validation',()=>{
  assert.equal(s.normalizeZone('America/Halifax'),'America/Halifax'); assert.equal(s.normalizeZone('UTC'),'UTC');
  assert.throws(()=>s.normalizeZone('not/a-zone')); assert.throws(()=>s.normalizeRecurrence('MONTHLY'));
});
test('P08DTS04-safe-identities-and-version-boundary',()=>{
  for(const v of [0,-1,1.5,NaN,Number.MAX_SAFE_INTEGER+1]) assert.throws(()=>s.scheduleVersion(v));
  assert.throws(()=>s.scheduleRequest({...edit,scheduleId:'../private'}));
});
test('P08DTS05-create-post-carries-csrf-and-stable-key',async()=>{
  const calls=[]; const api=client([success()],calls); await api.scheduleCommand(create,'p08d-create-key-05');
  assert.equal(calls[0].method,'POST'); assert.equal(calls[0].url,'/api/v1/schedules'); assert.equal(calls[0].csrf,'scoped-test-csrf');
  assert.equal(calls[0].key,'p08d-create-key-05'); assert.equal(calls[0].credentials,'same-origin'); assert.equal(calls[0].redirect,'error');
});
test('P08DTS06-edit-put-preserves-original-expected-version',async()=>{
  const calls=[]; await client([success('EDIT')],calls).scheduleCommand(edit,'p08d-edit-key-06');
  assert.equal(calls[0].method,'PUT'); assert.equal(calls[0].url,`/api/v1/schedules/${id}`);
  assert.deepEqual(JSON.parse(calls[0].body),{...definition,expectedVersion:1}); assert.ok(calls[0].csrf);
});
test('P08DTS07-committed-put-response-loss-reloads-and-replays',async()=>{
  const memory=storage(),calls=[]; const api=client([new TypeError('lost committed response'),success('EDIT',true)],calls);
  await assert.rejects(new IntentStore(memory,owner).executeSchedule(api,edit,()=> 'p08d-edit-key-07'),OutcomeUnknown);
  const restored=new IntentStore(memory,owner); assert.equal(restored.current().state,'UNCERTAIN');
  const r=await restored.retrySchedule(api); assert.equal(r.replayed,true); assert.deepEqual(calls[0],calls[1]); assert.equal(restored.current().state,'CONFIRMED');
});
test('P08DTS08-create-response-loss-never-duplicates-intent',async()=>{
  const store=new IntentStore(storage(),owner),calls=[]; const api=client([new TypeError('lost'),success('CREATE',true)],calls);
  await assert.rejects(store.executeSchedule(api,create,()=> 'p08d-create-key-08'),OutcomeUnknown); await store.retrySchedule(api); assert.deepEqual(calls[0],calls[1]);
});
test('P08DTS09-put-server-errors-and-timeout-remain-uncertain',async()=>{
  for(const status of [408,500,503]) {const store=new IntentStore(storage(),owner); await assert.rejects(store.executeSchedule(client([problem(status,'DEPENDENCY_UNAVAILABLE')]),edit,()=> 'p08d-server-key-09'),OutcomeUnknown); assert.equal(store.current().state,'UNCERTAIN');}
});
test('P08DTS10-malformed-put-success-retains-key',async()=>{
  for(const body of [{},{id,version:3,eventVersion:2,status:'ACTIVE'},{id:'invalid',version:2,eventVersion:2,status:'ACTIVE'}]) {
    const store=new IntentStore(storage(),owner); await assert.rejects(store.executeSchedule(client([Response.json(body,{status:200})]),edit,()=> 'p08d-malformed-key-10'),OutcomeUnknown); assert.equal(store.current().state,'UNCERTAIN');
  }
});
test('P08DTS11-non-json-put-success-retains-key',async()=>{
  const store=new IntentStore(storage(),owner); await assert.rejects(store.executeSchedule(client([new Response('not-json',{status:200})]),edit,()=> 'p08d-json-key-11'),OutcomeUnknown); assert.equal(store.current().state,'UNCERTAIN');
});
test('P08DTS12-session-admission-keeps-prepared-command',async()=>{
  const store=new IntentStore(storage(),owner),calls=[]; const api=client([problem(401,'AUTHENTICATION_REQUIRED'),success('EDIT',true)],calls);
  await assert.rejects(store.executeSchedule(api,edit,()=> 'p08d-session-key-12'),ApiError); assert.equal(store.current().state,'PREPARED'); await store.retrySchedule(api); assert.deepEqual(calls[0],calls[1]);
});
test('P08DTS13-csrf-throttling-and-expiry-do-not-prove-rollback',async()=>{
  const store=new IntentStore(storage(),owner); const api=client([new TypeError('lost'),problem(403,'CSRF_INVALID'),problem(429,'RATE_LIMITED'),problem(401,'AUTHENTICATION_REQUIRED')]);
  await assert.rejects(store.executeSchedule(api,edit,()=> 'p08d-admission-key-13'));
  for(let i=0;i<3;i++){await assert.rejects(store.retrySchedule(api));assert.equal(store.current().state,'UNCERTAIN');}
});
test('P08DTS14-stale-definition-conflict-is-explicit-rejection',async()=>{
  const store=new IntentStore(storage(),owner); await assert.rejects(store.executeSchedule(client([problem(409,'SCHEDULE_CONFLICT')]),edit,()=> 'p08d-conflict-key-14'),ApiError); assert.equal(store.current().state,'REJECTED');
});
test('P08DTS15-idempotency-conflict-never-authorizes-replacement',async()=>{
  const store=new IntentStore(storage(),owner); const api=client([new TypeError('lost'),problem(409,'IDEMPOTENCY_CONFLICT')]);
  await assert.rejects(store.executeSchedule(api,edit,()=> 'p08d-idempotency-key-15')); await assert.rejects(store.retrySchedule(api));
  assert.equal(store.current().state,'UNCERTAIN'); assert.throws(()=>store.prepare('schedules',create)); assert.throws(()=>store.forgetConfirmed());
});
test('P08DTS16-unresolved-schedule-blocks-new-money-instruction',()=>{
  const store=new IntentStore(storage(),owner); store.prepare('schedules',edit,()=> 'p08d-block-key-16');
  assert.throws(()=>store.prepare('transfers',definition));
});
test('P08DTS17-owner-scope-and-no-auth-material',()=>{
  const mem=storage(),store=new IntentStore(mem,owner); store.prepare('schedules',edit,()=> 'p08d-owner-key-17');
  assert.equal(new IntentStore(mem,id).current(),undefined);
  assert.deepEqual(Object.keys(store.current()).sort(),['ownerId','key','kind','intent','state','createdAt'].sort());
});
test('P08DTS18-all-lifecycle-requests-preserve-definition-version',async()=>{
  for(const action of ['PAUSE','RESUME','CANCEL']) {const calls=[]; await client([success(action)],calls).scheduleCommand({action,scheduleId:id,expectedVersion:1},'p08d-state-key-18'); assert.equal(calls[0].method,'POST'); assert.equal(calls[0].url,`/api/v1/schedules/${id}/${action.toLowerCase()}`); assert.deepEqual(JSON.parse(calls[0].body),{expectedVersion:1});}
});
test('P08DTS19-recovery-and-detail-routes-are-owner-navigation-only',()=>{
  assert.equal(intentRecoveryPath({kind:'schedules',intent:edit}),'/schedules/recovery');
  assert.equal(s.scheduleRoute(`/schedules/${id}/edit`).kind,'edit'); assert.equal(s.scheduleRoute('/schedules/recovery').kind,'recovery');
  assert.equal(s.scheduleRoute('/schedules/../private'),undefined);
});
test('P08DTS20-pagination-has-explicit-bounds',async()=>{
  const calls=[]; const api=client([Response.json({items:[],limit:20,offset:20,hasMore:false})],calls); await api.schedules(20,20);
  assert.equal(calls[0].url,'/api/v1/schedules?limit=20&offset=20'); assert.throws(()=>api.schedules(101,0)); assert.throws(()=>api.scheduleOccurrences(id,20,-1));
});
test('P08DTS21-temporal-preview-is-not-a-schedule-command',async()=>{
  const calls=[]; const preview={intendedLocal:definition.intendedLocal,zoneId:definition.zoneId,recurrence:'DAILY',resolvedLocal:definition.intendedLocal,offset:'-04:00',instant:'2030-01-10T13:30:00Z',policy:'NORMAL'};
  const r=await client([Response.json(preview)],calls).previewSchedule(definition); assert.deepEqual(r,preview); assert.equal(calls[0].url,'/api/v1/schedules/preview'); assert.equal(calls[0].key,null);
});
test('P08DTS22-terminal-status-disables-all-lifecycle-mutations',()=>{
  for(const state of ['CANCELLED','FINISHED']) for(const action of ['EDIT','PAUSE','RESUME','CANCEL']) assert.equal(s.scheduleActionAllowed(state,action),false);
  assert.equal(s.scheduleActionAllowed('PAUSED','RESUME'),true); assert.equal(s.scheduleActionAllowed('ACTIVE','RESUME'),false);
});
test('P08DTS23-read-failure-does-not-resolve-saved-write',async()=>{
  const store=new IntentStore(storage(),owner); const api=client([new TypeError('lost'),problem(404,'NOT_FOUND')]);
  await assert.rejects(store.executeSchedule(api,create,()=> 'p08d-read-key-23')); await assert.rejects(api.scheduleById(id)); assert.equal(store.current().state,'UNCERTAIN');
});
test('P08DTS24-definition-does-not-require-current-funds',()=>{
  assert.deepEqual(s.normalizeScheduleDefinition({...definition,availableMinor:'0'}),definition);
});
test('P08DTS25-occurrence-wire-status-agrees-with-published-schema',async()=>{
  const schema=JSON.parse(fs.readFileSync('backend/src/main/resources/openapi/p08d-ui.json','utf8'));
  const enums=[];
  function collect(value) {
    if (!value || typeof value !== 'object') return;
    if (value.properties?.outcome?.enum) enums.push(value.properties.outcome.enum);
    for (const child of Object.values(value)) collect(child);
  }
  collect(schema);
  assert.ok(enums.some(values=>JSON.stringify([...values].sort())===JSON.stringify(['REJECTED','SKIPPED_LATE','SUCCEEDED'])),'Published occurrence status enum is required');
  const base={id:owner,scheduleId:id,scheduleVersion:1,intendedLocal:'2030-01-10T09:30:00',dueAt:'2030-01-10T09:30:00Z',createdAt:'2030-01-10T09:30:01Z'};
  const rejected={...base,outcome:'REJECTED',operationId:null,journalId:null,errorCode:'INSUFFICIENT_FUNDS'};
  const response=await client([Response.json({items:[rejected],limit:20,offset:0,hasMore:false})]).scheduleOccurrences(id);
  assert.deepEqual(response.items,[rejected]);
  assert.equal(response.items[0].journalId,null);
  assert.throws(()=>s.validateOccurrence({...rejected,outcome:'FAILED'},id),/Invalid occurrence/);
  s.validateOccurrence({...base,outcome:'SKIPPED_LATE',operationId:null,journalId:null,errorCode:null},id);
  s.validateOccurrence({...base,outcome:'SUCCEEDED',operationId:owner,journalId:owner,errorCode:null},id);
});
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
(async()=>{let failures=0;const rows=[];for(const c of cases){try{await c.run();console.log('PASS',c.id);rows.push(`<testcase name="${c.id}"/>`);}catch(e){failures++;console.error('FAIL',c.id,e.stack||e.message);rows.push(`<testcase name="${c.id}"><failure message="${escape(e.message)}"/></testcase>`);}}
fs.mkdirSync('.evidence/client',{recursive:true});fs.writeFileSync('.evidence/client/p08d-results.xml',`<testsuite name="p08d-client" tests="${cases.length}" failures="${failures}" errors="0" skipped="0">${rows.join('\n')}</testsuite>`);console.log(`P08D_CLIENT_SUMMARY tests=${cases.length} failures=${failures}`);process.exitCode=failures?1:0;})();
