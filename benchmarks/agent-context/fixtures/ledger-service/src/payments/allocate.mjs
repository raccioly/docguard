import { roundMinor } from '../currency/rounding.mjs';

/** Allocate a payment to the oldest open invoices first. */
export function allocate(payment, invoices) {
  let remaining = payment.amount;
  const ordered = [...invoices].filter(i => i.outstanding > 0).sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
  for (const invoice of ordered) {
    if (remaining <= 0) break;
    const applied = Math.min(remaining, invoice.outstanding);
    invoice.outstanding = roundMinor(invoice.outstanding - applied, invoice.currency);
    invoice.paid = roundMinor(invoice.paid + applied, invoice.currency);
    remaining = roundMinor(remaining - applied, payment.currency);
  }
  return remaining;
}
