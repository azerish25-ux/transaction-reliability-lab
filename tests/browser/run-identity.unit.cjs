'use strict';
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {test} = require('node:test');
const {waitForAcceptedRun} = require('./run-identity.cjs');
const OLD = '10000000-0000-4000-8000-000000000001';
const NEW = '20000000-0000-4000-8000-000000000002';

// Deterministic DOM adapter for the real observation helper. No browser, network,
// API, database or experiment is started. This is not live-browser evidence.
function fixture(scenario = 'PREVIOUS', runId = OLD) {
  const changes = new EventEmitter();
  const state = {};
  function render(s, id, verdict = 'DETECTED', evidence = {scenario: s, runId: id, verdict}) {
    state['#detail-title'] = `${s} · Run detail`;
    state['#verdict'] = `${verdict} · ${id}`;
    state['#evidence'] = JSON.stringify(evidence);
    changes.emit('render');
  }
  render(scenario, runId);
  const page = {locator: selector => ({selector, textContent: async () => state[selector]})};
  function expect(locator) {
    return {toHaveText(expected, {timeout = 50} = {}) {
      const matches = () => expected instanceof RegExp ? expected.test(state[locator.selector]) : state[locator.selector] === expected;
      if (matches()) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const check = () => { if (matches()) { clearTimeout(timer); changes.off('render', check); resolve(); } };
        const timer = setTimeout(() => { changes.off('render', check); reject(new Error('Observation deadline exceeded')); }, timeout);
        changes.on('render', check);
      });
    }};
  }
  return {page, expect, render};
}
const receipt = {id: NEW, scenario: 'CURRENT'};

test('old status-only assertion reproduces stale result acceptance', async () => {
  const f = fixture();
  await f.expect(f.page.locator('#verdict')).toHaveText(/^DETECTED · /);
  assert.equal(JSON.parse(await f.page.locator('#evidence').textContent()).runId, OLD);
});
test('new accepted identity survives consecutive identical terminal statuses', async () => {
  const f = fixture();
  const pending = waitForAcceptedRun(f.page, f.expect, receipt, 'CURRENT', 'DETECTED', 100);
  f.render('CURRENT', NEW);
  assert.equal((await pending).runId, NEW);
});
test('same scenario repeated does not reuse previous run', async () => {
  const f = fixture('CURRENT');
  const pending = waitForAcceptedRun(f.page, f.expect, receipt, 'CURRENT', 'DETECTED', 100);
  f.render('CURRENT', NEW);
  assert.equal((await pending).runId, NEW);
});
test('stale run times out despite matching scenario and terminal status', async () => {
  const f = fixture('CURRENT');
  await assert.rejects(waitForAcceptedRun(f.page, f.expect, receipt, 'CURRENT', 'DETECTED', 5), /deadline/);
});
test('view and evidence identity must agree', async () => {
  const f = fixture(); f.render('CURRENT', NEW, 'DETECTED', {scenario: 'CURRENT', runId: OLD, verdict: 'DETECTED'});
  await assert.rejects(waitForAcceptedRun(f.page, f.expect, receipt, 'CURRENT', 'DETECTED', 5), /accepted request/);
});
test('view and evidence verdict must agree', async () => {
  const f = fixture(); f.render('CURRENT', NEW, 'DETECTED', {scenario: 'CURRENT', runId: NEW, verdict: 'FAILED'});
  await assert.rejects(waitForAcceptedRun(f.page, f.expect, receipt, 'CURRENT', 'DETECTED', 5), /must agree/);
});
test('wrong receipt scenario is rejected', async () => {
  const f = fixture();
  await assert.rejects(waitForAcceptedRun(f.page, f.expect, {...receipt, scenario: 'OTHER'}, 'CURRENT', 'DETECTED', 5));
});
test('invalid accepted ID is rejected', async () => {
  const f = fixture();
  await assert.rejects(waitForAcceptedRun(f.page, f.expect, {...receipt, id: 'invalid'}, 'CURRENT', 'DETECTED', 5));
});
