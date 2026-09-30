import { isAccountId } from '../util/ids.mjs';
import { invariant } from '../util/assert.mjs';

export function createRepository() {
  const accounts = new Map();
  return {
    save(account) { invariant(isAccountId(account.id), 'invalid account id'); accounts.set(account.id, account); },
    find(id) { return accounts.get(id) ?? null; },
    all() { return [...accounts.values()]; },
  };
}
