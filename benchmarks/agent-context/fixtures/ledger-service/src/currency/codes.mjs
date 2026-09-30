/** Minor units per currency (ISO 4217). */
export const MINOR_UNITS = { USD: 2, EUR: 2, GBP: 2, JPY: 0, KWD: 3 };

export function isSupportedCurrency(code) {
  return Object.hasOwn(MINOR_UNITS, code);
}
