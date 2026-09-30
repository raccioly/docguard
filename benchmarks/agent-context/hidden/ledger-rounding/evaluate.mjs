import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(process.argv[2]);
const load = path => import(`${pathToFileURL(resolve(root, path)).href}?eval=${Date.now()}`);
const { roundMinor } = await load('src/currency/rounding.mjs');
const { createInvoice } = await load('src/invoices/invoice.mjs');
// Ties chosen to be exact in binary floating point, so the checks test the
// rounding rule, not float noise.
const checks = [
  ['a non-tie USD amount keeps rounding to cents', () => roundMinor(1.234, 'USD') === 1.23],
  ['a USD tie that is already even stays', () => roundMinor(0.375, 'USD') === 0.38],
  ['a negative USD tie keeps its existing result', () => roundMinor(-0.125, 'USD') === -0.12],
  ['a USD tie rounds to the even cent (0.125 -> 0.12)', () => roundMinor(0.125, 'USD') === 0.12],
  ['a USD tie rounds to the even cent (0.625 -> 0.62)', () => roundMinor(0.625, 'USD') === 0.62],
  ['JPY has no minor unit (1234.5 -> 1234)', () => roundMinor(1234.5, 'JPY') === 1234],
  ['JPY ties round to even (1235.5 -> 1236)', () => roundMinor(1235.5, 'JPY') === 1236],
  ['JPY non-ties round to whole yen', () => roundMinor(99.4, 'JPY') === 99],
  ['KWD keeps three decimals', () => roundMinor(1.2344, 'KWD') === 1.234],
  ['KWD ties round to even (0.0625 -> 0.062)', () => roundMinor(0.0625, 'KWD') === 0.062],
  ['invoice totals round JPY lines to whole yen', () => createInvoice({ id: 'J', accountId: 'ACC-00000001', currency: 'JPY', dueDate: '2026-01-01', items: [{ quantity: 1, unitPrice: 1000.5, taxCategory: 'exempt' }] }).total === 1000],
];
const failures = checks.filter(([, check]) => { try { return !check(); } catch { return true; } }).map(([name]) => name);
console.log(JSON.stringify({ total: checks.length, passed: checks.length - failures.length, failures }));
process.exitCode = failures.length ? 1 : 0;
