import { formatMinor, type Currency } from './money.js';

export function formatMoney(input: string, currency: Currency, signed = false): string {
  const negative = input.startsWith('-');
  const absolute = negative ? input.slice(1) : input;
  const amount = formatMinor(absolute, currency, true);
  const sign = negative ? '−' : signed && input !== '0' ? '+' : '';
  return `${sign}${currency} ${amount}`;
}

export function formatInstant(input: string): string {
  const date = new Date(input);
  if (!Number.isFinite(date.getTime())) return 'Unknown time';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

export function shortReference(input: string): string {
  return input.length <= 18 ? input : `${input.slice(0, 8)}…${input.slice(-8)}`;
}

export function humanKind(input: string): string {
  return input.toLowerCase().split('_').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}
