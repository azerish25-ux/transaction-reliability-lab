import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// These are explicitly synthetic HTTP fixtures for presentation/interaction
// regression. No evidence from this suite proves ledger or backend correctness.
const customer = { id: '10000000-0000-4000-8000-000000000001', email: 'alice@example.test', displayName: 'Alice', role: 'CUSTOMER', expiresAt: '2099-01-01T00:00:00Z' };
const wallet = { id: '20000000-0000-4000-8000-000000000001', publicRef: 'LG-20000000000000000000000000000001', name: 'Everyday CAD', currency: 'CAD', postedMinor: '125050', reservedMinor: '2500', availableMinor: '122550', version: '4', updatedAt: '2026-10-03T12:00:00Z' };
const spare = { ...wallet, id: '20000000-0000-4000-8000-000000000002', publicRef: 'LG-20000000000000000000000000000002', name: 'Travel USD', currency: 'USD', postedMinor: '87500', reservedMinor: '0', availableMinor: '87500' };
const envelope = (items: unknown[]) => ({ items, limit: 100, offset: 0, hasMore: false });

async function fixture(page: Page, options: { anonymous?: boolean; empty?: boolean; role?: string; accountsError?: boolean } = {}) {
  let signedIn = !options.anonymous;
  const unexpected: string[] = [];
  const writes: string[] = [];
  await page.route('**/api/v1/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    const method = request.method();
    const reply = (json: unknown, status = 200) => route.fulfill({ json, status });
    if (path === '/auth/csrf') return reply({ headerName: 'X-XSRF-TOKEN', token: 'presentation-fixture-token' });
    if (path === '/auth/me') return signedIn ? reply({ ...customer, role: options.role ?? customer.role }) : reply({ code: 'AUTHENTICATION_REQUIRED', message: 'Sign in required' }, 401);
    if (path === '/auth/login') { signedIn = true; return reply(customer); }
    if (path === '/auth/logout') { signedIn = false; return route.fulfill({ status: 204 }); }
    if (method !== 'GET') writes.push(`${method} ${path}`);
    if (path === '/accounts' && method === 'GET') return options.accountsError ? reply({ code: 'DEPENDENCY_UNAVAILABLE', message: 'Fixture unavailable' }, 503) : reply(envelope(options.empty ? [] : [wallet, spare]));
    if (path === '/payments' || path === '/schedules' || path === '/webhooks/endpoints') return reply(envelope([]));
    if (path === `/accounts/${wallet.id}`) return reply(wallet);
    if (path === `/accounts/${wallet.id}/transactions`) return reply(envelope([]));
    unexpected.push(`${method} ${path}`);
    return reply({ code: 'NOT_FOUND', message: 'No presentation fixture for this resource' }, 404);
  });
  return { unexpected, writes };
}
async function cleanLayout(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(result.violations).toEqual([]);
}
async function capture(page: Page, name: string) {
  await page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });
}

test('dashboard hierarchy, full wallet references, navigation and accessibility', async ({ page }) => {
  const api = await fixture(page);
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome, Alice' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Everyday CAD' })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Primary navigation', exact: true });
  await expect(nav.getByRole('link')).toHaveCount(5);
  await expect(nav.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText(wallet.publicRef, { exact: true })).toBeVisible();
  await expect(page.getByText('CAD 1,225.50', { exact: true })).toBeVisible();
  await expect(page.getByText('USD 875.00', { exact: true })).toHaveCount(2);
  await cleanLayout(page);
  await capture(page, 'dashboard');
  expect(api.unexpected).toEqual([]);
  expect(errors).toEqual([]);
});

