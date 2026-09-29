import { randomUUID } from 'node:crypto';
import type { Page as BrowserPage } from '@playwright/test';
import { test, expect, command, read, signIn, accessible, screenshot, sql, type Actor } from './p08c-fixtures.js';
import type { AdminDetail, ReconciliationReport } from '../../src/admin-api.js';

// Administrator responses may include private investigation data. Capture only explicit, synthetic UI screenshots.
test.use({ trace: 'off', video: 'off', screenshot: 'off', actionTimeout: 10_000, navigationTimeout: 20_000 });
test.setTimeout(120_000);
const uuid=(value:string)=>{if(!/^[0-9a-f-]{36}$/i.test(value))throw new Error('Invalid P08F fixture UUID');return value;};
async function open(page:BrowserPage,label:string):Promise<void>{await page.getByRole('navigation',{name:'Administrator investigation',exact:true}).getByRole('link',{name:label,exact:true}).click();}
function fingerprint(payment:string):string{return sql(`SELECT md5(row_to_json(p)::text || coalesce((SELECT string_agg(e.id::text || ':' || e.amount_minor::text,',' ORDER BY e.id) FROM ledger.journal_entries e WHERE e.journal_id=p.journal_id),'')) FROM ledger.payments p WHERE id='${uuid(payment)}';`);}
async function savedReport(page:BrowserPage,admin:Actor):Promise<ReconciliationReport>{await expect(page).toHaveURL(/\/admin\/reconciliation\/[0-9a-f-]{36}$/);const id=page.url().split('/').at(-1)!;await expect(page.getByRole('heading',{name:'Executed independent checks',exact:true})).toBeVisible();return read(admin.api,`/admin/reconciliation/${uuid(id)}`);}
async function runReport(page:BrowserPage,admin:Actor):Promise<ReconciliationReport>{await open(page,'Reconciliation');await page.getByRole('button',{name:'Run reconciliation',exact:true}).click();return savedReport(page,admin);}

test('P08FE2E01 search all filters and inspect real journal at responsive widths',async({page,lab},info)=>{
  const f=await lab.settled(),admin=await lab.actor(true);await signIn(page,admin);await open(page,'Transactions');
  await expect(page.getByRole('heading',{name:'Transaction investigation',exact:true})).toBeFocused();
  await page.getByLabel('Transaction or journal UUID').fill(f.payment.id);await page.getByLabel('Transaction kind',{exact:true}).selectOption('PAYMENT');
  await page.getByLabel('Lifecycle status').selectOption('SETTLED');await page.getByLabel('Account UUID or LG reference').fill(f.source.publicRef);
  await page.getByLabel('User UUID or email').fill(f.payer.email);await page.getByLabel('Currency',{exact:true}).selectOption('CAD');
  await page.getByLabel('Minimum amount (minor units)').fill('2500');await page.getByLabel('Maximum amount (minor units)').fill('2500');
  await page.getByLabel('From UTC (inclusive)').fill('2000-01-01T00:00:00Z');await page.getByLabel('To UTC (exclusive)').fill('2099-01-01T00:00:00Z');
  await page.getByRole('button',{name:'Apply filters',exact:true}).click();const region=page.getByRole('region',{name:'Transaction search results',exact:true});
  await expect(region.getByRole('row')).toHaveCount(2);await expect(region.getByText('CAD 25.00',{exact:true})).toBeVisible();await accessible(page);await screenshot(page,info,'p08f-search');
  await region.getByRole('link',{name:`Inspect payment ${f.payment.id}`,exact:true}).click();await expect(page.getByRole('heading',{name:'Transaction and ledger detail',exact:true})).toBeVisible();
  const journal=page.getByRole('region',{name:'Journal entries',exact:true});await expect(journal.getByRole('row')).toHaveCount(3);await expect(journal.getByText('DEBIT',{exact:true})).toBeVisible();await expect(journal.getByText('CREDIT',{exact:true})).toBeVisible();
  const detail=await read<AdminDetail>(admin.api,`/admin/transactions/${f.payment.id}`);expect(detail.transaction.journalId).toBe(f.payment.journalId);expect(detail.entries.map(e=>e.amountMinor)).toEqual(['2500','2500']);
  expect(sql(`SELECT count(*) FROM ledger.journal_entries WHERE journal_id='${uuid(f.payment.journalId!)}' AND amount_minor=2500;`)).toBe('2');
  await accessible(page);await screenshot(page,info,'p08f-detail');
});

