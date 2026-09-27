import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
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
const demoPassword = runtime.LEDGER_DEMO_PASSWORD;
if (!demoPassword) throw new Error('LEDGER_DEMO_PASSWORD is missing');

async function expectNoConsoleErrors(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', failure => errors.push(failure.message));
  return errors;
}

async function signIn(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.getByLabel('Email address').fill('alice@example.test');
  await page.getByLabel('Password').fill(demoPassword);
  await page.getByRole('button', { name: 'Sign in securely' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome, Alice' })).toBeVisible();
}

async function expectAccessible(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(result.violations, JSON.stringify(result.violations, null, 2)).toEqual([]);
}

test('P08AE2E01 customer authentication, balances, history and safe detail', async ({ page }, testInfo) => {
  const consoleErrors = await expectNoConsoleErrors(page);
  await signIn(page);
  await expect(page.getByText('Synthetic money laboratory.')).toBeVisible();

  const primary = page.getByRole('article', { name: 'Alice CAD primary' });
  await expect(primary).toBeVisible();
  await expect(primary.getByText('CAD 100.00')).toHaveCount(2);
  await expect(primary.getByText('CAD 0.00')).toBeVisible();
  await expect(primary.getByText('LG-10000…00000001')).toBeVisible();

  const screenshotDirectory = path.resolve(process.cwd(), '../.evidence/playwright/screenshots');
  fs.mkdirSync(screenshotDirectory, { recursive: true });
  await page.screenshot({ path: path.join(screenshotDirectory, `${testInfo.project.name}-dashboard.png`), fullPage: true });
  await expectAccessible(page);

  await primary.getByRole('link', { name: 'View account activity' }).click();
  await expect(page.getByRole('heading', { name: 'Alice CAD primary' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Transaction history' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '+CAD 100.00' })).toBeVisible();
  await page.getByRole('link', { name: 'View Funding transaction details' }).first().click();

  await expect(page.getByRole('heading', { name: 'Funding' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Operation reference' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Customer-safe view' })).toBeVisible();
  await expect(page.getByText('f0000000-0000-0000-0000-000000000001')).toBeVisible();
  await expect(page.getByText('Synthetic CAD funding asset')).toHaveCount(0);
  await expect(page.getByText('North Shore Books CAD')).toHaveCount(0);
  await expectAccessible(page);
  expect(consoleErrors).toEqual([]);
});

test('P08AE2E02 registration begins empty and creates a zero-balance wallet', async ({ page }, testInfo) => {
  const consoleErrors = await expectNoConsoleErrors(page);
  const stamp = `${Date.now()}-${testInfo.project.name.replaceAll(/[^a-z]/g, '')}`;
  const name = `P08A Customer ${stamp.slice(-10)}`;
  const email = `p08a-${stamp}@example.test`;
  const password = `P08A-${stamp}-safe!`;

  await page.goto('/register');
  await page.getByLabel('Display name').fill(name);
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Create customer' }).click();
  await expect(page.getByRole('heading', { name: `Welcome, ${name}` })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No wallets yet' })).toBeVisible();

  await page.getByLabel('Account name').fill('Everyday CAD');
  await page.getByLabel('Currency').selectOption('CAD');
  await page.getByRole('button', { name: 'Open wallet' }).click();
  const wallet = page.getByRole('article', { name: 'Everyday CAD' });
  await expect(wallet).toBeVisible();
  await expect(wallet.getByText('CAD 0.00')).toHaveCount(3);
  await expect(page.getByText('Everyday CAD opened with a zero balance.')).toBeVisible();
  await expectAccessible(page);
  expect(consoleErrors).toEqual([]);
});

test('P08AE2E03 expired session is not treated as authenticated', async ({ page }) => {
  const consoleErrors = await expectNoConsoleErrors(page);
  await signIn(page);
  await page.context().clearCookies();
  await page.getByRole('button', { name: 'Refresh balances' }).click();
  const dialog = page.getByRole('dialog', { name: 'Your session ended' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Continue to sign in' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Continue to sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test('P08AE2E04 dependency failure is explicit and never fabricates balances', async ({ page }) => {
  await page.route('**/api/v1/accounts?**', route => route.fulfill({ status: 503, contentType: 'application/problem+json', body: JSON.stringify({ code: 'DEPENDENCY_UNAVAILABLE', title: 'Service temporarily unavailable', correlationId: '50000000-0000-0000-0000-000000000001', validation: {} }) }));
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Service temporarily unavailable' })).toBeVisible();
  await expect(page.getByText('A required service is temporarily unavailable. No financial result should be inferred from this screen.')).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(0);
});
