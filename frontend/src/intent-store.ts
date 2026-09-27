import { ApiClient, ApiError, OutcomeUnknown, type CommandResponse, type Intent, type TransferReceipt, type PaymentReceipt, normalizeIntent } from './api.js';
export type IntentState = 'PREPARED' | 'UNCERTAIN' | 'CONFIRMED' | 'REJECTED';
export interface StoredIntent { ownerId: string; key: string; kind: 'transfers' | 'payments'; intent: Intent; state: IntentState; createdAt: string; }
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
    const record: StoredIntent = JSON.parse(text);
    if (record.ownerId !== this.ownerId || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(record.key)
      || !['transfers','payments'].includes(record.kind) || !['PREPARED','UNCERTAIN','CONFIRMED','REJECTED'].includes(record.state)
      || !Number.isFinite(Date.parse(record.createdAt))) throw new TypeError('Invalid stored intent');
    record.intent = normalizeIntent(record.intent);
    return record;
  }
  prepare(kind: 'transfers' | 'payments', input: Intent, newKey: () => string = () => crypto.randomUUID()): StoredIntent {
    const previous = this.current();
    if (previous && ['PREPARED','UNCERTAIN'].includes(previous.state)) throw new Error('Resolve the previous intent before creating another one.');
    const record: StoredIntent = { ownerId: this.ownerId, kind, key: newKey(), intent: normalizeIntent(input), state: 'PREPARED', createdAt: new Date().toISOString() };
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
    const prepared = this.prepare('transfers', input, newKey);
    return this.sendPreparedTransfer(api, prepared);
  }
  async retryTransfer(api: ApiClient): Promise<CommandResponse<TransferReceipt>> {
    const current = this.current();
    if (!current || current.kind !== 'transfers' || !['PREPARED','UNCERTAIN'].includes(current.state)) throw new Error('No unresolved transfer intent.');
    return this.sendPreparedTransfer(api, current);
  }
  async executePayment(api: ApiClient, input: Intent, newKey: () => string = () => crypto.randomUUID()): Promise<CommandResponse<PaymentReceipt>> {
    const prepared = this.prepare('payments', input, newKey);
    return this.sendPreparedPayment(api, prepared);
  }
  async retryPayment(api: ApiClient): Promise<CommandResponse<PaymentReceipt>> {
    const current = this.current();
    if (!current || current.kind !== 'payments' || !['PREPARED','UNCERTAIN'].includes(current.state)) throw new Error('No unresolved payment intent.');
    return this.sendPreparedPayment(api, current);
  }
  private async sendPreparedTransfer(api: ApiClient, record: StoredIntent): Promise<CommandResponse<TransferReceipt>> {
    try {
      const response = await api.transfer(record.intent, record.key);
      this.transition('CONFIRMED');
      return response;
    } catch (failure) {
      if (failure instanceof OutcomeUnknown) this.transition('UNCERTAIN');
      else if (failure instanceof ApiError && failure.status < 500) this.transition('REJECTED');
      throw failure;
    }
  }
  private async sendPreparedPayment(api: ApiClient, record: StoredIntent): Promise<CommandResponse<PaymentReceipt>> {
    try {
      const response = await api.payment(record.intent, record.key);
      this.transition('CONFIRMED');
      return response;
    } catch (failure) {
      if (failure instanceof OutcomeUnknown) this.transition('UNCERTAIN');
      else if (failure instanceof ApiError && failure.status < 500) this.transition('REJECTED');
      throw failure;
    }
  }
  // Logout does not erase uncertain operations. A subsequent login by this owner may resolve/replay them.
  forgetConfirmed(): void {
    const current = this.current();
    if (current && !['CONFIRMED','REJECTED'].includes(current.state)) throw new Error('Cannot forget an uncertain operation.');
    this.storage.removeItem(this.slot);
  }
}
