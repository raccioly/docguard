import { roundMinor } from '../currency/rounding.mjs';

export function lineAmount(item, currency) {
  return roundMinor(item.quantity * item.unitPrice, currency);
}
