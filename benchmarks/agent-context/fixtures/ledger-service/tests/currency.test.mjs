import test from 'node:test';
import assert from 'node:assert/strict';
import { roundMinor, formatAmount } from '../src/index.mjs';

test('amounts that are not ties round to cents', () => {
  assert.equal(roundMinor(1.234, 'USD'), 1.23);
  assert.equal(roundMinor(10, 'USD'), 10);
  assert.equal(formatAmount(3.1, 'EUR'), '3.10 EUR');
});
