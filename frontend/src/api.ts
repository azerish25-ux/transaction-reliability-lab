import { currency, minor, MAX_TRANSACTION, type Currency } from './money.js';

export interface Problem {
  code: string;
  message: string;
  correlationId: string;
  validation?: Record<string, string>;
}
export interface Session { id: string; email: string; displayName: string; role: 'CUSTOMER' | 'ADMIN'; expiresAt: string; }
export interface Registered { id: string; email: string; displayName: string; role: 'CUSTOMER'; }
export interface Account { id: string; publicRef: string; name: string; currency: Currency; postedMinor: string; reservedMinor: string; availableMinor: string; version: string; updatedAt: string; }
export interface Page<T> { items: T[]; limit: number; offset: number; hasMore: boolean; }
export interface Entry { id: string; journalId: string; operationId: string; kind: string; side: 'DEBIT' | 'CREDIT'; amountMinor: string; currency: Currency; createdAt: string; }
export interface Transaction { journalId: string; operationId: string; kind: string; effectMinor: string; currency: Currency; createdAt: string; }
export interface TransactionDetail extends Transaction { accountId: string; accountPublicRef: string; accountName: string; entries: Entry[]; }
export interface Recipient { publicRef: string; currency: Currency; }
export interface Receipt { operationId: string; state: string; journalId?: string; paymentId?: string; }
export interface Intent { sourceId: string; recipientRef: string; amountMinor: string; currency: Currency; }
export interface TransferReceipt { id: string; kind: 'TRANSFER'; state: 'SETTLED'; journalId: string; amountMinor: string; currency: Currency; }
export interface TransferRecord { id: string; sourceId: string; recipientRef: string; amountMinor: string; currency: Currency; state: 'SETTLED'; journalId: string; createdAt: string; }
export interface PaymentReceipt { id: string; kind: 'PAYMENT'; state: 'PENDING'; amountMinor: string; currency: Currency; }
export interface PaymentRecord { id: string; direction: 'OUTGOING' | 'INCOMING'; accountId: string; counterpartyRef: string; amountMinor: string; currency: Currency; state: 'PENDING' | 'SETTLED' | 'FAILED' | 'CANCELLED'; version: string; adjustmentState: 'NONE' | 'PARTIALLY_REFUNDED' | 'FULLY_REFUNDED' | 'REVERSED'; journalId?: string; failureCode?: string; projectionState?: 'PENDING' | 'SETTLED' | 'FAILED' | 'CANCELLED'; projectionVersion?: string; createdAt: string; updatedAt: string; }
export interface CancellationReceipt { id: string; state: 'CANCELLED'; }
export interface AdjustmentReceipt { id: string; paymentId: string; kind: 'REFUND' | 'REVERSAL'; amountMinor: string; currency: Currency; journalId: string; }
export interface PaymentAdjustment { id: string; paymentId: string; kind: 'REFUND' | 'REVERSAL'; amountMinor: string; currency: Currency; journalId: string; reason: string; createdAt: string; }
export interface PaymentCancellationIntent { paymentId: string; reason?: string; }
export interface PaymentRefundIntent { paymentId: string; amountMinor: string; reason?: string; }
export interface PaymentReversalIntent { paymentId: string; reason: string; }
export interface CommandResponse<T> { status: number; body: T; replayed: boolean; }

