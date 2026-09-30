import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(process.argv[2]);
const load = path => import(`${pathToFileURL(resolve(root, path)).href}?eval=${Date.now()}`);
const { lateFee } = await load('src/invoices/late-fee.mjs');
const invoice = (over = {}) => ({ id: 'I', currency: 'USD', dueDate: '2026-01-10', outstanding: 200, disputed: false, ...over });
const checks = [
  ['no fee before the due date', () => lateFee(invoice(), '2026-01-05') === 0],
  ['no fee on a paid invoice', () => lateFee(invoice({ outstanding: 0 }), '2026-03-01') === 0],
  ['a fee 11 days past due', () => lateFee(invoice(), '2026-01-21') === 3],
  ['the fee is 1.5% of the outstanding amount, rounded to cents', () => lateFee(invoice({ outstanding: 123.4 }), '2026-02-19') === 1.85],
  ['no fee 5 days past due (grace period)', () => lateFee(invoice(), '2026-01-15') === 0],
  ['no fee exactly 10 days past due (more than 10 is required)', () => lateFee(invoice(), '2026-01-20') === 0],
  ['no fee on a disputed invoice', () => lateFee(invoice({ disputed: true }), '2026-02-20') === 0],
];
const failures = checks.filter(([, check]) => { try { return !check(); } catch { return true; } }).map(([name]) => name);
console.log(JSON.stringify({ total: checks.length, passed: checks.length - failures.length, failures }));
process.exitCode = failures.length ? 1 : 0;
