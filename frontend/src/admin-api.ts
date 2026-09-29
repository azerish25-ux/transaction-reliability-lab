import { ApiClient, OutcomeUnknown, type Page } from './api.js';
import { currency, type Currency } from './money.js';

export const ADMIN_CHECKS = ['BALANCES','JOURNALS','POSTINGS','PAYMENT_HOLDS','ADJUSTMENTS','IDEMPOTENCY','DURABLE_WORK','AUDIT_CHAIN'] as const;
export interface Snapshot { capturedAt: string; snapshotId: string; isolation: 'repeatable read'; readOnly: true; }
export interface AdminTransaction {
  id: string; kind: 'FUNDING'|'TRANSFER'|'PAYMENT'|'REFUND'|'REVERSAL'; state: 'PENDING'|'SETTLED'|'FAILED'|'CANCELLED';
  sourceId: string; sourceRef: string; sourceUserId: string|null; destinationId: string; destinationRef: string; destinationUserId: string|null;
  actorId: string|null; amountMinor: string; currency: Currency; journalId: string|null; parentId: string|null;
  version: string; adjustmentState: string; createdAt: string; updatedAt: string;
}
export interface AdminEntry { id: string; journalId: string; accountId: string; accountRef: string; accountKind: string; ownerId: string|null; side: 'DEBIT'|'CREDIT'; amountMinor: string; currency: Currency; }
export interface EventLink { id: string; eventType: string; aggregateVersion: string; correlationId: string; occurredAt: string; publishedAt: string|null; failedAt: string|null; attempts: number; }
export interface WorkLink { id: string; eventId: string; consumer: string; state: string; failureCode: string; updatedAt: string; }
export interface AdminDetail {
  snapshot: Snapshot; transaction: AdminTransaction; entries: AdminEntry[]; adjustments: Page<AdminTransaction>;
  events: Page<EventLink>; failedWork: Page<WorkLink>;
  payment: { refundedMinor: string; reversed: boolean; holdState: string|null; projectionState: string|null; projectionVersion: string|null; failureCode: string|null }|null;
  auditIntegrity: 'NOT_CHECKED';
}
export interface AuditRecord { aggregateId: string; sequence: string; actorId: string|null; action: string; operationId: string; correlationId: string; aggregateVersion: string; occurredAt: string; }
export interface AuditPage { snapshot: Snapshot; results: Page<AuditRecord>; integrity: 'NOT_CHECKED'; }
export interface ReconciliationCheck { id: typeof ADMIN_CHECKS[number]; title: string; status: 'PASS'|'DISCREPANCIES'; discrepancyCount: string; samples: {identity: string; detail: string}[]; hasMore: boolean; }
export interface ReconciliationReport {
  id: string; actorId: string; snapshot: Snapshot; completedAt: string; scope: string; status: 'PASS'|'DISCREPANCIES';
  discrepancyCount: string; totals: Record<string,string>; checks: ReconciliationCheck[]; limitations: string[];
}
export interface ReconciliationSummary { id: string; actorId: string; snapshotAt: string; scope: string; status: 'PASS'|'DISCREPANCIES'; discrepancyCount: string; createdAt: string; }
// Deliberately excludes the raw broker envelope returned by the legacy administration API.
export interface FailedWork extends WorkLink { exchangeName: string; routingKey: string; attempts: number; replayRequestedBy: string|null; replayRequestedAt: string|null; createdAt: string; republishedAt: string|null; }
export type AdminQuery = Record<string,string>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = ['FUNDING','TRANSFER','PAYMENT','REFUND','REVERSAL'];
const STATES = ['PENDING','SETTLED','FAILED','CANCELLED'];
const txKeys = ['reference','kind','status','account','user','currency','minAmountMinor','maxAmountMinor','from','to','parentId','limit','offset'];
const auditKeys = ['aggregateId','operationId','actorId','correlationId','action','from','to','limit','offset'];
function invalid(message = 'Invalid administrator response'): never { throw new TypeError(message); }
function text(value: unknown, maximum = 1000): asserts value is string { if (typeof value !== 'string' || value.length > maximum) invalid(); }
function object(value: unknown): asserts value is Record<string,unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(); }
function boolean(value: unknown): asserts value is boolean { if (typeof value !== 'boolean') invalid(); }
function instant(value: unknown): asserts value is string { text(value); if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) invalid(); }
function count(value: unknown): asserts value is string { text(value,100); if (!/^(0|[1-9][0-9]*)$/.test(value)) invalid(); }
export function adminId(value: string): string { if (!UUID.test(value)) invalid('A complete UUID reference is required.'); return value.toLowerCase(); }
function id(value: unknown): asserts value is string { text(value); adminId(value); }
function nullableId(value: unknown): void { if (value !== null) id(value); }
function nullableInstant(value: unknown): void { if (value !== null) instant(value); }
function snapshot(value: unknown): asserts value is Snapshot {
  object(value); instant(value.capturedAt); text(value.snapshotId);
  if (!/^\d+:\d+:[0-9,]*$/.test(value.snapshotId) || value.isolation !== 'repeatable read' || value.readOnly !== true) invalid();
}
function page<T>(value: unknown, validate: (value: unknown)=>asserts value is T): asserts value is Page<T> {
  object(value); if (!Array.isArray(value.items) || !Number.isInteger(value.limit) || (value.limit as number)<1 || (value.limit as number)>100
    || !Number.isInteger(value.offset) || (value.offset as number)<0 || (value.offset as number)>10000 || value.items.length>(value.limit as number)) invalid();
  boolean(value.hasMore); value.items.forEach(validate);
}
function transaction(value: unknown): asserts value is AdminTransaction {
  object(value); id(value.id); id(value.sourceId); id(value.destinationId); nullableId(value.sourceUserId); nullableId(value.destinationUserId);
  nullableId(value.actorId); nullableId(value.journalId); nullableId(value.parentId);
  text(value.kind); text(value.state); if (!KINDS.includes(value.kind) || !STATES.includes(value.state)) invalid();
  text(value.sourceRef); text(value.destinationRef); count(value.amountMinor); count(value.version); text(value.adjustmentState);
  currency(value.currency as Currency); instant(value.createdAt); instant(value.updatedAt);
  if (BigInt(value.amountMinor)<=0n || BigInt(value.amountMinor)>9223372036854775807n) invalid();
}
function auditRecord(value: unknown): asserts value is AuditRecord {
  object(value); id(value.aggregateId); id(value.operationId); id(value.correlationId); nullableId(value.actorId);
  text(value.action); count(value.sequence); count(value.aggregateVersion); instant(value.occurredAt);
}
function workLink(value: unknown): asserts value is WorkLink {
  object(value); id(value.id); id(value.eventId); text(value.consumer); text(value.state); text(value.failureCode); instant(value.updatedAt);
}
function failedWork(value: unknown): asserts value is FailedWork {
  workLink(value); const v=value as unknown as Record<string,unknown>;
  text(v.exchangeName); text(v.routingKey); if (!Number.isInteger(v.attempts) || (v.attempts as number)<0) invalid();
  nullableId(v.replayRequestedBy); nullableInstant(v.replayRequestedAt); nullableInstant(v.republishedAt); instant(v.createdAt);
}
export function validateReport(value: unknown): asserts value is ReconciliationReport {
  object(value); id(value.id); id(value.actorId); snapshot(value.snapshot); instant(value.completedAt); count(value.discrepancyCount);
  if (value.scope!=='P08F-v1:all-financial-records' || !Array.isArray(value.checks) || value.checks.length!==ADMIN_CHECKS.length) invalid();
  object(value.totals); Object.values(value.totals).forEach(count);
  if (!Array.isArray(value.limitations) || value.limitations.length<1) invalid(); value.limitations.forEach(v=>text(v,2000));
  const seen=new Set<string>(); let total=0n;
  for (const entry of value.checks) {
    object(entry); text(entry.id); text(entry.title); count(entry.discrepancyCount); boolean(entry.hasMore);
    if (!ADMIN_CHECKS.includes(entry.id as typeof ADMIN_CHECKS[number]) || seen.has(entry.id) || !Array.isArray(entry.samples) || entry.samples.length>10) invalid();
    seen.add(entry.id); const n=BigInt(entry.discrepancyCount); total+=n;
    if (entry.status!==(n===0n?'PASS':'DISCREPANCIES') || BigInt(entry.samples.length)>n || entry.hasMore!==(n>BigInt(entry.samples.length))) invalid();
    entry.samples.forEach(sample=>{object(sample);text(sample.identity);text(sample.detail,2000);});
  }
  if (total!==BigInt(value.discrepancyCount) || value.status!==(total===0n?'PASS':'DISCREPANCIES')) invalid();
}
export function adminQuery(input: AdminQuery|URLSearchParams, kind: 'transactions'|'audit'|'paging'='transactions'): string {
  const source=input instanceof URLSearchParams ? input : new URLSearchParams(input);
  const allowed=kind==='transactions'?txKeys:kind==='audit'?auditKeys:['limit','offset'];
  const values: AdminQuery={}; const seen=new Set<string>();
  for(const [key,original] of source.entries()) {
    if (!allowed.includes(key) || seen.has(key)) invalid('Unknown or repeated search filter.'); seen.add(key);
    const value=original.trim(); if(value.length>254 || /[\x00-\x1f\x7f]/.test(value)) invalid('Search filter is too long or contains control characters.');
    if(value) values[key]=value;
  }
  for(const key of ['reference','parentId','aggregateId','operationId','actorId','correlationId']) if(values[key]) values[key]=adminId(values[key]!);
  for(const key of ['minAmountMinor','maxAmountMinor']) if(values[key]) {
    count(values[key]); if(BigInt(values[key]!)>9223372036854775807n) invalid('Amount exceeds the supported integer range.');
  }
  if(values.minAmountMinor && values.maxAmountMinor && BigInt(values.minAmountMinor)>BigInt(values.maxAmountMinor)) invalid('Minimum amount must not exceed maximum amount.');
  if(values.kind && !KINDS.includes(values.kind)) invalid('Unknown transaction kind.');
  if(values.status && !STATES.includes(values.status)) invalid('Unknown payment status.');
  if(values.currency) currency(values.currency as Currency);
  if(values.account) {
    if(UUID.test(values.account)) values.account=adminId(values.account);
    else if(/^LG-[0-9a-f]{32}$/i.test(values.account)) values.account=`LG-${values.account.slice(3).toLowerCase()}`;
    else invalid('Use a complete account UUID or LG reference.');
  }
  if(values.user) {values.user=values.user.toLowerCase();if(!UUID.test(values.user) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.user)) invalid('Use a user UUID or email.');}
  if(values.action && !/^[A-Z][A-Z0-9_]{0,79}$/.test(values.action)) invalid('Use an exact uppercase audit action.');
  for(const key of ['from','to']) if(values[key]) instant(values[key]);
  if(values.from && values.to && Date.parse(values.from)>=Date.parse(values.to)) invalid('The end of the UTC range must be after its start.');
  for(const [key,fallback,min,max] of [['limit','25',1,100],['offset','0',0,10000]] as const) {
    const v=values[key]??fallback;
    if(!/^(0|[1-9][0-9]{0,4})$/.test(v) || Number(v)<min || Number(v)>max) invalid('Pagination is outside the supported range.'); values[key]=v;
  }
  return new URLSearchParams(values).toString();
}
export function adminRoute(path: string): boolean { return /^\/admin\/(transactions|audit|reconciliation|failed-work)(\/|$)/.test(path); }
export class AdminApi {
  constructor(private readonly api: ApiClient) { }
  async search(query: AdminQuery|URLSearchParams): Promise<{snapshot: Snapshot; results: Page<AdminTransaction>}> {
    const v=await this.api.get<unknown>(`/admin/transactions?${adminQuery(query)}`); object(v);snapshot(v.snapshot);page(v.results,transaction);return v as unknown as {snapshot:Snapshot;results:Page<AdminTransaction>};
  }
  async detail(reference: string): Promise<AdminDetail> {
    const v=await this.api.get<unknown>(`/admin/transactions/${adminId(reference)}`); object(v);snapshot(v.snapshot);transaction(v.transaction);
    if(v.transaction.id!==adminId(reference) || v.auditIntegrity!=='NOT_CHECKED' || !Array.isArray(v.entries)) invalid();
    v.entries.forEach(e=>{object(e);count(e.id);id(e.journalId);id(e.accountId);text(e.accountRef);text(e.accountKind);nullableId(e.ownerId);count(e.amountMinor);currency(e.currency as Currency);if(!['DEBIT','CREDIT'].includes(String(e.side))) invalid();});
    page(v.adjustments,transaction);page(v.failedWork,workLink);
    page(v.events,(e: unknown): asserts e is EventLink => {object(e);id(e.id);text(e.eventType);count(e.aggregateVersion);id(e.correlationId);instant(e.occurredAt);nullableInstant(e.publishedAt);nullableInstant(e.failedAt);if(!Number.isInteger(e.attempts)) invalid();});
    if(v.payment!==null){object(v.payment);count(v.payment.refundedMinor);boolean(v.payment.reversed);for(const k of ['holdState','projectionState','projectionVersion','failureCode']) if(v.payment[k]!==null) text(v.payment[k]);}
    return v as unknown as AdminDetail;
  }
  async audit(query: AdminQuery|URLSearchParams): Promise<AuditPage> {
    const v=await this.api.get<unknown>(`/admin/audit?${adminQuery(query,'audit')}`);object(v);snapshot(v.snapshot);page(v.results,auditRecord);if(v.integrity!=='NOT_CHECKED') invalid();return v as unknown as AuditPage;
  }
  async history(query: AdminQuery|URLSearchParams={}): Promise<Page<ReconciliationSummary>> {
    const v=await this.api.get<unknown>(`/admin/reconciliation?${adminQuery(query,'paging')}`);
    page(v,(r: unknown): asserts r is ReconciliationSummary=>{object(r);id(r.id);id(r.actorId);instant(r.snapshotAt);instant(r.createdAt);text(r.scope);count(r.discrepancyCount);if(r.status!==(r.discrepancyCount==='0'?'PASS':'DISCREPANCIES')) invalid();});return v;
  }
  async report(reference: string): Promise<ReconciliationReport> {
    const v=await this.api.get<unknown>(`/admin/reconciliation/${adminId(reference)}`);validateReport(v);if(v.id!==adminId(reference)) invalid();return v;
  }
  async run(reference: string): Promise<ReconciliationReport> {
    const requestId=adminId(reference);
    const response=await this.api.command<unknown>('/admin/reconciliation',{id:requestId},requestId);
    try {validateReport(response.body);if(![200,201].includes(response.status) || response.body.id!==requestId) invalid();return response.body;}
    catch {throw new OutcomeUnknown();}
  }
  async failedWork(query: AdminQuery|URLSearchParams={}): Promise<Page<FailedWork>> {
    const v=await this.api.get<unknown>(`/admin/failed-work?${adminQuery(query,'paging')}`);page(v,failedWork);return {...v,items:v.items.map(safeWork)};
  }
  async work(reference: string): Promise<FailedWork> {
    const v=await this.api.get<unknown>(`/admin/failed-work/${adminId(reference)}`);failedWork(v);if(v.id!==adminId(reference)) invalid();return safeWork(v);
  }
  async requestReplay(reference: string): Promise<void> {
    const requestId=adminId(reference);
    // The existing endpoint does not promise idempotent replay cycles. On uncertainty read it; never auto-resubmit.
    const v=await this.api.command<unknown>(`/admin/failed-work/${requestId}/replay`,{});
    object(v.body);if(v.status!==202 || v.body.id!==requestId || v.body.state!=='REPLAY_REQUESTED') invalid();
  }
}
function safeWork(v: FailedWork): FailedWork {
  return {id:v.id,eventId:v.eventId,consumer:v.consumer,state:v.state,failureCode:v.failureCode,updatedAt:v.updatedAt,
    exchangeName:v.exchangeName,routingKey:v.routingKey,attempts:v.attempts,replayRequestedBy:v.replayRequestedBy,
    replayRequestedAt:v.replayRequestedAt,createdAt:v.createdAt,republishedAt:v.republishedAt};
}
export class ReconciliationIntent {
  private readonly key: string;
  constructor(private readonly storage: Pick<Storage,'getItem'|'setItem'|'removeItem'>, private readonly owner: string) { this.key=`ledgerguard:p08f:reconciliation:${adminId(owner)}`; }
  current(): string|undefined {
    const raw=this.storage.getItem(this.key);if(raw===null) return undefined;
    const v: unknown=JSON.parse(raw);object(v);if(Object.keys(v).sort().join(',')!=='id,owner,version' || v.version!==1 || v.owner!==this.owner) invalid('Saved report request is invalid.');id(v.id);return v.id;
  }
  prepare(reference: string): string {
    const requested=adminId(reference);const current=this.current();if(current && current!==requested) invalid('Resolve the saved report request first.');
    this.storage.setItem(this.key,JSON.stringify({version:1,owner:this.owner,id:requested}));if(this.current()!==requested) invalid('Report request could not be preserved.');return requested;
  }
  complete(reference: string): void {if(this.current()===adminId(reference)) this.storage.removeItem(this.key);}
}
