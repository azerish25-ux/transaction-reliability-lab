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
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]), hour = Number(m[4]), minute = Number(m[5]), second = Number(m[6] ?? 0);
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
  if (value.operationId != null) scheduleId(value.operationId);
  if (value.journalId != null) scheduleId(value.journalId);
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
  if (!match || !match[1] || !UUID.test(match[1])) return undefined;
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
