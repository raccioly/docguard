import { lineAmount } from './line-items.mjs';
import { lineTax } from '../tax/compute.mjs';
import { roundMinor } from '../currency/rounding.mjs';

export function invoiceTotal(invoice) {
  const sum = invoice.items.reduce((acc, item) => acc + lineAmount(item, invoice.currency) + lineTax(item, invoice.currency), 0);
  return roundMinor(sum, invoice.currency);
}
