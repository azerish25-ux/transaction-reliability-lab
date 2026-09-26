import { currency, minor, MAX_TRANSACTION, type Currency } from './money.js';
export interface Problem { code: string; message: string; correlationId: string; }
export interface Session { id: string; name: string; role: 'CUSTOMER' | 'ADMIN'; expiresAt: string; }
export interface Account { id: string; publicRef: string; name: string; currency: Currency; postedMinor: string; reservedMinor: string; availableMinor: string; version: string; updatedAt: string; }
export interface Receipt { operationId: string; state: string; journalId?: string; paymentId?: string; }
export interface Intent { sourceId: string; recipientRef: string; amountMinor: string; currency: Currency; }
export class ApiError extends Error {
  constructor(readonly status: number, readonly problem: Problem) { super(problem.message); this.name = 'ApiError'; }
}
export class OutcomeUnknown extends Error {
  constructor() { super('Outcome not yet confirmed. Keep this intent and safely retry the same key.'); this.name = 'OutcomeUnknown'; }
}
export function normalizeIntent(input: Intent): Intent {
  const amount = minor(input.amountMinor, MAX_TRANSACTION);
  if (amount === 0n || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.sourceId)) throw new TypeError('Invalid intent');
  const recipient = input.recipientRef.trim();
  if (!recipient || recipient.length > 80) throw new TypeError('Invalid recipient reference');
  return Object.freeze({ sourceId: input.sourceId.toLowerCase(), recipientRef: recipient, amountMinor: amount.toString(), currency: currency(input.currency) });
}
export class ApiClient {
  private csrf: { headerName: string; token: string } | undefined;
  constructor(private readonly transport: typeof fetch = fetch, private readonly prefix = '/api/v1') {
    // The production browser client is same origin; injected prefixes belong only to test harnesses.
    if (!prefix.startsWith('/') || prefix.startsWith('//') || prefix.includes('..')) throw new TypeError('Expected same-origin API prefix');
  }
  async get<T>(path: string): Promise<T> { return (await this.request<T>(path, 'GET')).body; }
  async csrfToken(): Promise<void> {
    const token = await this.get<{ headerName: string; token: string }>('/auth/csrf');
    if (token.headerName !== 'X-XSRF-TOKEN' || !token.token) throw new TypeError('Invalid CSRF token response');
    this.csrf = token;
  }
  clearSession(): void { this.csrf = undefined; }
  async command<T>(path: string, body: unknown, key?: string): Promise<{ status: number; body: T; replayed: boolean }> {
    if (!this.csrf) await this.csrfToken();
    return this.request<T>(path, 'POST', body, key);
  }
  private async request<T>(path: string, method: 'GET' | 'POST', body?: unknown, key?: string): Promise<{ status: number; body: T; replayed: boolean }> {
    if (!path.startsWith('/') || path.startsWith('//') || /[\r\n]/.test(path)) throw new TypeError('Invalid API path');
    const headers = new Headers({ Accept: 'application/json' });
    if (method !== 'GET') {
      headers.set('Content-Type', 'application/json');
      if (!this.csrf) throw new TypeError('CSRF token required');
      headers.set(this.csrf.headerName, this.csrf.token);
    }
    if (key) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(key)) throw new TypeError('Invalid idempotency key');
      headers.set('Idempotency-Key', key);
    }
    let response: Response;
    try {
      response = await this.transport(`${this.prefix}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin', redirect: 'error', signal: AbortSignal.timeout(15_000) });
    } catch (cause) {
      if (method === 'POST' && key) throw new OutcomeUnknown();
      throw cause;
    }
    let result: unknown;
    try { result = await response.json(); } catch {
      if (method === 'POST' && key) throw new OutcomeUnknown();
      throw new TypeError('Invalid API response');
    }
    if (!response.ok) {
      if (response.status === 401) this.clearSession();
      const p = result as Partial<Problem>;
      throw new ApiError(response.status, { code: p?.code ?? 'HTTP_ERROR', message: p?.message ?? 'Request could not be completed.', correlationId: p?.correlationId ?? '' });
    }
    return { status: response.status, body: result as T, replayed: response.headers.get('Idempotency-Replayed') === 'true' };
  }
}