test('navigation stays singular across repeated routes and browser back/forward', async ({ page }) => {
  const api = await fixture(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome, Alice' })).toBeVisible();
  for (let visit = 0; visit < 2; visit++) {
    const nav = page.getByRole('navigation', { name: 'Primary navigation', exact: true });
    await nav.getByRole('link', { name: 'Transfer', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Make a transfer', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Transfer', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { name: 'Make a transfer', exact: true })).toBeFocused();
    await nav.getByRole('link', { name: 'Payments', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'No payments yet' })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Make a transfer', exact: true })).toBeVisible();
    await page.goForward();
    await expect(nav.getByRole('link', { name: 'Payments', exact: true })).toHaveAttribute('aria-current', 'page');
    await nav.getByRole('link', { name: 'Dashboard', exact: true }).click();
    await expect(nav.getByRole('link')).toHaveCount(5);
    await expect(page.locator('[aria-current="page"]')).toHaveCount(1);
  }
  expect(api.unexpected).toEqual([]);
});

test('transfer review can be dismissed by keyboard without sending or losing fields', async ({ page }) => {
  const api = await fixture(page);
  await page.goto('/transfers/new');
  await expect(page.getByLabel('Source wallet')).toBeVisible();
  await page.getByLabel('Recipient reference', { exact: true }).fill(spare.publicRef);
  await page.getByLabel('Amount (CAD)', { exact: true }).fill('25.00');
  await page.getByRole('button', { name: 'Review transfer', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Confirm and transfer' })).toBeFocused();
  await cleanLayout(page);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Review transfer', exact: true })).toBeFocused();
  await expect(page.getByLabel('Amount (CAD)', { exact: true })).toHaveValue('25.00');
  await page.getByRole('button', { name: 'Review transfer', exact: true }).click();
  await dialog.getByRole('button', { name: 'Go back' }).click();
  await expect(dialog).not.toBeVisible();
  expect(api.writes).toEqual([]);
  await capture(page, 'transfer');
  await cleanLayout(page);
});

for (const kind of ['transfer', 'payment']) {
  test(`${kind} rejects the source wallet as recipient before confirmation, regardless of case`, async ({ page }) => {
    const api = await fixture(page);
    await page.goto(kind === 'transfer' ? '/transfers/new' : '/payments/new');
    await expect(page.getByLabel('Source wallet')).toBeVisible();
    await page.getByLabel('Amount (CAD)', { exact: true }).fill('1.00');
    for (const reference of [wallet.publicRef, wallet.publicRef.toLowerCase()]) {
      await page.getByLabel('Recipient reference', { exact: true }).fill(reference);
      await page.getByRole('button', { name: `Review ${kind}`, exact: true }).click();
      await expect(page.getByText('Choose a different recipient wallet.')).toBeVisible();
      await expect(page.getByRole('dialog')).not.toBeVisible();
    }
    expect(api.writes).toEqual([]);
  });
}

test('empty and service-error states never invent balances', async ({ page }) => {
  await fixture(page, { empty: true });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'No wallets yet' })).toBeVisible();
  await cleanLayout(page);
  await page.unroute('**/api/v1/**');
  await fixture(page, { accountsError: true });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Service temporarily unavailable' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No wallets yet' })).not.toBeVisible();
  await expect(page.locator('.account-card')).toHaveCount(0);
  await cleanLayout(page);
});

test('login, sign out and skip link remain operable on every viewport', async ({ page }) => {
  await fixture(page, { anonymous: true });
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await cleanLayout(page);
  await capture(page, 'sign-in');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
  await page.getByLabel('Email address').fill(customer.email);
  await page.getByLabel('Password', { exact: true }).fill('presentation-fixture-only');
  await page.getByRole('button', { name: 'Sign in securely' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome, Alice' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toHaveCount(0);
});

test('administrator shell exposes investigation routes without customer-only controls', async ({ page }) => {
  await fixture(page, { role: 'ADMIN' });
  await page.goto('/admin/adjustments');
  const nav = page.getByRole('navigation', { name: 'Primary navigation', exact: true });
  await expect(nav.getByRole('link')).toHaveCount(2);
  await expect(nav.getByRole('link', { name: 'Adjustments' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('navigation', { name: 'Administrator investigation' }).getByRole('link')).toHaveCount(4);
  await expect(page.getByRole('link', { name: 'Webhooks', exact: true })).toHaveCount(0);
  await cleanLayout(page);
  await capture(page, 'administrator');
});

test('loading is explicit and resolves without flashing an empty ledger', async ({ page }) => {
  await fixture(page);
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/accounts?**', async route => {
    await waiting;
    await route.fulfill({ json: envelope([wallet, spare]) });
  });
  await page.goto('/');
  await expect(page.getByText('Loading authoritative records…', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No wallets yet' })).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh balances' })).toBeDisabled();
  release();
  await expect(page.getByRole('heading', { name: 'Everyday CAD' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh balances' })).toBeEnabled();
});


test('copy failure offers a usable manual reference instead of claiming success', async ({ page }) => {
  await fixture(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('Clipboard unavailable in this fixture')) } });
  });
  await page.goto('/');
  const account = page.getByRole('article', { name: 'Everyday CAD' });
  await account.getByRole('button', { name: 'Copy reference' }).click();
  await expect(account.getByText('Copy was not available. Select the reference manually.')).toBeVisible();
  await expect(account.getByText(wallet.publicRef, { exact: true })).toBeVisible();
  await expect(account.getByText('Reference copied.', { exact: true })).toHaveCount(0);
});

test('320-pixel layout retains all five primary destinations', async ({ page }) => {
  await fixture(page);
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Everyday CAD' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Primary navigation', exact: true }).getByRole('link')).toHaveCount(5);
  await cleanLayout(page);
});
