"""One-use, guarded P08D delivery. Removed by the publishing commit."""
from pathlib import Path
import json

ROOT = Path.cwd()
def write(path, text):
    p = ROOT / path
    if p.exists(): raise RuntimeError('Refusing to replace new file: ' + path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text.lstrip('\n'))
def replace(path, old, new, count=1):
    p = ROOT / path
    text = p.read_text()
    if text.count(old) != count: raise RuntimeError('Source guard failed: ' + path + ': ' + old[:70])
    p.write_text(text.replace(old, new))

write('frontend/src/schedule-api.ts', r'''
import { currency, minor, MAX_TRANSACTION, type Currency } from './money.js';
import type { CommandResponse, Page } from './api.js';

export type Recurrence = 'ONCE' | 'DAILY' | 'WEEKLY';
export type ScheduleStatus = 'ACTIVE' | 'PAUSED' | 'CANCELLED' | 'FINISHED';
export type ScheduleStateAction = 'PAUSE' | 'RESUME' | 'CANCEL';
export interface ScheduleDefinition {
  sourceId: string; recipientRef: string; amountMinor: string; currency: Currency;
  intendedLocal: string; zoneId: string; recurrence: Recurrence;
}
export type ScheduleCommand =
  | { action: 'CREATE'; definition: ScheduleDefinition }
  | { action: 'EDIT'; scheduleId: string; expectedVersion: number; definition: ScheduleDefinition }
  | { action: ScheduleStateAction; scheduleId: string; expectedVersion: number };
export interface ScheduleReceipt {
  id: string; version: number; eventVersion: number; status: ScheduleStatus;
}
export interface ScheduleRecord extends ScheduleDefinition, ScheduleReceipt {
  nextInstant: string; createdAt: string; updatedAt: string;
}
export interface ScheduleOccurrence {
  id: string; scheduleId: string; scheduleVersion: number; intendedLocal: string; dueAt: string;
  outcome: 'SUCCEEDED' | 'FAILED' | 'SKIPPED_LATE'; operationId: string | null;
  journalId: string | null; errorCode: string | null; createdAt: string;
}
export interface SchedulePreview {
  intendedLocal: string; zoneId: string; recurrence: Recurrence; resolvedLocal: string;
  offset: string; instant: string; policy: 'NORMAL' | 'GAP_FORWARD' | 'OVERLAP_EARLIER';
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function scheduleId(value: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new TypeError('Invalid schedule identity');
  return value.toLowerCase();
}
export function scheduleVersion(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError('Invalid schedule version');
  return value;
}
/** A wall time is not an instant. Never parse this using the browser's local timezone. */
export function normalizeLocal(value: string): string {
  if (typeof value !== 'string') throw new TypeError('Enter a local date and time');
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!m) throw new TypeError('Use a local date and time without an offset or fractional seconds');
  const [year, month, day, hour, minute, second] = m.slice(1).map(v => Number(v ?? 0));
  const d = new Date(0);
  d.setUTCFullYear(year, month - 1, day); d.setUTCHours(hour, minute, second, 0);
  if (year < 1 || d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day
      || d.getUTCHours() !== hour || d.getUTCMinutes() !== minute || d.getUTCSeconds() !== second) {
    throw new TypeError('Enter a valid calendar date and local time');
  }
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? '00'}`;
}
export function normalizeZone(value: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 100) throw new TypeError('Choose an IANA time zone');
  const zone = value.trim();
  if (!/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(zone)) throw new TypeError('Choose an IANA time zone');
  try { new Intl.DateTimeFormat('en', { timeZone: zone }).format(0); }
  catch { throw new TypeError('This browser does not recognize that IANA time zone'); }
  return zone;
}
export function normalizeRecurrence(value: string): Recurrence {
  if (!['ONCE', 'DAILY', 'WEEKLY'].includes(value)) throw new TypeError('Choose one-time, daily or weekly recurrence');
  return value as Recurrence;
}
export function normalizeScheduleDefinition(input: ScheduleDefinition): ScheduleDefinition {
  const sourceId = scheduleId(input.sourceId);
  const amount = minor(input.amountMinor, MAX_TRANSACTION);
  if (amount === 0n) throw new TypeError('Enter a positive schedule amount');
  const ref = typeof input.recipientRef === 'string' ? input.recipientRef.trim() : '';
  if (!/^LG-[0-9a-f]{32}$/i.test(ref)) throw new TypeError('Enter a valid LedgerGuard recipient reference');
  return Object.freeze({ sourceId, recipientRef: `LG-${ref.slice(3).toLowerCase()}`, amountMinor: amount.toString(),
    currency: currency(input.currency), intendedLocal: normalizeLocal(input.intendedLocal),
    zoneId: normalizeZone(input.zoneId), recurrence: normalizeRecurrence(input.recurrence) });
}
export function normalizeScheduleCommand(input: ScheduleCommand): ScheduleCommand {
  if (!input || typeof input !== 'object') throw new TypeError('Invalid schedule instruction');
  if (input.action === 'CREATE') return Object.freeze({ action: 'CREATE', definition: normalizeScheduleDefinition(input.definition) });
  const id = scheduleId('scheduleId' in input ? input.scheduleId : '');
  const version = scheduleVersion('expectedVersion' in input ? input.expectedVersion : 0);
  if (input.action === 'EDIT') return Object.freeze({ action: 'EDIT', scheduleId: id, expectedVersion: version, definition: normalizeScheduleDefinition(input.definition) });
  if (!['PAUSE', 'RESUME', 'CANCEL'].includes(input.action)) throw new TypeError('Invalid schedule action');
  return Object.freeze({ action: input.action, scheduleId: id, expectedVersion: version });
}
export function scheduleRequest(input: ScheduleCommand): { path: string; method: 'POST' | 'PUT'; body: unknown } {
  const command = normalizeScheduleCommand(input);
  if (command.action === 'CREATE') return { path: '/schedules', method: 'POST', body: command.definition };
  if (command.action === 'EDIT') return { path: `/schedules/${command.scheduleId}`, method: 'PUT', body: { ...command.definition, expectedVersion: command.expectedVersion } };
  return { path: `/schedules/${command.scheduleId}/${command.action.toLowerCase()}`, method: 'POST', body: { expectedVersion: command.expectedVersion } };
}
function instant(value: string): string {
  if (typeof value !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new TypeError('Invalid authoritative execution instant');
  return value;
}
function receipt(value: ScheduleReceipt): void {
  if (!value || !['ACTIVE', 'PAUSED', 'CANCELLED', 'FINISHED'].includes(value.status)) throw new TypeError('Invalid schedule status');
  scheduleId(value.id); scheduleVersion(value.version); scheduleVersion(value.eventVersion);
}
export function validateScheduleReceipt(response: CommandResponse<ScheduleReceipt>, command: ScheduleCommand): CommandResponse<ScheduleReceipt> {
  receipt(response.body);
  const body = response.body;
  if (response.status !== (command.action === 'CREATE' ? 201 : 200)) throw new TypeError('Unexpected schedule response status');
  if (command.action === 'CREATE') {
    if (body.version !== 1 || body.status !== 'ACTIVE') throw new TypeError('Invalid creation receipt');
  } else {
    if (body.id !== command.scheduleId || body.version !== command.expectedVersion + (command.action === 'EDIT' ? 1 : 0)) throw new TypeError('Mismatched schedule receipt');
    const state = command.action === 'PAUSE' ? 'PAUSED' : command.action === 'RESUME' ? 'ACTIVE' : command.action === 'CANCEL' ? 'CANCELLED' : undefined;
    if (state && body.status !== state) throw new TypeError('Mismatched lifecycle receipt');
  }
  return response;
}
export function validateScheduleRecord(value: ScheduleRecord): ScheduleRecord {
  receipt(value); normalizeScheduleDefinition(value); instant(value.nextInstant); instant(value.createdAt); instant(value.updatedAt);
  return value;
}
export function validateOccurrence(value: ScheduleOccurrence, id: string): ScheduleOccurrence {
  if (!value || value.scheduleId !== id || !['SUCCEEDED', 'FAILED', 'SKIPPED_LATE'].includes(value.outcome)) throw new TypeError('Invalid occurrence record');
  scheduleId(value.id); scheduleVersion(value.scheduleVersion); normalizeLocal(value.intendedLocal); instant(value.dueAt); instant(value.createdAt);
  if (value.operationId !== null) scheduleId(value.operationId);
  if (value.journalId !== null) scheduleId(value.journalId);
  if (value.outcome === 'SUCCEEDED' && (!value.operationId || !value.journalId)) throw new TypeError('Successful occurrence is missing its immutable references');
  return value;
}
export function validateSchedulePage<T>(page: Page<T>, validate: (item: T) => T): Page<T> {
  if (!page || !Array.isArray(page.items) || typeof page.hasMore !== 'boolean' || !Number.isInteger(page.limit)
      || page.limit < 1 || page.limit > 100 || !Number.isInteger(page.offset) || page.offset < 0 || page.items.length > page.limit) throw new TypeError('Invalid schedule page');
  page.items.forEach(validate); return page;
}
export function validatePreview(value: SchedulePreview, definition: ScheduleDefinition): SchedulePreview {
  if (!value || normalizeLocal(value.intendedLocal) !== definition.intendedLocal || value.zoneId !== definition.zoneId
      || value.recurrence !== definition.recurrence || !['NORMAL', 'GAP_FORWARD', 'OVERLAP_EARLIER'].includes(value.policy)
      || !/^(Z|[+-]\d{2}:\d{2})$/.test(value.offset)) throw new TypeError('Invalid server time preview');
  normalizeLocal(value.resolvedLocal); instant(value.instant); return value;
}
export function scheduleRoute(path: string): { kind: 'list' | 'create' | 'detail' | 'edit' | 'recovery'; id?: string } | undefined {
  if (path === '/schedules') return { kind: 'list' };
  if (path === '/schedules/new') return { kind: 'create' };
  if (path === '/schedules/recovery') return { kind: 'recovery' };
  const match = /^\/schedules\/([^/]+)(\/edit)?$/.exec(path);
  if (!match || !UUID.test(match[1])) return undefined;
  return { kind: match[2] ? 'edit' : 'detail', id: match[1].toLowerCase() };
}
export function scheduleActionAllowed(status: ScheduleStatus, action: ScheduleStateAction | 'EDIT'): boolean {
  if (action === 'RESUME') return status === 'PAUSED';
  if (action === 'PAUSE') return status === 'ACTIVE';
  return status === 'ACTIVE' || status === 'PAUSED';
}
export function scheduleTime(value: string, zone: string): string {
  instant(value);
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'longOffset' }).format(new Date(value));
}
''')

