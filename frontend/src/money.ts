/** Money crosses the wire as canonical integer strings, never JSON numbers. */
export const exponents = { CAD: 2, USD: 2, JPY: 0, KWD: 3 } as const;
export type Currency = keyof typeof exponents;
export const MAX_TRANSACTION = 1_000_000_000_000n;
export const MAX_BALANCE = 9_223_372_036_854_775_807n;
export class MoneyError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'MoneyError'; }
}
export function currency(value: unknown): Currency {
  if (typeof value !== 'string' || !Object.hasOwn(exponents, value)) throw new MoneyError('UNSUPPORTED_CURRENCY');
  return value as Currency;
}
export function minor(value: unknown, limit: bigint = MAX_BALANCE): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(value)) throw new MoneyError('INVALID_MINOR_UNITS');
  const parsed = BigInt(value);
  if (parsed > limit) throw new MoneyError('AMOUNT_OVERFLOW');
  return parsed;
}
export function parseAmount(input: string, code: Currency): string {
  const exponent = exponents[currency(code)];
  if (input.length > 32 || !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(input)) throw new MoneyError('INVALID_AMOUNT');
  const [whole = '', fraction = ''] = input.split('.');
  if (fraction.length > exponent) throw new MoneyError('EXCESS_PRECISION');
  const value = BigInt(whole) * (10n ** BigInt(exponent)) + BigInt(fraction.padEnd(exponent, '0') || '0');
  if (value <= 0n || value > MAX_TRANSACTION) throw new MoneyError('AMOUNT_OUT_OF_RANGE');
  return value.toString();
}
export function formatMinor(input: string, code: Currency, group = false): string {
  const value = minor(input);
  const exponent = exponents[currency(code)];
  const padded = value.toString().padStart(exponent + 1, '0');
  const whole = exponent ? padded.slice(0, -exponent) : padded;
  const grouped = group ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : whole;
  return exponent ? `${grouped}.${padded.slice(-exponent)}` : grouped;
}
export function available(posted: string, reserved: string): string {
  const p = minor(posted), r = minor(reserved);
  if (r > p) throw new MoneyError('INVALID_BALANCE');
  return (p - r).toString();
}
