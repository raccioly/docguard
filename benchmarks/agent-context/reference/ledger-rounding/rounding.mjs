import { MINOR_UNITS } from './codes.mjs';

/**
 * Round a monetary amount to its currency's minor units with round-half-to-even
 * (acme.ledger#FR-004). JPY has no minor unit, KWD has three.
 */
export function roundMinor(amount, currency) {
  const factor = 10 ** (MINOR_UNITS[currency] ?? 2);
  // Strip binary noise (1.2345 * 1000 is 1234.4999999999998) before deciding a tie.
  const scaled = Number((amount * factor).toFixed(8));
  const floor = Math.floor(scaled);
  const tie = Math.abs(scaled - floor - 0.5) < 1e-9;
  const rounded = tie ? (floor % 2 === 0 ? floor : floor + 1) : Math.round(scaled);
  return rounded / factor;
}
