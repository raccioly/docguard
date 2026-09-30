import { TAX_RATES } from './rates.mjs';
import { roundMinor } from '../currency/rounding.mjs';

export function lineTax(item, currency) {
  const rate = TAX_RATES[item.taxCategory ?? 'standard'] ?? TAX_RATES.standard;
  return roundMinor(item.quantity * item.unitPrice * rate, currency);
}
