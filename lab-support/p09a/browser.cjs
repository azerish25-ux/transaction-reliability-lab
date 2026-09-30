/* Real-browser verification against the live lab. Never intercepted or mocked. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const frontendRequire = createRequire(path.join(root, 'frontend/package.json'));
const {chromium} = frontendRequire('playwright');
const {expect} = frontendRequire('@playwright/test');
const {waitForAcceptedRun} = require('../../tests/browser/run-identity.cjs');
const values = Object.fromEntries(fs.readFileSync(path.join(root, '.ledgerguard/p09a/runtime.env'), 'utf8').trim().split('\n').map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
const base = `http://127.0.0.1:${values.LEDGER_LAB_PORT}`;
const output = path.join(root, '.evidence/p09a/browser');
fs.mkdirSync(output, {recursive: true});

(async () => {
  const browser = await chromium.launch({headless: true});
  const context = await browser.newContext({viewport: {width: 1280, height: 900}});
  const page = await context.newPage();
  const consoleErrors = [];
  async function confirmAcceptedRun(dialog, scenario) {
    const [response] = await Promise.all([
      page.waitForResponse(response => {
        const request = response.request();
        return new URL(response.url()).pathname === '/lab/api/runs'
          && request.method() === 'POST' && response.status() === 202
          && request.postDataJSON()?.scenario === scenario;
      }),
      dialog.getByRole('button', {name: 'Confirm', exact: true}).click(),
    ]);
    const receipt = await response.json();
    assert.equal(receipt.scenario, scenario);
    return receipt;
  }

  page.on('pageerror', error => consoleErrors.push(error.name));
  const tests = [];
  let stage = 'UNAUTHENTICATED_LAB_DENIED';
  let failure = null;
  try {
    await page.goto(base + '/lab/');
    await page.getByRole('heading', {name: 'Sign in to the lab'}).waitFor();
    const unauthenticated = await context.request.get(base + '/lab/api/runs');
    assert.equal(unauthenticated.status(), 401);
    tests.push({id: stage, status: 'PASS'});

    stage = 'ADMIN_COMMAND_REQUIRES_CSRF';
    await page.getByLabel('Password', {exact: true}).fill(values.LEDGER_DEMO_PASSWORD);
    await page.getByRole('button', {name: 'Sign in', exact: true}).click();
    await page.getByRole('heading', {name: 'Execution boundary'}).waitFor();
    const denied = await context.request.post(base + '/lab/api/runs', {
      data: {requestId: crypto.randomUUID(), scenario: 'F01', seed: 74021}, headers: {Origin: base}});
    assert.equal(denied.status(), 403); // No command CSRF token.
    tests.push({id: stage, status: 'PASS'});

    stage = 'F01_OPEN_CONFIRMATION';
    await page.getByRole('button', {name: 'Run F01', exact: true}).click();
    const dialog = page.getByRole('dialog', {name: 'Confirm isolated experiment', exact: true});
    await expect(dialog).toBeVisible();
    stage = 'F01_CONFIRMATION_FOCUS';
    assert.equal(await page.evaluate(() => document.getElementById('confirmation').contains(document.activeElement)), true);
    stage = 'F01_CONFIRM';
    const receiptF01 = await confirmAcceptedRun(dialog, 'F01');
    stage = 'F01_AWAIT_REAL_VERDICT';
    // Locator assertions use Playwright's utility world. Do not bypass or relax
    // the application's CSP to run waitForFunction's main-world eval loop.
    const actual = await waitForAcceptedRun(page, expect, receiptF01, 'F01', 'PASSED');
    assert.equal(actual.scenario, 'F01');
    assert.equal(actual.verdict, 'PASSED');
    tests.push({id: 'ADMIN_BROWSER_EXECUTES_REAL_F01', status: 'PASS'});

    stage = 'D02_OPEN_CONFIRMATION';
    await page.getByRole('button', {name: 'Run D02', exact: true}).click();
    await expect(dialog).toBeVisible();
    stage = 'D02_CONFIRM';
    const receiptD02 = await confirmAcceptedRun(dialog, 'D02');
    stage = 'D02_AWAIT_REAL_VERDICT';
    const detected = await waitForAcceptedRun(page, expect, receiptD02, 'D02', 'DETECTED');
    assert.equal(detected.scenario, 'D02');
    assert.equal(detected.verdict, 'DETECTED');
    tests.push({id: 'ADMIN_BROWSER_EXECUTES_REAL_D02', status: 'PASS'});

    stage = 'F02_OPEN_CONFIRMATION';
    await page.getByRole('button', {name: 'Run F02', exact: true}).click();
    await expect(dialog).toBeVisible();
    const receiptF02 = await confirmAcceptedRun(dialog, 'F02');
    stage = 'F02_AWAIT_REAL_VERDICT';
    const duplicate = await waitForAcceptedRun(page, expect, receiptF02, 'F02', 'PASSED');
    assert.equal(duplicate.scenario, 'F02');
    assert.equal(duplicate.verdict, 'PASSED');
    assert.equal(duplicate.phases.duplicate.observations.routedPublications, 2);
    tests.push({id: 'ADMIN_BROWSER_EXECUTES_REAL_F02', status: 'PASS'});

    stage = 'D06_OPEN_CONFIRMATION';
    await page.getByRole('button', {name: 'Run D06', exact: true}).click();
    await expect(dialog).toBeVisible();
    const receiptD06 = await confirmAcceptedRun(dialog, 'D06');
    stage = 'D06_AWAIT_REAL_VERDICT';
    const duplicateDefect = await waitForAcceptedRun(page, expect, receiptD06, 'D06', 'DETECTED');
    assert.equal(duplicateDefect.scenario, 'D06');
    assert.equal(duplicateDefect.phases.mutant.assertion.id, 'D06_DUPLICATE_FINANCIAL_EFFECT');
    tests.push({id: 'ADMIN_BROWSER_EXECUTES_REAL_D06', status: 'PASS'});

    stage = 'D01_OPEN_CONFIRMATION';
    await page.getByRole('button', {name: 'Run D01', exact: true}).click();
    await expect(dialog).toBeVisible();
    const receiptD01 = await confirmAcceptedRun(dialog, 'D01');
    stage = 'D01_AWAIT_REAL_VERDICT';
    const replayDefect = await waitForAcceptedRun(page, expect, receiptD01, 'D01', 'DETECTED');
    assert.equal(replayDefect.scenario, 'D01');
    assert.equal(replayDefect.phases.mutant.assertion.id, 'D01_REPLAY_ONE_OPERATION');
    tests.push({id: 'ADMIN_BROWSER_EXECUTES_REAL_D01', status: 'PASS'});

    stage = 'RESPONSIVE_SCREENSHOTS';
    await page.screenshot({path: path.join(output, 'desktop.png'), fullPage: true});
    await page.setViewportSize({width: 390, height: 844});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({path: path.join(output, 'mobile.png'), fullPage: true});
    tests.push({id: 'MOBILE_NO_HORIZONTAL_OVERFLOW', status: 'PASS'});

    stage = 'KEYBOARD_FOCUS_SURVIVES_POLL';
    await page.getByRole('button', {name: 'Refresh', exact: true}).focus();
    await page.waitForTimeout(2400);
    await expect(page.locator('#refresh')).toBeFocused();
    tests.push({id: stage, status: 'PASS'});

    stage = 'AUTHENTICATED_CUSTOMER_LAB_DENIED';
    await page.getByRole('button', {name: 'Sign out', exact: true}).click();
    await page.getByRole('heading', {name: 'Sign in to the lab'}).waitFor();
    await page.getByLabel('Email', {exact: true}).fill('alice@example.test');
    await page.getByLabel('Password', {exact: true}).fill(values.LEDGER_DEMO_PASSWORD);
    await page.getByRole('button', {name: 'Sign in', exact: true}).click();
    await expect(page.locator('#notice')).toContainText('ADMIN_REQUIRED');
    assert.equal((await context.request.get(base + '/lab/api/catalogue')).status(), 403);
    tests.push({id: stage, status: 'PASS'});
    stage = 'NO_BROWSER_PAGE_ERRORS';
    assert.deepEqual(consoleErrors, []);
    tests.push({id: stage, status: 'PASS'});
  } catch (error) {
    // Emit fixed categories and our own stage IDs, never arbitrary error text,
    // locator call logs, entered passwords, cookies, traces or storage state.
    const category = /strict mode violation/.test(error.message) ? 'STRICT_LOCATOR'
      : /Content Security Policy|unsafe-eval|EvalError/.test(error.message) ? 'CSP_EVALUATION'
      : /Timeout|timed out|timeout/i.test(error.message) ? 'TIMEOUT'
      : error.name === 'AssertionError' ? 'ASSERTION_FAILURE' : 'BROWSER_ERROR';
    failure = {stage, category};
    console.error(JSON.stringify({browserFailure: failure}));
    throw error;
  } finally {
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({sourceSha: values.LEDGER_LAB_SOURCE,
      scope: 'REAL_BROWSER_LIVE_LAB', tests, expectedTests: 11, complete: tests.length === 11 && failure === null,
      failure}, null, 2));
    await context.close(); await browser.close();
  }
})().catch(() => { console.error('Browser verification failed; inspect the sanitized stage diagnostic.'); process.exitCode = 1; });
