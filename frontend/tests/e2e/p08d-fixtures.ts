import { randomUUID } from 'node:crypto';
import type { APIRequestContext, Page } from '@playwright/test';
import type { Account, Page as ApiPage } from '../../src/api.js';
import type { Currency } from '../../src/money.js';
import type { Recurrence, ScheduleDefinition, ScheduleRecord, ScheduleOccurrence } from '../../src/schedule-api.js';
import { expect, sql, command, csrf, read, type Actor, type Lab } from './p08c-fixtures.js';
export { test, expect, signIn, accessible, screenshot, command, csrf, read, sql } from './p08c-fixtures.js';
export interface ScheduleFixture { owner: Actor; recipient: Actor; source: Account; destination: Account; }
const uuid = (value: string): string => { if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) throw new Error('Invalid fixture UUID'); return value; };
/** HTML datetime-local canonicalizes zero seconds away; the production client restores
 * canonical API seconds without converting the customer's wall time to an instant. */
export function inputWallTime(value: string): string { return value.replace(/:00$/, ''); }
export function localUTC(offsetSeconds = 86400): string { return inputWallTime(new Date(Date.now() + offsetSeconds * 1000).toISOString().slice(0, 19)); }
export async function fixture(lab: Lab, funded = true, currency: Currency = 'CAD'): Promise<ScheduleFixture> {
  const owner = await lab.actor(), recipient = await lab.actor();
  const source = await lab.wallet(owner, currency), destination = await lab.wallet(recipient, currency);
  if (funded) {
    const asset = randomUUID();
    sql(`BEGIN; INSERT INTO ledger.accounts(id,label,currency,kind) VALUES('${asset}','P08D synthetic fixture asset','${currency}','SANDBOX_FUNDING_ASSET');
      INSERT INTO ledger.account_balances(account_id) VALUES('${asset}');
      SELECT ledger._post('${randomUUID()}','FUNDING','${asset}','${uuid(source.id)}',10000,'${currency}'); COMMIT;`);
  }
  return { owner, recipient, source, destination };
}
export function definition(f: ScheduleFixture, recurrence: Recurrence = 'ONCE', amountMinor = '100'): ScheduleDefinition {
  return { sourceId: f.source.id, recipientRef: f.destination.publicRef, amountMinor, currency: f.source.currency,
    intendedLocal: localUTC(), zoneId: 'UTC', recurrence };
}
export async function create(f: ScheduleFixture, input = definition(f)): Promise<ScheduleRecord> {
  const result = await command(f.owner.api, '/schedules', input); expect(result.status()).toBe(201);
  return read(f.owner.api, `/schedules/${(await result.json()).id}`);
}
export async function edit(api: APIRequestContext, id: string, body: ScheduleDefinition & { expectedVersion: number }) {
  const token = await csrf(api);
  return api.put(`/api/v1/schedules/${id}`, { data: body, headers: { [token.headerName]: token.token, 'Idempotency-Key': randomUUID() } });
}
export async function fillForm(page: Page, f: ScheduleFixture, input = definition(f), amount = '1.00'): Promise<void> {
  await expect(page.getByLabel('Source wallet', { exact: true })).toBeVisible();
  await page.getByLabel('Source wallet', { exact: true }).selectOption(input.sourceId);
  await page.getByLabel('Recipient reference', { exact: true }).fill(input.recipientRef);
  await page.getByLabel(/^Amount per occurrence/).fill(amount);
  await page.getByLabel('Recurrence', { exact: true }).selectOption(input.recurrence);
  await page.getByLabel('Intended local date and time', { exact: true }).fill(inputWallTime(input.intendedLocal));
  await page.getByLabel('IANA time zone', { exact: true }).fill(input.zoneId);
}
export async function review(page: Page, editing = false): Promise<void> {
  await page.getByRole('button', { name: 'Review schedule', exact: true }).click();
  await expect(page.getByRole('dialog', { name: editing ? 'Confirm schedule edit' : 'Confirm schedule', exact: true })).toBeVisible();
}
export async function confirm(page: Page, editing = false): Promise<void> {
  await page.getByRole('dialog', { name: editing ? 'Confirm schedule edit' : 'Confirm schedule', exact: true })
    .getByRole('button', { name: editing ? 'Save schedule edit' : 'Create schedule', exact: true }).click();
}
export async function occurrences(f: ScheduleFixture, id: string): Promise<ScheduleOccurrence[]> {
  return (await read<ApiPage<ScheduleOccurrence>>(f.owner.api, `/schedules/${id}/occurrences?limit=100&offset=0`)).items;
}
export async function settledOccurrences(f: ScheduleFixture, id: string, count: number): Promise<ScheduleOccurrence[]> {
  await expect.poll(async () => (await occurrences(f, id)).length, { timeout: 45000, intervals: [100, 200, 400, 800] }).toBe(count);
  return occurrences(f, id);
}
/** Independently count financial effects and sum immutable entries, not UI-reported outcomes. */
export function oracle(f: ScheduleFixture, id: string, occurrenceCount: number, effects: number, totalMinor: string): void {
  const row = JSON.parse(sql(`SELECT json_build_object(
    'occurrences',(SELECT count(*) FROM ledger.schedule_occurrences WHERE schedule_id='${uuid(id)}'),
    'effects',(SELECT count(*) FROM ledger.schedule_occurrences o JOIN ledger.transfers t ON t.id=o.operation_id WHERE o.schedule_id='${id}'),
    'journals',(SELECT count(*) FROM ledger.schedule_occurrences o JOIN ledger.journals j ON j.operation_id=o.operation_id WHERE o.schedule_id='${id}'),
    'debits',(SELECT COALESCE(sum(e.amount_minor::numeric),0)::text FROM ledger.schedule_occurrences o JOIN ledger.journals j ON j.operation_id=o.operation_id JOIN ledger.journal_entries e ON e.journal_id=j.id WHERE o.schedule_id='${id}' AND e.side='DEBIT'),
    'credits',(SELECT COALESCE(sum(e.amount_minor::numeric),0)::text FROM ledger.schedule_occurrences o JOIN ledger.journals j ON j.operation_id=o.operation_id JOIN ledger.journal_entries e ON e.journal_id=j.id WHERE o.schedule_id='${id}' AND e.side='CREDIT'))`));
  expect(row).toEqual({ occurrences: occurrenceCount, effects, journals: effects, debits: totalMinor, credits: totalMinor });
  expect(sql(`SELECT count(*) FROM ledger.account_balances b WHERE b.account_id IN ('${uuid(f.source.id)}','${uuid(f.destination.id)}') AND
    (b.posted_minor <> (SELECT COALESCE(sum(CASE WHEN e.side='CREDIT' THEN e.amount_minor::numeric ELSE -e.amount_minor::numeric END),0) FROM ledger.journal_entries e WHERE e.account_id=b.account_id) OR b.posted_minor-b.reserved_minor < 0 OR b.reserved_minor <> 0);`)).toBe('0');
}
/** Disposable fixture only: simulate a stopped scheduler's overdue wall-time definition.
 * No financial row is fabricated. Real competing workers create every occurrence and journal.
 * This helper is never packaged into the backend or a release image. */
export function makeOverdue(id: string, hours: number): void {
  if (!Number.isInteger(hours) || hours < 1 || hours > 600) throw new Error('Invalid bounded fixture age');
  sql(`WITH timing AS MATERIALIZED (SELECT date_trunc('second',clock_timestamp())-interval '${hours} hours' AS due)
    UPDATE ledger.schedules SET intended_local=timing.due AT TIME ZONE 'UTC',next_instant=timing.due,zone_id='UTC'
    FROM timing WHERE id='${uuid(id)}' AND status='ACTIVE';`);
}
