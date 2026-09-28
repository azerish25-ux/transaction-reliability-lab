import { test, expect, signIn, accessible, screenshot, reviewRefund, confirmRefund, command, read, ledgerOracle } from './p08c-fixtures.js';
import type { PaymentAdjustment, PaymentAdjustmentContext, Page as ApiPage } from '../../src/api.js';

const pageErrors = new WeakMap<import('@playwright/test').Page, string[]>();
test.beforeEach(async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  // Runtime JavaScript faults are never waived, including during deliberate transport failures.
  pageErrors.set(page, errors);
});

test.afterEach(async ({ page }) => { expect(pageErrors.get(page) ?? []).toEqual([]); });

test('P08CE2E01 recipient partial then remaining refund preserves settlement and accessible receipts', async ({ page, lab }, info) => {
  const f = await lab.settled(); await signIn(page, f.recipient); await page.goto(`/payments/${f.payment.id}`);
  await expect(page.getByRole('heading', { name: 'Refunds and adjustments' })).toBeVisible();
  const navigation = page.getByRole('navigation', { name: 'Primary navigation' });
  for (const name of ['Dashboard', 'Transfer', 'Payments']) await expect(navigation.getByRole('link', { name, exact: true })).toBeVisible();
  await reviewRefund(page, '10.00'); const dialog = page.getByRole('dialog', { name: 'Confirm refund', exact: true });
  await expect(dialog.getByRole('button', { name: 'Go back' })).toBeFocused();
  await page.keyboard.press('Tab'); await expect(dialog.getByRole('button', { name: 'Confirm refund', exact: true })).toBeFocused();
  await accessible(page); await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Review refund', exact: true })).toBeFocused();
  await screenshot(page, info, 'refund'); await accessible(page);
  await page.getByRole('button', { name: 'Review refund', exact: true }).click(); await confirmRefund(page);
  await expect(page.getByRole('heading', { name: 'Adjustment receipt', exact: true })).toBeFocused();
  await expect(page.getByText('Partially refunded', { exact: true })).toBeVisible();
  await expect(page.getByText(f.payment.journalId!, { exact: true })).toBeVisible();
  ledgerOracle(f, '1000', 1); await screenshot(page, info, 'adjustment-receipt'); await accessible(page);
  await page.getByRole('link', { name: 'Back to payment details' }).click();
  await page.getByRole('button', { name: 'Refund remaining amount' }).click(); await expect(page.getByLabel(/^Refund amount/)).toHaveValue('15.00');
  await page.getByRole('button', { name: 'Review refund', exact: true }).click(); await confirmRefund(page);
  await expect(page.getByText('Fully refunded', { exact: true })).toBeVisible(); ledgerOracle(f, '2500', 2);
  await page.getByRole('link', { name: 'Back to payment details' }).click();
  await expect(page.getByRole('button', { name: 'Review refund', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /^View refund receipt/ })).toHaveCount(2);
});

test('P08CE2E02 full KWD refund rejects rounding and posts exactly 1234 minor units', async ({ page, lab }) => {
  const f = await lab.settled('1234', 'KWD'); await signIn(page, f.recipient); await page.goto(`/payments/${f.payment.id}`);
  for (const invalid of ['0', '1.2341', '1e0', '1.235']) {
    await page.getByLabel(/^Refund amount/).fill(invalid); await page.getByRole('button', { name: 'Review refund', exact: true }).click();
    await expect(page.getByLabel(/^Refund amount/)).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('dialog', { name: 'Confirm refund', exact: true })).not.toBeVisible();
  }
  await accessible(page); await page.getByRole('button', { name: 'Refund remaining amount' }).click();
  await expect(page.getByLabel(/^Refund amount/)).toHaveValue('1.234');
  await page.getByRole('button', { name: 'Review refund', exact: true }).click(); await confirmRefund(page);
  await expect(page.getByText('Fully refunded', { exact: true })).toBeVisible(); ledgerOracle(f, '1234', 1);
});

