import test from 'node:test';
import assert from 'node:assert/strict';
import { createInvoice, agingReport, summaryLines, overdueEmail, createAccount } from '../src/index.mjs';

test('aging buckets group outstanding invoices', () => {
  const inv = createInvoice({ id: 'X', accountId: 'ACC-00000001', dueDate: '2026-01-01', items: [{ quantity: 1, unitPrice: 10, taxCategory: 'exempt' }] });
  assert.deepEqual(agingReport([inv], '2026-03-15'), { '0-30': 0, '31-60': 0, '61-90': 10, '90+': 0 });
  assert.equal(summaryLines([inv], '2026-03-15', 'USD')[2], '61-90: 10.00 USD');
});

test('overdue e-mail falls back to English', () => {
  assert.equal(overdueEmail(createAccount(2, { language: 'fr' }), { id: 'INV-9' }), 'Invoice INV-9 is overdue.');
  assert.equal(overdueEmail(createAccount(3, { language: 'es' }), { id: 'INV-9' }), 'La factura INV-9 está vencida.');
});