replace('frontend/src/api.ts', "import { currency, minor, MAX_TRANSACTION, type Currency } from './money.js';", "import { currency, minor, MAX_TRANSACTION, type Currency } from './money.js';\nimport { normalizeScheduleCommand, normalizeScheduleDefinition, scheduleId, scheduleRequest, validateScheduleReceipt, validateScheduleRecord, validateSchedulePage, validateOccurrence, validatePreview, type ScheduleCommand, type ScheduleDefinition, type ScheduleReceipt, type ScheduleRecord, type ScheduleOccurrence, type SchedulePreview } from './schedule-api.js';")
replace('frontend/src/api.ts', "  async command<T>(path: string, body: unknown, key?: string): Promise<CommandResponse<T>> {", """  schedules(limit = 20, offset = 0): Promise<Page<ScheduleRecord>> {
    pagination(limit, offset);
    return this.get<Page<ScheduleRecord>>(`/schedules?limit=${limit}&offset=${offset}`).then(page => validateSchedulePage(page, validateScheduleRecord));
  }
  scheduleById(id: string): Promise<ScheduleRecord> {
    return this.get<ScheduleRecord>(`/schedules/${scheduleId(id)}`).then(value => {
      validateScheduleRecord(value);
      if (value.id !== scheduleId(id)) throw new TypeError('Mismatched schedule identity');
      return value;
    });
  }
  scheduleOccurrences(id: string, limit = 20, offset = 0): Promise<Page<ScheduleOccurrence>> {
    const normalized = scheduleId(id); pagination(limit, offset);
    return this.get<Page<ScheduleOccurrence>>(`/schedules/${normalized}/occurrences?limit=${limit}&offset=${offset}`)
      .then(page => validateSchedulePage(page, value => validateOccurrence(value, normalized)));
  }
  previewSchedule(input: ScheduleDefinition): Promise<SchedulePreview> {
    const definition = normalizeScheduleDefinition(input);
    return this.command<SchedulePreview>('/schedules/preview', { intendedLocal: definition.intendedLocal, zoneId: definition.zoneId, recurrence: definition.recurrence })
      .then(response => validatePreview(response.body, definition));
  }
  scheduleCommand(input: ScheduleCommand, key: string): Promise<CommandResponse<ScheduleReceipt>> {
    const normalized = normalizeScheduleCommand(input);
    const request = scheduleRequest(normalized);
    return this.command<ScheduleReceipt>(request.path, request.body, key, request.method).then(response => {
      try { return validateScheduleReceipt(response, normalized); }
      catch { throw new OutcomeUnknown(); }
    });
  }
  async command<T>(path: string, body: unknown, key?: string, method: 'POST' | 'PUT' = 'POST'): Promise<CommandResponse<T>> {""")
