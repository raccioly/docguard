#!/usr/bin/env node
/**
 * Run the full test suite with its temporary directory pointed at a fresh empty
 * folder, then fail if anything the suite created is still there
 * (specs/098-test-temp-dirs, FR-005).
 *
 *   node tools/check-temp-leaks.mjs            # npm test, then the check
 *   node tools/check-temp-leaks.mjs -- <cmd…>  # a different command instead of npm test
 *   node tools/check-temp-leaks.mjs --check <dir>  # only check a folder an earlier run used as TMPDIR
 *
 * One run of the suite, not two: CI sets TMPDIR for its single `npm test` step and then runs `--check`. Exit code
 * is the suite's own when it failed, else 1 when a directory was left behind,
 * else 0. Node's own compile cache (`node-compile-cache`) is not ours and is ignored.
 *
 * @implements docguard.test-temp-dirs#FR-005
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempDir } from '../tests/helpers/temp-dir.mjs';

const IGNORED = new Set(['node-compile-cache']);

function entriesLeft(dir) {
  return readdirSync(dir).filter(name => !IGNORED.has(name));
}

/** Print what is left and return the exit code: 1 when anything is. */
function report(dir, left) {
  if (left.length === 0) {
    console.log('temp-leak check: the suite left no temporary directory behind.');
    return 0;
  }
  console.error(`temp-leak check: ${left.length} temporary entr${left.length === 1 ? 'y' : 'ies'} left behind by the suite:`);
  for (const name of left.slice(0, 50)) console.error(`  ${name}${statSync(join(dir, name)).isDirectory() ? '/' : ''}`);
  if (left.length > 50) console.error(`  … and ${left.length - 50} more`);
  return 1;
}

function main() {
  const rest = process.argv.slice(2);
  if (rest[0] === '--check') {
    if (!rest[1]) { console.error('usage: check-temp-leaks.mjs --check <dir>'); return 2; }
    return report(rest[1], entriesLeft(rest[1]));
  }
  const sep = rest.indexOf('--');
  const command = sep >= 0 ? rest.slice(sep + 1) : ['npm', 'test'];
  const dir = makeTempDir('dg-leakcheck-');
  const result = spawnSync(command[0], command.slice(1), {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, TMPDIR: dir, TMP: dir, TEMP: dir },
  });
  const code = report(dir, entriesLeft(dir));
  return result.status !== 0 ? (result.status || 1) : code;
}

process.exitCode = main();
