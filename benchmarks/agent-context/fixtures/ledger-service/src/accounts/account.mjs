import { accountId } from '../util/ids.mjs';
import { DEFAULT_CURRENCY, DEFAULT_LANGUAGE } from '../config/defaults.mjs';

export function createAccount(n, { currency = DEFAULT_CURRENCY, language = DEFAULT_LANGUAGE } = {}) {
  return { id: accountId(n), currency, language, entries: [] };
}
