/**
 * Round a monetary amount for storage and display.
 */
export function roundMinor(amount, currency) {
  return Math.round(amount * 100) / 100;
}
