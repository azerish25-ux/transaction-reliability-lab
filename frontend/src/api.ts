import { currency, minor, MAX_TRANSACTION, type Currency } from './money.js';
export interface Problem { code: string; message: string; correlationId: string; }
export interface Session { id: string; email: string; displayName: string; role: 'CUSTOMER' | 'ADMIN'; expiresAt: string; }
export interface Registered { id: string; email: string; displayName: string; role: 'CUSTOMER'; }
export interface Account { id: string; publicRef: string; name: string; currency: Currency; postedMinor: string; reservedMinor: string; availableMinor: string; version: string; updatedAt: string; }
export interface Page<T> { items: T[]; limit: number; offset: number; hasMore: boolean; }
export interface Entry { id: string; journalId: string; operationId: string; kind: string; side: 'DEBIT' | 'CREDIT'; amountMinor: string; currency: Currency; createdAt: string; }
export interface Transaction { journalId: string; operationId: string; kind: string; effectMinor: string; currency: Currency; createdAt: string; }
export interface Recipient { publicRef: string; currency: Currency; }
export interface Receipt { operationId: string; state: string; journalId?: string; paymentId?: string; }
export interface Intent { sourceId: string; recipientRef: string; amountMinor: string; currency: Currency; }
export interface TransferReceipt { id: string; kind: 'TRANSFER'; state: 'SETTLED'; journalId: string; amountMinor: string; currency: Currency; }
export interface TransferRecord { id: string; sourceId: string; recipientRef: string; amountMinor: string; currency: Currency; state: 'SETTLED'; journalId: string; createdAt: string; }
export interface CommandResponse<T> { status: number; body: T; replayed: boolean; }
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
export function normalizeTransferIntent(input: Intent): Intent {
  const normalized = normalizeIntent(input);
  if (!/^LG-[0-9a-f]{32}$/i.test(normalized.recipientRef)) throw new TypeError('Invalid transfer recipient reference');
  return Object.freeze({ ...normalized, recipientRef: `LG-${normalized.recipientRef.slice(3).toLowerCase()}` });
}

export class ApiClient {
  private csrf: { headerName: string; token: string } | undefined;
  constructor(private readonly transport: typeof fetch = fetch, private readonly prefix = '/api/v1') {
    if (!prefix.startsWith('/') || prefix.startsWith('//') || prefix.includes('..')) throw new TypeError('Expected same-origin API prefix');
  }
  async get<T>(path: string): Promise<T> { return (await this.request<T>(path, 'GET')).body; }
  async csrfToken(): Promise<void> {
    const token = await this.get<{ headerName: string; token: string }>('/auth/csrf');
    if (token.headerName !== 'X-XSRF-TOKEN' || !token.token) throw new TypeError('Invalid CSRF token response');
    this.csrf = token;
  }
  clearSession(): void { this.csrf = undefined; }
  async register(input: { email: string; password: string; displayName: string }): Promise<Registered> {
    return (await this.command<Registered>('/auth/register', input)).body;
  }
  async login(email: string, password: string): Promise<Session> {
    const response = await this.command<Session>('/auth/login', { email, password });
    await this.csrfToken();
    return response.body;
  }
  async logout(): Promise<void> {
    await this.command<void>('/auth/logout', undefined);
    await this.csrfToken();
  }
  me(): Promise<Session> { return this.get<Session>('/auth/me'); }
  accounts(limit = 50, offset = 0): Promise<Page<Account>> { return this.get<Page<Account>>(`/accounts?limit=${limit}&offset=${offset}`); }
  async createAccount(name: string, unit: Currency): Promise<Account> {
    return (await this.command<Account>('/accounts', { name, currency: currency(unit) })).body;
  }
  transfer(input: Intent, key: string): Promise<CommandResponse<TransferReceipt>> {
    return this.command<TransferReceipt>('/transfers', normalizeTransferIntent(input), key);
  }
  transferById(id: string): Promise<TransferRecord> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new TypeError('Invalid transfer identity');
    return this.get<TransferRecord>(`/transfers/${id.toLowerCase()}`);
  }
  transfers(limit = 50, offset = 0): Promise<Page<TransferRecord>> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 10000) throw new TypeError('Invalid pagination');
    return this.get<Page<TransferRecord>>(`/transfers?limit=${limit}&offset=${offset}`);
  }
  async command<T>(path: string, body: unknown, key?: string): Promise<CommandResponse<T>> {
    if (!this.csrf) await this.csrfToken();
    return this.request<T>(path, 'POST', body, key);
  }
  private async request<T>(path: string, method: 'GET' | 'POST', body?: unknown, key?: string): Promise<CommandResponse<T>> {
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
    if (method === 'POST' && key && (response.status >= 500 || response.status === 408)) throw new OutcomeUnknown();
    if (response.status === 401) this.clearSession();
    if (response.ok && (path === '/auth/login' || path === '/auth/logout')) this.clearSession();
    let result: unknown;
    if (response.status === 204) {
      result = undefined;
    } else {
      try { result = await response.json(); } catch {
        if (method === 'POST' && key) throw new OutcomeUnknown();
        throw new TypeError('Invalid API response');
      }
    }
    if (!response.ok) {
      const p = result as Partial<Problem> & { title?: string };
      throw new ApiError(response.status, { code: p?.code ?? 'HTTP_ERROR', message: p?.message ?? p?.title ?? 'Request could not be completed.', correlationId: p?.correlationId ?? '' });
    }
    return { status: response.status, body: result as T, replayed: response.headers.get('Idempotency-Replayed') === 'true' };
  }
}
