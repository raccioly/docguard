/**
 * v0.17.1 — "What's new since v<pin>" surfaces in the guard footer when the
 * running CLI is newer than the pinned version. Closes the recurring user
 * pattern of asking for features that shipped one or two releases ago.
 *
 * @req SC-WN-001 — pin at older version surfaces the highlight reel
 * @req SC-WN-002 — pin at current version shows no highlights
 * @req SC-WN-003 — highlights list is bounded (max 5 inline, "N more" pointer otherwise)
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CLI = join(process.cwd(), 'cli/docguard.mjs');

function makeRepo(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-whatsnew-'));
  mkdirSync(join(dir, 'docs-canonical'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 't', version: '0.0.1' }));
  writeFileSync(join(dir, 'docs-canonical/ARCHITECTURE.md'), '# A\nstub\n');
  writeFileSync(join(dir, 'CHANGELOG.md'), '# Changelog\n## [Unreleased]\n');
  writeFileSync(join(dir, 'AGENTS.md'), '# Agents\n');
  writeFileSync(join(dir, 'DRIFT-LOG.md'), '# Drift\n');
  writeFileSync(join(dir, '.docguard.json'), JSON.stringify({
    projectName: 't', profile: 'starter', version: '0.5', ...extra,
  }, null, 2));
  const env = { ...process.env };
  spawnSync('git', ['init', '-q'], { cwd: dir, env });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A'], { cwd: dir, env });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { cwd: dir, env });
  return dir;
}

describe("guard footer — what's-new highlights", () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('pinning at v0.12.0 surfaces the headline features shipped since', () => {
    dir = makeRepo({ docguardVersion: '0.12.0' });
    const r = spawnSync('node', [CLI, 'guard', '--quiet'], { cwd: dir, encoding: 'utf-8' });
    assert.match(r.stdout, /New since v0\.12\.0/);
    // Should mention at least one of the headline features that shipped after v0.12
    assert.match(r.stdout, /sync --since|docguard impact|docguard explain|memory --diff/,
      `expected at least one headline feature; got: ${r.stdout.slice(-800)}`);
  });

  it('pinning at current CLI version shows no what\'s-new (clean)', () => {
    const PKG = JSON.parse(readFileSync('package.json', 'utf-8'));
    dir = makeRepo({ docguardVersion: PKG.version });
    const r = spawnSync('node', [CLI, 'guard', '--quiet'], { cwd: dir, encoding: 'utf-8' });
    assert.doesNotMatch(r.stdout, /New since v/);
  });

  it('caps at 5 inline highlights with "N more" pointer when more exist', () => {
    dir = makeRepo({ docguardVersion: '0.11.0' });
    const r = spawnSync('node', [CLI, 'guard', '--quiet'], { cwd: dir, encoding: 'utf-8' });
    // Should be capped at 5 lines + "N more in CHANGELOG.md"
    const lines = r.stdout.split('\n').filter(l => /^\s+•\s+v0\./.test(l));
    assert.ok(lines.length <= 5, `expected at most 5 inline highlights; got ${lines.length}`);
    assert.match(r.stdout, /more in CHANGELOG\.md/, 'should point at CHANGELOG.md for the rest');
  });
});
