import { invariant } from './assert.mjs';

const ACCOUNT_ID = /^ACC-[0-9A-F]{8}$/;

export function isAccountId(value) {
  return typeof value === 'string' && ACCOUNT_ID.test(value);
}

export function accountId(n) {
  invariant(Number.isInteger(n) && n >= 0, 'account number must be a non-negative integer');
  return `ACC-${n.toString(16).toUpperCase().padStart(8, '0')}`;
}
