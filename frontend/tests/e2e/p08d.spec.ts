import type { Page, Request } from '@playwright/test';
import type { Page as ApiPage } from '../../src/api.js';
import type { ScheduleRecord } from '../../src/schedule-api.js';
import { test, expect, signIn, accessible, screenshot, command, read, csrf, fixture, definition, create, edit, fillForm, review, confirm, occurrences, settledOccurrences, oracle, localUTC, makeOverdue } from './p08d-fixtures.js';

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  test.setTimeout(120000); const faults: string[] = [];
  page.on('pageerror', error => faults.push(error.message)); errors.set(page, faults);
});
test.afterEach(async ({ page }) => { expect(errors.get(page) ?? []).toEqual([]); });
const instruction = (request: Request) => ({ method: request.method(), body: request.postData(), key: request.headers()['idempotency-key'] });

async function currentId(page: Page): Promise<string> {
  await expect(page).toHaveURL(/\/schedules\/[0-9a-f-]{36}$/);
  const id = new URL(page.url()).pathname.split('/').pop();
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) throw new Error('Missing authoritative schedule reference');
  await expect(page.getByRole('heading', { name: 'Schedule detail', exact: true })).toBeVisible();
  return id;
}
async function control(page: Page, name: 'Pause' | 'Resume' | 'Cancel'): Promise<void> {
  await page.getByRole('button', { name: `${name} schedule`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `Confirm ${name.toLowerCase()}`, exact: true });
  await expect(dialog).toBeVisible(); await dialog.getByRole('button', { name: 'Confirm schedule action', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Schedule instruction confirmed' })).toBeVisible();
}

test('P08DE2E01 one-time customer schedule executes once with immutable journal evidence', async ({ page, lab }, info) => {
  const f = await fixture(lab); await signIn(page, f.owner);
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Schedules', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No schedules on this page' })).toBeVisible();
  await page.getByRole('link', { name: 'New schedule', exact: true }).click();
  await fillForm(page, f);
  await page.getByLabel('Intended local date and time', { exact: true }).fill(localUTC(12));
  await review(page); await confirm(page); const id = await currentId(page);
  expect((await settledOccurrences(f, id, 1))[0]?.outcome).toBe('SUCCEEDED');
  await page.getByRole('button', { name: 'Refresh schedule', exact: true }).click();
  await expect(page.getByText('Finished', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Succeeded', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View executed transfer' })).toBeVisible();
  oracle(f, id, 1, 1, '100'); await accessible(page); await screenshot(page, info, 'p08d-result');
  await page.getByRole('link', { name: 'View executed transfer' }).click();
  await expect(page.getByRole('heading', { name: 'Transfer receipt', exact: true })).toBeVisible();
});

test('P08DE2E02 weekly schedule editing and lifecycle controls preserve versioned history', async ({ page, lab }, info) => {
  const f = await fixture(lab); await signIn(page, f.owner); await page.goto('/schedules/new');
  await fillForm(page, f, definition(f, 'WEEKLY')); await review(page); await confirm(page); const id = await currentId(page);
  await page.getByRole('link', { name: 'Edit schedule', exact: true }).click();
  await page.getByLabel(/^Amount per occurrence/).fill('2.50'); await review(page, true); await confirm(page, true); await currentId(page);
  let record = await read<ScheduleRecord>(f.owner.api, `/schedules/${id}`); expect(record.version).toBe(2); expect(record.amountMinor).toBe('250');
  await control(page, 'Pause'); await expect(page.getByText('Paused', { exact: true }).last()).toBeVisible();
  record = await read(f.owner.api, `/schedules/${id}`); expect(record.version).toBe(2); expect(record.status).toBe('PAUSED');
  await control(page, 'Resume'); await expect(page.getByRole('button', { name: 'Pause schedule', exact: true })).toBeEnabled();
  record = await read(f.owner.api, `/schedules/${id}`); expect(record.version).toBe(2); expect(record.status).toBe('ACTIVE');
  await control(page, 'Cancel'); await expect(page.getByRole('button', { name: 'Pause schedule', exact: true })).toBeDisabled();
  record = await read(f.owner.api, `/schedules/${id}`); expect(record.version).toBe(2); expect(record.eventVersion).toBe(5); expect(record.status).toBe('CANCELLED');
  await expect(page.getByRole('button', { name: 'Edit schedule', exact: true })).toBeDisabled();
  oracle(f, id, 0, 0, '0'); await accessible(page); await screenshot(page, info, 'p08d-controls');
});