test('P08CE2E03 lost committed refund survives reload and expired authentication with the same key', async ({ page, lab }) => {
  const f = await lab.settled(); await signIn(page, f.recipient); await page.goto(`/payments/${f.payment.id}`);
  const keys: string[] = []; let dropped = false;
  await page.route(`**/api/v1/payments/${f.payment.id}/refunds`, async route => {
    keys.push(route.request().headers()['idempotency-key']!);
    if (!dropped) { dropped = true; const committed = await route.fetch(); expect(committed.status()).toBe(201); await route.abort('failed'); }
    else await route.continue();
  });
  await reviewRefund(page, '10.00'); await confirmRefund(page);
  await expect(page.getByRole('button', { name: 'Retry same refund' })).toBeVisible(); ledgerOracle(f, '1000', 1);
  await page.reload(); await expect(page.getByRole('button', { name: 'Retry same refund' })).toBeVisible();
  await page.goto('/transfers/new'); await expect(page.getByRole('link', { name: 'Resolve safely' }).first()).toBeVisible();
  await page.getByRole('link', { name: 'Resolve safely' }).first().click();
  await expect(page.getByRole('heading', { name: 'Payment details', exact: true })).toBeVisible();
  // Finish the observable authoritative read before revocation; a pending GET may otherwise
  // correctly expire the UI before the intended POST admission-boundary assertion.
  await expect(page.getByRole('button', { name: 'Refresh adjustments', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Retry same refund', exact: true })).toBeVisible();
  // Revoke the real browser session without erasing its preserved economic intent.
  const logout = await command(page.request, '/auth/logout', {}); expect(logout.status()).toBe(204);
  const denied = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith(`/payments/${f.payment.id}/refunds`) && r.status() === 401, { timeout: 15_000 });
  await page.getByRole('button', { name: 'Retry same refund' }).click({ timeout: 10_000 });
  expect((await denied).status()).toBe(401);
  await expect(page.getByRole('dialog', { name: 'Your session ended' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue to sign in' }).click();
  await signIn(page, f.recipient); await page.getByRole('link', { name: 'Resolve safely' }).first().click();
  await expect(page).toHaveURL(new RegExp(`/payments/${f.payment.id}$`));
  await expect(page.getByRole('heading', { name: 'Payment details', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh adjustments', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Retry same refund', exact: true })).toBeVisible();
  const replay = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith(`/payments/${f.payment.id}/refunds`) && r.status() === 201, { timeout: 15_000 });
  await page.getByRole('button', { name: 'Retry same refund' }).click({ timeout: 10_000 }); expect((await replay).headers()['idempotency-replayed']).toBe('true');
  await expect(page.getByText('Recovered by safe replay.')).toBeVisible();
  expect(keys.length).toBeGreaterThanOrEqual(3); expect(new Set(keys).size).toBe(1); ledgerOracle(f, '1000', 1);
});

test('P08CE2E04 administrator full reversal requires reason and blocks later adjustments', async ({ page, lab }, info) => {
  const f = await lab.settled(), admin = await lab.actor(true); await signIn(page, admin);
  await expect(page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Adjustments', exact: true })).toBeVisible();
  await page.getByLabel('Payment ID', { exact: true }).fill(f.payment.id); await page.getByRole('button', { name: 'Inspect payment' }).click();
  await page.getByRole('button', { name: 'Review full reversal' }).click();
  await expect(page.getByLabel('Reversal reason (required)')).toHaveAttribute('aria-invalid', 'true'); await accessible(page);
  await page.getByLabel('Reversal reason (required)').fill('  Authorized duplicate-payment correction  ');
  await expect(page.getByLabel('Reversal reason (required)')).toHaveAttribute('aria-invalid', 'false');
  await screenshot(page, info, 'reversal'); await page.getByRole('button', { name: 'Review full reversal' }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirm full reversal', exact: true }); await accessible(page);
  await dialog.getByRole('button', { name: 'Confirm full reversal', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Adjustment receipt' })).toBeVisible(); await expect(page.getByText('Reversed', { exact: true })).toBeVisible();
  await expect(page.getByText('Authorized duplicate-payment correction', { exact: true })).toBeVisible(); ledgerOracle(f, '2500', 1, true); await accessible(page);
  expect((await command(f.recipient.api, `/payments/${f.payment.id}/refunds`, { amountMinor: '1' })).status()).toBe(409);
  expect((await command(admin.api, `/payments/${f.payment.id}/reversal`, { reason: 'Second reversal denied' })).status()).toBe(409);
  ledgerOracle(f, '2500', 1, true);
});

test('P08CE2E05 lost reversal reload recovers the original adjustment and journal', async ({ page, lab }) => {
  const f = await lab.settled(), admin = await lab.actor(true); await signIn(page, admin); await page.goto(`/admin/payments/${f.payment.id}/reversal`);
  const keys: string[] = []; let dropped = false;
  await page.route(`**/api/v1/payments/${f.payment.id}/reversal`, async route => {
    keys.push(route.request().headers()['idempotency-key']!);
    if (!dropped) { dropped = true; const response = await route.fetch(); expect(response.status()).toBe(201); await route.abort('failed'); } else await route.continue();
  });
  await page.getByLabel('Reversal reason (required)').fill('Replayed administrative correction'); await page.getByRole('button', { name: 'Review full reversal' }).click();
  await page.getByRole('dialog', { name: 'Confirm full reversal', exact: true }).getByRole('button', { name: 'Confirm full reversal', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry same reversal' })).toBeVisible(); await page.reload();
  await page.getByRole('button', { name: 'Retry same reversal' }).click(); await expect(page.getByText('Recovered by safe replay.')).toBeVisible();
  expect(keys).toHaveLength(2); expect(new Set(keys).size).toBe(1); ledgerOracle(f, '2500', 1, true);
});

test('P08CE2E06 payer and outsider cannot gain recipient or administrator authority', async ({ page, lab }) => {
  const f = await lab.settled(), outsider = await lab.actor(); await signIn(page, f.payer); await page.goto(`/payments/${f.payment.id}`);
  await expect(page.getByText(/Only the original recipient owner can refund/)).toBeVisible();
  await expect(page.getByLabel(/^Refund amount/)).toHaveCount(0);
  const context = await read<PaymentAdjustmentContext>(f.payer.api, `/payments/${f.payment.id}/adjustment-context`);
  expect(context.recipientAvailableMinor).toBeNull(); expect(context.recipientBalanceVersion).toBeNull();
  expect((await command(f.payer.api, `/payments/${f.payment.id}/refunds`, { amountMinor: '1' })).status()).toBe(403);
  expect((await outsider.api.get(`/api/v1/payments/${f.payment.id}/adjustment-context`)).status()).toBe(404);
  expect((await f.payer.api.get(`/api/v1/admin/payments/${f.payment.id}/adjustment-context`)).status()).toBe(403);
  await page.goto(`/admin/payments/${f.payment.id}/reversal`); await expect(page.getByRole('heading', { name: 'Administrator access required' })).toBeVisible(); await accessible(page);
  ledgerOracle(f, '0', 0);
});

test('P08CE2E07 any prior refund forbids administrative full reversal', async ({ page, lab }) => {
  const f = await lab.settled(), admin = await lab.actor(true);
  expect((await command(f.recipient.api, `/payments/${f.payment.id}/refunds`, { amountMinor: '100' })).status()).toBe(201);
  await signIn(page, admin); await page.goto(`/admin/payments/${f.payment.id}/reversal`);
  await expect(page.getByText('A full reversal is forbidden after any successful refund.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review full reversal' })).toHaveCount(0);
  expect((await command(admin.api, `/payments/${f.payment.id}/reversal`, { reason: 'Forbidden after refund' })).status()).toBe(409);
  ledgerOracle(f, '100', 1); await accessible(page);
});

test('P08CE2E08 stale and simultaneous refunds cannot exceed the original settlement', async ({ page, lab }) => {
  const f = await lab.settled(); await signIn(page, f.recipient); await page.goto(`/payments/${f.payment.id}`); await reviewRefund(page, '15.00');
  expect((await command(f.recipient.api, `/payments/${f.payment.id}/refunds`, { amountMinor: '1500' })).status()).toBe(201);
  await confirmRefund(page); await expect(page.getByText('EXCESS_REFUND', { exact: true })).toBeVisible();
  await expect(page.locator('.adjustment-totals').getByText('CAD 10.00', { exact: true })).toBeVisible();
  const competing = await Promise.all([
    command(f.recipient.api, `/payments/${f.payment.id}/refunds`, { amountMinor: '700' }),
    command(f.recipient.api, `/payments/${f.payment.id}/refunds`, { amountMinor: '700' })
  ]);
  expect(competing.map(r => r.status()).sort()).toEqual([201, 422]); ledgerOracle(f, '2200', 2);
  await page.getByRole('button', { name: 'Refresh adjustments' }).click();
  await expect(page.locator('.adjustment-totals').getByText('CAD 3.00', { exact: true })).toBeVisible();
});

test('P08CE2E09 recipient spending after confirmation review causes a controlled funds rejection', async ({ page, lab }) => {
  const f = await lab.settled(), extra = await lab.wallet(f.payer); await signIn(page, f.recipient); await page.goto(`/payments/${f.payment.id}`);
  await reviewRefund(page, '25.00');
  const spent = await command(f.recipient.api, '/transfers', { sourceId: f.destination.id, recipientRef: extra.publicRef, amountMinor: '2500', currency: 'CAD' }); expect(spent.status()).toBe(201);
  await confirmRefund(page); await expect(page.getByText('INSUFFICIENT_FUNDS', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review refund', exact: true })).toHaveCount(0); ledgerOracle(f, '0', 0); await accessible(page);
});

test('P08CE2E10 paged history uses authoritative totals and failed reads never imply failed money', async ({ page, lab }) => {
  const f = await lab.settled(); let adjustment: PaymentAdjustment | undefined;
  for (let n = 0; n < 11; n++) { const response = await command(f.recipient.api, `/payments/${f.payment.id}/refunds`, { amountMinor: '1', reason: `P08C history ${n}` }); expect(response.status()).toBe(201); adjustment = await response.json(); }
  await signIn(page, f.recipient); await page.goto(`/payments/${f.payment.id}`);
  await expect(page.getByRole('link', { name: /^View refund receipt/ })).toHaveCount(10);
  await expect(page.locator('.adjustment-totals').getByText('CAD 24.89', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next adjustments' }).click(); await expect(page.getByRole('link', { name: /^View refund receipt/ })).toHaveCount(1);
  await expect(page.locator('.adjustment-totals').getByText('CAD 24.89', { exact: true })).toBeVisible();
  const pattern = `**/api/v1/payments/${f.payment.id}/adjustment-context`;
  await page.route(pattern, route => route.abort('failed')); await page.getByRole('button', { name: 'Refresh adjustments' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Request could not be completed' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review refund', exact: true })).toBeDisabled();
  await page.unroute(pattern); await page.getByRole('button', { name: 'Refresh adjustments' }).click();
  await expect(page.getByRole('button', { name: 'Review refund', exact: true })).toBeEnabled(); ledgerOracle(f, '11', 11);
  const outsider = await lab.actor(); expect((await outsider.api.get(`/api/v1/payments/${f.payment.id}/adjustments/${adjustment!.id}`)).status()).toBe(404);
  const items = await read<ApiPage<PaymentAdjustment>>(f.recipient.api, `/payments/${f.payment.id}/adjustments?limit=100&offset=0`); expect(items.items).toHaveLength(11);
  await accessible(page);
});
