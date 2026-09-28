import { randomUUID } from 'node:crypto';
import type { Page, Route } from '@playwright/test';
import { test, expect, command, csrf, read, signIn, accessible, screenshot, sql, type Actor, type Lab } from './p08c-fixtures.js';
import type { Account, Page as ApiPage, PaymentRecord } from '../../src/api.js';
import type { WebhookEndpoint, WebhookDelivery, WebhookDeliveryDetail } from '../../src/webhook-api.js';
import type { WebhookCommand, WebhookCommandResult, SavedWebhookCommand } from '../../src/p08e-core.js';

// These journeys deliberately receive one-time signing secrets. Never record automatic
// traces, videos, response bodies, or failure screenshots; manual captures follow dismissal.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });
test.setTimeout(120_000);
test.afterEach(() => { receiver('NORMAL'); });

function receiver(mode: 'NORMAL' | 'STATUS_400'): void {
  sql(`UPDATE ledger.webhook_receiver_control SET mode='${mode}',updated_at=clock_timestamp() WHERE singleton;`);
}
async function send(actor: Actor, body: WebhookCommand, key = randomUUID()): Promise<WebhookCommandResult> {
  const response = await command(actor.api, '/webhook-commands', body, key);
  expect(response.status()).toBe(200);
  return response.json();
}
async function endpoint(actor: Actor): Promise<string> { return (await send(actor, { kind: 'CREATE' })).command.endpointId; }
async function open(page: Page): Promise<void> {
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Webhooks', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Webhooks', exact: true })).toBeVisible();
}
async function confirm(page: Page, title: string): Promise<void> {
  const dialog = page.getByRole('dialog', { name: title, exact: true });
  await expect(dialog).toBeVisible(); await dialog.getByRole('button', { name: title, exact: true }).click();
  await expect(dialog).not.toBeVisible();
}
async function saved(page: Page, actor: Actor): Promise<SavedWebhookCommand> {
  return page.evaluate(owner => JSON.parse(localStorage.getItem(`ledgerguard.webhook.intent.v1.${owner}`) ?? 'null'), actor.id);
}
async function dropCommitted(page: Page, kind: WebhookCommand['kind']): Promise<() => number> {
  let dropped = 0;
  await page.route('**/api/v1/webhook-commands', async (route: Route) => {
    if (route.request().method() === 'POST' && route.request().postDataJSON()?.kind === kind && dropped === 0) {
      dropped++; const response = await route.fetch({ maxRetries: 0, maxRedirects: 0 });
      expect(response.status()).toBe(200); await response.dispose(); await route.abort('failed');
    } else await route.continue();
  });
  return () => dropped;
}
async function noPersistentSecret(page: Page): Promise<void> {
  // Assert booleans rather than printing the secret in an assertion failure.
  expect(await page.evaluate(() => {
    const secret = document.querySelector('[data-testid="webhook-signing-secret"]')?.textContent;
    if (!secret) return false;
    return ![...Object.values(localStorage), ...Object.values(sessionStorage), location.href].some(value => String(value).includes(secret));
  })).toBe(true);
}
async function createInUi(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'New subscription', exact: true }).click();
  await confirm(page, 'Create subscription'); await expect(page.getByTestId('webhook-signing-secret')).toBeVisible();
}
async function funded(lab: Lab): Promise<{ payer: Actor; recipient: Actor; source: Account; destination: Account }> {
  const payer = await lab.actor(), recipient = await lab.actor();
  const source = await lab.wallet(payer), destination = await lab.wallet(recipient), asset = randomUUID();
  sql(`BEGIN; INSERT INTO ledger.accounts(id,label,currency,kind) VALUES('${asset}','P08E synthetic asset','CAD','SANDBOX_FUNDING_ASSET');
    INSERT INTO ledger.account_balances(account_id) VALUES('${asset}');
    SELECT ledger._post('${randomUUID()}','FUNDING','${asset}','${source.id}',10000,'CAD'); COMMIT;`);
  return { payer, recipient, source, destination };
}
async function paymentFixture(lab: Lab) {
  const f = await funded(lab), ep = await endpoint(f.payer);
  const response = await command(f.payer.api, '/payments', { sourceId: f.source.id, recipientRef: f.destination.publicRef, amountMinor: '2500', currency: 'CAD' });
  expect(response.status()).toBe(202); const paymentId = (await response.json() as { id: string }).id;
  await expect.poll(async () => (await read<PaymentRecord>(f.payer.api, `/payments/${paymentId}`)).state, { timeout: 40_000 }).toBe('SETTLED');
  let delivery: WebhookDelivery | undefined;
  await expect.poll(async () => {
    const page = await read<ApiPage<WebhookDelivery>>(f.payer.api, `/webhook-endpoints/${ep}/deliveries?limit=50&offset=0`);
    delivery = page.items.find(value => value.eventType === 'payment.settled'); return Boolean(delivery);
  }, { timeout: 30_000 }).toBe(true);
  return { ...f, ep, paymentId, delivery: delivery! };
}
function money(paymentId: string): string {
  return sql(`SELECT json_build_object('state',p.state,'journal',p.journal_id,'refunded',p.refunded_minor,'reversed',p.reversed,
    'source',(SELECT json_build_array(posted_minor,reserved_minor) FROM ledger.account_balances WHERE account_id=p.source_id),
    'destination',(SELECT json_build_array(posted_minor,reserved_minor) FROM ledger.account_balances WHERE account_id=p.destination_id),
    'entries',(SELECT count(*) FROM ledger.journal_entries WHERE journal_id=p.journal_id),
    'adjustments',(SELECT count(*) FROM ledger.adjustments WHERE payment_id=p.id)) FROM ledger.payments p WHERE p.id='${paymentId}';`);
}
async function deliveryState(actor: Actor, id: string, state: string, cycle?: number): Promise<void> {
  await expect.poll(async () => {
    const record = (await read<WebhookDeliveryDetail>(actor.api, `/webhook-deliveries/${id}`)).delivery;
    return cycle === undefined ? record.state : `${record.state}:${record.cycle}`;
  }, { timeout: 40_000, intervals: [200, 400, 800] }).toBe(cycle === undefined ? state : `${state}:${cycle}`);
}

