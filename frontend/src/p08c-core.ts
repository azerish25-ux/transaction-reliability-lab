import { currency, formatMinor, MAX_TRANSACTION, minor, parseAmount } from './money.js';
import type { PaymentAdjustmentContext, PaymentRecord } from './api.js';
import { normalizeProductPath } from './p08b-core.js';

export const PAYMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export type AdjustmentRoute = { kind: 'lookup' } | { kind: 'reversal'; paymentId: string }
  | { kind: 'receipt'; paymentId: string; adjustmentId: string; administrator: boolean };

export function adjustmentRoute(input: string): AdjustmentRoute | undefined {
  const path = normalizeProductPath(input);
  if (path === '/admin/adjustments') return { kind: 'lookup' };
  const reversal = path.match(new RegExp(`^/admin/payments/(${ID})/reversal$`, 'i'));
  if (reversal?.[1]) return { kind: 'reversal', paymentId: reversal[1].toLowerCase() };
  const receipt = path.match(new RegExp(`^(/admin)?/payments/(${ID})/adjustments/(${ID})$`, 'i'));
  if (receipt?.[2] && receipt[3]) return { kind: 'receipt', paymentId: receipt[2].toLowerCase(), adjustmentId: receipt[3].toLowerCase(), administrator: Boolean(receipt[1]) };
  return undefined;
}

export function adjustmentLabel(state: PaymentRecord['adjustmentState']): string {
  return { NONE: 'No adjustments', PARTIALLY_REFUNDED: 'Partially refunded', FULLY_REFUNDED: 'Fully refunded', REVERSED: 'Reversed' }[state];
}

export function adjustmentDisabledReason(code: string | null): string {
  const reasons: Record<string, string> = {
    RECIPIENT_OWNER_REQUIRED: 'Only the original recipient owner can refund this payment. Viewing it as payer does not grant refund authority.',
    ADMIN_REQUIRED: 'A full reversal requires an administrator.',
    NOT_SETTLED: 'Only a settled payment can be refunded or reversed.',
    PAYMENT_REVERSED: 'This payment has already been reversed. No further adjustment is permitted.',
    FULLY_REFUNDED: 'The full settled amount has already been refunded.',
    PRIOR_REFUND: 'A full reversal is forbidden after any successful refund.',
    INSUFFICIENT_FUNDS: 'The original recipient does not have enough currently available funds for this action.'
  };
  return code ? reasons[code] ?? 'The authoritative payment state does not permit this action.' : '';
}

/** Validate the review contract before enabling a control. Posting authority stays on the server. */
export function validateAdjustmentContext(context: PaymentAdjustmentContext): PaymentAdjustmentContext {
  if (!PAYMENT_ID.test(context.paymentId) || !['PENDING', 'SETTLED', 'FAILED', 'CANCELLED'].includes(context.state)) throw new TypeError('Invalid payment adjustment context.');
  currency(context.currency);
  const amount = minor(context.amountMinor, MAX_TRANSACTION);
  const refunded = minor(context.refundedMinor, MAX_TRANSACTION);
  const remaining = minor(context.remainingRefundableMinor, MAX_TRANSACTION);
  if (amount === 0n || refunded > amount || !['NONE', 'PARTIALLY_REFUNDED', 'FULLY_REFUNDED', 'REVERSED'].includes(context.adjustmentState)) throw new TypeError('Invalid adjustment totals.');
  const reversed = context.adjustmentState === 'REVERSED';
  const expectedState = reversed ? 'REVERSED' : refunded === 0n ? 'NONE' : refunded === amount ? 'FULLY_REFUNDED' : 'PARTIALLY_REFUNDED';
  if (context.adjustmentState !== expectedState || (reversed && refunded !== 0n)
    || remaining !== (context.state === 'SETTLED' && !reversed ? amount - refunded : 0n)) throw new TypeError('Inconsistent adjustment totals. Refresh the authoritative record.');
  if (context.recipientAvailableMinor !== null) minor(context.recipientAvailableMinor);
  if (context.canRefund && (remaining === 0n || context.recipientAvailableMinor === null || context.refundDisabledReason !== null)) throw new TypeError('Invalid refund eligibility.');
  if (context.canReverse && (context.state !== 'SETTLED' || context.adjustmentState !== 'NONE' || context.reversalDisabledReason !== null)) throw new TypeError('Invalid reversal eligibility.');
  return context;
}

export function refundMinor(input: string, context: PaymentAdjustmentContext): string {
  validateAdjustmentContext(context);
  if (!context.canRefund) throw new TypeError(adjustmentDisabledReason(context.refundDisabledReason));
  let amount: string;
  try { amount = parseAmount(input.trim(), context.currency); }
  catch { throw new TypeError(`Enter a positive ${context.currency} amount with exactly the supported currency precision; no rounding or exponent notation is accepted.`); }
  if (BigInt(amount) > BigInt(context.remainingRefundableMinor)) throw new TypeError('Refund exceeds the remaining refundable amount.');
  if (context.recipientAvailableMinor === null || BigInt(amount) > BigInt(context.recipientAvailableMinor)) throw new TypeError('Refund exceeds the recipient wallet’s currently available funds.');
  return amount;
}

export function remainingInput(context: PaymentAdjustmentContext): string {
  validateAdjustmentContext(context);
  return formatMinor(context.remainingRefundableMinor, context.currency);
}

export function adjustmentReason(input: string, required: boolean): string | undefined {
  const value = input.trim();
  if (required && !value) throw new TypeError('A reversal reason is required.');
  if (value.length > 500) throw new TypeError('Reason must be at most 500 characters.');
  return value || undefined;
}

export function adjustmentReceiptPath(paymentId: string, adjustmentId: string, administrator = false): string {
  if (!PAYMENT_ID.test(paymentId) || !PAYMENT_ID.test(adjustmentId)) throw new TypeError('Invalid adjustment reference.');
  return `${administrator ? '/admin' : ''}/payments/${paymentId}/adjustments/${adjustmentId}`;
}
