import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccount, postEntry, balance } from '../src/index.mjs';

test('balance sums posted entries and ignores pending ones', () => {
  const account = createAccount(1);
  postEntry(account, 10.25);
  postEntry(account, 4.5);
  postEntry(account, 100, { pending: true });
  assert.equal(balance(account), 14.75);
  assert.match(account.id, /^ACC-[0-9A-F]{8}$/);
});
