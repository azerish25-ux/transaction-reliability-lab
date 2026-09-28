import {
  ApiClient, ApiError, OutcomeUnknown,
  type AdjustmentReceipt, type CancellationReceipt, type CommandResponse, type Intent,
  type PaymentCancellationIntent, type PaymentReceipt, type PaymentRefundIntent,
  type PaymentReversalIntent, type TransferReceipt,
  normalizeIntent, normalizePaymentCancellationIntent, normalizePaymentIntent,
  normalizePaymentRefundIntent, normalizePaymentReversalIntent, normalizeTransferIntent
} from './api.js';
export type IntentState = 'PREPARED' | 'UNCERTAIN' | 'CONFIRMED' | 'REJECTED';
export type IntentKind = 'transfers' | 'payments' | 'payment-cancellations' | 'payment-refunds' | 'payment-reversals';
export type EconomicIntent = Intent | PaymentCancellationIntent | PaymentRefundIntent | PaymentReversalIntent;
export interface StoredIntent { ownerId: string; key: string; kind: IntentKind; intent: EconomicIntent; state: IntentState; createdAt: string; }
/** Stores only economic intent. Authentication/CSRF/JWT material must never enter this store. */
export class IntentStore {
  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, private readonly ownerId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(ownerId)) throw new TypeError('Invalid owner identity');
  }
  private get slot(): string { return `ledgerguard.intent.v1.${this.ownerId}`; }
  current(): StoredIntent | undefined {
    const text = this.storage.getItem(this.slot);
    if (!text) return undefined;
    if (text.length > 4096) throw new TypeError('Stored intent too large');
    const record = JSON.parse(text) as StoredIntent;
    if (record.ownerId !== this.ownerId || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(record.key)
      || !['transfers','payments','payment-cancellations','payment-refunds','payment-reversals'].includes(record.kind)
      || !['PREPARED','UNCERTAIN','CONFIRMED','REJECTED'].includes(record.state)
      || !Number.isFinite(Date.parse(record.createdAt))) throw new TypeError('Invalid stored intent');
    record.intent = normalizeStored(record.kind, record.intent);
    return record;
  }
  prepare(kind: IntentKind, input: EconomicIntent, newKey: () => string = () => crypto.randomUUID()): StoredIntent {
    const previous = this.current();
    if (previous && ['PREPARED','UNCERTAIN'].includes(previous.state)) throw new Error('Resolve the previous intent before creating another one.');
    const record: StoredIntent = { ownerId: this.ownerId, kind, key: newKey(), intent: normalizeStored(kind, input), state: 'PREPARED', createdAt: new Date().toISOString() };
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(record.key)) throw new TypeError('Invalid generated key');
    this.storage.setItem(this.slot, JSON.stringify(record));
    return record;
  }
  transition(state: Exclude<IntentState, 'PREPARED'>): StoredIntent {
    const current = this.current();
    if (!current || !['PREPARED','UNCERTAIN'].includes(current.state)) throw new Error('No unresolved intent.');
    const updated = { ...current, state };
    this.storage.setItem(this.slot, JSON.stringify(updated));
    return updated;
  }
  async executeTransfer(api: ApiClient, input: Intent, newKey: () => string = () => crypto.randomUUID()): Promise<CommandResponse<TransferReceipt>> {
    return this.sendPreparedTransfer(api, this.prepare('transfers', normalizeTransferIntent(input), newKey));
  }
  async retryTransfer(api: ApiClient): Promise<CommandResponse<TransferReceipt>> {
    return this.sendPreparedTransfer(api, this.unresolved('transfers'));
  }
  async executePayment(api: ApiClient, input: Intent, newKey: () => string = () => crypto.randomUUID()): Promise<CommandResponse<PaymentReceipt>> {
    return this.sendPreparedPayment(api, this.prepare('payments', normalizePaymentIntent(input), newKey));
  }
  async retryPayment(api: ApiClient): Promise<CommandResponse<PaymentReceipt>> {
    return this.sendPreparedPayment(api, this.unresolved('payments'));
  }
  async executeCancellation(api: ApiClient, input: PaymentCancellationIntent, newKey: () => string = () => crypto.randomUUID()): Promise<CommandResponse<CancellationReceipt>> {
    return this.sendPreparedCancellation(api, this.prepare('payment-cancellations', input, newKey));
  }
  async retryCancellation(api: ApiClient): Promise<CommandResponse<CancellationReceipt>> {
    return this.sendPreparedCancellation(api, this.unresolved('payment-cancellations'));
  }
  async executeRefund(api: ApiClient, input: PaymentRefundIntent, newKey: () => string = () => crypto.randomUUID()): Promise<CommandResponse<AdjustmentReceipt>> {
    return this.sendPreparedRefund(api, this.prepare('payment-refunds', input, newKey));
  }
  async retryRefund(api: ApiClient): Promise<CommandResponse<AdjustmentReceipt>> {
    return this.sendPreparedRefund(api, this.unresolved('payment-refunds'));
  }
  async executeReversal(api: ApiClient, input: PaymentReversalIntent, newKey: () => string = () => crypto.randomUUID()): Promise<CommandResponse<AdjustmentReceipt>> {
    return this.sendPreparedReversal(api, this.prepare('payment-reversals', input, newKey));
  }
  async retryReversal(api: ApiClient): Promise<CommandResponse<AdjustmentReceipt>> {
    return this.sendPreparedReversal(api, this.unresolved('payment-reversals'));
  }
  private unresolved(kind: IntentKind): StoredIntent {
    const current = this.current();
    if (!current || current.kind !== kind || !['PREPARED','UNCERTAIN'].includes(current.state)) throw new Error(`No unresolved ${kind} intent.`);
    return current;
  }
  private async resolve<T>(command: () => Promise<CommandResponse<T>>): Promise<CommandResponse<T>> {
    try {
      const response = await command();
      this.transition('CONFIRMED');
      return response;
    } catch (failure) {
      if (failure instanceof OutcomeUnknown) this.transition('UNCERTAIN');
      else if (failure instanceof ApiError && failure.status < 500) {
        const admissionFailure = failure.status === 401 || failure.status === 429
          || failure.problem.code === 'CSRF_INVALID' || failure.problem.code === 'IDEMPOTENCY_CONFLICT';
        const stillUncertain = this.current()?.state === 'UNCERTAIN';
        const durableRejection = failure.status === 409 || failure.status === 422;
        if (!admissionFailure && (!stillUncertain || durableRejection)) this.transition('REJECTED');
      }
      throw failure;
    }
  }
  private sendPreparedTransfer(api: ApiClient, record: StoredIntent): Promise<CommandResponse<TransferReceipt>> {
    return this.resolve(() => api.transfer(record.intent as Intent, record.key));
  }
  private sendPreparedPayment(api: ApiClient, record: StoredIntent): Promise<CommandResponse<PaymentReceipt>> {
    return this.resolve(() => api.payment(record.intent as Intent, record.key));
  }
  private sendPreparedCancellation(api: ApiClient, record: StoredIntent): Promise<CommandResponse<CancellationReceipt>> {
    const input = record.intent as PaymentCancellationIntent;
    return this.resolve(() => api.cancelPayment(input.paymentId, record.key, input.reason));
  }
  private sendPreparedRefund(api: ApiClient, record: StoredIntent): Promise<CommandResponse<AdjustmentReceipt>> {
    const input = record.intent as PaymentRefundIntent;
    return this.resolve(() => api.refundPayment(input.paymentId, input.amountMinor, record.key, input.reason));
  }
  private sendPreparedReversal(api: ApiClient, record: StoredIntent): Promise<CommandResponse<AdjustmentReceipt>> {
    const input = record.intent as PaymentReversalIntent;
    return this.resolve(() => api.reversePayment(input.paymentId, input.reason, record.key));
  }
  // Logout does not erase uncertain operations. A subsequent login by this owner may resolve/replay them.
  forgetConfirmed(): void {
    const current = this.current();
    if (current && !['CONFIRMED','REJECTED'].includes(current.state)) throw new Error('Cannot forget an uncertain operation.');
    this.storage.removeItem(this.slot);
  }
}

function normalizeStored(kind: IntentKind, input: EconomicIntent): EconomicIntent {
  switch (kind) {
    case 'transfers':
    case 'payments': return normalizeIntent(input as Intent);
    case 'payment-cancellations': return normalizePaymentCancellationIntent(input as PaymentCancellationIntent);
    case 'payment-refunds': return normalizePaymentRefundIntent(input as PaymentRefundIntent);
    case 'payment-reversals': return normalizePaymentReversalIntent(input as PaymentReversalIntent);
  }
}