test('P08EE2E01-create-one-time-secret-and-responsive-subscriptions', async ({ page, lab }, info) => {
  const actor = await lab.actor(); await signIn(page, actor); await open(page); await createInUi(page);
  await noPersistentSecret(page);
  await page.getByRole('button', { name: 'Dismiss signing secret' }).click();
  await expect(page.getByTestId('webhook-signing-secret')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Webhook command confirmed' })).toBeFocused();
  await accessible(page); await screenshot(page, info, 'p08e-subscriptions');
  const list = await read<ApiPage<WebhookEndpoint>>(actor.api, '/webhook-endpoints?limit=50&offset=0');
  expect(list.items).toHaveLength(1);
  const first = list.items[0];
  if (!first) throw new Error('The created subscription is missing from its owner list');
  const record = await read<Record<string, unknown>>(actor.api, `/webhook-endpoints/${first.id}`);
  expect('signingSecret' in record || 'encryptedSecret' in record).toBe(false);
  await page.getByRole('link', { name: 'View confirmed record' }).click();
  await expect(page.getByTestId('webhook-version')).toHaveText('1'); await accessible(page);
});

test('P08EE2E02-committed-creation-loss-reloads-and-replays-once', async ({ page, lab }, info) => {
  const actor = await lab.actor(); await signIn(page, actor); await open(page);
  const dropped = await dropCommitted(page, 'CREATE');
  await page.getByRole('button', { name: 'New subscription', exact: true }).click(); await confirm(page, 'Create subscription');
  await expect(page.getByRole('heading', { name: 'Webhook outcome not yet confirmed', exact: true })).toBeVisible();
  const original = await saved(page, actor); expect(original.command).toEqual({ kind: 'CREATE' }); expect(dropped()).toBe(1);
  await page.reload(); await expect(page.getByRole('button', { name: 'Retry preserved command' })).toBeEnabled();
  expect(await saved(page, actor)).toEqual(original); await accessible(page); await screenshot(page, info, 'p08e-recovery');
  await page.getByRole('button', { name: 'Retry preserved command' }).click();
  await expect(page.getByText('The one-time secret response is unavailable.', { exact: true })).toBeVisible();
  await expect(page.getByTestId('webhook-signing-secret')).toHaveCount(0);
  expect(sql(`SELECT count(*) FROM ledger.webhook_commands WHERE owner_id='${actor.id}' AND command_id='${original.key}';`)).toBe('1');
  expect(sql(`SELECT count(*) FROM ledger.webhook_audit WHERE actor_id='${actor.id}' AND action='ENDPOINT_CREATED';`)).toBe('1');
  expect(await saved(page, actor)).toBeNull();
});

test('P08EE2E03-lost-rotation-reauthenticates-without-a-second-rotation', async ({ page, lab }) => {
  const actor = await lab.actor(), ep = await endpoint(actor); await signIn(page, actor); await page.goto(`/webhooks/${ep}`);
  await expect(page.getByTestId('webhook-version')).toHaveText('1'); await dropCommitted(page, 'ROTATE');
  await page.getByRole('button', { name: 'Rotate signing secret', exact: true }).click(); await confirm(page, 'Rotate signing secret');
  await expect(page.getByRole('button', { name: 'Check command outcome' })).toBeVisible(); const original = await saved(page, actor);
  // Revoke the actual browser session via the protected API; preserve its saved command.
  expect((await command(page.request, '/auth/logout', {})).status()).toBe(204);
  await page.getByRole('button', { name: 'Check command outcome' }).click();
  await page.getByRole('button', { name: 'Continue to sign in' }).click();
  await signIn(page, actor); await open(page); expect((await saved(page, actor)).key).toBe(original.key);
  await page.getByRole('button', { name: 'Check command outcome' }).click();
  await expect(page.getByText('The one-time secret response is unavailable.', { exact: true })).toBeVisible();
  expect(sql(`SELECT count(*) FROM ledger.webhook_audit WHERE endpoint_id='${ep}' AND action='SECRET_ROTATED';`)).toBe('1');
  await page.getByRole('link', { name: 'View confirmed record' }).click();
  await expect(page.getByTestId('webhook-version')).toHaveText('2');
  await page.getByRole('button', { name: 'Rotate signing secret', exact: true }).click(); await confirm(page, 'Rotate signing secret');
  await expect(page.getByTestId('webhook-signing-secret')).toBeVisible(); await noPersistentSecret(page);
  await page.getByRole('link', { name: 'All subscriptions', exact: true }).click();
  await expect(page.getByTestId('webhook-signing-secret')).toHaveCount(0);
  expect(sql(`SELECT count(*) FROM ledger.webhook_audit WHERE endpoint_id='${ep}' AND action='SECRET_ROTATED';`)).toBe('2');
});

test('P08EE2E04-version-race-remains-explicit-and-keyboard-focus-restores', async ({ page, lab }, info) => {
  const actor = await lab.actor(), ep = await endpoint(actor); await signIn(page, actor); await page.goto(`/webhooks/${ep}`);
  const control = page.getByRole('button', { name: 'Disable subscription', exact: true });
  await control.click(); await page.keyboard.press('Escape'); await expect(control).toBeFocused();
  await control.press('Enter'); await page.getByRole('dialog').getByRole('button', { name: 'Go back' }).click(); await expect(control).toBeFocused();
  await control.click(); await send(actor, { kind: 'STATE', endpointId: ep, enabled: false, expectedVersion: 1 });
  await confirm(page, 'Disable subscription');
  await expect(page.getByText('WEBHOOK_CONFLICT', { exact: true })).toBeVisible();
  await expect(page.getByTestId('webhook-version')).toHaveText('2');
  expect(sql(`SELECT count(*) FROM ledger.webhook_audit WHERE endpoint_id='${ep}' AND action='ENDPOINT_DISABLED';`)).toBe('1');
  await page.getByRole('button', { name: 'Enable subscription', exact: true }).click(); await confirm(page, 'Enable subscription');
  await expect(page.getByTestId('webhook-version')).toHaveText('3'); await accessible(page); await screenshot(page, info, 'p08e-subscription');
});

test('P08EE2E05-real-settlement-failed-delivery-audited-retry-and-financial-isolation', async ({ page, lab }, info) => {
  receiver('STATUS_400'); const f = await paymentFixture(lab);
  await deliveryState(f.payer, f.delivery.id, 'FAILED', 1); const before = money(f.paymentId);
  await signIn(page, f.payer); await page.goto(`/webhooks/deliveries/${f.delivery.id}`);
  await expect(page.getByText('Delivery failed', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cycle 1, attempt 1' })).toBeVisible();
  receiver('NORMAL'); await page.getByLabel('Retry reason', { exact: true }).fill('Sandbox receiver recovered');
  await page.getByRole('button', { name: 'Review delivery retry' }).click(); await confirm(page, 'Request delivery retry');
  await expect(page.getByRole('heading', { name: 'Retry request confirmed' })).toBeVisible();
  await deliveryState(f.payer, f.delivery.id, 'DELIVERED', 2);
  await expect(page.locator('.webhook-badge').filter({ hasText: /^Delivered$/ })).toBeVisible({ timeout: 30_000 });
  expect(money(f.paymentId)).toBe(before);
  expect(sql(`SELECT count(*) FROM ledger.webhook_audit WHERE delivery_id='${f.delivery.id}' AND action='MANUAL_RETRY_REQUESTED';`)).toBe('1');
  expect(sql(`SELECT count(*) FROM ledger.webhook_receiver_receipts WHERE endpoint_id='${f.ep}' AND event_id='${f.delivery.eventId}';`)).toBe('1');
  await accessible(page); await screenshot(page, info, 'p08e-delivery');
});

test('P08EE2E06-replaying-a-lost-retry-after-refailure-does-not-start-cycle-three', async ({ page, lab }) => {
  receiver('STATUS_400'); const f = await paymentFixture(lab); await deliveryState(f.payer, f.delivery.id, 'FAILED', 1);
  const before = money(f.paymentId); await signIn(page, f.payer); await page.goto(`/webhooks/deliveries/${f.delivery.id}`);
  await dropCommitted(page, 'RETRY'); await page.getByLabel('Retry reason', { exact: true }).fill('Inspect bounded retry');
  await page.getByRole('button', { name: 'Review delivery retry' }).click(); await confirm(page, 'Request delivery retry');
  await deliveryState(f.payer, f.delivery.id, 'FAILED', 2); await page.reload();
  await page.getByRole('button', { name: 'Retry preserved command' }).click();
  await expect(page.getByRole('heading', { name: 'Retry request confirmed' })).toBeVisible();
  await expect(page.getByTestId('webhook-cycle')).toHaveText('2');
  expect(sql(`SELECT cycle FROM ledger.webhook_deliveries WHERE id='${f.delivery.id}';`)).toBe('2');
  expect(sql(`SELECT count(*) FROM ledger.webhook_audit WHERE delivery_id='${f.delivery.id}' AND action='MANUAL_RETRY_REQUESTED';`)).toBe('1');
  expect(money(f.paymentId)).toBe(before);
});

test('P08EE2E07-owner-authorization-csrf-and-ordinary-secret-nondisclosure', async ({ page, lab }) => {
  const owner = await lab.actor(), stranger = await lab.actor(), admin = await lab.actor(true), key = randomUUID();
  const created = await send(owner, { kind: 'CREATE' }, key), ep = created.command.endpointId;
  const secret = created.signingSecret; expect(typeof secret === 'string').toBe(true);
  for (const path of [`/webhook-endpoints/${ep}`, `/webhook-endpoints/${ep}/deliveries`, `/webhook-commands/${key}`]) {
    expect((await stranger.api.get(`/api/v1${path}`)).status()).toBe(404);
    const response = await owner.api.get(`/api/v1${path}`); expect(response.status()).toBe(200);
    expect((await response.text()).includes(secret!)).toBe(false);
  }
  expect((await command(stranger.api, '/webhook-commands', { kind: 'ROTATE', endpointId: ep, expectedVersion: 1 })).status()).toBe(404);
  expect((await command(admin.api, '/webhook-commands', { kind: 'CREATE' })).status()).toBe(403);
  expect((await owner.api.post('/api/v1/webhook-commands', { data: { kind: 'CREATE' }, headers: { 'Idempotency-Key': randomUUID() } })).status()).toBe(403);
  expect(sql(`SELECT has_table_privilege('ledger_runtime','ledger.webhook_commands','INSERT') OR has_table_privilege('ledger_runtime','ledger.webhook_commands','UPDATE') OR has_table_privilege('ledger_runtime','ledger.webhook_commands','DELETE');`)).toBe('f');
  await signIn(page, stranger); await page.goto(`/webhooks/${ep}`);
  await expect(page.getByText('NOT_FOUND', { exact: true })).toBeVisible();
  await expect(page.getByTestId('webhook-version')).toHaveCount(0); await accessible(page);
});

test('P08EE2E08-concurrent-command-dedup-conflict-and-immutable-receipt', async ({ lab }) => {
  const actor = await lab.actor(), key = randomUUID(), token = await csrf(actor.api);
  const responses = await Promise.all(Array.from({ length: 6 }, () => actor.api.post('/api/v1/webhook-commands', {
    data: { kind: 'CREATE' }, headers: { [token.headerName]: token.token, 'Idempotency-Key': key }
  })));
  for (const response of responses) expect(response.status()).toBe(200);
  const values = await Promise.all(responses.map(response => response.json() as Promise<WebhookCommandResult>));
  expect(new Set(values.map(value => value.command.endpointId)).size).toBe(1);
  expect(values.filter(value => typeof value.signingSecret === 'string').length).toBe(1);
  expect(values.filter(value => value.command.replayed === false).length).toBe(1);
  const first = values[0];
  if (!first) throw new Error('Concurrent commands returned no receipts');
  const ep = first.command.endpointId;
  expect((await command(actor.api, '/webhook-commands', { kind: 'STATE', endpointId: ep, expectedVersion: 1, enabled: false }, key)).status()).toBe(409);
  expect(sql(`SELECT count(*) FROM ledger.webhook_commands WHERE owner_id='${actor.id}';`)).toBe('1');
  expect(sql(`SELECT count(*) FROM ledger.webhook_audit WHERE actor_id='${actor.id}' AND action='ENDPOINT_CREATED';`)).toBe('1');
  expect(sql(`SELECT enabled FROM ledger.webhook_endpoints WHERE id='${ep}';`)).toBe('t');
  expect(() => sql(`UPDATE ledger.webhook_commands SET receipt='{}'::jsonb WHERE owner_id='${actor.id}' AND command_id='${key}';`)).toThrow();
  expect(() => sql(`DELETE FROM ledger.webhook_commands WHERE owner_id='${actor.id}' AND command_id='${key}';`)).toThrow();
});

test('P08EE2E09-real-event-pagination-keeps-financial-identities', async ({ page, lab }) => {
  receiver('NORMAL'); const f = await funded(lab), ep = await endpoint(f.payer);
  for (let index = 0; index < 21; index++) {
    const response = await command(f.payer.api, '/transfers', { sourceId: f.source.id, recipientRef: f.destination.publicRef, amountMinor: '1', currency: 'CAD' });
    expect(response.status()).toBe(201);
  }
  await expect.poll(async () => (await read<ApiPage<WebhookDelivery>>(f.payer.api, `/webhook-endpoints/${ep}/deliveries?limit=50&offset=0`)).items.length, { timeout: 30_000 }).toBe(21);
  await signIn(page, f.payer); await page.goto(`/webhooks/${ep}`);
  await expect(page.getByRole('link', { name: 'Inspect delivery', exact: true })).toHaveCount(20);
  await page.getByRole('button', { name: 'Next delivery page' }).click();
  await expect(page.getByRole('link', { name: 'Inspect delivery', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Next delivery page' })).toBeDisabled();
  await page.getByRole('button', { name: 'Previous delivery page' }).click();
  await expect(page.getByRole('link', { name: 'Inspect delivery', exact: true })).toHaveCount(20);
  expect(sql(`SELECT count(DISTINCT event_id) FROM ledger.webhook_deliveries WHERE endpoint_id='${ep}';`)).toBe('21');
  expect(sql(`SELECT posted_minor FROM ledger.account_balances WHERE account_id='${f.source.id}';`)).toBe('9979');
  await accessible(page);
});

test('P08EE2E10-unavailable-service-is-not-an-empty-or-successful-list', async ({ page, lab }) => {
  const actor = await lab.actor(); await signIn(page, actor);
  await page.route('**/api/v1/webhook-endpoints?*', route => route.fulfill({ status: 503, contentType: 'application/problem+json', body: JSON.stringify({ code: 'DEPENDENCY_UNAVAILABLE', message: 'Scoped response fault' }) }));
  await open(page); await expect(page.getByText('DEPENDENCY_UNAVAILABLE', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New subscription', exact: true })).toBeDisabled();
  await expect(page.getByRole('heading', { name: 'No subscriptions on this page' })).toHaveCount(0);
  await page.unroute('**/api/v1/webhook-endpoints?*'); await page.getByRole('button', { name: 'Refresh records' }).click();
  await expect(page.getByRole('heading', { name: 'No subscriptions on this page' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New subscription', exact: true })).toBeEnabled(); await accessible(page);
});
