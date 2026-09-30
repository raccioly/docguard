import { daysBetween } from '../util/dates.mjs';
import { roundMinor } from '../currency/rounding.mjs';
import { LATE_FEE_RATE } from '../config/defaults.mjs';

/** The late fee owed on an invoice as of `today`. */
export function lateFee(invoice, today) {
  const daysLate = daysBetween(invoice.dueDate, today);
  if (daysLate <= 0 || invoice.outstanding <= 0) return 0;
  return roundMinor(invoice.outstanding * LATE_FEE_RATE, invoice.currency);
}
