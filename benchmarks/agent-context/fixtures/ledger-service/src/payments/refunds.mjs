import { invariant } from '../util/assert.mjs';

export function refund(invoice, amount) {
  invariant(amount <= invoice.paid, 'refund exceeds the amount paid');
  invoice.paid -= amount;
  invoice.outstanding += amount;
  return amount;
}
