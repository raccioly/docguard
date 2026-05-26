/**
 * v0.14-Q2 — `docguard guard --profile` prints per-validator timing.
 *
 * @req SC-Q2-001 — --profile prints a timing block
 * @req SC-Q2-002 — every active validator carries a numeric durationMs in JSON output
 * @req SC-Q2-003 — --profile is off by default (no noise)
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CLI = join(process.cwd(), 'cli/docguard.mjs');

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-profile-'));
  const files = {
    'package.json': JSON.stringify({ name: 'p', version: '0.0.1' }),
    'docs-canonical/ARCHITECTURE.md': '# A\nstub.\n',
    'CHANGELOG.md': '# C\n## [Unreleased]\n',
    'AGENTS.md': '# A\n',
    '.docguard.json': JSON.stringify({ projectName: 'p', profile: 'starter', version: '0.5' }),
  };
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  // git init so Freshness can run
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A'], { cwd: dir });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { cwd: dir });
  return dir;
}

describe('guard --timings', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('prints a timing block when --timings is set', () => {
    dir = makeRepo();
    const r = spawnSync('node', [CLI, 'guard', '--timings'], { cwd: dir, encoding: 'utf-8' });
    assert.match(r.stdout, /Profile/, '--timings should print a Profile header');
    assert.match(r.stdout, /per-validator wall time/);
    assert.match(r.stdout, /total validator time/);
  });

  it('does NOT print profile output without the flag', () => {
    dir = makeRepo();
    const r = spawnSync('node', [CLI, 'guard'], { cwd: dir, encoding: 'utf-8' });
    assert.doesNotMatch(r.stdout, /per-validator wall time/,
      'profile output must be opt-in');
  });

  it('includes durationMs in --format json output', () => {
    dir = makeRepo();
    const r = spawnSync('node', [CLI, 'guard', '--format', 'json'], { cwd: dir, encoding: 'utf-8' });
    const data = JSON.parse(r.stdout);
    // Every active validator should have a durationMs (could be 0 for trivial ones)
    for (const v of data.validators) {
      if (v.status === 'skipped') continue;
      assert.equal(typeof v.durationMs, 'number',
        `validator "${v.name}" missing durationMs in JSON output`);
    }
  });
});
