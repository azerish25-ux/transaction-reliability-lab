// P08C exercises the compiled production client, money parser, routing and durable intent store.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { ApiClient, ApiError, OutcomeUnknown } = require('../../.evidence/ts/api.js');
const { IntentStore } = require('../../.evidence/ts/intent-store.js');
const { intentRecoveryPath } = require('../../.evidence/ts/p08b-core.js');
const { adjustmentRoute, adjustmentReason, adjustmentReceiptPath, refundMinor, remainingInput, validateAdjustmentContext } = require('../../.evidence/ts/p08c-core.js');
const cases = []; const test = (id, run) => cases.push({ id, run });
const owner = '00000000-0000-0000-0000-000000000001';
const paymentId = 'e0000000-0000-0000-0000-000000000001';
const adjustmentId = 'a0000000-0000-0000-0000-000000000001';
const journalId = 'f0000000-0000-0000-0000-000000000001';
const receipt = { id: adjustmentId, paymentId, kind: 'REFUND', amountMinor: '1250', currency: 'CAD', journalId };
const context = { paymentId, state: 'SETTLED', adjustmentState: 'NONE', amountMinor: '2500', refundedMinor: '0', remainingRefundableMinor: '2500', currency: 'CAD', journalId, version: '2', payerRef: 'LG-10000000000000000000000000000001', recipientRef: 'LG-20000000000000000000000000000001', recipientAvailableMinor: '2500', recipientBalanceVersion: '2', canRefund: true, canReverse: false, refundDisabledReason: null, reversalDisabledReason: 'ADMIN_REQUIRED' };
const storage = () => { const map = new Map(); return { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: k => map.delete(k) }; };
function client(replies, requests = []) { return new ApiClient(async (url, options) => {
  if (url.endsWith('/auth/csrf')) return Response.json({ headerName: 'X-XSRF-TOKEN', token: 'scoped-test-csrf' });
  requests.push({ url, body: options.body, key: options.headers.get('Idempotency-Key') });
  const next = replies.shift(); if (next instanceof Error) throw next; return typeof next === 'function' ? next() : next;
}); }
const success = (kind = 'REFUND') => Response.json({ ...receipt, kind }, { status: 201, headers: { 'Idempotency-Replayed': 'true' } });
const problem = (status, code) => Response.json({ code, message: code }, { status });
const intent = { paymentId, amountMinor: '1250', reason: 'Returned item' };