export class ApiError extends Error {
  constructor(readonly status: number, readonly problem: Problem) {
    super(problem.message);
    this.name = 'ApiError';
  }
}
export class OutcomeUnknown extends Error {
  constructor() {
    super('Outcome not yet confirmed. Keep this intent and safely retry the same key.');
    this.name = 'OutcomeUnknown';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function identity(value: string, label: string): string {
  if (!UUID.test(value)) throw new TypeError(`Invalid ${label} identity`);
  return value.toLowerCase();
}
function pagination(limit: number, offset: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 10000) {
    throw new TypeError('Invalid pagination');
  }
}
function reason(value: string | undefined, required = false): string | undefined {
  if (value === undefined) {
    if (required) throw new TypeError('Reason is required');
    return undefined;
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > 500) throw new TypeError('Invalid reason');
  return normalized;
}
export function normalizeIntent(input: Intent): Intent {
  const amount = minor(input.amountMinor, MAX_TRANSACTION);
  if (amount === 0n || !UUID.test(input.sourceId)) throw new TypeError('Invalid intent');
  const recipient = input.recipientRef.trim();
  if (!recipient || recipient.length > 80) throw new TypeError('Invalid recipient reference');
  return Object.freeze({ sourceId: input.sourceId.toLowerCase(), recipientRef: recipient, amountMinor: amount.toString(), currency: currency(input.currency) });
}
export function normalizeTransferIntent(input: Intent): Intent {
  const normalized = normalizeIntent(input);
  if (!/^LG-[0-9a-f]{32}$/i.test(normalized.recipientRef)) throw new TypeError('Invalid transfer recipient reference');
  return Object.freeze({ ...normalized, recipientRef: `LG-${normalized.recipientRef.slice(3).toLowerCase()}` });
}
export const normalizePaymentIntent = normalizeTransferIntent;
export function normalizePaymentCancellationIntent(input: PaymentCancellationIntent): PaymentCancellationIntent {
  const paymentId = identity(input.paymentId, 'payment');
  const normalizedReason = reason(input.reason);
  return Object.freeze(normalizedReason === undefined ? { paymentId } : { paymentId, reason: normalizedReason });
}
export function normalizePaymentRefundIntent(input: PaymentRefundIntent): PaymentRefundIntent {
  const paymentId = identity(input.paymentId, 'payment');
  const amount = minor(input.amountMinor, MAX_TRANSACTION);
  if (amount === 0n) throw new TypeError('Invalid refund amount');
  const normalizedReason = reason(input.reason);
  return Object.freeze(normalizedReason === undefined
    ? { paymentId, amountMinor: amount.toString() }
    : { paymentId, amountMinor: amount.toString(), reason: normalizedReason });
}
export function normalizePaymentReversalIntent(input: PaymentReversalIntent): PaymentReversalIntent {
  return Object.freeze({ paymentId: identity(input.paymentId, 'payment'), reason: reason(input.reason, true)! });
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
  accounts(limit = 50, offset = 0): Promise<Page<Account>> {
    pagination(limit, offset);
    return this.get<Page<Account>>(`/accounts?limit=${limit}&offset=${offset}`);
  }
  accountById(id: string): Promise<Account> {
    return this.get<Account>(`/accounts/${identity(id, 'account')}`);
  }
  accountEntries(id: string, limit = 50, offset = 0): Promise<Page<Entry>> {
    pagination(limit, offset);
    return this.get<Page<Entry>>(`/accounts/${identity(id, 'account')}/entries?limit=${limit}&offset=${offset}`);
  }
  accountTransactions(id: string, limit = 50, offset = 0): Promise<Page<Transaction>> {
    pagination(limit, offset);
    return this.get<Page<Transaction>>(`/accounts/${identity(id, 'account')}/transactions?limit=${limit}&offset=${offset}`);
  }
  accountTransaction(id: string, journalId: string): Promise<TransactionDetail> {
    return this.get<TransactionDetail>(`/accounts/${identity(id, 'account')}/transactions/${identity(journalId, 'journal')}`);
  }
  async createAccount(name: string, unit: Currency): Promise<Account> {
    return (await this.command<Account>('/accounts', { name, currency: currency(unit) })).body;
  }
  transfer(input: Intent, key: string): Promise<CommandResponse<TransferReceipt>> {
    return this.command<TransferReceipt>('/transfers', normalizeTransferIntent(input), key);
  }
  transferById(id: string): Promise<TransferRecord> {
    return this.get<TransferRecord>(`/transfers/${identity(id, 'transfer')}`);
  }
  transfers(limit = 50, offset = 0): Promise<Page<TransferRecord>> {
    pagination(limit, offset);
    return this.get<Page<TransferRecord>>(`/transfers?limit=${limit}&offset=${offset}`);
  }
  payment(input: Intent, key: string): Promise<CommandResponse<PaymentReceipt>> {
    return this.command<PaymentReceipt>('/payments', normalizePaymentIntent(input), key);
  }
  paymentById(id: string): Promise<PaymentRecord> {
    return this.get<PaymentRecord>(`/payments/${identity(id, 'payment')}`);
  }
  payments(limit = 50, offset = 0): Promise<Page<PaymentRecord>> {
    pagination(limit, offset);
    return this.get<Page<PaymentRecord>>(`/payments?limit=${limit}&offset=${offset}`);
  }
  cancelPayment(id: string, key: string, cancellationReason?: string): Promise<CommandResponse<CancellationReceipt>> {
    const input = normalizePaymentCancellationIntent({ paymentId: id, reason: cancellationReason });
    return this.command<CancellationReceipt>(`/payments/${input.paymentId}/cancel`, input.reason === undefined ? {} : { reason: input.reason }, key);
  }
  refundPayment(id: string, amountMinor: string, key: string, refundReason?: string): Promise<CommandResponse<AdjustmentReceipt>> {
    const input = normalizePaymentRefundIntent({ paymentId: id, amountMinor, reason: refundReason });
    const body: { amountMinor: string; reason?: string } = { amountMinor: input.amountMinor };
    if (input.reason !== undefined) body.reason = input.reason;
    return this.command<AdjustmentReceipt>(`/payments/${input.paymentId}/refunds`, body, key);
  }
  reversePayment(id: string, reversalReason: string, key: string): Promise<CommandResponse<AdjustmentReceipt>> {
    const input = normalizePaymentReversalIntent({ paymentId: id, reason: reversalReason });
    return this.command<AdjustmentReceipt>(`/payments/${input.paymentId}/reversal`, { reason: input.reason }, key);
  }
  paymentAdjustments(id: string, limit = 50, offset = 0): Promise<Page<PaymentAdjustment>> {
    const paymentId = identity(id, 'payment');
    pagination(limit, offset);
    return this.get<Page<PaymentAdjustment>>(`/payments/${paymentId}/adjustments?limit=${limit}&offset=${offset}`);
  }
  paymentAdjustment(id: string, adjustmentId: string): Promise<PaymentAdjustment> {
    return this.get<PaymentAdjustment>(`/payments/${identity(id, 'payment')}/adjustments/${identity(adjustmentId, 'adjustment')}`);
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
      response = await this.transport.call(globalThis, `${this.prefix}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'same-origin',
        redirect: 'error',
        signal: AbortSignal.timeout(15_000)
      });
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
      try {
        result = await response.json();
      } catch {
        if (method === 'POST' && key) throw new OutcomeUnknown();
        throw new TypeError('Invalid API response');
      }
    }
    if (!response.ok) {
      const p = result as Partial<Problem> & { title?: string; validation?: Record<string, string> };
      throw new ApiError(response.status, {
        code: p?.code ?? 'HTTP_ERROR',
        message: p?.message ?? p?.title ?? 'Request could not be completed.',
        correlationId: p?.correlationId ?? '',
        validation: p?.validation ?? {}
      });
    }
    return { status: response.status, body: result as T, replayed: response.headers.get('Idempotency-Replayed') === 'true' };
  }
}
