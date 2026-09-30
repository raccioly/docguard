import { invoiceTotal } from './totals.mjs';

export function createInvoice({ id, accountId, currency = 'USD', dueDate, items = [] }) {
  const invoice = { id, accountId, currency, dueDate, items, disputed: false, paid: 0 };
  invoice.total = invoiceTotal(invoice);
  invoice.outstanding = invoice.total;
  return invoice;
}
