/**
 * v0.17-P1 — Version pin in `.docguard.json`.
 *
 * User report: "The CLI auto-bumped 0.13.1 → 0.14.1 → 0.15.0 between commands
 * in the same session. New validators appeared between runs. Same project,
 * same docs, different score across versions." This release adds an opt-in
 * `docguardVersion` field that pins the expected CLI version + a `--pin`
 * action to update it after a passing run.
 *
 * @req SC-P1-001 — guard nudges when running CLI > pinned version
 * @req SC-P1-002 — guard nudges when running CLI < pinned version
 * @req SC-P1-003 — no nudge when CLI matches pin (silent OK)
 * @req SC-P1-004 — no nudge when docguardVersion is absent (backward compat)
 * @req SC-P1-005 — `guard --pin` writes docguardVersion to .docguard.json
 * @req SC-P1-006 — `guard --pin` refuses on FAIL status (don't pin broken state)
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const CLI = join(process.cwd(), 'cli/docguard.mjs');
const PKG = JSON.parse(readFileSync('package.json', 'utf-8'));
const CURRENT = PKG.version;

function makeRepo(extraConfig = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-pin-'));
  mkdirSync(join(dir, 'docs-canonical'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 't', version: '0.0.1' }));
  writeFileSync(join(dir, 'docs-canonical/ARCHITECTURE.md'), '# A\nstub.\n');
  writeFileSync(join(dir, 'CHANGELOG.md'), '# Changelog\n## [Unreleased]\n');
  writeFileSync(join(dir, 'AGENTS.md'), '# Agents\n');
  writeFileSync(join(dir, 'DRIFT-LOG.md'), '# Drift\n');
  writeFileSync(join(dir, '.docguard.json'), JSON.stringify({
    projectName: 't', profile: 'starter', version: '0.5', ...extraConfig,
  }, null, 2));
  // git init so Freshness has history
  const env = { ...process.env };
  spawnSync('git', ['init', '-q'], { cwd: dir, env });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A'], { cwd: dir, env });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { cwd: dir, env });
  return dir;
}

describe('guard — version pin nudge', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('no nudge when docguardVersion is absent (backward compat)', () => {
    dir = makeRepo();
    const r = spawnSync('node', [CLI, 'guard', '--quiet'], { cwd: dir, encoding: 'utf-8' });
    assert.doesNotMatch(r.stdout, /📌/, 'absent pin should not trigger any pin nudge');
  });

  it('no nudge when CLI matches the pinned version', () => {
    dir = makeRepo({ docguardVersion: CURRENT });
    const r = spawnSync('node', [CLI, 'guard', '--quiet'], { cwd: dir, encoding: 'utf-8' });
    assert.doesNotMatch(r.stdout, /📌/, 'matching pin should be silent');
  });

  it('nudges when CLI version is NEWER than the pin', () => {
    dir = makeRepo({ docguardVersion: '0.1.0' });
    const r = spawnSync('node', [CLI, 'guard', '--quiet'], { cwd: dir, encoding: 'utf-8' });
    assert.match(r.stdout, /📌/, 'newer-than-pinned should nudge');
    assert.match(r.stdout, /docguard guard --pin/, 'nudge should point at --pin');
    assert.match(r.stdout, /pins v0\.1\.0/, 'nudge should reference the pin value');
  });

  it('nudges when CLI version is OLDER than the pin', () => {
    dir = makeRepo({ docguardVersion: '99.0.0' });
    const r = spawnSync('node', [CLI, 'guard', '--quiet'], { cwd: dir, encoding: 'utf-8' });
    assert.match(r.stdout, /📌/, 'older-than-pinned should nudge');
    assert.match(r.stdout, /Upgrade with/, 'nudge should point at upgrade');
  });

  it('--pin writes docguardVersion on a passing run', () => {
    dir = makeRepo();
    const r = spawnSync('node', [CLI, 'guard', '--pin', '--quiet'], { cwd: dir, encoding: 'utf-8' });
    assert.match(r.stdout, /pinned: \(unset\) → /, `expected pin write; got: ${r.stdout.slice(-400)}`);
    const cfg = JSON.parse(readFileSync(join(dir, '.docguard.json'), 'utf-8'));
    assert.equal(cfg.docguardVersion, CURRENT);
  });

  it('--pin is idempotent (no-op when already current)', () => {
    dir = makeRepo({ docguardVersion: CURRENT });
    const r = spawnSync('node', [CLI, 'guard', '--pin', '--quiet'], { cwd: dir, encoding: 'utf-8' });
    assert.match(r.stdout, /already pinned/);
  });
});
