export interface Line { sku: string; qty: number }
export type Total = number;
export function sum(lines: Line[]): Total {
  return lines.reduce((acc, l) => acc + l.qty, 0);
}
export enum Mode { Fast = 'fast', Safe = 'safe' }
