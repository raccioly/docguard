import { MINOR_UNITS } from './codes.mjs';
import { roundMinor } from './rounding.mjs';

export function formatAmount(amount, currency) {
  const digits = MINOR_UNITS[currency] ?? 2;
  return `${roundMinor(amount, currency).toFixed(digits)} ${currency}`;
}
