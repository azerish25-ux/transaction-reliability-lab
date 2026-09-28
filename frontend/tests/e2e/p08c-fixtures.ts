import { test as base, expect, type APIRequestContext, type Page, type TestInfo } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Account, PaymentRecord } from '../../src/api.js';
import type { Currency } from '../../src/money.js';

const runtimePath = path.resolve('../.ledgerguard/runtime.env');
const runtime = Object.fromEntries(fs.readFileSync(runtimePath, 'utf8').split(/\r?\n/)
  .filter(line => line && !line.startsWith('#') && line.includes('='))
  .map(line => { const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)]; }));
const uuid = (value: string): string => { if (!/^[0-9a-f-]{36}$/i.test(value)) throw new Error('Invalid fixture UUID'); return value; };

/** Only disposable Compose fixture setup and independent read oracles use the owner role.
 * No credential is present in arguments, exception messages, test results or screenshots. */
export function sql(query: string): string {
  if (!runtime.LEDGER_OWNER_PASSWORD || !runtime.POSTGRES_DB) throw new Error('Missing isolated Compose database configuration');
  try {
    return execFileSync('docker', ['compose', '--env-file', runtimePath, '-f', path.resolve('../compose.yaml'),
      'exec', '-T', '-e', 'PGPASSWORD', 'postgres', 'psql', '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1',
      '-U', 'ledger_owner', '-d', runtime.POSTGRES_DB, '-c', query], {
      env: { ...process.env, PGPASSWORD: runtime.LEDGER_OWNER_PASSWORD }, encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
  } catch { throw new Error('P08C fixture/oracle SQL failed; inspect redacted service diagnostics.'); }
}
export interface Actor { id: string; email: string; password: string; displayName: string; api: APIRequestContext; admin: boolean; }
export interface Fixture { payer: Actor; recipient: Actor; source: Account; destination: Account; payment: PaymentRecord; }
export async function csrf(api: APIRequestContext): Promise<{ headerName: string; token: string }> {
  const response = await api.get('/api/v1/auth/csrf'); expect(response.status()).toBe(200); return response.json();
}
export async function command(api: APIRequestContext, endpoint: string, body: unknown, key = randomUUID()) {
  const token = await csrf(api);
  return api.post(`/api/v1${endpoint}`, { data: body, headers: { [token.headerName]: token.token, 'Idempotency-Key': key } });
}
export async function read<T>(api: APIRequestContext, endpoint: string): Promise<T> {
  const response = await api.get(`/api/v1${endpoint}`); expect(response.status()).toBe(200); return response.json();
}
export class Lab {
  private readonly contexts: APIRequestContext[] = [];
  constructor(private readonly playwright: typeof import('playwright-core'), private readonly baseURL: string) {
    const host = new URL(baseURL).hostname;
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) throw new Error('P08C fixture mutation requires a local disposable Compose target.');
  }
  async actor(admin = false): Promise<Actor> {
    const api = await this.playwright.request.newContext({ baseURL: this.baseURL }); this.contexts.push(api);
    const email = `p08c-${randomUUID()}@example.test`, password = `P08C-${randomUUID()}-Fixture!`, displayName = admin ? 'P08C Reviewer' : 'P08C Customer';
    const registered = await command(api, '/auth/register', { email, password, displayName }); expect(registered.status()).toBe(201);
    const identity = await registered.json() as { id: string };
    if (admin) sql(`UPDATE ledger.app_users SET role='ADMIN' WHERE id='${uuid(identity.id)}';`);
    const login = await command(api, '/auth/login', { email, password }); expect(login.status()).toBe(200);
    return { id: identity.id, email, password, displayName, api, admin };
  }
  async wallet(actor: Actor, currency: Currency = 'CAD'): Promise<Account> {
    const response = await command(actor.api, '/accounts', { name: 'P08C isolated wallet', currency }); expect(response.status()).toBe(201); return response.json();
  }
  async settled(amountMinor = '2500', currency: Currency = 'CAD'): Promise<Fixture> {
    const payer = await this.actor(), recipient = await this.actor();
    const source = await this.wallet(payer, currency), destination = await this.wallet(recipient, currency);
    if (!/^\d{1,12}$/.test(amountMinor) || BigInt(amountMinor) <= 0n || !['CAD', 'USD', 'JPY', 'KWD'].includes(currency)) throw new Error('Invalid fixture amount');
    const asset = randomUUID();
    sql(`BEGIN; INSERT INTO ledger.accounts(id,label,currency,kind) VALUES('${asset}','P08C synthetic asset','${currency}','SANDBOX_FUNDING_ASSET');
      INSERT INTO ledger.account_balances(account_id) VALUES('${asset}');
      SELECT ledger._post('${randomUUID()}','FUNDING','${asset}','${uuid(source.id)}',${amountMinor},'${currency}'); COMMIT;`);
    const response = await command(payer.api, '/payments', { sourceId: source.id, recipientRef: destination.publicRef, amountMinor, currency });
    expect(response.status()).toBe(202); const accepted = await response.json() as { id: string; state: string }; expect(accepted.state).toBe('PENDING');
    await expect.poll(async () => (await read<PaymentRecord>(payer.api, `/payments/${accepted.id}`)).state, { timeout: 40_000, intervals: [100, 200, 400, 800] }).toBe('SETTLED');
    return { payer, recipient, source, destination, payment: await read(payer.api, `/payments/${accepted.id}`) };
  }
  async dispose(): Promise<void> { for (const context of this.contexts) await context.dispose(); }
}
export const test = base.extend<{ lab: Lab }>({ lab: async ({ playwright, baseURL }, use) => {
  if (!baseURL) throw new Error('Missing local UI URL'); const lab = new Lab(playwright, baseURL);
  try { await use(lab); } finally { await lab.dispose(); }
} });
export { expect };
export async function signIn(page: Page, actor: Actor): Promise<void> {
  await page.goto('/'); await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await page.getByLabel('Email address').fill(actor.email); await page.getByLabel('Password', { exact: true }).fill(actor.password);
  await page.getByRole('button', { name: 'Sign in securely' }).click();
  await expect(page.getByRole('heading', { name: actor.admin ? 'Payment adjustments' : `Welcome, ${actor.displayName}`, exact: true })).toBeVisible();
}
export async function accessible(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(result.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) }))).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}
export async function screenshot(page: Page, info: TestInfo, name: string): Promise<void> {
  const folder = path.resolve('../.evidence/playwright/screenshots'); fs.mkdirSync(folder, { recursive: true });
  // Start at the real document top so full-page capture cannot stitch offscreen fixed controls into view.
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.screenshot({ path: path.join(folder, `${info.project.name}-${name}.png`), fullPage: true, animations: 'disabled' });
}
export async function reviewRefund(page: Page, amount: string): Promise<void> {
  await page.getByLabel(/^Refund amount/).fill(amount); await page.getByRole('button', { name: 'Review refund', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Confirm refund', exact: true })).toBeVisible();
}
export async function confirmRefund(page: Page): Promise<void> {
  await page.getByRole('dialog', { name: 'Confirm refund', exact: true }).getByRole('button', { name: 'Confirm refund', exact: true }).click();
}
/** Recompute amounts from immutable entries, not from the endpoint's adjustment helper. */
export function ledgerOracle(f: Fixture, adjustedMinor: string, adjustments: number, reversed = false): void {
  const id = uuid(f.payment.id);
  const row = JSON.parse(sql(`SELECT json_build_object('state',p.state,'journal',p.journal_id,'refunded',p.refunded_minor::text,'reversed',p.reversed,
    'count',(SELECT count(*) FROM ledger.adjustments WHERE payment_id=p.id),
    'journals',(SELECT count(DISTINCT journal_id) FROM ledger.adjustments WHERE payment_id=p.id),
    'debits',(SELECT COALESCE(sum(e.amount_minor::numeric),0)::text FROM ledger.adjustments a JOIN ledger.journal_entries e ON e.journal_id=a.journal_id WHERE a.payment_id=p.id AND e.side='DEBIT'),
    'credits',(SELECT COALESCE(sum(e.amount_minor::numeric),0)::text FROM ledger.adjustments a JOIN ledger.journal_entries e ON e.journal_id=a.journal_id WHERE a.payment_id=p.id AND e.side='CREDIT'),
    'badEntries',(SELECT count(*) FROM ledger.adjustments a JOIN ledger.journal_entries e ON e.journal_id=a.journal_id WHERE a.payment_id=p.id AND ((e.side='DEBIT' AND e.account_id<>p.destination_id) OR (e.side='CREDIT' AND e.account_id<>p.source_id) OR e.currency<>p.currency)),
    'entryCount',(SELECT count(*) FROM ledger.adjustments a JOIN ledger.journal_entries e ON e.journal_id=a.journal_id WHERE a.payment_id=p.id)) FROM ledger.payments p WHERE p.id='${id}';`));
  expect(row).toEqual({ state: 'SETTLED', journal: f.payment.journalId, refunded: reversed ? '0' : adjustedMinor, reversed,
    count: adjustments, journals: adjustments, debits: adjustedMinor, credits: adjustedMinor, badEntries: 0, entryCount: adjustments * 2 });
  expect(sql(`SELECT count(*) FROM ledger.account_balances b WHERE b.account_id IN ('${uuid(f.source.id)}','${uuid(f.destination.id)}') AND
    (b.posted_minor <> (SELECT COALESCE(sum(CASE WHEN e.side='CREDIT' THEN e.amount_minor::numeric ELSE -e.amount_minor::numeric END),0) FROM ledger.journal_entries e WHERE e.account_id=b.account_id) OR b.posted_minor-b.reserved_minor < 0);`)).toBe('0');
}