replace('frontend/src/api.ts', "return this.request<T>(path, 'POST', body, key);", "return this.request<T>(path, method, body, key);")
replace('frontend/src/api.ts', "method: 'GET' | 'POST'", "method: 'GET' | 'POST' | 'PUT'")
p=ROOT/'frontend/src/api.ts'; text=p.read_text(); count=text.count("method === 'POST' && key")
if count != 3: raise RuntimeError('Unexpected unknown-outcome boundary count: '+str(count))
p.write_text(text.replace("method === 'POST' && key", "method !== 'GET' && key"))

replace('frontend/src/intent-store.ts', "export type IntentState =", "import { normalizeScheduleCommand, type ScheduleCommand, type ScheduleReceipt } from './schedule-api.js';\nexport type IntentState =")
replace('frontend/src/intent-store.ts', "| 'payment-reversals';", "| 'payment-reversals' | 'schedules';")
replace('frontend/src/intent-store.ts', "| PaymentReversalIntent;", "| PaymentReversalIntent | ScheduleCommand;")
replace('frontend/src/intent-store.ts', "'payment-refunds','payment-reversals'].includes(record.kind)", "'payment-refunds','payment-reversals','schedules'].includes(record.kind)")
replace('frontend/src/intent-store.ts', "  private unresolved(kind: IntentKind): StoredIntent {", """  async executeSchedule(api: ApiClient, input: ScheduleCommand, newKey: () => string = () => crypto.randomUUID()): Promise<CommandResponse<ScheduleReceipt>> {
    return this.sendPreparedSchedule(api, this.prepare('schedules', input, newKey));
  }
  async retrySchedule(api: ApiClient): Promise<CommandResponse<ScheduleReceipt>> {
    return this.sendPreparedSchedule(api, this.unresolved('schedules'));
  }
  private sendPreparedSchedule(api: ApiClient, record: StoredIntent): Promise<CommandResponse<ScheduleReceipt>> {
    return this.resolve(() => api.scheduleCommand(record.intent as ScheduleCommand, record.key));
  }
  private unresolved(kind: IntentKind): StoredIntent {""")
