import { test, expect, type Page as BrowserPage, type TestInfo } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import path from 'node:path';
import type { Account, Page as ApiPage } from '../../src/api.js';
import { formatMoney, shortReference } from '../../src/format.js';

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

interface BrowserError {
  text: string;
  url: string;
}

function collectBrowserErrors(page: BrowserPage): BrowserError[] {
  const errors: BrowserError[] = [];
  page.on('console', message => {
    if (message.type() === 'error') errors.push({ text: message.text(), url: message.location().url });
  });
  page.on('pageerror', failure => errors.push({ text: failure.message, url: '' }));
  return errors;
}

function unexpectedBrowserErrors(errors: BrowserError[], allowExpiredSession = false): BrowserError[] {
  return errors.filter(error => {
    const unauthorized = error.text.includes('status of 401');
    const pathname = (() => {
      try { return new URL(error.url).pathname; } catch { return ''; }
    })();
    if (unauthorized && pathname === '/api/v1/auth/me') return false;
    if (allowExpiredSession && unauthorized && pathname.startsWith('/api/v1/')) return false;
    return true;
  });
}

async function signIn(page: BrowserPage): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.getByLabel('Email address').fill('alice@example.test');
  await page.getByLabel('Password').fill(demoPassword);
  await page.getByRole('button', { name: 'Sign in securely' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome, Alice' })).toBeVisible();
}

async function registerCustomer(page: BrowserPage, testInfo: TestInfo, purpose: string): Promise<{ name: string; email: string; password: string }> {
  const project = testInfo.project.name.replaceAll(/[^a-z]/g, '');
  const stamp = `${Date.now()}-${project}-${testInfo.retry}-${purpose}`;
  const name = `P08A ${purpose} ${stamp.slice(-14)}`;
  const email = `p08a-${purpose}-${stamp}@example.test`.toLowerCase();
  const password = `P08A-${stamp}-Safe!`;

  await page.goto('/register');
  await page.getByLabel('Display name').fill(name);
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Create customer' }).click();
  await expect(page.getByRole('heading', { name: `Welcome, ${name}` })).toBeVisible();
  return { name, email, password };
}

async function expectAccessible(page: BrowserPage): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(result.violations, JSON.stringify(result.violations, null, 2)).toEqual([]);
}

test('P08AE2E01 customer authentication, balances, history and safe detail', async ({ page }, testInfo) => {
  const browserErrors = collectBrowserErrors(page);
  const accountsResponsePromise = page.waitForResponse(response => {
    const url = new URL(response.url());
    return response.request().method() === 'GET' && url.pathname === '/api/v1/accounts' && response.ok();
  });

  await signIn(page);
  const accountsResponse = await accountsResponsePromise;
  const accountPage = await accountsResponse.json() as ApiPage<Account>;
  const primaryAccount = accountPage.items.find(account => account.name === 'Alice CAD primary');
  expect(primaryAccount, 'Alice CAD primary must be returned by the authoritative account API').toBeDefined();
  if (!primaryAccount) throw new Error('Alice CAD primary was not returned');

  expect(BigInt(primaryAccount.availableMinor)).toBe(BigInt(primaryAccount.postedMinor) - BigInt(primaryAccount.reservedMinor));
  await expect(page.getByText('Synthetic money laboratory.')).toBeVisible();

  const primary = page.getByRole('article', { name: primaryAccount.name });
  await expect(primary).toBeVisible();
  const displayedBalances = [primaryAccount.availableMinor, primaryAccount.postedMinor, primaryAccount.reservedMinor]
    .map(amount => formatMoney(amount, primaryAccount.currency));
  for (const value of new Set(displayedBalances)) {
    await expect(primary.getByText(value, { exact: true })).toHaveCount(displayedBalances.filter(candidate => candidate === value).length);
  }
  await expect(primary.getByText(shortReference(primaryAccount.publicRef), { exact: true })).toBeVisible();

  const screenshotDirectory = path.resolve(process.cwd(), '../.evidence/playwright/screenshots');
  fs.mkdirSync(screenshotDirectory, { recursive: true });
  await page.screenshot({ path: path.join(screenshotDirectory, `${testInfo.project.name}-dashboard.png`), fullPage: true });
  await expectAccessible(page);

  await primary.getByRole('link', { name: 'View account activity' }).click();
  await expect(page.getByRole('heading', { name: primaryAccount.name })).toBeVisible();
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
  expect(unexpectedBrowserErrors(browserErrors)).toEqual([]);
});

test('P08AE2E02 registration begins empty and creates a zero-balance wallet', async ({ page }, testInfo) => {
  const browserErrors = collectBrowserErrors(page);
  await registerCustomer(page, testInfo, 'registration');
  await expect(page.getByRole('heading', { name: 'No wallets yet' })).toBeVisible();

  await page.getByLabel('Account name').fill('Everyday CAD');
  await page.getByLabel('Currency').selectOption('CAD');
  await page.getByRole('button', { name: 'Open wallet' }).click();
  const wallet = page.getByRole('article', { name: 'Everyday CAD' });
  await expect(wallet).toBeVisible();
  await expect(wallet.getByText('CAD 0.00')).toHaveCount(3);
  await expect(page.getByText('Everyday CAD opened with a zero balance.')).toBeVisible();
  await expectAccessible(page);
  expect(unexpectedBrowserErrors(browserErrors)).toEqual([]);
});

test('P08AE2E03 expired session is not treated as authenticated', async ({ page }, testInfo) => {
  const browserErrors = collectBrowserErrors(page);
  await registerCustomer(page, testInfo, 'expiry');
  await page.context().clearCookies();
  await page.getByRole('button', { name: 'Refresh balances' }).click();
  const dialog = page.getByRole('dialog', { name: 'Your session ended' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Continue to sign in' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Continue to sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  expect(unexpectedBrowserErrors(browserErrors, true)).toEqual([]);
});

test('P08AE2E04 dependency failure is explicit and never fabricates balances', async ({ page }, testInfo) => {
  await page.route('**/api/v1/accounts?**', route => route.fulfill({ status: 503, contentType: 'application/problem+json', body: JSON.stringify({ code: 'DEPENDENCY_UNAVAILABLE', title: 'Service temporarily unavailable', correlationId: '50000000-0000-0000-0000-000000000001', validation: {} }) }));
  await registerCustomer(page, testInfo, 'dependency');
  await expect(page.getByRole('heading', { name: 'Service temporarily unavailable' })).toBeVisible();
  await expect(page.getByText('A required service is temporarily unavailable. No financial result should be inferred from this screen.')).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(0);
});
