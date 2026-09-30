import { daysBetween } from '../util/dates.mjs';
import { roundMinor } from '../currency/rounding.mjs';
import { LATE_FEE_RATE } from '../config/defaults.mjs';

const GRACE_DAYS = 10;

/**
 * The late fee owed on an invoice as of `today` (acme.ledger#FR-007): only
 * more than 10 calendar days past due, and never on a disputed invoice.
 */
export function lateFee(invoice, today) {
  if (invoice.disputed || invoice.outstanding <= 0) return 0;
  if (daysBetween(invoice.dueDate, today) <= GRACE_DAYS) return 0;
  return roundMinor(invoice.outstanding * LATE_FEE_RATE, invoice.currency);
}
