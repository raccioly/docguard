// Fixture for the doclock-v0 compatibility golden (specs/070-requirement-anchors FR-015).
import { round } from './math.mjs';

export const RATE = 0.2;

export function applyDiscount(total, coupon) {
  if (!coupon) return total;
  return round(total * (1 - RATE), 2);
}

export class Cart {
  constructor(items) { this.items = items; }
  total() { return this.items.reduce((sum, item) => sum + item.price, 0); }
  static empty() { return new Cart([]); }
}

const internal = () => 'x';
export { internal as exposed };
export default function main() { return applyDiscount(10, true); }
