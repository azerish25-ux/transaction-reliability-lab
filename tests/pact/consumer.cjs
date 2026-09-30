// Genuine Pact JS generation through the shipped TypeScript API client.
// Transport adapts the browser's same-origin URL to Pact's local mock server only.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { PactV3, MatchersV3: M } = require('../../frontend/node_modules/@pact-foundation/pact');
const { ApiClient } = require('../../.evidence/ts/api.js');
const output = path.resolve(__dirname, '../../.evidence/pact');
const account = {
  id: M.uuid('11111111-1111-4111-8111-111111111111'),
  publicRef: M.regex('LG-[0-9a-f]{32}', 'LG-11111111111111111111111111111111'),
  name: 'Contract wallet', currency: 'CAD', postedMinor: '0', reservedMinor: '0',
  availableMinor: '0', version: M.regex('[0-9]+', '0'),
  updatedAt: M.regex('^.+T.+Z$', '2026-09-30T00:00:00Z')
};
const pact = () => new PactV3({ consumer: 'BadPennyWeb', provider: 'BadPennyApi', dir: output, logLevel: 'warn' });
const client = server => new ApiClient((url, options) => fetch(new URL(url, server.url), options));
async function main() {
  // Discard only this test's generated contract; Pact otherwise merges stale interactions.
  fs.rmSync(path.join(output, 'BadPennyWeb-BadPennyApi.json'), { force: true });
  await pact().given('authenticated customer with no accounts').uponReceiving('read the current customer')
    .withRequest({ method: 'GET', path: '/api/v1/auth/me' })
    .willRespondWith({ status: 200, body: { id: M.uuid('11111111-1111-4111-8111-111111111111'), email: M.regex('^contract[0-9]+@example.test$', 'contract1@example.test'), displayName: 'Contract Customer', role: 'CUSTOMER', expiresAt: M.regex('^.+T.+Z$', '2026-09-30T01:00:00Z') } })
    .executeTest(async server => { const me = await client(server).me(); assert.equal(me.role, 'CUSTOMER'); assert.equal(me.displayName, 'Contract Customer'); });
  await pact().given('authenticated customer with no accounts').uponReceiving('read an empty wallet page')
    .withRequest({ method: 'GET', path: '/api/v1/accounts', query: { limit: '50', offset: '0' } })
    .willRespondWith({ status: 200, body: { items: [], limit: 50, offset: 0, hasMore: false } })
    .executeTest(async server => assert.deepEqual(await client(server).accounts(), { items: [], limit: 50, offset: 0, hasMore: false }));
  await pact().given('authenticated customer with a zero balance account').uponReceiving('read a wallet page with money serialized as strings')
    .withRequest({ method: 'GET', path: '/api/v1/accounts', query: { limit: '50', offset: '0' } })
    .willRespondWith({ status: 200, body: { items: [account], limit: 50, offset: 0, hasMore: false } })
    .executeTest(async server => { const page = await client(server).accounts(); assert.equal(page.items.length, 1); assert.equal(page.items[0].postedMinor, '0'); assert.equal(page.items[0].availableMinor, '0'); });
  const creation = pact().given('authenticated customer with no accounts').uponReceiving('obtain a CSRF token before creating a wallet')
    .withRequest({ method: 'GET', path: '/api/v1/auth/csrf' })
    .willRespondWith({ status: 200, body: { headerName: 'X-XSRF-TOKEN', token: M.string('contract-csrf-token') } });
  creation.given('authenticated customer with no accounts').uponReceiving('create a CAD wallet using the real client')
    .withRequest({ method: 'POST', path: '/api/v1/accounts', headers: { 'Content-Type': 'application/json', 'X-XSRF-TOKEN': 'contract-csrf-token' }, body: { name: 'Contract wallet', currency: 'CAD' } })
    .willRespondWith({ status: 201, body: account });
  await creation.executeTest(async server => { const created = await client(server).createAccount('Contract wallet', 'CAD'); assert.equal(created.name, 'Contract wallet'); assert.equal(created.postedMinor, '0'); });
}
main().catch(error => { console.error(error); process.exitCode = 1; });