test('P08DE2E03 committed creation response loss survives reload with one schedule and original key', async ({ page, lab }, info) => {
  const f = await fixture(lab); await signIn(page, f.owner); await page.goto('/schedules/new');
  const requests: ReturnType<typeof instruction>[] = []; let dropped = false; let id = '';
  await page.route('**/api/v1/schedules', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    requests.push(instruction(route.request()));
    if (!dropped) { dropped = true; const response = await route.fetch(); expect(response.status()).toBe(201); id = (await response.json()).id; await route.abort('failed'); }
    else await route.continue();
  });
  await fillForm(page, f); await review(page); await confirm(page);
  await expect(page.getByRole('link', { name: 'Open safe recovery' })).toBeVisible();
  await page.reload(); await page.getByRole('link', { name: 'Open safe recovery' }).click();
  await expect(page.getByRole('heading', { name: 'Outcome not yet confirmed', exact: true })).toBeVisible();
  await accessible(page); await screenshot(page, info, 'p08d-recovery');
  const response = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/api/v1/schedules') && r.status() === 201);
  await page.getByRole('button', { name: 'Retry same schedule instruction' }).click();
  expect((await response).headers()['idempotency-replayed']).toBe('true');
  await expect(page.getByText('The original command receipt was replayed.', { exact: false })).toBeVisible();
  expect(requests).toHaveLength(2); expect(requests[0]).toEqual(requests[1]);
  expect((await read<ApiPage<ScheduleRecord>>(f.owner.api, '/schedules')).items.map(r => r.id)).toEqual([id]); oracle(f, id, 0, 0, '0');
});

test('P08DE2E04 committed PUT survives revocation and reauthentication without replacing version or key', async ({ page, lab }) => {
  const f = await fixture(lab); const record = await create(f); await signIn(page, f.owner); await page.goto(`/schedules/${record.id}/edit`);
  const requests: ReturnType<typeof instruction>[] = []; let dropped = false;
  await page.route(`**/api/v1/schedules/${record.id}`, async route => {
    if (route.request().method() !== 'PUT') return route.continue();
    requests.push(instruction(route.request()));
    if (!dropped) { dropped = true; const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort('failed'); }
    else await route.continue();
  });
  await page.getByLabel(/^Amount per occurrence/).fill('2.00'); await review(page, true); await confirm(page, true);
  await page.getByRole('link', { name: 'Open safe recovery' }).click(); await page.reload();
  await expect(page.getByRole('button', { name: 'Retry same schedule instruction' })).toBeVisible();
  expect((await command(page.request, '/auth/logout', {})).status()).toBe(204);
  const denied = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().endsWith(`/schedules/${record.id}`));
  const expired = page.waitForResponse(r => r.request().method() === 'GET' && r.url().endsWith('/auth/me') && r.status() === 401);
  await page.getByRole('button', { name: 'Retry same schedule instruction' }).click();
  expect((await denied).status()).toBe(403); expect((await expired).status()).toBe(401);
  await page.getByRole('button', { name: 'Continue to sign in' }).click(); await signIn(page, f.owner);
  await page.getByRole('link', { name: 'Resolve safely' }).first().click();
  const replay = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().endsWith(`/schedules/${record.id}`) && r.status() === 200);
  await page.getByRole('button', { name: 'Retry same schedule instruction' }).click();
  expect((await replay).headers()['idempotency-replayed']).toBe('true');
  expect(requests).toHaveLength(3); expect(requests[0]).toEqual(requests[1]); expect(requests[0]).toEqual(requests[2]);
  expect(JSON.parse(requests[2]!.body!).expectedVersion).toBe(1);
  const actual = await read<ScheduleRecord>(f.owner.api, `/schedules/${record.id}`); expect(actual.version).toBe(2); expect(actual.amountMinor).toBe('200'); oracle(f, record.id, 0, 0, '0');
});

