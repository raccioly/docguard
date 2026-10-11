import { helper } from './helper.mjs';

/** @implements acme.golden#FR-001 */
export function total(items, rate) {
  const sum = items.reduce((acc, item) => acc + item.price, 0);
  return sum * (1 - rate);
}

/** @implements acme.golden#FR-002 */
export class Cart {
  add(item) { this.items.push(item); return helper(item); }
}

export function other(x) {
  // @implements acme.golden#FR-003
  const label = 'value: ' + x;
  return label;
}
