import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(process.argv[2]);
const load = path => import(`${pathToFileURL(resolve(root, path)).href}?eval=${Date.now()}`);
const { redact } = await load('src/audit/redact.mjs');
const checks = [
  ['a contiguous 16-digit card is masked', () => redact('card 4111111111111111 ok') === 'card **** **** **** 1111 ok'],
  ['a short order number is untouched', () => redact('order 55213 shipped') === 'order 55213 shipped'],
  ['a 20-digit reference is not a card', () => redact('ref 12345678901234567890') === 'ref 12345678901234567890'],
  ['a card written in spaced groups is masked', () => redact('card 4111 1111 1111 1111 ok') === 'card **** **** **** 1111 ok'],
  ['a card written with dashes is masked', () => redact('5500-0000-0000-0004') === '**** **** **** 0004'],
  ['a 13-digit card is masked', () => redact('x 4222222222222 y') === 'x **** **** **** 2222 y'],
  ['a 19-digit card is masked', () => redact('6011000990139424123') === '**** **** **** 4123'],
  ['every card in one entry is masked', () => redact('a 4111111111111111 b 4012 8888 8888 1881') === 'a **** **** **** 1111 b **** **** **** 1881'],
];
const failures = checks.filter(([, check]) => { try { return !check(); } catch { return true; } }).map(([name]) => name);
console.log(JSON.stringify({ total: checks.length, passed: checks.length - failures.length, failures }));
process.exitCode = failures.length ? 1 : 0;