replace('frontend/src/intent-store.ts', "    case 'payment-reversals': return normalizePaymentReversalIntent(input as PaymentReversalIntent);", "    case 'payment-reversals': return normalizePaymentReversalIntent(input as PaymentReversalIntent);\n    case 'schedules': return normalizeScheduleCommand(input as ScheduleCommand);")
replace('frontend/src/p08b-core.ts', "    case 'transfers': return '/transfers/new';", "    case 'schedules': return '/schedules/recovery';\n    case 'transfers': return '/transfers/new';")
replace('frontend/src/p08b-core.ts', "    case 'transfers': return 'transfer';", "    case 'schedules': return 'schedule instruction';\n    case 'transfers': return 'transfer';")

write('backend/src/main/java/lab/ledgerguard/schedules/SchedulePreviewController.java', r'''
package lab.ledgerguard.schedules;

import java.time.DateTimeException;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import lab.ledgerguard.core.SchedulePolicy;
import lab.ledgerguard.http.ApiException;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/** Pure temporal preview. It neither reserves funds nor creates a schedule/idempotency record. */
@RestController
@ConditionalOnProperty(name = "ledgerguard.schedules.enabled", havingValue = "true")
public class SchedulePreviewController {
    public record Request(String intendedLocal, String zoneId, String recurrence) { }
    public record Preview(String intendedLocal, String zoneId, String recurrence, String resolvedLocal,
                          String offset, String instant, String policy) { }
    private static final DateTimeFormatter LOCAL = DateTimeFormatter.ofPattern("uuuu-MM-dd'T'HH:mm:ss");

    @PostMapping(value = "/api/v1/schedules/preview", consumes = "application/json", produces = "application/json")
    public Preview preview(@RequestBody Request request) {
        if (request == null) throw new ApiException(400, "INVALID_SCHEDULE");
        LocalDateTime local;
        try {
            local = LocalDateTime.parse(request.intendedLocal(), DateTimeFormatter.ISO_LOCAL_DATE_TIME);
            if (local.getNano() != 0) throw new DateTimeException("Fractional wall time");
        } catch (DateTimeException | NullPointerException invalid) {
            throw new ApiException(400, "INVALID_LOCAL_TIME");
        }
        ZoneId zone;
        try {
            if (request.zoneId() == null || request.zoneId().length() > 100) throw new DateTimeException("Invalid zone");
            zone = ZoneId.of(request.zoneId());
        } catch (DateTimeException invalid) {
            throw new ApiException(400, "INVALID_TIME_ZONE");
        }
        SchedulePolicy.Recurrence recurrence;
        try { recurrence = SchedulePolicy.Recurrence.valueOf(request.recurrence()); }
        catch (IllegalArgumentException | NullPointerException invalid) { throw new ApiException(400, "INVALID_RECURRENCE"); }
        var instant = SchedulePolicy.resolve(local, zone);
        var resolved = instant.atZone(zone);
        int offsets = zone.getRules().getValidOffsets(local).size();
        return new Preview(LOCAL.format(local), zone.getId(), recurrence.name(), LOCAL.format(resolved.toLocalDateTime()),
            resolved.getOffset().getId(), instant.toString(), offsets == 0 ? "GAP_FORWARD" : offsets > 1 ? "OVERLAP_EARLIER" : "NORMAL");
    }

    @GetMapping(value = "/api/v1/openapi/p08d-ui.json", produces = "application/json")
    public Resource contract() { return new ClassPathResource("openapi/p08d-ui.json"); }
}
''')
write('backend/src/test/java/lab/ledgerguard/SchedulePreviewTest.java', r'''
package lab.ledgerguard;

import lab.ledgerguard.http.ApiException;
import lab.ledgerguard.schedules.SchedulePreviewController;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class SchedulePreviewTest {
    private final SchedulePreviewController controller = new SchedulePreviewController();
    private SchedulePreviewController.Preview preview(String local, String zone, String recurrence) {
        return controller.preview(new SchedulePreviewController.Request(local, zone, recurrence));
    }
    @Test void P08DUT01_halifaxGapPreservesMinutes() {
        var p = preview("2027-03-14T02:30:00", "America/Halifax", "DAILY");
        assertEquals("GAP_FORWARD", p.policy()); assertEquals("2027-03-14T03:30:00", p.resolvedLocal());
        assertEquals("-03:00", p.offset()); assertEquals("2027-03-14T06:30:00Z", p.instant());
    }
    @Test void P08DUT02_halifaxOverlapChoosesEarlierOffset() {
        var p = preview("2027-11-07T01:30:00", "America/Halifax", "WEEKLY");
        assertEquals("OVERLAP_EARLIER", p.policy()); assertEquals("-03:00", p.offset());
        assertEquals("2027-11-07T04:30:00Z", p.instant());
    }
    @Test void P08DUT03_utcIsIndependentOfMachineZone() {
        var p = preview("2027-01-10T09:30", "UTC", "ONCE");
        assertEquals("NORMAL", p.policy()); assertEquals("Z", p.offset()); assertEquals("2027-01-10T09:30:00Z", p.instant());
    }
    @Test void P08DUT04_invalidCalendarAndFractionalTimesRejected() {
        for (String value : new String[]{"2027-02-29T09:00:00", "2027-01-10T25:00:00", "2027-01-10T09:00:00.001", "2027-01-10T09:00:00Z"})
            assertThrows(ApiException.class, () -> preview(value, "UTC", "ONCE"));
    }
    @Test void P08DUT05_invalidZoneAndRecurrenceRejected() {
        assertThrows(ApiException.class, () -> preview("2027-01-10T09:00:00", "not/a-zone", "ONCE"));
        assertThrows(ApiException.class, () -> preview("2027-01-10T09:00:00", "UTC", "MONTHLY"));
    }
    @Test void P08DUT06_nullRequestRejected() { assertThrows(ApiException.class, () -> controller.preview(null)); }
}
''')
contract_path=ROOT/'backend/src/main/resources/openapi/p07a-schedules.json'
contract=json.loads(contract_path.read_text())
contract['info']={**contract['info'], 'title':'LedgerGuard P08D customer schedule interface', 'version':'0.4.0', 'description':'P07A schedule commands and owner-scoped history, plus a pure server-authoritative temporal preview. Synthetic money only. Preview does not create schedules or reserve funds.'}
path_prefix='/api/v1' if '/api/v1/schedules' in contract['paths'] else ''
preview_properties={name:{'type':'string'} for name in ('intendedLocal','zoneId','recurrence','resolvedLocal','offset','instant','policy')}
preview_properties['recurrence']['enum']=['ONCE','DAILY','WEEKLY']; preview_properties['policy']['enum']=['NORMAL','GAP_FORWARD','OVERLAP_EARLIER']; preview_properties['instant']['format']='date-time'
contract['paths'][path_prefix+'/schedules/preview']={'post':{'operationId':'previewScheduleTime','summary':'Resolve intended wall time using the same policy as the scheduler; no financial mutation', 'requestBody':{'required':True,'content':{'application/json':{'schema':{'type':'object','required':['intendedLocal','zoneId','recurrence'],'properties':{key:preview_properties[key] for key in ('intendedLocal','zoneId','recurrence')}}}}},'responses':{'200':{'description':'Authoritative temporal resolution, not durable schedule acceptance','content':{'application/json':{'schema':{'type':'object','required':list(preview_properties),'properties':preview_properties}}}},'400':{'description':'Invalid local time, zone or recurrence'},'401':{'description':'Authentication required'},'403':{'description':'CSRF or authorization failure'}}}}
write('backend/src/main/resources/openapi/p08d-ui.json',json.dumps(contract,indent=2)+'\n')

