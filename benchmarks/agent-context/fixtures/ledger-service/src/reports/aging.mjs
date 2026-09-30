import { daysBetween } from '../util/dates.mjs';

const BUCKETS = [[0, 30, '0-30'], [31, 60, '31-60'], [61, 90, '61-90'], [91, Infinity, '90+']];

export function agingReport(invoices, today) {
  const report = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  for (const invoice of invoices) {
    if (invoice.outstanding <= 0) continue;
    const days = Math.max(0, daysBetween(invoice.dueDate, today));
    const [, , label] = BUCKETS.find(([lo, hi]) => days >= lo && days <= hi);
    report[label] += invoice.outstanding;
  }
  return report;
}
