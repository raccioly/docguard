import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(process.argv[2]);
const { resolveTimeout } = await import(`${pathToFileURL(resolve(root, 'src/options.mjs')).href}?eval=${Date.now()}`);
const throwsTypeError = value => { try { resolveTimeout(value); return false; } catch (error) { return error instanceof TypeError; } };
const checks = [
  ['modern option remains stable', () => resolveTimeout({ timeoutMs: 25 }) === 25],
  ['default remains 5000', () => resolveTimeout({}) === 5000],
  ['legacy timeout is accepted', () => resolveTimeout({ timeout: 40 }) === 40],
  ['timeoutMs takes precedence', () => resolveTimeout({ timeoutMs: 20, timeout: 40 }) === 20],
  ['zero timeoutMs takes precedence', () => resolveTimeout({ timeoutMs: 0, timeout: 40 }) === 0],
  ['invalid selected timeoutMs throws', () => throwsTypeError({ timeoutMs: -1, timeout: 40 })],
  ['invalid selected legacy timeout throws', () => throwsTypeError({ timeout: Number.NaN })],
];
const failures = checks.filter(([, check]) => { try { return !check(); } catch { return true; } }).map(([name]) => name);
console.log(JSON.stringify({ total: checks.length, passed: checks.length - failures.length, failures }));
process.exitCode = failures.length ? 1 : 0;
