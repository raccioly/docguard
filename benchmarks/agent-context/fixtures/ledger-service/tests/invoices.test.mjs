import test from 'node:test';
import assert from 'node:assert/strict';
import { createInvoice, invoiceStatus, lateFee } from '../src/index.mjs';

const invoice = () => createInvoice({ id: 'INV-1', accountId: 'ACC-00000001', dueDate: '2026-01-10', items: [
  { quantity: 2, unitPrice: 50, taxCategory: 'standard' },
  { quantity: 1, unitPrice: 20, taxCategory: 'exempt' },
] });

test('invoice totals include tax per line item', () => {
  assert.equal(invoice().total, 128);
});

test('status follows payment and due date', () => {
  const inv = invoice();
  assert.equal(invoiceStatus(inv, '2026-01-05'), 'open');
  assert.equal(invoiceStatus(inv, '2026-02-01'), 'overdue');
  inv.outstanding = 0;
  assert.equal(invoiceStatus(inv, '2026-02-01'), 'paid');
});

test('an invoice that is not yet due owes no late fee; a long-overdue one does', () => {
  assert.equal(lateFee(invoice(), '2026-01-05'), 0);
  assert.equal(lateFee(invoice(), '2026-03-01'), 1.92);
});
