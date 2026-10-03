import { parseAmount, type Currency } from './money.js';
import type { IntentKind, StoredIntent } from './intent-store.js';
import type { PaymentRecord } from './api.js';

export type PaymentState = PaymentRecord['state'];

export function normalizeProductPath(input: string): string {
  const path = input.split(/[?#]/, 1)[0] ?? '/';
  if (!path.startsWith('/')) return '/';
  const normalized = path.replace(/\/{2,}/g, '/').replace(/\/$/, '');
  return normalized || '/';
}

export function isP08BPath(input: string): boolean {
  const path = normalizeProductPath(input);
  return path === '/transfers/new'
    || /^\/transfers\/[0-9a-f-]{36}$/i.test(path)
    || path === '/payments'
    || path === '/payments/new'
    || /^\/payments\/[0-9a-f-]{36}$/i.test(path);
}

export function amountToMinor(input: string, currency: Currency): string {
  return parseAmount(input.trim(), currency);
}

/** References are case-insensitive; normalization preserves the uppercase LG prefix. */
export function isSameWalletReference(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

export function isTerminalPaymentState(state: PaymentState): boolean {
  return state === 'SETTLED' || state === 'FAILED' || state === 'CANCELLED';
}

export function paymentStateLabel(state: PaymentState): string {
  switch (state) {
    case 'PENDING': return 'Pending';
    case 'SETTLED': return 'Settled';
    case 'FAILED': return 'Failed';
    case 'CANCELLED': return 'Cancelled';
  }
}

export function paymentStateTone(state: PaymentState): 'pending' | 'success' | 'danger' | 'neutral' {
  switch (state) {
    case 'PENDING': return 'pending';
    case 'SETTLED': return 'success';
    case 'FAILED': return 'danger';
    case 'CANCELLED': return 'neutral';
  }
}

export function paymentPollDelay(attempt: number): number {
  const safeAttempt = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;
  return Math.min(2500, 900 + safeAttempt * 160);
}

export function intentRecoveryPath(record: Pick<StoredIntent, 'kind' | 'intent'>): string {
  switch (record.kind) {
    case 'schedules': return '/schedules/recovery';
    case 'transfers': return '/transfers/new';
    case 'payments': return '/payments/new';
    case 'payment-refunds':
    case 'payment-cancellations': {
      const paymentId = 'paymentId' in record.intent ? record.intent.paymentId : '';
      return /^[0-9a-f-]{36}$/i.test(paymentId) ? `/payments/${paymentId}` : '/payments';
    }
    case 'payment-reversals': {
      const paymentId = 'paymentId' in record.intent ? record.intent.paymentId : '';
      return /^[0-9a-f-]{36}$/i.test(paymentId) ? `/admin/payments/${paymentId}/reversal` : '/admin/adjustments';
    }
  }
}

export function intentKindLabel(kind: IntentKind): string {
  switch (kind) {
    case 'schedules': return 'schedule instruction';
    case 'transfers': return 'transfer';
    case 'payments': return 'payment';
    case 'payment-cancellations': return 'payment cancellation';
    case 'payment-refunds': return 'payment refund';
    case 'payment-reversals': return 'payment reversal';
  }
}
