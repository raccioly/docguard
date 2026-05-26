/**
 * v0.21-B — Smart `init` first-run-detection tests.
 *
 * v0.21 makes `docguard init` auto-detect existing source code and switch
 * from the blank-skeleton path to the "scan and propose" path (which
 * dispatches to `runGenerate` with --plan). These tests pin the heuristic:
 *
 *   - Empty dir → skeleton path (unchanged)
 *   - Dir with cli/ or src/ → smart mode → "DocGuard Init — Smart Mode" banner
 *   - --skeleton flag → forces skeleton even with code present
 *   - --wizard flag → goes to wizard (not smart mode)
 *   - --skip-prompts → stays on skeleton path (CI / deterministic flow)
 *   - Pre-existing docs-canonical/ with .md files → skeleton path (re-init)
 *
 * @req SC-INIT-SMART-001 — empty dir uses skeleton path
 * @req SC-INIT-SMART-002 — dir with src/ triggers smart mode
 * @req SC-INIT-SMART-003 — dir with cli/ triggers smart mode
 * @req SC-INIT-SMART-004 — --skeleton forces skeleton even with src/
 * @req SC-INIT-SMART-005 — --skip-prompts keeps skeleton path
 * @req SC-INIT-SMART-006 — pre-existing canonical docs skip smart mode
 * @req SC-INIT-SMART-007 — 10+ top-level source files (Python style) triggers smart mode
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CLI = join(process.cwd(), 'cli/docguard.mjs');

function stripAnsi(s) { return s.replace(/\x1B\[[0-9;]*[A-Za-z]/g, ''); }

function mkFixture({ withSrcDir = false, withCliDir = false, withPyFiles = 0, withCanonicalDoc = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'init-smart-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture', version: '0.0.1' }));
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir, stdio: 'ignore' });
  spawnSync('git', ['config', 'user.email', 't@t'], { cwd: dir, stdio: 'ignore' });
  spawnSync('git', ['config', 'user.name', 't'], { cwd: dir, stdio: 'ignore' });
  if (withSrcDir) {
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src/main.mjs'), '// stub\n');
  }
  if (withCliDir) {
    mkdirSync(join(dir, 'cli'));
    writeFileSync(join(dir, 'cli/main.mjs'), '// stub\n');
  }
  for (let i = 0; i < withPyFiles; i++) {
    writeFileSync(join(dir, `mod${i}.py`), '# stub\n');
  }
  if (withCanonicalDoc) {
    mkdirSync(join(dir, 'docs-canonical'));
    writeFileSync(join(dir, 'docs-canonical/ARCHITECTURE.md'), '# Architecture\n\nstub\n');
  }
  spawnSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' });
  spawnSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
  return dir;
}

describe('v0.21 — smart init first-run detection', () => {
  let dir;
  afterEach(() => { if (dir) { rmSync(dir, { recursive: true, force: true }); dir = null; } });

  it('empty directory uses the skeleton path (backward compat)', () => {
    dir = mkFixture();
    const r = spawnSync('node', [CLI, 'init', '--skip-prompts', '--quiet'], { cwd: dir, encoding: 'utf-8' });
    const out = stripAnsi(r.stdout);
    assert.match(out, /DocGuard Init —/);
    assert.doesNotMatch(out, /Smart Mode/);
    assert.doesNotMatch(out, /DocGuard Generate Plan/);
  });

  it('directory with src/ triggers smart mode → dispatches to generate', () => {
    dir = mkFixture({ withSrcDir: true });
    const r = spawnSync('node', [CLI, 'init', '--quiet'], { cwd: dir, encoding: 'utf-8' });
    const out = stripAnsi(r.stdout);
    assert.match(out, /Smart Mode/);
    assert.match(out, /scan and propose/);
    assert.match(out, /DocGuard Generate Plan/);
  });

  it('directory with cli/ triggers smart mode', () => {
    dir = mkFixture({ withCliDir: true });
    const r = spawnSync('node', [CLI, 'init', '--quiet'], { cwd: dir, encoding: 'utf-8' });
    const out = stripAnsi(r.stdout);
    assert.match(out, /Smart Mode/);
  });

  it('--skeleton forces skeleton path even with src/ present', () => {
    dir = mkFixture({ withSrcDir: true });
    const r = spawnSync('node', [CLI, 'init', '--skip-prompts', '--quiet', '--skeleton'], { cwd: dir, encoding: 'utf-8' });
    const out = stripAnsi(r.stdout);
    assert.doesNotMatch(out, /Smart Mode/);
    assert.match(out, /DocGuard Init —/);
  });

  it('--skip-prompts keeps skeleton path (CI determinism)', () => {
    dir = mkFixture({ withSrcDir: true });
    const r = spawnSync('node', [CLI, 'init', '--skip-prompts', '--quiet'], { cwd: dir, encoding: 'utf-8' });
    const out = stripAnsi(r.stdout);
    assert.doesNotMatch(out, /Smart Mode/);
  });

  it('pre-existing canonical doc → skip smart mode (treats as re-init)', () => {
    dir = mkFixture({ withSrcDir: true, withCanonicalDoc: true });
    const r = spawnSync('node', [CLI, 'init', '--skip-prompts', '--quiet'], { cwd: dir, encoding: 'utf-8' });
    const out = stripAnsi(r.stdout);
    assert.doesNotMatch(out, /Smart Mode/);
  });

  it('10+ top-level source files (Python style) triggers smart mode', () => {
    dir = mkFixture({ withPyFiles: 10 });
    const r = spawnSync('node', [CLI, 'init', '--quiet'], { cwd: dir, encoding: 'utf-8' });
    const out = stripAnsi(r.stdout);
    assert.match(out, /Smart Mode/);
  });

  it('fewer than 10 top-level files + no code dir → skeleton path', () => {
    dir = mkFixture({ withPyFiles: 3 });
    const r = spawnSync('node', [CLI, 'init', '--skip-prompts', '--quiet'], { cwd: dir, encoding: 'utf-8' });
    const out = stripAnsi(r.stdout);
    assert.doesNotMatch(out, /Smart Mode/);
  });
});
