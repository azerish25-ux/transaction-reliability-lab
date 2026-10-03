// P08B customer money-movement behavior using the compiled production client modules.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { ApiClient, OutcomeUnknown } = require('../../.evidence/ts/api.js');
const { IntentStore } = require('../../.evidence/ts/intent-store.js');
const {
  amountToMinor,
  intentRecoveryPath,
  isP08BPath,
  isSameWalletReference,
  isTerminalPaymentState,
  paymentPollDelay,
  paymentStateLabel
} = require('../../.evidence/ts/p08b-core.js');

const cases = [];
const test = (id, run) => cases.push({ id, run });
const alice = '00000000-0000-0000-0000-000000000001';
const source = '10000000-0000-0000-0000-000000000001';
const recipient = 'LG-20000000000000000000000000000001';
const paymentId = '50000000-0000-0000-0000-000000000001';
const paymentIntent = { sourceId: source, recipientRef: recipient, amountMinor: '25', currency: 'CAD' };
const paymentReceipt = { id: paymentId, kind: 'PAYMENT', state: 'PENDING', amountMinor: '25', currency: 'CAD' };
const cancellationReceipt = { id: paymentId, state: 'CANCELLED' };
const csrf = token => Response.json({ headerName: 'X-XSRF-TOKEN', token });
const storage = () => {
  const values = new Map();
  return {
    values,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  };
};

test('P08BTS09-same-wallet-validation-compares-canonical-and-entered-references', () => {
  const { normalizeTransferIntent, normalizePaymentIntent } = require('../../.evidence/ts/api.js');
  for (const normalize of [normalizeTransferIntent, normalizePaymentIntent]) {
    for (const entered of [recipient, recipient.toLowerCase(), ` ${recipient.toLowerCase()} `]) {
      const intent = normalize({ ...paymentIntent, recipientRef: entered });
      assert.equal(isSameWalletReference(intent.recipientRef, recipient), true);
      assert.equal(isSameWalletReference(intent.recipientRef, 'LG-30000000000000000000000000000001'), false);
    }
  }
});

test('P08BTS01-operation-specific-validation-precedes-persistence', async () => {
  const memory = storage();
  const store = new IntentStore(memory, alice);
  await assert.rejects(
    store.executeTransfer({}, { ...paymentIntent, recipientRef: 'not-a-ledgerguard-reference' }, () => 'p08b-transfer-key-0001'),
    /Invalid transfer recipient reference/
  );
  assert.equal(memory.values.size, 0);
});

test('P08BTS02-major-unit-entry-becomes-exact-minor-unit-string', () => {
  assert.equal(amountToMinor('1.23', 'CAD'), '123');
  assert.equal(amountToMinor('7', 'JPY'), '7');
  assert.equal(amountToMinor('1.234', 'KWD'), '1234');
  assert.throws(() => amountToMinor('0.001', 'CAD'));
  assert.throws(() => amountToMinor('0', 'CAD'));
});

test('P08BTS03-customer-routes-and-recovery-destinations-are-bounded', () => {
  assert.equal(isP08BPath('/transfers/new?recover=1'), true);
  assert.equal(isP08BPath(`/payments/${paymentId}`), true);
  assert.equal(isP08BPath('/admin/lab'), false);
  assert.equal(intentRecoveryPath({ kind: 'transfers', intent: paymentIntent }), '/transfers/new');
  assert.equal(intentRecoveryPath({ kind: 'payments', intent: paymentIntent }), '/payments/new');
  assert.equal(intentRecoveryPath({ kind: 'payment-cancellations', intent: { paymentId } }), `/payments/${paymentId}`);
});

test('P08BTS04-payment-status-policy-never-treats-pending-as-terminal', () => {
  assert.equal(isTerminalPaymentState('PENDING'), false);
  for (const state of ['SETTLED', 'FAILED', 'CANCELLED']) assert.equal(isTerminalPaymentState(state), true);
  assert.equal(paymentStateLabel('PENDING'), 'Pending');
  assert.equal(paymentStateLabel('SETTLED'), 'Settled');
});

test('P08BTS05-authoritative-polling-backoff-is-bounded', () => {
  assert.equal(paymentPollDelay(-1), 900);
  assert.equal(paymentPollDelay(0), 900);
  assert(paymentPollDelay(3) > paymentPollDelay(0));
  assert.equal(paymentPollDelay(1000), 2500);
});

test('P08BTS06-lost-payment-response-reuses-identical-key-and-intent', async () => {
  const memory = storage();
  const requests = [];
  let attempts = 0;
  const api = new ApiClient(async (url, options) => {
    if (url.endsWith('/auth/csrf')) return csrf('p08b-csrf-6');
    requests.push([options.headers.get('Idempotency-Key'), options.body]);
    attempts += 1;
    if (attempts === 1) throw new TypeError('response disappeared after durable acceptance');
    return Response.json(paymentReceipt, { status: 202, headers: { 'Idempotency-Replayed': 'true' } });
  });
  const store = new IntentStore(memory, alice);
  await assert.rejects(store.executePayment(api, paymentIntent, () => 'p08b-payment-key-0006'), OutcomeUnknown);
  assert.equal(store.current().state, 'UNCERTAIN');
  const response = await store.retryPayment(api);
  assert.equal(response.replayed, true);
  assert.equal(store.current().state, 'CONFIRMED');
  assert.deepEqual(requests[0], requests[1]);
});

test('P08BTS07-lost-cancellation-response-reuses-the-preserved-command', async () => {
  const memory = storage();
  const requests = [];
  let attempts = 0;
  const api = new ApiClient(async (url, options) => {
    if (url.endsWith('/auth/csrf')) return csrf('p08b-csrf-7');
    requests.push([url, options.headers.get('Idempotency-Key'), options.body]);
    attempts += 1;
    if (attempts === 1) throw new TypeError('cancellation response lost');
    return Response.json(cancellationReceipt, { status: 200, headers: { 'Idempotency-Replayed': 'true' } });
  });
  const store = new IntentStore(memory, alice);
  await assert.rejects(store.executeCancellation(api, { paymentId, reason: 'Customer request' }, () => 'p08b-cancel-key-0007'), OutcomeUnknown);
  const response = await store.retryCancellation(api);
  assert.equal(response.body.state, 'CANCELLED');
  assert.deepEqual(requests[0], requests[1]);
});

test('P08BTS08-an-unresolved-command-blocks-a-conflicting-new-instruction', () => {
  const store = new IntentStore(storage(), alice);
  store.prepare('payments', paymentIntent, () => 'p08b-payment-key-0008');
  store.transition('UNCERTAIN');
  assert.throws(() => store.prepare('transfers', paymentIntent, () => 'p08b-transfer-key-0008'));
});

const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
(async () => {
  let failures = 0;
  const rows = [];
  for (const current of cases) {
    try {
      await current.run();
      console.log('PASS', current.id);
      rows.push(`<testcase name="${current.id}"/>`);
    } catch (failure) {
      failures += 1;
      console.error('FAIL', current.id, failure.stack || failure.message);
      rows.push(`<testcase name="${current.id}"><failure message="${escape(failure.message)}"/></testcase>`);
    }
  }
  fs.mkdirSync('.evidence/client', { recursive: true });
  fs.writeFileSync('.evidence/client/p08b-results.xml', `<testsuite name="p08b-client" tests="${cases.length}" failures="${failures}" errors="0" skipped="0">${rows.join('\n')}</testsuite>`);
  console.log(`P08B_CLIENT_SUMMARY tests=${cases.length} failures=${failures}`);
  process.exitCode = failures ? 1 : 0;
})();
