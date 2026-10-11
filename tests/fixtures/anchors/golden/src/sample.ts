import { helper } from './helper';

/** @implements acme.golden#FR-001 */
export function total(items: { price: number }[], rate: number): number {
  const sum = items.reduce((acc, item) => acc + item.price, 0);
  return sum * (1 - rate);
}

/** @implements acme.golden#FR-002 */
export class Cart {
  add(item: string): string { return helper(item); }
}
