import { agingReport } from './aging.mjs';
import { formatAmount } from '../currency/format.mjs';

export function summaryLines(invoices, today, currency) {
  return Object.entries(agingReport(invoices, today)).map(([bucket, amount]) => `${bucket}: ${formatAmount(amount, currency)}`);
}