test('P08CTS01-exact-currency-refund-entry-without-rounding', () => {
  assert.equal(refundMinor('12.50', context), '1250');
  assert.equal(refundMinor('1.234', { ...context, currency: 'KWD' }), '1234');
  assert.equal(refundMinor('1250', { ...context, currency: 'JPY' }), '1250');
  for (const input of ['1e1', '0', '-1', '0.001', 'NaN', '1,20']) assert.throws(() => refundMinor(input, context));
  assert.throws(() => refundMinor('1.1', { ...context, currency: 'JPY' }));
});
test('P08CTS02-server-totals-are-validated-not-summed-from-a-history-page', () => {
  const partial = { ...context, adjustmentState: 'PARTIALLY_REFUNDED', refundedMinor: '123', remainingRefundableMinor: '2377' };
  assert.equal(remainingInput(partial), '23.77');
  assert.throws(() => validateAdjustmentContext({ ...partial, remainingRefundableMinor: '2500' }));
  assert.throws(() => validateAdjustmentContext({ ...context, refundedMinor: '2501' }));
});
test('P08CTS03-production-client-uses-owner-and-explicit-admin-context-paths', async () => {
  const requests = []; const api = client([Response.json(context), Response.json(context)], requests);
  await api.paymentAdjustmentContext(paymentId); await api.paymentAdjustmentContext(paymentId, true);
  assert.deepEqual(requests.map(r => r.url), [`/api/v1/payments/${paymentId}/adjustment-context`, `/api/v1/admin/payments/${paymentId}/adjustment-context`]);
});
test('P08CTS04-lost-refund-reloads-and-replays-identical-economic-instruction', async () => {
  const memory = storage(); const requests = []; const api = client([new TypeError('lost committed response'), success()], requests);
  const first = new IntentStore(memory, owner);
  await assert.rejects(first.executeRefund(api, intent, () => 'p08c-refund-key-04'), OutcomeUnknown);
  const restored = new IntentStore(memory, owner);
  assert.equal(restored.current().state, 'UNCERTAIN'); await restored.retryRefund(api);
  assert.deepEqual(requests[0], requests[1]); assert.equal(restored.current().state, 'CONFIRMED');
});
test('P08CTS05-lost-reversal-preserves-mandatory-reason-and-key', async () => {
  const store = new IntentStore(storage(), owner); const requests = [];
  const api = client([new TypeError('lost'), success('REVERSAL')], requests);
  await assert.rejects(store.executeReversal(api, { paymentId, reason: '  Correction  ' }, () => 'p08c-reversal-key-05'), OutcomeUnknown);
  await store.retryReversal(api); assert.deepEqual(requests[0], requests[1]);
  assert.deepEqual(JSON.parse(requests[0].body), { reason: 'Correction' });
});
test('P08CTS06-preaccept-session-expiry-keeps-prepared-command', async () => {
  const store = new IntentStore(storage(), owner); const requests = [];
  const api = client([problem(401, 'AUTHENTICATION_REQUIRED'), success()], requests);
  await assert.rejects(store.executeRefund(api, intent, () => 'p08c-expired-key-06'), ApiError);
  assert.equal(store.current().state, 'PREPARED'); await store.retryRefund(api); assert.deepEqual(requests[0], requests[1]);
});
test('P08CTS07-401-after-uncertainty-never-forgets-original-command', async () => {
  const store = new IntentStore(storage(), owner); const requests = [];
  const api = client([new TypeError('lost'), problem(401, 'AUTHENTICATION_REQUIRED'), success()], requests);
  await assert.rejects(store.executeRefund(api, intent, () => 'p08c-expired-key-07'), OutcomeUnknown);
  await assert.rejects(store.retryRefund(api), ApiError); assert.equal(store.current().state, 'UNCERTAIN');
  assert.throws(() => store.prepare('payment-refunds', intent)); await store.retryRefund(api);
  assert.deepEqual(requests[0], requests[2]);
});
test('P08CTS08-csrf-and-throttling-retain-uncertain-replay', async () => {
  const store = new IntentStore(storage(), owner);
  const api = client([new TypeError('lost'), problem(403, 'CSRF_INVALID'), problem(429, 'AUTH_THROTTLED'), success()]);
  await assert.rejects(store.executeRefund(api, intent, () => 'p08c-security-key-08'));
  for (let i = 0; i < 2; i++) { await assert.rejects(store.retryRefund(api)); assert.equal(store.current().state, 'UNCERTAIN'); }
  await store.retryRefund(api); assert.equal(store.current().state, 'CONFIRMED');
});
test('P08CTS09-authorization-read-denial-is-not-proof-of-rollback', async () => {
  const store = new IntentStore(storage(), owner); const api = client([new TypeError('lost'), problem(403, 'FORBIDDEN'), problem(404, 'NOT_FOUND')]);
  await assert.rejects(store.executeRefund(api, intent, () => 'p08c-denied-key-09'));
  for (let i = 0; i < 2; i++) { await assert.rejects(store.retryRefund(api)); assert.equal(store.current().state, 'UNCERTAIN'); }
});
test('P08CTS10-authoritative-durable-business-rejection-is-final', async () => {
  const store = new IntentStore(storage(), owner); const api = client([problem(422, 'INSUFFICIENT_FUNDS')]);
  await assert.rejects(store.executeRefund(api, intent, () => 'p08c-rejected-key-10'), e => e.status === 422);
  assert.equal(store.current().state, 'REJECTED');
});
test('P08CTS11-malformed-success-cannot-discard-replay-protection', async () => {
  for (const body of [{}, { ...receipt, journalId: '' }, { ...receipt, amountMinor: '1251' }, { ...receipt, kind: 'REVERSAL' }, { ...receipt, currency: 'XXX' }]) {
    const store = new IntentStore(storage(), owner); const api = client([Response.json(body, { status: 201 })]);
    await assert.rejects(store.executeRefund(api, intent, () => 'p08c-malformed-key-11'), OutcomeUnknown);
    assert.equal(store.current().state, 'UNCERTAIN');
  }
});
test('P08CTS12-idempotency-conflict-does-not-authorize-replacement', async () => {
  const store = new IntentStore(storage(), owner); const api = client([new TypeError('lost'), problem(409, 'IDEMPOTENCY_CONFLICT')]);
  await assert.rejects(store.executeRefund(api, intent, () => 'p08c-conflict-key-12'));
  await assert.rejects(store.retryRefund(api)); assert.equal(store.current().state, 'UNCERTAIN');
  assert.throws(() => store.prepare('payment-refunds', { ...intent, amountMinor: '1' }));
});
test('P08CTS13-economic-intent-is-owner-scoped-without-auth-material', () => {
  const mem = storage(); const store = new IntentStore(mem, owner); store.prepare('payment-refunds', intent, () => 'p08c-owner-key-13');
  assert.equal(new IntentStore(mem, '00000000-0000-0000-0000-000000000002').current(), undefined);
  assert.deepEqual(Object.keys(store.current()).sort(), ['ownerId','key','kind','intent','state','createdAt'].sort());
});
test('P08CTS14-refund-reversal-recovery-and-receipt-routes-keep-parent', () => {
  assert.equal(intentRecoveryPath({ kind: 'payment-refunds', intent }), `/payments/${paymentId}`);
  assert.equal(intentRecoveryPath({ kind: 'payment-reversals', intent: { paymentId, reason: 'Correction' } }), `/admin/payments/${paymentId}/reversal`);
  assert.equal(adjustmentRoute('/admin/adjustments').kind, 'lookup');
  assert.equal(adjustmentRoute(adjustmentReceiptPath(paymentId, adjustmentId, true)).administrator, true);
  assert.equal(adjustmentRoute(`/admin/payments/${'-'.repeat(36)}/reversal`), undefined);
  assert.throws(() => adjustmentReceiptPath(paymentId, '../private'));
});
test('P08CTS15-reversal-reason-is-normalized-required-and-bounded', () => {
  assert.equal(adjustmentReason('  Correction  ', true), 'Correction'); assert.equal(adjustmentReason(' ', false), undefined);
  assert.throws(() => adjustmentReason(' ', true)); assert.throws(() => adjustmentReason('a'.repeat(501), false));
});
test('P08CTS16-refund-bound-and-availability-remain-distinct', () => {
  const partial = { ...context, adjustmentState: 'PARTIALLY_REFUNDED', refundedMinor: '1000', remainingRefundableMinor: '1500', recipientAvailableMinor: '500' };
  assert.throws(() => refundMinor('15.01', partial), /remaining/); assert.throws(() => refundMinor('15.00', partial), /available/);
  assert.equal(refundMinor('5.00', partial), '500'); assert.equal(remainingInput(partial), '15.00');
});
test('P08CTS17-invalid-context-identity-and-unavailable-read-do-not-imply-money-failure', async () => {
  let calls = 0; const api = new ApiClient(async () => { calls++; return Response.json(context); });
  assert.throws(() => api.paymentAdjustmentContext('invalid', true)); assert.equal(calls, 0);
  const offline = new ApiClient(async () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(offline.paymentAdjustmentContext(paymentId), error => !(error instanceof TypeError) && !(error instanceof OutcomeUnknown) && error.message.includes('no financial outcome has been inferred'));
});
test('P08CTS18-terminal-adjustment-states-disable-further-money-movement', () => {
  assert.throws(() => validateAdjustmentContext({ ...context, adjustmentState: 'REVERSED', remainingRefundableMinor: '0' }));
  const full = { ...context, adjustmentState: 'FULLY_REFUNDED', refundedMinor: '2500', remainingRefundableMinor: '0', canRefund: false, refundDisabledReason: 'FULLY_REFUNDED' };
  validateAdjustmentContext(full); assert.throws(() => refundMinor('0.01', full), /already/);
});
const escape = s => String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
(async () => { let failures = 0; const rows = []; for (const c of cases) {
  try { await c.run(); console.log('PASS', c.id); rows.push(`<testcase name="${c.id}"/>`); }
  catch (e) { failures++; console.error('FAIL', c.id, e.stack || e.message); rows.push(`<testcase name="${c.id}"><failure message="${escape(e.message)}"/></testcase>`); }
} fs.mkdirSync('.evidence/client', { recursive: true }); fs.writeFileSync('.evidence/client/p08c-results.xml', `<testsuite name="p08c-client" tests="${cases.length}" failures="${failures}" errors="0" skipped="0">${rows.join('\n')}</testsuite>`); console.log(`P08C_CLIENT_SUMMARY tests=${cases.length} failures=${failures}`); process.exitCode = failures ? 1 : 0; })();
