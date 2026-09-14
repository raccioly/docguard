import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(process.argv[2]);
const { normalizeStatus } = await import(`${pathToFileURL(resolve(root, 'src/status.mjs')).href}?eval=${Date.now()}`);
const checks = [
  ['canonical READY remains stable', () => normalizeStatus('READY') === 'READY'],
  ['unknown remains null', () => normalizeStatus('other') === null],
  ['non-string remains null', () => normalizeStatus(4) === null],
  ['queued alias is accepted', () => normalizeStatus('queued') === 'QUEUED'],
  ['hyphenated in-progress alias is accepted', () => normalizeStatus('in-progress') === 'IN_PROGRESS'],
  ['underscored in_progress alias is accepted', () => normalizeStatus('in_progress') === 'IN_PROGRESS'],
  ['aliases trim whitespace and ignore case', () => normalizeStatus('  In-Progress ') === 'IN_PROGRESS'],
];
const failures = checks.filter(([, check]) => { try { return !check(); } catch { return true; } }).map(([name]) => name);
console.log(JSON.stringify({ total: checks.length, passed: checks.length - failures.length, failures }));
process.exitCode = failures.length ? 1 : 0;
