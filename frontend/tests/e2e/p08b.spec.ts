import { test, expect, type Page as BrowserPage, type TestInfo } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function runtimeEnvironment(): Record<string, string> {
  const file = path.resolve(process.cwd(), '../.ledgerguard/runtime.env');
  if (!fs.existsSync(file)) throw new Error(`Missing runtime environment: ${file}`);
  return Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(line => line && !line.startsWith('#') && line.includes('=')).map(line => {
    const separator = line.indexOf('=');
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
}

const runtime = runtimeEnvironment();
const demoPassword: string = runtime.LEDGER_DEMO_PASSWORD ?? (() => { throw new Error('LEDGER_DEMO_PASSWORD is missing'); })();

const ALICE_CAD = '10000000-0000-0000-0000-000000000001';
const BOB_CAD = '20000000-0000-0000-0000-000000000001';
const MERCHANT_CAD = '30000000-0000-0000-0000-000000000001';
const BOB_REF = 'LG-20000000000000000000000000000001';
const MERCHANT_REF = 'LG-30000000000000000000000000000001';

async function signInAs(page: BrowserPage, email: string, displayName: string): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(demoPassword);
  await page.getByRole('button', { name: 'Sign in securely' }).click();
  await expect(page.getByRole('heading', { name: `Welcome, ${displayName}` })).toBeVisible();
}

async function expectAccessible(page: BrowserPage): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(result.violations, JSON.stringify(result.violations, null, 2)).toEqual([]);
}

