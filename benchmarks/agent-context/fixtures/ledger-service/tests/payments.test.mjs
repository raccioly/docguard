import test from 'node:test';
import assert from 'node:assert/strict';
import { createInvoice, createPayment, allocate, refund, luhnValid } from '../src/index.mjs';

test('payments go to the oldest open invoice first', () => {
  const older = createInvoice({ id: 'A', accountId: 'ACC-00000001', dueDate: '2026-01-01', items: [{ quantity: 1, unitPrice: 30, taxCategory: 'exempt' }] });
  const newer = createInvoice({ id: 'B', accountId: 'ACC-00000001', dueDate: '2026-02-01', items: [{ quantity: 1, unitPrice: 30, taxCategory: 'exempt' }] });
  const left = allocate(createPayment({ id: 'P', accountId: 'ACC-00000001', amount: 40 }), [newer, older]);
  assert.equal(older.outstanding, 0);
  assert.equal(newer.outstanding, 20);
  assert.equal(left, 0);
  assert.throws(() => refund(newer, 50), /exceeds/);
});

test('card numbers are Luhn-checked', () => {
  assert.equal(luhnValid('4111111111111111'), true);
  assert.equal(luhnValid('4111111111111112'), false);
});
