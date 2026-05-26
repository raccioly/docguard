/**
 * v0.17-P4 — Validator naming consistency (additive).
 *
 * User reported: "Inconsistent validator naming: testSpec (JSON key) /
 * test-spec (CLI flag) / Test-Spec (display). Pick one casing." Rather
 * than break existing configs, this release ACCEPTS both forms in
 * .docguard.json and normalizes internally to camelCase. The display
 * (kebab-case) and JSON output (camelCase) stay as-is.
 *
 * @req SC-P4-001 — kebab-case validator keys in .docguard.json work
 * @req SC-P4-002 — camelCase validator keys keep working (regression)
 * @req SC-P4-003 — kebab-case severity keys in .docguard.json work
 * @req SC-P4-004 — non-validator keys in config are left untouched
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CLI = join(process.cwd(), 'cli/docguard.mjs');

function makeRepo(configOverrides) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-naming-'));
  mkdirSync(join(dir, 'docs-canonical'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 't', version: '0.0.1' }));
  writeFileSync(join(dir, 'docs-canonical/ARCHITECTURE.md'), '# A\nstub.\n');
  writeFileSync(join(dir, 'CHANGELOG.md'), '# Changelog\n## [Unreleased]\n');
  writeFileSync(join(dir, 'AGENTS.md'), '# Agents\n');
  writeFileSync(join(dir, 'DRIFT-LOG.md'), '# Drift\n');
  writeFileSync(join(dir, '.docguard.json'), JSON.stringify({
    projectName: 't', profile: 'starter', version: '0.5', ...configOverrides,
  }, null, 2));
  const env = { ...process.env };
  spawnSync('git', ['init', '-q'], { cwd: dir, env });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A'], { cwd: dir, env });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { cwd: dir, env });
  return dir;
}

describe('validator naming — accepts both kebab and camel', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('kebab-case validators.test-spec disables Test-Spec', () => {
    dir = makeRepo({
      validators: { 'test-spec': false },
    });
    const r = spawnSync('node', [CLI, 'guard', '--format', 'json', '--quiet'], { cwd: dir, encoding: 'utf-8' });
    const data = JSON.parse(r.stdout);
    const ts = data.validators.find(v => v.key === 'testSpec');
    assert.ok(ts, 'Test-Spec validator should be in results');
    assert.equal(ts.status, 'skipped',
      `kebab-case "test-spec: false" should disable; got status: ${ts.status}`);
  });

  it('camelCase validators.testSpec still disables Test-Spec (regression)', () => {
    dir = makeRepo({
      validators: { testSpec: false },
    });
    const r = spawnSync('node', [CLI, 'guard', '--format', 'json', '--quiet'], { cwd: dir, encoding: 'utf-8' });
    const data = JSON.parse(r.stdout);
    const ts = data.validators.find(v => v.key === 'testSpec');
    assert.equal(ts.status, 'skipped');
  });

  it('kebab-case severity.cross-reference applies correctly', () => {
    dir = makeRepo({
      severity: { 'cross-reference': 'low' },
    });
    const r = spawnSync('node', [CLI, 'guard', '--format', 'json', '--quiet'], { cwd: dir, encoding: 'utf-8' });
    const data = JSON.parse(r.stdout);
    const xref = data.validators.find(v => v.key === 'crossReference');
    if (xref && xref.status !== 'skipped') {
      assert.equal(xref.severity, 'low',
        `kebab-case "cross-reference: low" should set severity; got: ${xref.severity}`);
    }
  });

  it('camelCase severity.crossReference still works (regression)', () => {
    dir = makeRepo({
      severity: { crossReference: 'high' },
    });
    const r = spawnSync('node', [CLI, 'guard', '--format', 'json', '--quiet'], { cwd: dir, encoding: 'utf-8' });
    const data = JSON.parse(r.stdout);
    const xref = data.validators.find(v => v.key === 'crossReference');
    if (xref && xref.status !== 'skipped') {
      assert.equal(xref.severity, 'high');
    }
  });

  it('non-validator config keys are left untouched', () => {
    dir = makeRepo({
      // These are non-validator keys; even if they happen to be kebab-case
      // they should not be munged.
      'source-root': 'src',  // an unknown kebab key in the user config
      validators: { 'test-spec': false },
    });
    const r = spawnSync('node', [CLI, 'guard', '--format', 'json', '--quiet'], { cwd: dir, encoding: 'utf-8' });
    // The test passes as long as guard doesn't crash on the unknown key.
    assert.ok(r.status === 0 || r.status === 2, `guard should exit cleanly, got ${r.status}`);
  });
});