test('P08DE2E05 stale browser edit is rejected and reload is explicit', async ({ page, lab }) => {
  const f = await fixture(lab); const record = await create(f); await signIn(page, f.owner); await page.goto(`/schedules/${record.id}/edit`);
  await page.getByLabel(/^Amount per occurrence/).fill('2.00'); await review(page, true);
  expect((await edit(f.owner.api, record.id, { ...definition(f), amountMinor: '300', expectedVersion: 1 })).status()).toBe(200);
  await confirm(page, true); await expect(page.getByText('SCHEDULE_VERSION_CONFLICT', { exact: true })).toBeVisible();
  await expect(page.getByText(/No newer version was silently substituted/)).toBeVisible();
  expect((await read<ScheduleRecord>(f.owner.api, `/schedules/${record.id}`)).amountMinor).toBe('300');
  await expect(page.getByLabel(/^Amount per occurrence/)).toHaveValue('2.00');
  await page.getByRole('button', { name: 'Load current definition' }).click();
  await expect(page.getByLabel(/^Amount per occurrence/)).toHaveValue('3.00');
  await accessible(page); oracle(f, record.id, 0, 0, '0');
});

test('P08DE2E06 owner authorization protects schedules occurrences edits and controls', async ({ page, lab }) => {
  const f = await fixture(lab); const record = await create(f); const outsider = await lab.actor();
  for (const endpoint of [`/schedules/${record.id}`, `/schedules/${record.id}/occurrences`]) expect((await outsider.api.get(`/api/v1${endpoint}`)).status()).toBe(404);
  expect((await edit(outsider.api, record.id, { ...definition(f), expectedVersion: 1 })).status()).toBe(404);
  for (const action of ['pause', 'resume', 'cancel']) expect((await command(outsider.api, `/schedules/${record.id}/${action}`, { expectedVersion: 1 })).status()).toBe(404);
  await signIn(page, outsider); await page.goto(`/schedules/${record.id}`); await expect(page.getByText('NOT_FOUND', { exact: true })).toBeVisible();
  await expect(page.getByText(f.destination.publicRef, { exact: true })).toHaveCount(0); await expect(page.getByRole('button', { name: 'Pause schedule' })).toHaveCount(0); await accessible(page);
  const admin = await lab.actor(true); expect((await command(admin.api, '/schedules', definition(f))).status()).toBe(403);
  oracle(f, record.id, 0, 0, '0');
});

test('P08DE2E07 server preview explains Halifax gap overlap and UTC without mutation', async ({ page, lab }, info) => {
  const f = await fixture(lab); await signIn(page, f.owner); await page.goto('/schedules/new');
  const samples = [
    { intendedLocal: '2027-03-14T02:30:00', zoneId: 'America/Halifax', instant: '2027-03-14T06:30:00Z', policy: 'Spring gap:' },
    { intendedLocal: '2027-11-07T01:30:00', zoneId: 'America/Halifax', instant: '2027-11-07T04:30:00Z', policy: 'Autumn overlap:' },
    { intendedLocal: '2027-11-07T01:30:00', zoneId: 'UTC', instant: '2027-11-07T01:30:00Z', policy: 'This wall time maps to one instant' }
  ];
  for (const sample of samples) {
    await fillForm(page, f, { ...definition(f, 'DAILY'), intendedLocal: sample.intendedLocal, zoneId: sample.zoneId }); await review(page);
    const dialog = page.getByRole('dialog', { name: 'Confirm schedule', exact: true });
    await expect(dialog.getByText(sample.instant, { exact: true })).toBeVisible(); await expect(dialog.getByText(new RegExp(sample.policy))).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Go back' })).toBeFocused(); await accessible(page);
    await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible(); await expect(page.getByRole('button', { name: 'Review schedule', exact: true })).toBeFocused();
  }
  await screenshot(page, info, 'p08d-form');
  expect((await read<ApiPage<ScheduleRecord>>(f.owner.api, '/schedules')).items).toEqual([]);
  const token = await csrf(f.owner.api);
  expect((await f.owner.api.post('/api/v1/schedules/preview', { data: samples[0] })).status()).toBe(403);
  expect((await f.owner.api.post('/api/v1/schedules/preview', { data: { intendedLocal: '2027-02-29T02:30:00', zoneId: 'UTC', recurrence: 'ONCE' }, headers: { [token.headerName]: token.token } })).status()).toBe(400);
});