test('P08FE2E02 customer and anonymous users cannot read administrator records',async({page,lab,playwright,baseURL})=>{
  const customer=await lab.actor(),id=randomUUID();await signIn(page,customer);await page.goto('/admin/transactions');
  await expect(page.getByRole('heading',{name:'Administrator access required',exact:true})).toBeVisible();await expect(page.getByRole('navigation',{name:'Administrator investigation',exact:true})).toHaveCount(0);
  const anonymous=await playwright.request.newContext({baseURL});
  try {for(const path of ['/admin/transactions',`/admin/transactions/${id}`,'/admin/audit','/admin/reconciliation',`/admin/reconciliation/${id}`,'/admin/failed-work']){expect((await customer.api.get('/api/v1'+path)).status()).toBe(403);expect((await anonymous.get('/api/v1'+path)).status()).toBe(401);}
    expect((await command(customer.api,'/admin/reconciliation',{id})).status()).toBe(403);
  }finally{await anonymous.dispose();}
  await accessible(page);
});

test('P08FE2E03 audit history links immutable operation identities without private payloads',async({page,lab},info)=>{
  const f=await lab.settled(),admin=await lab.actor(true);const reason='P08F private synthetic adjustment reason';
  const refund=await command(f.recipient.api,`/payments/${f.payment.id}/refunds`,{amountMinor:'100',reason});expect(refund.status()).toBe(201);
  await signIn(page,admin);await page.goto(`/admin/transactions/${f.payment.id}`);await page.getByRole('link',{name:'View financial audit history',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Financial audit history',exact:true})).toBeVisible();const region=page.getByRole('region',{name:'Financial audit events',exact:true});const refundId=(await refund.json()).id as string;const refundRow=region.getByRole('row').filter({hasText:refundId});await expect(refundRow).toHaveCount(1);await expect(refundRow.getByRole('cell').first()).toHaveText(/^Refund\s*Sequence \d+$/);
  const response=await admin.api.get(`/api/v1/admin/audit?aggregateId=${f.payment.id}`);expect(response.status()).toBe(200);const data=await response.json();expect(data.integrity).toBe('NOT_CHECKED');expect(JSON.stringify(data)).not.toContain(reason);expect(JSON.stringify(data)).not.toContain('canonical_body');
  expect(data.results.items.length).toBe(Number(sql(`SELECT count(*) FROM ledger.audit_records WHERE aggregate_id='${uuid(f.payment.id)}';`)));
  await expect(page.getByText('not checked in this list',{exact:true})).toBeVisible();await accessible(page);await screenshot(page,info,'p08f-audit');
});

test('P08FE2E04 run and reload a real clean consistent-snapshot report',async({page,lab},info)=>{
  const f=await lab.settled(),admin=await lab.actor(true),before=fingerprint(f.payment.id);await signIn(page,admin);
  const report=await runReport(page,admin);expect(report.status).toBe('PASS');expect(report.discrepancyCount).toBe('0');expect(report.snapshot.readOnly).toBe(true);expect(report.snapshot.isolation).toBe('repeatable read');expect(report.checks).toHaveLength(8);
  expect(sql(`SELECT count(*) FROM ledger.reconciliation_runs WHERE id='${uuid(report.id)}';`)).toBe('1');expect(fingerprint(f.payment.id)).toBe(before);
  await expect(page.getByRole('heading',{name:'Passed at the recorded snapshot',exact:true})).toBeVisible();await accessible(page);await screenshot(page,info,'p08f-report');
  await page.reload();expect(await savedReport(page,admin)).toEqual(report);expect(fingerprint(f.payment.id)).toBe(before);
});

test('P08FE2E05 committed response loss survives reload and reauthentication with one report',async({page,lab},info)=>{
  const admin=await lab.actor(true);await signIn(page,admin);await open(page,'Reconciliation');let dropped=false,id='';let original:ReconciliationReport|undefined;
  await page.route('**/api/v1/admin/reconciliation',async route=>{if(route.request().method()==='POST'&&!dropped){dropped=true;id=(route.request().postDataJSON() as {id:string}).id;const response=await route.fetch();expect(response.status()).toBe(201);original=await response.json();await route.abort('failed');}else await route.continue();});
  await page.getByRole('button',{name:'Run reconciliation',exact:true}).click();await expect(page.getByRole('button',{name:'Resume saved report request',exact:true})).toBeEnabled();
  expect(sql(`SELECT count(*) FROM ledger.reconciliation_runs WHERE id='${uuid(id)}';`)).toBe('1');
  await page.reload();await expect(page.getByRole('button',{name:'Resume saved report request',exact:true})).toBeVisible();
  const stored=await page.evaluate(owner=>JSON.parse(localStorage.getItem(`ledgerguard:p08f:reconciliation:${owner}`)??'null'),admin.id);expect(stored).toEqual({version:1,owner:admin.id,id});
  await page.context().clearCookies();await signIn(page,admin);await open(page,'Reconciliation');await page.getByRole('button',{name:'Resume saved report request',exact:true}).click();
  expect(await savedReport(page,admin)).toEqual(original);expect(sql(`SELECT count(*) FROM ledger.reconciliation_runs WHERE id='${uuid(id)}';`)).toBe('1');await accessible(page);
});

test('P08FE2E06 discrepancy evidence is real, retained and restored without automatic repair',async({page,lab})=>{
  const f=await lab.settled(),admin=await lab.actor(true);const aggregate=uuid(f.payment.id);
  const original=sql(`SELECT encode(convert_to(canonical_body,'UTF8'),'base64') FROM ledger.audit_records WHERE aggregate_id='${aggregate}' AND sequence=1;`).replace(/\s/g,'');
  if(!/^[A-Za-z0-9+/=]+$/.test(original))throw new Error('Invalid fixture backup');
  // Owner-only, disposable fixture. Transactional DDL restores the trigger before exposing the tampered bytes.
  sql(`BEGIN; ALTER TABLE ledger.audit_records DISABLE TRIGGER immutable_audit; UPDATE ledger.audit_records SET canonical_body=canonical_body||' ' WHERE aggregate_id='${aggregate}' AND sequence=1; ALTER TABLE ledger.audit_records ENABLE TRIGGER immutable_audit; COMMIT;`);
  let report:ReconciliationReport|undefined;
  try {await signIn(page,admin);report=await runReport(page,admin);expect(report.status).toBe('DISCREPANCIES');expect(report.checks.find(c=>c.id==='AUDIT_CHAIN')?.samples.some(s=>s.identity.startsWith(aggregate))).toBe(true);
    await expect(page.getByRole('heading',{name:'Discrepancies found',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Passed at the recorded snapshot',exact:true})).toHaveCount(0);await accessible(page);
    expect(sql(`SELECT right(canonical_body,1)=' ' FROM ledger.audit_records WHERE aggregate_id='${aggregate}' AND sequence=1;`)).toBe('t');
  } finally {sql(`BEGIN; ALTER TABLE ledger.audit_records DISABLE TRIGGER immutable_audit; UPDATE ledger.audit_records SET canonical_body=convert_from(decode('${original}','base64'),'UTF8') WHERE aggregate_id='${aggregate}' AND sequence=1; ALTER TABLE ledger.audit_records ENABLE TRIGGER immutable_audit; COMMIT;`);}
  const corrected=await runReport(page,admin);expect(corrected.status).toBe('PASS');expect(corrected.discrepancyCount).toBe('0');
  expect((await read<ReconciliationReport>(admin.api,`/admin/reconciliation/${report!.id}`)).status).toBe('DISCREPANCIES');
});

test('P08FE2E07 existing failed-work replay is explicit and does not duplicate settled money',async({page,lab},info)=>{
  const f=await lab.settled(),admin=await lab.actor(true),before=fingerprint(f.payment.id);
  const id=sql(`SELECT ledger.record_failed_work('payment-settler-v1',e.id,'ledgerguard.events.v1',e.event_type,
    jsonb_build_object('eventId',e.id,'eventType',e.event_type,'schemaVersion',e.schema_version,'aggregateId',e.aggregate_id,'aggregateVersion',e.aggregate_version,'correlationId',e.correlation_id,'occurredAt',to_char(e.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'payload',e.payload),'P08F_CONTROLLED_REPLAY',1)
    FROM ledger.outbox_events e WHERE aggregate_id='${uuid(f.payment.id)}' AND event_type='payment.requested';`);
  await signIn(page,admin);await page.goto(`/admin/failed-work/${uuid(id)}`);await expect(page.getByRole('heading',{name:'Failed-work detail',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Review replay request',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Replay this failed work?',exact:true});await expect(dialog).toBeVisible();await expect(dialog.getByRole('button',{name:'Go back',exact:true})).toBeFocused();
  await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();await expect(page.getByRole('button',{name:'Review replay request',exact:true})).toBeFocused();
  await page.getByRole('button',{name:'Review replay request',exact:true}).click();await dialog.getByRole('button',{name:'Request replay',exact:true}).click();await expect(dialog).not.toBeVisible();
  await expect.poll(()=>sql(`SELECT state FROM ledger.failed_work WHERE id='${uuid(id)}';`),{timeout:20_000}).toBe('REPUBLISHED');
  await page.getByRole('button',{name:'Check current work state',exact:true}).click();await expect(page.getByRole('button',{name:'Review replay request',exact:true})).toBeDisabled();
  expect(sql(`SELECT count(*) FROM ledger.failed_work_replay_audit WHERE work_id='${uuid(id)}' AND action='REPLAY_REQUESTED';`)).toBe('1');expect(fingerprint(f.payment.id)).toBe(before);
  await accessible(page);await screenshot(page,info,'p08f-failed-work');
});

test('P08FE2E08 read errors invalid filters and absent resources never show stale success',async({page,lab})=>{
  const admin=await lab.actor(true);await signIn(page,admin);await page.route('**/api/v1/admin/transactions?**',route=>route.abort('failed'));await open(page,'Transactions');
  await expect(page.getByRole('button',{name:'Retry loading records',exact:true})).toBeVisible();await expect(page.getByRole('region',{name:'Transaction search results',exact:true})).toHaveCount(0);
  await page.unroute('**/api/v1/admin/transactions?**');await page.getByRole('button',{name:'Retry loading records',exact:true}).click();await expect(page.getByRole('heading',{name:'Matching operations',exact:true})).toBeVisible();
  await page.getByLabel('Minimum amount (minor units)').fill('1e4');await page.getByRole('button',{name:'Apply filters',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();
  await page.goto('/admin/transactions/'+randomUUID());await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByRole('heading',{name:'Authoritative operation',exact:true})).toHaveCount(0);await accessible(page);
});

test('P08FE2E09 deterministic paged transaction search uses real database order',async({page,lab})=>{
  const f=await lab.settled('3000'),admin=await lab.actor(true);const ids:string[]=[];
  for(let i=0;i<3;i++){const response=await command(f.recipient.api,'/transfers',{sourceId:f.destination.id,recipientRef:f.source.publicRef,amountMinor:'100',currency:'CAD'});expect(response.status()).toBe(201);ids.push((await response.json()).id);}
  const expected=sql(`SELECT id FROM ledger.transfers WHERE source_id='${uuid(f.destination.id)}' ORDER BY created_at DESC,id DESC;`).split('\n');expect(expected).toHaveLength(3);
  await signIn(page,admin);await page.goto(`/admin/transactions?kind=TRANSFER&account=${f.destination.id}&limit=1&offset=0`);
  for(let i=0;i<3;i++){const region=page.getByRole('region',{name:'Transaction search results',exact:true});await expect(region.getByRole('row')).toHaveCount(2);await expect(region.getByRole('link',{name:`Inspect transfer ${expected[i]}`,exact:true})).toBeVisible();if(i<2)await page.getByRole('button',{name:'Next page',exact:true}).click();}
  await expect(page.getByRole('button',{name:'Next page',exact:true})).toBeDisabled();await page.getByRole('button',{name:'Previous page',exact:true}).click();await expect(page.getByRole('link',{name:`Inspect transfer ${expected[1]}`,exact:true})).toBeVisible();await accessible(page);
});

test('P08FE2E10 report remains historical after later financial work and requires CSRF for runs',async({page,lab})=>{
  const f=await lab.settled(),admin=await lab.actor(true);await signIn(page,admin);const initial=await runReport(page,admin);
  const denied=await admin.api.post('/api/v1/admin/reconciliation',{data:{id:randomUUID()}});expect(denied.status()).toBe(403);
  const response=await command(f.recipient.api,'/transfers',{sourceId:f.destination.id,recipientRef:f.source.publicRef,amountMinor:'100',currency:'CAD'});expect(response.status()).toBe(201);
  await page.reload();expect(await savedReport(page,admin)).toEqual(initial);await expect(page.getByText('This is a saved historical result. It is not a production-readiness or security certification.',{exact:true})).toBeVisible();
  expect(BigInt(sql('SELECT count(*) FROM ledger.transfers;'))).toBeGreaterThan(BigInt(initial.totals.transfers!));await accessible(page);
});
