// P08A production client contract checks. Live browser and PostgreSQL behavior are exercised separately.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { ApiClient, ApiError } = require('../../.evidence/ts/api.js');
const cases = [];
const test = (id, run) => cases.push({ id, run });
const accountId = '10000000-0000-0000-0000-000000000001';
const journalId = '20000000-0000-0000-0000-000000000001';
const transaction = {
  journalId,
  operationId: '30000000-0000-0000-0000-000000000001',
  kind: 'FUNDING',
  effectMinor: '10000',
  currency: 'CAD',
  createdAt: '2026-09-27T12:00:00Z'
};

test('P08ATS01-owner-account-path', async () => {
  const calls = [];
  const api = new ApiClient(async (url, options) => {
    calls.push({ url, method: options.method, credentials: options.credentials });
    return Response.json({ id: accountId, publicRef: 'LG-10000000000000000000000000000001', name: 'Primary', currency: 'CAD', postedMinor: '10000', reservedMinor: '0', availableMinor: '10000', version: '1', updatedAt: '2026-09-27T12:00:00Z' });
  });
  const account = await api.accountById(accountId.toUpperCase());
  assert.equal(account.postedMinor, '10000');
  assert.deepEqual(calls, [{ url: `/api/v1/accounts/${accountId}`, method: 'GET', credentials: 'same-origin' }]);
});

test('P08ATS02-deterministic-history-pagination', async () => {
  let requested;
  const api = new ApiClient(async url => {
    requested = url;
    return Response.json({ items: [transaction], limit: 15, offset: 30, hasMore: false });
  });
  const page = await api.accountTransactions(accountId, 15, 30);
  assert.equal(requested, `/api/v1/accounts/${accountId}/transactions?limit=15&offset=30`);
  assert.equal(page.items[0].effectMinor, '10000');
  assert.equal(page.offset, 30);
});

test('P08ATS03-customer-safe-detail-path', async () => {
  let requested;
  const detail = { ...transaction, accountId, accountPublicRef: 'LG-10000000000000000000000000000001', accountName: 'Primary', entries: [{ id: '10', journalId, operationId: transaction.operationId, kind: 'FUNDING', side: 'CREDIT', amountMinor: '10000', currency: 'CAD', createdAt: transaction.createdAt }] };
  const api = new ApiClient(async url => { requested = url; return Response.json(detail); });
  assert.deepEqual(await api.accountTransaction(accountId, journalId), detail);
  assert.equal(requested, `/api/v1/accounts/${accountId}/transactions/${journalId}`);
  assert.equal(Object.hasOwn(detail, 'counterpartyBalance'), false);
});

test('P08ATS04-invalid-identity-never-reaches-network', async () => {
  let calls = 0;
  const api = new ApiClient(async () => { calls++; return Response.json({}); });
  assert.throws(() => api.accountTransaction('../other', journalId), /Invalid account identity/);
  assert.throws(() => api.accountTransaction(accountId, 'not-a-journal'), /Invalid journal identity/);
  assert.equal(calls, 0);
});

test('P08ATS05-problem-validation-and-correlation-preserved', async () => {
  const api = new ApiClient(async url => url.endsWith('/auth/csrf')
    ? Response.json({ headerName: 'X-XSRF-TOKEN', token: 'csrf-p08a' })
    : Response.json({ code: 'VALIDATION_FAILED', title: 'Invalid request', correlationId: '40000000-0000-0000-0000-000000000001', validation: { name: 'Invalid value' } }, { status: 400 }));
  await assert.rejects(api.createAccount('', 'CAD'), failure => failure instanceof ApiError && failure.problem.validation.name === 'Invalid value' && failure.problem.correlationId.endsWith('0001'));
});

test('P08ATS06-bounded-pagination-rejected-client-side', async () => {
  let calls = 0;
  const api = new ApiClient(async () => { calls++; return Response.json({}); });
  assert.throws(() => api.accountTransactions(accountId, 101, 0), /Invalid pagination/);
  assert.throws(() => api.accountTransactions(accountId, 15, 10001), /Invalid pagination/);
  assert.equal(calls, 0);
});

const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
(async () => {
  let failures = 0; const rows = [];
  for (const current of cases) {
    try { await current.run(); console.log('PASS', current.id); rows.push(`<testcase name="${current.id}"/>`); }
    catch (failure) { failures++; console.error('FAIL', current.id, failure.message); rows.push(`<testcase name="${current.id}"><failure message="${escape(failure.message)}"/></testcase>`); }
  }
  fs.mkdirSync('.evidence/client', { recursive: true });
  fs.writeFileSync('.evidence/client/p08a-results.xml', `<testsuite name="p08a-client" tests="${cases.length}" failures="${failures}" errors="0" skipped="0">${rows.join('\n')}</testsuite>`);
  console.log(`P08A_CLIENT_SUMMARY tests=${cases.length} failures=${failures}`);
  process.exitCode = failures ? 1 : 0;
})();
