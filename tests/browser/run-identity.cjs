'use strict';
const assert = require('node:assert/strict');

// Observes UI only. It never submits a command or chooses a test scenario.
async function waitForAcceptedRun(page, expect, receipt, scenario, verdict, timeout = 180000) {
  assert.match(receipt.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  assert.equal(receipt.scenario, scenario);
  await expect(page.locator('#detail-title')).toHaveText(`${scenario} · Run detail`, {timeout});
  await expect(page.locator('#verdict')).toHaveText(`${verdict} · ${receipt.id}`, {timeout});
  const result = JSON.parse(await page.locator('#evidence').textContent());
  assert.equal(result.runId, receipt.id, 'Evidence must belong to the accepted request');
  assert.equal(result.scenario, scenario, 'Evidence must belong to the selected scenario');
  assert.equal(result.verdict, verdict, 'Evidence and visible verdict must agree');
  return result;
}
module.exports = {waitForAcceptedRun};
