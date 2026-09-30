import { roundMinor } from '../currency/rounding.mjs';

export function postEntry(account, amount, { pending = false } = {}) {
  account.entries.push({ amount, pending });
}

export function balance(account) {
  const posted = account.entries.filter(e => !e.pending).reduce((sum, e) => sum + e.amount, 0);
  return roundMinor(posted, account.currency);
}
