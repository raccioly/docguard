/**
 * Pricing module.
 * @implements acme.billing#FR-001
 */
import { round } from './math.mjs';

/** @implements acme.billing#FR-002 */
export function applyDiscount(total, coupon) {
  // @implements acme.billing#FR-003
  const rate = coupon ? 0.1 : 0;
  return round(total * (1 - rate));
}

export class Cart {
  // @implements acme.billing#FR-004
  total() { return 1; }
}

// @implements acme.billing#FR-005
export const LIMITS = { max: 10 };

const message = "see // @implements acme.billing#FR-009 in a string";
const template = `@implements acme.billing#FR-009`;
const pattern = /\/\/ @implements acme.billing#FR-009/;

// @implements acme.billing#FR-006
app.post('/login', (req, res) => res.send(message + template + pattern));

// @implements acme.billing#FR-007 {scope=symbol}

export function late() {}

// @req FR-001, FR-002
export function multi() {}

// @implements acme.billing#FR-099
export function ghost() {}

// @implements acme.billing#FR-004
registerPlugin(LIMITS);

// @covers FR-008
export function covered() {}
