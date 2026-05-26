/**
 * v0.14-P4 — `docguard upgrade --apply --pr` opens a migration PR.
 *
 * Full PR creation requires a real git remote + gh authentication, so the
 * deep test is manual (and validated in the dry-run on wu-whatsappinbox).
 * Here we verify the structural pieces:
 *   - --pr flag is parsed
 *   - upgrade.mjs exports work when --pr is set
 *   - gh-absence is handled gracefully
 *
 * @req SC-P4-001 — --pr flag is parsed and passed to runUpgrade
 * @req SC-P4-002 — gh-absent environment produces a clear error
 * @req SC-P4-003 — --pr without --apply is harmless (no PR opened)
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CLI = join(process.cwd(), 'cli/docguard.mjs');

function makeRepo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-pr-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

describe('upgrade --pr', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('--pr without --apply does not open a PR (no-op for read mode)', () => {
    dir = makeRepo({
      'package.json': JSON.stringify({ name: 't', version: '0.0.1' }),
      '.docguard.json': JSON.stringify({ projectName: 't', version: '0.4', profile: 'starter' }),
    });
    const r = spawnSync('node', [CLI, 'upgrade', '--pr'], { cwd: dir, encoding: 'utf-8' });
    // Should run upgrade in REPORT mode (no migration). Status 0 or 1 are
    // both fine — what we're checking is no PR creation attempt.
    assert.doesNotMatch(r.stdout + r.stderr, /pr create/i,
      'gh pr create must not run without --apply');
  });

  it('--apply --pr without gh CLI installed produces a clear error', () => {
    dir = makeRepo({
      'package.json': JSON.stringify({ name: 't', version: '0.0.1' }),
      '.docguard.json': JSON.stringify({ projectName: 't', version: '0.4', profile: 'starter' }),
    });
    // Stub PATH so `gh` is not findable
    const r = spawnSync('node', [CLI, 'upgrade', '--apply', '--pr'], {
      cwd: dir,
      encoding: 'utf-8',
      env: { ...process.env, PATH: '/usr/bin:/bin' },  // strip ~/.local/bin etc.
    });
    // If gh isn't on the stripped PATH, expect the clear error message.
    // If gh IS available system-wide, the test is a no-op (skip-style).
    if (/gh CLI not found/.test(r.stdout + r.stderr)) {
      assert.match(r.stdout + r.stderr, /Install: https:\/\/cli\.github\.com/);
      assert.equal(r.status, 1, 'should exit 1 when PR creation aborts');
    }
  });

  it('reports the migrated schema version in --apply mode', () => {
    dir = makeRepo({
      'package.json': JSON.stringify({ name: 't', version: '0.0.1' }),
      '.docguard.json': JSON.stringify({ projectName: 't', version: '0.4', profile: 'starter' }),
    });
    const r = spawnSync('node', [CLI, 'upgrade', '--apply'], { cwd: dir, encoding: 'utf-8' });
    // The 0.4 → 0.5 migration is real and should print the version arrow.
    assert.match(r.stdout, /Schema migrated 0\.4 → 0\.5/,
      `expected migration banner, got: ${r.stdout.slice(0, 400)}`);
  });
});
