/**
 * v0.21-A — `docguard demo` smoke tests.
 *
 * The demo is the funnel-unblocker for adoption: a dev runs `npx docguard-cli
 * demo` and sees the value in 30 seconds. These tests verify the command
 * actually does what the README promises:
 *   - runs end-to-end without errors
 *   - prints the expected sections (banner, found-N-warnings, score, CTA)
 *   - cleans up the temp fixture (no /tmp pollution)
 *   - --keep preserves the fixture for debugging
 *
 * @req SC-DEMO-001 — `docguard demo` exits 0
 * @req SC-DEMO-002 — output contains "DocGuard Demo" banner
 * @req SC-DEMO-003 — output reports a warning count + score
 * @req SC-DEMO-004 — output contains the install CTA
 * @req SC-DEMO-005 — temp fixture is cleaned up by default
 * @req SC-DEMO-006 — --keep preserves the fixture
 * @req SC-DEMO-007 — --quiet suppresses the banner
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CLI = join(process.cwd(), 'cli/docguard.mjs');

// Strip ANSI color codes so regex assertions are readable
function stripAnsi(s) { return s.replace(/\x1B\[[0-9;]*[A-Za-z]/g, ''); }

describe('docguard demo', () => {
  it('runs end-to-end and exits 0', () => {
    const r = spawnSync('node', [CLI, 'demo', '--quiet'], { encoding: 'utf-8' });
    assert.equal(r.status, 0, `demo should exit 0; got ${r.status}\nstderr: ${r.stderr}`);
  });

  it('output shows the demo banner + scan + score + CTA', () => {
    const r = spawnSync('node', [CLI, 'demo'], { encoding: 'utf-8' });
    const out = stripAnsi(r.stdout);
    assert.match(out, /DocGuard Demo/);
    assert.match(out, /What DocGuard found in your fixture/);
    assert.match(out, /Validators run: \d+/);
    assert.match(out, /Warnings: \d+/);
    assert.match(out, /CDD Maturity Score/);
    // Install CTA — both global-install and zero-install paths
    assert.match(out, /npm install -g docguard-cli/);
    assert.match(out, /npx docguard-cli/);
  });

  it('--quiet suppresses the banner', () => {
    const r = spawnSync('node', [CLI, 'demo', '--quiet'], { encoding: 'utf-8' });
    const out = stripAnsi(r.stdout);
    // Quiet mode skips the intro and fixture-path lines but still shows findings
    assert.doesNotMatch(out, /No install\. No setup\./);
    // Findings section still appears
    assert.match(out, /What DocGuard found/);
  });

  it('cleans up the temp fixture by default', () => {
    // Count tmp-dir entries before/after to verify no leak
    const tmp = tmpdir();
    const before = readdirSync(tmp).filter(f => f.startsWith('docguard-demo-')).length;
    spawnSync('node', [CLI, 'demo', '--quiet'], { encoding: 'utf-8' });
    const after = readdirSync(tmp).filter(f => f.startsWith('docguard-demo-')).length;
    assert.equal(after, before, `demo should clean up its temp fixture; before=${before} after=${after}`);
  });

  it('--keep preserves the temp fixture and reports its path', () => {
    const tmp = tmpdir();
    const before = readdirSync(tmp).filter(f => f.startsWith('docguard-demo-'));
    const r = spawnSync('node', [CLI, 'demo', '--keep', '--quiet'], { encoding: 'utf-8' });
    const after = readdirSync(tmp).filter(f => f.startsWith('docguard-demo-'));
    assert.equal(after.length, before.length + 1, 'should keep one new fixture dir');
    // The output should tell the user where it lives
    const out = stripAnsi(r.stdout);
    assert.match(out, /Fixture kept at \/.*docguard-demo-/);
    // Clean up the kept fixture so we don't leak across tests
    const kept = after.find(d => !before.includes(d));
    if (kept) {
      try { require('node:fs').rmSync(join(tmp, kept), { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it('top-5 findings span multiple validators (not all from one)', () => {
    const r = spawnSync('node', [CLI, 'demo', '--quiet'], { encoding: 'utf-8' });
    const out = stripAnsi(r.stdout);
    // Find the validator-name lines (numbered 1-5 with "[SEV] <Validator>")
    const validatorMatches = [...out.matchAll(/^\s+\d+\.\s+\[(?:HIGH|MED|LOW)\]\s+(\S[^\n]*?)$/gm)]
      .map(m => m[1].trim());
    // At least 3 distinct validators should appear in the top 5
    const distinct = new Set(validatorMatches);
    assert.ok(distinct.size >= 3,
      `expected diverse top-5 validators; got: ${[...distinct].join(', ')}`);
  });
});