async function submitTransfer(page: BrowserPage, amount: string): Promise<void> {
  await page.getByLabel('Source wallet').selectOption(ALICE_CAD);
  await page.getByLabel('Recipient reference').fill(BOB_REF);
  await page.getByLabel(/^Amount/).fill(amount);
  await page.getByRole('button', { name: 'Review transfer' }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirm transfer' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Confirm and transfer' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Confirm and transfer' }).click();
}

async function submitPayment(page: BrowserPage, sourceId: string, recipientRef: string, amount: string): Promise<{ status: number; state: string; id: string }> {
  await page.getByLabel('Source wallet').selectOption(sourceId);
  await page.getByLabel('Recipient reference').fill(recipientRef);
  await page.getByLabel(/^Amount/).fill(amount);
  await page.getByRole('button', { name: 'Review payment' }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirm payment' });
  await expect(dialog).toBeVisible();
  const accepted = page.waitForResponse(response => {
    const url = new URL(response.url());
    return response.request().method() === 'POST' && url.pathname === '/api/v1/payments';
  });
  await dialog.getByRole('button', { name: 'Confirm payment' }).click();
  const response = await accepted;
  const body = await response.json() as { state: string; id: string };
  return { status: response.status(), state: body.state, id: body.id };
}

function composeWorkers(action: 'stop' | 'start'): void {
  const common = ['compose', '--env-file', '../.ledgerguard/runtime.env', '-f', '../compose.yaml'];
  const args = action === 'stop'
    ? [...common, 'stop', 'payment-worker-a', 'payment-worker-b']
    : [...common, 'up', '-d', '--no-deps', '--wait', 'payment-worker-a', 'payment-worker-b'];
  execFileSync('docker', args, { cwd: process.cwd(), stdio: 'pipe', timeout: 75_000 });
}

test('P08BE2E01 explicit transfer confirmation produces an authoritative settled receipt', async ({ page }, testInfo) => {
  await signInAs(page, 'alice@example.test', 'Alice');
  await page.goto('/transfers/new');
  await expect(page.getByRole('heading', { name: 'Make a transfer' })).toBeVisible();
  await submitTransfer(page, '0.01');

  await expect(page.getByRole('heading', { name: 'Transfer receipt' })).toBeVisible();
  await expect(page.getByText('Settled', { exact: true })).toBeVisible();
  await expect(page.getByText(BOB_REF, { exact: true })).toBeVisible();
  await expect(page.getByText('Scoped receipt')).toBeVisible();

  const screenshotDirectory = path.resolve(process.cwd(), '../.evidence/playwright/screenshots');
  fs.mkdirSync(screenshotDirectory, { recursive: true });
  await page.screenshot({ path: path.join(screenshotDirectory, `${testInfo.project.name}-transfer.png`), fullPage: true });
  await expectAccessible(page);
});

test('P08BE2E02 a lost transfer response is resolved with the same key and one economic effect', async ({ page }, testInfo) => {
  await signInAs(page, 'alice@example.test', 'Alice');
  await page.goto('/transfers/new');
  const amountByProject: Record<string, string> = {
    'chromium-desktop': '0.02',
    'chromium-tablet': '0.03',
    'chromium-mobile': '0.04'
  };
  const amount = amountByProject[testInfo.project.name] ?? '0.05';
  const expectedMinor = amount.replace('0.', '').replace(/^0+/, '') || '0';
  const startedAt = Date.now();
  let intercepted = false;
  await page.route('**/api/v1/transfers', async route => {
    if (!intercepted && route.request().method() === 'POST') {
      intercepted = true;
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      await route.abort('failed');
      return;
    }
    await route.continue();
  });

  await submitTransfer(page, amount);
  await expect(page.getByRole('heading', { name: 'Outcome not yet confirmed' }).last()).toBeVisible();
  await page.getByRole('button', { name: 'Retry same transfer' }).click();
  await expect(page.getByRole('heading', { name: 'Transfer receipt' })).toBeVisible();
  await expect(page.getByText('Recovered by safe replay.')).toBeVisible();

  const matching = await page.evaluate(async ({ recipientRef, amountMinor, threshold }) => {
    const response = await fetch('/api/v1/transfers?limit=100&offset=0', { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`Transfer history failed: ${response.status}`);
    const body = await response.json() as { items: Array<{ recipientRef: string; amountMinor: string; createdAt: string }> };
    return body.items.filter(item => item.recipientRef === recipientRef && item.amountMinor === amountMinor && Date.parse(item.createdAt) >= threshold).length;
  }, { recipientRef: BOB_REF, amountMinor: expectedMinor, threshold: startedAt - 1000 });
  expect(matching).toBe(1);
});

test('P08BE2E03 a durable pending payment reaches authoritative settlement', async ({ page }, testInfo) => {
  await signInAs(page, 'bob@example.test', 'Bob');
  await page.goto('/payments/new');
  await expect(page.getByRole('heading', { name: 'Create a payment' })).toBeVisible();
  const accepted = await submitPayment(page, BOB_CAD, MERCHANT_REF, '0.01');
  expect(accepted.status).toBe(202);
  expect(accepted.state).toBe('PENDING');

  await expect(page.getByRole('heading', { name: 'Payment details' })).toBeVisible();
  await expect(page.getByText('Settled', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(MERCHANT_REF, { exact: true })).toBeVisible();
  await expect(page.getByText('Settlement journal')).toBeVisible();

  const screenshotDirectory = path.resolve(process.cwd(), '../.evidence/playwright/screenshots');
  fs.mkdirSync(screenshotDirectory, { recursive: true });
  await page.screenshot({ path: path.join(screenshotDirectory, `${testInfo.project.name}-payment.png`), fullPage: true });
  await expectAccessible(page);
});

test('P08BE2E04 an outgoing pending payment can be cancelled without claiming a race it lost', async ({ page }) => {
  test.setTimeout(120_000);
  await signInAs(page, 'merchant@example.test', 'North Shore Books');
  composeWorkers('stop');
  try {
    await page.goto('/payments/new');
    const accepted = await submitPayment(page, MERCHANT_CAD, BOB_REF, '0.01');
    expect(accepted.status).toBe(202);
    expect(accepted.state).toBe('PENDING');
    await expect(page.getByRole('heading', { name: 'Payment details' })).toBeVisible();
    await expect(page.getByText('Pending', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Cancel pending payment' }).click();
    const dialog = page.getByRole('dialog', { name: 'Cancel pending payment' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Reason (optional)').fill('P08B verified customer cancellation');
    await dialog.getByRole('button', { name: 'Confirm cancellation' }).click();
    await expect(page.getByText('Cancelled', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Cancel pending payment' })).toHaveCount(0);
    await expectAccessible(page);
  } finally {
    composeWorkers('start');
  }
});