write('tests/contracts/p08d-client.test.cjs', r'''
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
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
(async()=>{let failures=0;const rows=[];for(const c of cases){try{await c.run();console.log('PASS',c.id);rows.push(`<testcase name="${c.id}"/>`);}catch(e){failures++;console.error('FAIL',c.id,e.stack||e.message);rows.push(`<testcase name="${c.id}"><failure message="${escape(e.message)}"/></testcase>`);}}
fs.mkdirSync('.evidence/client',{recursive:true});fs.writeFileSync('.evidence/client/p08d-results.xml',`<testsuite name="p08d-client" tests="${cases.length}" failures="${failures}" errors="0" skipped="0">${rows.join('\n')}</testsuite>`);console.log(`P08D_CLIENT_SUMMARY tests=${cases.length} failures=${failures}`);process.exitCode=failures?1:0;})();
''')
package=ROOT/'frontend/package.json'; data=json.loads(package.read_text()); data['scripts']['test:contracts']+=' && node tests/contracts/p08d-client.test.cjs'; package.write_text(json.dumps(data,indent=2)+'\n')
config=ROOT/'frontend/tsconfig.core.json'; data=json.loads(config.read_text()); data['include'].append('src/schedule-api.ts'); config.write_text(json.dumps(data,indent=2)+'\n')
Path(__file__).unlink()
print('P08D client, preserved intent recovery, temporal preview and regression tests installed; source awaiting verification.')
