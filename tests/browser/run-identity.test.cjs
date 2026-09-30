// Synthetic UI synchronization regression only. No API, database or lab is started.
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const {createRequire} = require('node:module');
const frontendRequire = createRequire(path.resolve(__dirname, '../../frontend/package.json'));
const {chromium} = frontendRequire('playwright');
const {expect} = frontendRequire('@playwright/test');
const {waitForAcceptedRun} = require('./run-identity.cjs');
const OLD = '10000000-0000-4000-8000-000000000001';
const NEW = '20000000-0000-4000-8000-000000000002';
(async () => {
  const browser = await chromium.launch({headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? {executablePath: process.env.CHROMIUM_EXECUTABLE} : {})});
  const page = await browser.newPage();
  let passed = 0;
  async function render(scenario, runId, verdict = 'DETECTED', evidence = {scenario, runId, verdict}) {
    await page.setContent('<h2 id="detail-title"></h2><p id="verdict"></p><pre id="evidence"></pre>');
    await page.evaluate(({scenario, runId, verdict, evidence}) => {
      document.querySelector('#detail-title').textContent = `${scenario} · Run detail`;
      document.querySelector('#verdict').textContent = `${verdict} · ${runId}`;
      document.querySelector('#evidence').textContent = JSON.stringify(evidence);
    }, {scenario, runId, verdict, evidence});
  }
  async function test(name, body) { await body(); passed++; console.log('PASS ' + name); }
  try {
    await test('old status-only wait accepts the previous scenario and reproduces the race', async () => {
      await render('PREVIOUS', OLD);
      await expect(page.locator('#verdict')).toHaveText(/^DETECTED · /);
      assert.equal(JSON.parse(await page.locator('#evidence').textContent()).runId, OLD);
    });
    await test('accepted run identity waits across the previous matching terminal status', async () => {
      await render('PREVIOUS', OLD);
      const result = waitForAcceptedRun(page, expect, {id: NEW, scenario: 'CURRENT'}, 'CURRENT', 'DETECTED', 1000);
      await render('CURRENT', NEW);
      assert.equal((await result).runId, NEW);
    });
    await test('same-scenario repeated run cannot reuse the old completed result', async () => {
      await render('CURRENT', OLD);
      const result = waitForAcceptedRun(page, expect, {id: NEW, scenario: 'CURRENT'}, 'CURRENT', 'DETECTED', 1000);
      await render('CURRENT', NEW);
      assert.equal((await result).runId, NEW);
    });
    await test('wrong accepted identity times out rather than accepting old success', async () => {
      await render('CURRENT', OLD);
      await assert.rejects(waitForAcceptedRun(page, expect, {id: NEW, scenario: 'CURRENT'}, 'CURRENT', 'DETECTED', 100));
    });
    await test('wrong evidence identity is rejected even when visible status matches', async () => {
      await render('CURRENT', NEW, 'DETECTED', {scenario: 'CURRENT', runId: OLD, verdict: 'DETECTED'});
      await assert.rejects(waitForAcceptedRun(page, expect, {id: NEW, scenario: 'CURRENT'}, 'CURRENT', 'DETECTED', 100), /accepted request/);
    });
    await test('inconsistent evidence verdict is rejected', async () => {
      await render('CURRENT', NEW, 'DETECTED', {scenario: 'CURRENT', runId: NEW, verdict: 'FAILED'});
      await assert.rejects(waitForAcceptedRun(page, expect, {id: NEW, scenario: 'CURRENT'}, 'CURRENT', 'DETECTED', 100), /must agree/);
    });
    await test('wrong scenario receipt is rejected before DOM observation', async () => {
      await assert.rejects(waitForAcceptedRun(page, expect, {id: NEW, scenario: 'OTHER'}, 'CURRENT', 'DETECTED', 100));
    });
    await test('invalid receipt identity is rejected', async () => {
      await assert.rejects(waitForAcceptedRun(page, expect, {id: 'invalid', scenario: 'CURRENT'}, 'CURRENT', 'DETECTED', 100));
    });
    console.log(JSON.stringify({scope: 'SYNTHETIC_UI_SYNCHRONIZATION_ONLY', tests: passed, failures: 0}));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
