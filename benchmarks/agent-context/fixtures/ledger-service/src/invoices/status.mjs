import { daysBetween } from '../util/dates.mjs';

export function invoiceStatus(invoice, today) {
  if (invoice.disputed) return 'disputed';
  if (invoice.outstanding <= 0) return 'paid';
  return daysBetween(invoice.dueDate, today) > 0 ? 'overdue' : 'open';
}
