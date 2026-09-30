// Sensitivity check for Pact's wire-schema comparison, using in-memory synthetic
// responses only. This is NOT verification of the Spring provider.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { Verifier } = require('../../frontend/node_modules/@pact-foundation/pact');
const dir = path.resolve(__dirname, '../../.evidence/pact-sensitivity');
fs.mkdirSync(dir, { recursive: true });
const generated = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../.evidence/pact/BadPennyWeb-BadPennyApi.json')));
const interaction = generated.interactions.find(i => i.description === 'read a wallet page with money serialized as strings');
assert.ok(interaction, 'Generate the actual client Pact first');
const selected = { ...generated, interactions: [interaction] };
const pactPath = path.join(dir, 'selected.json'); fs.writeFileSync(pactPath, JSON.stringify(selected));
async function verify(body) {
  const server = http.createServer((request, response) => {
    assert.equal(request.url, '/api/v1/accounts?limit=50&offset=0');
    response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await new Verifier({ provider: 'BadPennyApi', providerBaseUrl: `http://127.0.0.1:${server.address().port}`,
      pactUrls: [pactPath], logLevel: 'error', stateHandlers: { 'authenticated customer with a zero balance account': () => {} }
    }).verifyProvider();
  } finally { await new Promise(resolve => server.close(resolve)); }
}
(async () => {
  await verify(interaction.response.body);
  const incompatible = structuredClone(interaction.response.body);
  incompatible.items[0].postedMinor = 0;
  await assert.rejects(verify(incompatible), /Verif|mismatch|fail/i);
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({ scope: 'synthetic Pact engine sensitivity, not real provider acceptance', compatible: 'PASS', numericMoneyInsteadOfString: 'REJECTED' }, null, 2));
  console.log('PASS: compatible synthetic schema accepted; numeric money incompatibility rejected by Pact');
})().catch(error => { console.error(error); process.exitCode = 1; });
