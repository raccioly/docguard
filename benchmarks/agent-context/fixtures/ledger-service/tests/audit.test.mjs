import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuditLog } from '../src/index.mjs';

test('audit entries hide a card number and keep the rest of the text', () => {
  const log = createAuditLog();
  log.record('payment.received', 'card 4111111111111111 charged for order 5521');
  assert.equal(log.entries()[0].detail, 'card **** **** **** 1111 charged for order 5521');
});

test('unknown events are rejected', () => {
  assert.throws(() => createAuditLog().record('nope', 'x'), /unknown audit event/);
});
