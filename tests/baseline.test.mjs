/**
 * Adoption baseline — `.docguard.baseline.json` (v0.33).
 *
 * @req SC-BSL-001 — fingerprints are stable across line numbers and volatile counts
 * @req SC-BSL-002 — guard --update-baseline freezes current findings; guard then passes
 * @req SC-BSL-003 — suppression is visible (note + baselineSuppressed in JSON)
 * @req SC-BSL-004 — --no-baseline restores the full view
 * @req SC-BSL-005 — NEW findings still gate (the whole point)
 * @req SC-BSL-006 — malformed baseline = absent (fail-open on visibility)
 * @req SC-BSL-007 — ci honors the baseline (runGuardInternal path)
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { fingerprintFinding, saveBaseline, loadBaseline, BASELINE_FILE } from '../cli/writers/baseline.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'cli', 'docguard.mjs');

function makeFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-baseline-'));
  writeFileSync(join(dir, '.docguard.json'), JSON.stringify({ projectName: 'bl-fixture', profile: 'standard' }));
  mkdirSync(join(dir, 'docs-canonical'), { recursive: true });
  writeFileSync(join(dir, 'docs-canonical', 'ARCHITECTURE.md'), '# Architecture\n');
  return dir;
}

function spawnCli(args, cwd) {
  return spawnSync('node', [CLI, ...args], {
    cwd, encoding: 'utf-8', env: { ...process.env, NO_COLOR: '1' },
  });
}

describe('fingerprintFinding — stability', () => {
  it('is identical across line-number and volatile-count churn', () => {
    const a = fingerprintFinding({ code: 'FRS002', location: 'docs/X.md:12', message: '21 code commits since last update' });
    const b = fingerprintFinding({ code: 'FRS002', location: 'docs/X.md:97', message: '48 code commits since last update' });
    assert.equal(a, b, 'line numbers and digit runs must not change the fingerprint');
  });

  it('differs by code and by path', () => {
    const base = { code: 'STR001', location: 'a.md', message: 'missing' };
    assert.notEqual(fingerprintFinding(base), fingerprintFinding({ ...base, code: 'STR002' }));
    assert.notEqual(fingerprintFinding(base), fingerprintFinding({ ...base, location: 'b.md' }));
  });
});

describe('baseline adoption flow', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('freeze → pass → visible note → --no-baseline restores', () => {
    dir = makeFixture();
    assert.equal(spawnCli(['guard'], dir).status, 1, 'bare fixture fails before baseline');

    const upd = spawnCli(['guard', '--update-baseline'], dir);
    assert.equal(upd.status, 0);
    assert.ok(existsSync(join(dir, BASELINE_FILE)), 'baseline file written at repo root');

    const after = spawnCli(['guard'], dir);
    assert.equal(after.status, 0, 'frozen findings no longer gate');
    assert.match(after.stdout, /pre-existing finding\(s\) suppressed/);

    assert.equal(spawnCli(['guard', '--no-baseline'], dir).status, 1, '--no-baseline shows everything');
  });

  it('JSON carries baselineSuppressed and ci honors the baseline', () => {
    dir = makeFixture();
    spawnCli(['guard', '--update-baseline'], dir);
    const g = JSON.parse(spawnCli(['guard', '--format', 'json'], dir).stdout);
    assert.ok(g.baselineSuppressed > 0);
    assert.equal(g.status, 'PASS');

    const ci = spawnCli(['ci', '--no-history'], dir);
    assert.equal(ci.status, 0, 'ci gates only new drift once baselined');
  });

  it('NEW findings still gate after the freeze', () => {
    dir = makeFixture();
    spawnCli(['guard', '--update-baseline'], dir);
    assert.equal(spawnCli(['guard'], dir).status, 0);
    // Introduce brand-new drift: delete a doc that existed at freeze time —
    // its STR001 has a different fingerprint (path) than anything baselined.
    rmSync(join(dir, 'docs-canonical', 'ARCHITECTURE.md'));
    const res = spawnCli(['guard'], dir);
    assert.equal(res.status, 1, 'a finding not in the baseline must still fail');
    assert.match(res.stdout, /ARCHITECTURE\.md/);
  });

  it('malformed baseline is treated as absent — nothing is hidden', () => {
    dir = makeFixture();
    writeFileSync(join(dir, BASELINE_FILE), 'not json{{{');
    assert.equal(loadBaseline(dir), null);
    assert.equal(spawnCli(['guard'], dir).status, 1, 'corrupt baseline must not un-gate CI');
  });

  it('saveBaseline stores occurrence counts with sorted keys for clean diffs', () => {
    dir = makeFixture();
    const f = { code: 'STR001', location: 'a.md', message: 'x' };
    const n = saveBaseline(dir, [f, { ...f }, { code: 'ENV001', location: 'b.md', message: 'y' }]);
    assert.equal(n, 2, 'two distinct fingerprints');
    const doc = JSON.parse(readFileSync(join(dir, BASELINE_FILE), 'utf-8'));
    const keys = Object.keys(doc.fingerprints);
    assert.deepEqual(keys, [...keys].sort());
    assert.equal(doc.fingerprints[fingerprintFinding(f)], 2, 'duplicate instance recorded as count 2');
  });

  it('H2 regression: a NEW instance of a baselined finding class still gates', () => {
    dir = makeFixture();
    // Freeze exactly ONE occurrence of a fingerprint...
    const f = { code: 'STR001', location: 'docs-canonical/DATA-MODEL.md', message: 'Missing required file: docs-canonical/DATA-MODEL.md' };
    saveBaseline(dir, [f]);
    const loaded = loadBaseline(dir);
    assert.equal(loaded.get(fingerprintFinding(f)), 1, 'baseline stores an occurrence budget, not a set');
    // ...and confirm the budget semantics end-to-end: the real guard run has
    // MANY findings; a 1-count baseline for one of them suppresses exactly 1.
    const before = JSON.parse(spawnCli(['guard', '--format', 'json', '--no-baseline'], dir).stdout);
    const after = JSON.parse(spawnCli(['guard', '--format', 'json'], dir).stdout);
    assert.equal(after.baselineSuppressed, 1, 'exactly one instance suppressed');
    assert.equal(before.findings.length - after.findings.length, 1);
  });

  it('H3 regression: report and ci disclose baseline suppression', () => {
    dir = makeFixture();
    spawnCli(['guard', '--update-baseline'], dir);
    const rep = JSON.parse(spawnCli(['report', '--format', 'json'], dir).stdout);
    assert.ok(rep.guard.baselineSuppressed > 0, 'report JSON must carry baselineSuppressed');
    const repMd = spawnCli(['report'], dir).stdout;
    assert.match(repMd, /suppressed by/, 'report markdown must disclose suppression');
    const ci = JSON.parse(spawnCli(['ci', '--no-history', '--format', 'json'], dir).stdout);
    assert.ok(ci.guard.baselineSuppressed > 0, 'ci JSON must carry baselineSuppressed');
  });

  it('L1 regression: --update-baseline refuses --changed-only', () => {
    dir = makeFixture();
    const res = spawnCli(['guard', '--update-baseline', '--changed-only'], dir);
    assert.equal(res.status, 1);
    assert.ok(!existsSync(join(dir, BASELINE_FILE)), 'no partial baseline written');
  });
});
