/* Real-browser verification against the live lab. Never intercepted or mocked. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const frontendRequire = createRequire(path.join(root, 'frontend/package.json'));
const {chromium} = frontendRequire('playwright');
const values = Object.fromEntries(fs.readFileSync(path.join(root, '.ledgerguard/p09a/runtime.env'), 'utf8').trim().split('\n').map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
const base = `http://127.0.0.1:${values.LEDGER_LAB_PORT}`;
const output = path.join(root, '.evidence/p09a/browser');
fs.mkdirSync(output, {recursive: true});

(async () => {
  const browser = await chromium.launch({headless: true});
  const context = await browser.newContext({viewport: {width: 1280, height: 900}});
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('pageerror', error => consoleErrors.push(error.name));
  const tests = [];
  try {
    await page.goto(base + '/lab/');
    await page.getByRole('heading', {name: 'Sign in to the lab'}).waitFor();
    const unauthenticated = await context.request.get(base + '/lab/api/runs');
    assert.equal(unauthenticated.status(), 401);
    tests.push({id: 'UNAUTHENTICATED_LAB_DENIED', status: 'PASS'});

    await page.getByLabel('Password', {exact: true}).fill(values.LEDGER_DEMO_PASSWORD);
    await page.getByRole('button', {name: 'Sign in', exact: true}).click();
    await page.getByRole('heading', {name: 'Execution boundary'}).waitFor();
    const denied = await context.request.post(base + '/lab/api/runs', {
      data: {requestId: crypto.randomUUID(), scenario: 'F01', seed: 74021}, headers: {Origin: base}});
    assert.equal(denied.status(), 403); // No command CSRF token.
    tests.push({id: 'ADMIN_COMMAND_REQUIRES_CSRF', status: 'PASS'});

    await page.getByRole('button', {name: 'Run F01', exact: true}).click();
    await page.getByRole('dialog').waitFor();
    assert.equal(await page.evaluate(() => document.getElementById('confirmation').contains(document.activeElement)), true);
    await page.getByRole('button', {name: 'Confirm', exact: true}).click();
    await page.waitForFunction(() => /^PASSED · /.test(document.getElementById('verdict').textContent), null, {timeout: 180000});
    const actual = await page.locator('#evidence').textContent();
    assert.equal(JSON.parse(actual).scenario, 'F01');
    assert.equal(JSON.parse(actual).verdict, 'PASSED');
    tests.push({id: 'ADMIN_BROWSER_EXECUTES_REAL_F01', status: 'PASS'});
    await page.getByRole('button', {name: 'Run D02', exact: true}).click();
    await page.getByRole('button', {name: 'Confirm', exact: true}).click();
    await page.waitForFunction(() => /^DETECTED · /.test(document.getElementById('verdict').textContent), null, {timeout: 180000});
    assert.equal(JSON.parse(await page.locator('#evidence').textContent()).scenario, 'D02');
    tests.push({id: 'ADMIN_BROWSER_EXECUTES_REAL_D02', status: 'PASS'});
    await page.screenshot({path: path.join(output, 'desktop.png'), fullPage: true});
    await page.setViewportSize({width: 390, height: 844});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({path: path.join(output, 'mobile.png'), fullPage: true});
    tests.push({id: 'MOBILE_NO_HORIZONTAL_OVERFLOW', status: 'PASS'});

    // Keyboard focus must survive the live two-second status refresh.
    await page.getByRole('button', {name: 'Refresh', exact: true}).focus();
    await page.waitForTimeout(2400);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'refresh');
    tests.push({id: 'KEYBOARD_FOCUS_SURVIVES_POLL', status: 'PASS'});
    await page.getByRole('button', {name: 'Sign out', exact: true}).click();
    await page.getByRole('heading', {name: 'Sign in to the lab'}).waitFor();
    await page.getByLabel('Email', {exact: true}).fill('alice@example.test');
    await page.getByLabel('Password', {exact: true}).fill(values.LEDGER_DEMO_PASSWORD);
    await page.getByRole('button', {name: 'Sign in', exact: true}).click();
    await page.waitForFunction(() => document.getElementById('notice').textContent.includes('ADMIN_REQUIRED'));
    assert.equal((await context.request.get(base + '/lab/api/catalogue')).status(), 403);
    tests.push({id: 'AUTHENTICATED_CUSTOMER_LAB_DENIED', status: 'PASS'});
    assert.deepEqual(consoleErrors, []);
    tests.push({id: 'NO_BROWSER_PAGE_ERRORS', status: 'PASS'});
  } finally {
    // No storageState, raw traces, HAR or cookies are published.
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({sourceSha: values.LEDGER_LAB_SOURCE,
      scope: 'REAL_BROWSER_LIVE_LAB', tests, expectedTests: 8, complete: tests.length === 8}, null, 2));
    await context.close(); await browser.close();
  }
})().catch(error => { console.error(error.name + ': browser verification failed'); process.exitCode = 1; });
