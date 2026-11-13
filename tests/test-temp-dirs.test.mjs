/**
 * Every temporary directory a test, benchmark or tool creates is removed
 * (specs/098-test-temp-dirs, issue 662).
 *
 * The helper removes a directory when its test ends, when its file ends and,
 * as a backstop, when the process exits or is interrupted. It never removes a
 * path it did not create or one outside the OS temporary directory. A scan
 * keeps `mkdtemp` out of every other file under `tests/`, `benchmarks/` and
 * `tools/`.
 *
 * @req docguard.test-temp-dirs#FR-001
 * @req docguard.test-temp-dirs#FR-002
 * @req docguard.test-temp-dirs#FR-003
 * @req docguard.test-temp-dirs#FR-004
 * @req docguard.test-temp-dirs#FR-005
 * @req docguard.test-temp-dirs#FR-006
 * @req docguard.test-temp-dirs#SC-001
 * @req docguard.test-temp-dirs#SC-002
 * @req docguard.test-temp-dirs#SC-003
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir, removeTempDir } from './helpers/temp-dir.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HELPER = join(ROOT, 'tests', 'helpers', 'temp-dir.mjs');

/** Run `body` in a child process (its own TMPDIR) and return the child's result plus what it left in TMPDIR. */
function runChild(t, body) {
  const scratch = makeTempDir('dg-tempdirs-child-', t);
  const script = join(scratch, 'child.mjs');
  writeFileSync(script, `import { makeTempDir } from ${JSON.stringify(HELPER)};\n${body}\n`);
  const tmp = join(scratch, 'tmp');
  mkdirSync(tmp);
  const result = spawnSync(process.execPath, [script], { env: { ...process.env, TMPDIR: tmp, TMP: tmp, TEMP: tmp, NODE_TEST_CONTEXT: '' }, encoding: 'utf8' });
  return { result, left: readdirSync(tmp) };
}

describe('makeTempDir removes what it creates (FR-001)', () => {
  it('creates a directory under the OS temp directory with the given prefix', t => {
    const dir = makeTempDir('dg-prefix-check-', t);
    assert.ok(statSync(dir).isDirectory());
    assert.ok(realpathSync(dir).startsWith(realpathSync(tmpdir())));
    assert.match(dir, /dg-prefix-check-/);
  });

  it('removes the directory when the test it was given ends', async t => {
    let made;
    await t.test('inner test', inner => { made = makeTempDir('dg-inner-', inner); writeFileSync(join(made, 'f'), 'x'); assert.ok(existsSync(made)); });
    assert.equal(existsSync(made), false);
  });

  it('removes a directory that was created without a test context, when the file ends or the process exits', t => {
    const { result, left } = runChild(t, `const d = makeTempDir('dg-nocontext-'); console.log(d);`);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(left, []);
  });
});

describe('the exit backstop covers a failed or interrupted process (FR-002)', () => {
  it('removes the directory when the process throws', t => {
    const { result, left } = runChild(t, `makeTempDir('dg-throw-'); throw new Error('boom');`);
    assert.notEqual(result.status, 0);
    assert.deepEqual(left, []);
  });

  it('removes the directory when the process calls process.exit', t => {
    const { left } = runChild(t, `makeTempDir('dg-exit-'); process.exit(3);`);
    assert.deepEqual(left, []);
  });

  it('removes the directory when the process is sent SIGTERM', t => {
    const { result, left } = runChild(t, `makeTempDir('dg-sigterm-'); process.kill(process.pid, 'SIGTERM'); setTimeout(() => {}, 5000);`);
    assert.equal(result.status, 143);
    assert.deepEqual(left, []);
  });

  it('removes the directory when the process is sent SIGINT', t => {
    const { result, left } = runChild(t, `makeTempDir('dg-sigint-'); process.kill(process.pid, 'SIGINT'); setTimeout(() => {}, 5000);`);
    assert.equal(result.status, 130);
    assert.deepEqual(left, []);
  });

  it('keeps a directory the caller asked to retain', t => {
    const { left } = runChild(t, `makeTempDir('dg-keep-', undefined, { keep: true });`);
    assert.equal(left.length, 1);
  });
});