test('P08DE2E08 zero-balance customer may schedule but insufficient occurrence has no financial effect', async ({ page, lab }) => {
  const f = await fixture(lab, false); await signIn(page, f.owner); await page.goto('/schedules/new');
  await fillForm(page, f); await page.getByLabel('Intended local date and time').fill(localUTC(12)); await review(page); await confirm(page);
  const id = await currentId(page); const history = await settledOccurrences(f, id, 1); expect(history[0]?.outcome).toBe('FAILED');
  await page.getByRole('button', { name: 'Refresh schedule' }).click(); await expect(page.getByRole('heading', { name: 'Failed', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View executed transfer' })).toHaveCount(0); oracle(f, id, 1, 0, '0'); await accessible(page);
});

test('P08DE2E09 exact currency validation rejects rounding self transfers and currency mismatch', async ({ page, lab }) => {
  const f = await fixture(lab, false, 'KWD'); const other = await lab.wallet(f.recipient, 'USD');
  await signIn(page, f.owner); await page.goto('/schedules/new'); await fillForm(page, f, definition(f), '1.234');
  for (const amount of ['0', '-1', '1e0', '1.2345']) {
    await page.getByLabel(/^Amount per occurrence/).fill(amount); await page.getByRole('button', { name: 'Review schedule' }).click();
    await expect(page.getByLabel(/^Amount per occurrence/)).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('dialog', { name: 'Confirm schedule', exact: true })).not.toBeVisible();
  }
  await page.getByLabel(/^Amount per occurrence/).fill('1.234'); await page.getByLabel('Recipient reference', { exact: true }).fill(f.source.publicRef);
  await page.getByRole('button', { name: 'Review schedule' }).click(); await expect(page.getByLabel('Recipient reference', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await page.getByLabel('Recipient reference', { exact: true }).fill(other.publicRef); await page.getByRole('button', { name: 'Review schedule' }).click();
  await expect(page.getByText('The recipient must exist and use the same currency as the source wallet.').first()).toBeVisible();
  await page.getByLabel('Recipient reference', { exact: true }).fill(f.destination.publicRef); await review(page); await confirm(page);
  const id = await currentId(page); expect((await read<ScheduleRecord>(f.owner.api, `/schedules/${id}`)).amountMinor).toBe('1234'); oracle(f, id, 0, 0, '0'); await accessible(page);
});

test('P08DE2E10 real catch-up results paginate and retain original local history after zone edit', async ({ page, lab }) => {
  const f = await fixture(lab); const record = await create(f, definition(f, 'DAILY'));
  // This isolated timing fixture simulates 22 days of scheduler downtime. No occurrences or money are inserted.
  makeOverdue(record.id, 22 * 24 + 1); const history = await settledOccurrences(f, record.id, 23);
  expect(history.filter(o => o.outcome === 'SKIPPED_LATE')).toHaveLength(22); expect(history.filter(o => o.outcome === 'SUCCEEDED')).toHaveLength(1);
  oracle(f, record.id, 23, 1, '100');
  await signIn(page, f.owner); await page.goto(`/schedules/${record.id}`);
  await expect(page.getByRole('heading', { name: 'Succeeded', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next occurrence page' }).click(); await expect(page.getByRole('heading', { name: 'Skipped late', exact: true })).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Next occurrence page' })).toBeDisabled();
  await page.getByRole('button', { name: 'Previous occurrence page' }).click();
  await expect(page.getByRole('heading', { name: 'Succeeded', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Edit schedule', exact: true }).click();
  await page.getByLabel('Intended local date and time').fill('2030-01-10T09:30:00'); await page.getByLabel('IANA time zone').fill('America/Halifax');
  await review(page, true); await confirm(page, true); await currentId(page);
  const after = await occurrences(f, record.id); expect(after).toEqual(history); expect((await read<ScheduleRecord>(f.owner.api, `/schedules/${record.id}`)).version).toBe(2);
  await accessible(page); oracle(f, record.id, 23, 1, '100');
});
