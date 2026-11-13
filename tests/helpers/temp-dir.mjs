/**
 * Temporary directories that are always removed (specs/098-test-temp-dirs).
 *
 * Tests, benchmarks and tools used to call `mkdtempSync(join(tmpdir(), 'dg-…'))`
 * and rely on each file to clean up. Many never did, and a test that failed or
 * was interrupted skipped its hook: one machine collected 626 directories
 * (84 MB) in a day. Every temporary directory now comes from `makeTempDir`.
 *
 * Removal is registered three ways, so a directory survives none of them:
 * - given a test context `t`, `t.after` removes it when that test finishes;
 * - under the Node test runner, one file-level `after` removes whatever is left
 *   when the file's tests finish (a directory kept for a later test in the same
 *   file lives until then);
 * - one process `exit` handler removes the rest synchronously, and SIGINT and
 *   SIGTERM exit through it.
 *
 * This module does not import the test runner statically, so `benchmarks/` and
 * `tools/` use it as plain code and call `removeTempDir` in a `finally`.
 * Removal never throws, and refuses any path that this module did not create
 * or that does not resolve inside the OS temporary directory.
 *
 * @implements docguard.test-temp-dirs#FR-001
 * @implements docguard.test-temp-dirs#FR-002
 * @implements docguard.test-temp-dirs#FR-003
 * @implements docguard.test-temp-dirs#FR-006
 */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';

/** Directories this module created and has not removed: resolved path -> created path. */
const registry = new Map();
let installed = false;

function realTmp() {
  try { return realpathSync(tmpdir()); } catch { return tmpdir(); }
}

/** Remove one directory this module created. Returns true when it is gone. Never throws. */
export function removeTempDir(dir) {
  try {
    const real = registry.get(dir);
    if (!real) return false; // not created by makeTempDir: refuse
    if (!real.startsWith(realTmp() + sep)) return false; // outside the OS temp directory: refuse
    rmSync(dir, { recursive: true, force: true });
    registry.delete(dir);
    return true;
  } catch {
    return false;
  }
}

/** Remove every directory still registered. Synchronous, so it can run from `exit`. */
export function removeAllTempDirs() {
  for (const dir of [...registry.keys()]) removeTempDir(dir);
}

function install() {
  if (installed) return;
  installed = true;
  process.on('exit', removeAllTempDirs);
  // A default SIGINT/SIGTERM kills the process without running `exit` handlers; exit through the normal path.
  // Leave a signal alone when something else already handles it.
  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
    if (process.listenerCount(signal) === 0) process.once(signal, () => process.exit(code));
  }
}

// `NODE_TEST_CONTEXT` is set in a process the Node test runner started, and child processes inherit it, so the
// entry script must also be a test file: a benchmark a test spawns must not start a harness of its own (its
// output would follow the JSON the test parses). The hook is registered while the module loads (a test file's
// top level, before any test runs), where `after` attaches to the file's root.
if (process.env.NODE_TEST_CONTEXT && /\.test\.[cm]?js$/.test(process.argv[1] ?? '')) {
  try { createRequire(import.meta.url)('node:test').after(removeAllTempDirs); } catch { /* the exit handler is the backstop */ }
}

/**
 * Create a temporary directory under the OS temp directory and arrange for its removal.
 * @param {string} [prefix] directory name prefix, for example `dg-anchors-`
 * @param {{ after?: (fn: () => void) => void }} [t] optional test context; its `after` removes the directory when that test ends
 * @param {{ parent?: string, keep?: boolean }} [options] `parent` replaces the OS temp directory (the helper then
 *   removes the result only if the parent resolves inside it); `keep` creates the directory and registers no removal,
 *   for a caller that retains its output on request
 * @returns {string} the directory's absolute path
 */
export function makeTempDir(prefix = 'dg-', t, { parent = tmpdir(), keep = false } = {}) {
  install();
  const dir = mkdtempSync(join(parent, prefix));
  if (keep) return dir;
  registry.set(dir, realpathSync(dir));
  if (t && typeof t.after === 'function') t.after(() => { removeTempDir(dir); });
  return dir;
}