describe('removal is confined to what the helper created inside the OS temp directory (FR-003)', () => {
  it('refuses a directory it did not create', t => {
    const stranger = join(realpathSync(tmpdir()), `dg-stranger-${process.pid}-${Date.now()}`);
    mkdirSync(stranger);
    t.after(() => rmSync(stranger, { recursive: true, force: true }));
    assert.equal(removeTempDir(stranger), false);
    assert.ok(existsSync(stranger));
  });

  it('refuses the OS temp directory itself and a path outside it', () => {
    assert.equal(removeTempDir(tmpdir()), false);
    assert.equal(removeTempDir(ROOT), false);
    assert.ok(existsSync(ROOT));
  });

  it('refuses a created directory whose real path is outside the temp directory', t => {
    // A parent that sits outside the OS temp directory: the directory is created, never removed by the helper.
    const outside = join(ROOT, `.dg-outside-${process.pid}-${Date.now()}`);
    mkdirSync(outside);
    t.after(() => rmSync(outside, { recursive: true, force: true }));
    const dir = makeTempDir('dg-outside-child-', undefined, { parent: outside });
    assert.equal(removeTempDir(dir), false);
    assert.ok(existsSync(dir));
  });

  it('does not follow a symlink out of the temp directory', t => {
    const target = join(ROOT, `.dg-target-${process.pid}-${Date.now()}`);
    mkdirSync(target);
    t.after(() => rmSync(target, { recursive: true, force: true }));
    writeFileSync(join(target, 'keep.txt'), 'keep');
    const dir = makeTempDir('dg-link-', t);
    const link = join(dir, 'link');
    try { symlinkSync(target, link); } catch { return; /* symlinks unavailable on this platform */ }
    assert.equal(removeTempDir(dir), true);
    assert.ok(existsSync(join(target, 'keep.txt')), 'the symlink target must survive');
  });

  it('never throws, even for a directory that is already gone or a non-string', t => {
    const dir = makeTempDir('dg-gone-', t);
    rmSync(dir, { recursive: true, force: true });
    assert.doesNotThrow(() => removeTempDir(dir));
    assert.doesNotThrow(() => removeTempDir(undefined));
    assert.doesNotThrow(() => removeTempDir(null));
  });
});

describe('nothing creates a temporary directory around the helper (FR-004)', () => {
  const SCANNED = ['tests', 'benchmarks', 'tools'];
  const CALL = /\bmkdtemp(?:Sync)?\s*\(/;

  function walk(dir, out = []) {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules') continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path, out);
      else if (/\.(?:mjs|js|cjs)$/.test(name)) out.push(path);
    }
    return out;
  }

  it('finds no mkdtemp or mkdtempSync call outside tests/helpers/temp-dir.mjs', () => {
    const offenders = [];
    for (const top of SCANNED) {
      for (const file of walk(join(ROOT, top))) {
        if (file === HELPER) continue;
        readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
          if (CALL.test(line)) offenders.push(`${relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
        });
      }
    }
    assert.deepEqual(offenders, [], `use makeTempDir from tests/helpers/temp-dir.mjs instead:\n${offenders.join('\n')}`);
  });

  it('the scan sees a violation (control)', () => {
    const sync = 'mkdtemp' + 'Sync';
    assert.ok(CALL.test(`const d = ${sync}(join(tmpdir(), 'x'));`));
    assert.ok(CALL.test(`fs.${'mkdtemp'} (join(os.tmpdir(), 'x'), cb)`));
    assert.equal(CALL.test(`import { ${sync} } from 'node:fs';`), false);
  });
});

describe('the leak check proves a clean run (FR-005)', () => {
  it('fails and names a directory the command left behind, and passes a clean command', t => {
    const dirty = spawnSync(process.execPath, [join(ROOT, 'tools', 'check-temp-leaks.mjs'), '--', process.execPath, '-e', "require('fs').mkdirSync(process.env.TMPDIR + '/dg-left-behind')"], { encoding: 'utf8' });
    assert.equal(dirty.status, 1);
    assert.match(dirty.stderr, /dg-left-behind/);
    const clean = spawnSync(process.execPath, [join(ROOT, 'tools', 'check-temp-leaks.mjs'), '--', process.execPath, '-e', '0'], { encoding: 'utf8' });
    assert.equal(clean.status, 0, clean.stderr);
    void t;
  });

  it('--check reports a folder an earlier run used, and passes an empty one', t => {
    const dir = makeTempDir('dg-checkmode-', t);
    mkdirSync(join(dir, 'dg-stale'));
    mkdirSync(join(dir, 'node-compile-cache'));
    const dirty = spawnSync(process.execPath, [join(ROOT, 'tools', 'check-temp-leaks.mjs'), '--check', dir], { encoding: 'utf8' });
    assert.equal(dirty.status, 1);
    assert.match(dirty.stderr, /dg-stale/);
    rmSync(join(dir, 'dg-stale'), { recursive: true });
    assert.equal(spawnSync(process.execPath, [join(ROOT, 'tools', 'check-temp-leaks.mjs'), '--check', dir], { encoding: 'utf8' }).status, 0);
  });

  it('is what the CI hermeticity job runs after its single suite run', () => {
    const ci = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
    assert.match(ci, /echo "TMPDIR=\$RUNNER_TEMP\/suite-tmp" >> "\$GITHUB_ENV"/);
    assert.match(ci, /run: node tools\/check-temp-leaks\.mjs --check "\$RUNNER_TEMP\/suite-tmp"/);
    assert.match(readFileSync(join(ROOT, 'package.json'), 'utf8'), /"test:temp-leaks": "node tools\/check-temp-leaks\.mjs"/);
  });
});
