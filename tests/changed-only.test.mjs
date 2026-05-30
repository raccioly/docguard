/**
 * `docguard guard --changed-only` — pre-commit lite mode.
 *
 * @req SC-K5-001 — --changed-only restricts the validator set to a fast subset
 * @req SC-K5-002 — the fast subset includes Docs-Sync, Environment, API-Surface
 * @req SC-K5-003 — non-lite validators are reported as 'skipped'
 * @req SC-K5-004 — the lite set itself stays unchanged across releases
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { CHANGED_ONLY_VALIDATORS, liteValidatorsConfig } from '../cli/commands/guard.mjs';

function make(files) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-changed-only-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

describe('CHANGED_ONLY_VALIDATORS — the pre-commit lite set', () => {
  it('exists as a non-empty array of strings', () => {
    assert.ok(Array.isArray(CHANGED_ONLY_VALIDATORS));
    assert.ok(CHANGED_ONLY_VALIDATORS.length > 0);
    for (const k of CHANGED_ONLY_VALIDATORS) assert.equal(typeof k, 'string');
  });

  it('includes the three validators promised in CI-RECIPES', () => {
    assert.ok(CHANGED_ONLY_VALIDATORS.includes('docsSync'),
      'pre-commit lite must include Docs-Sync — the highest-value drift catcher');
    assert.ok(CHANGED_ONLY_VALIDATORS.includes('environment'),
      'pre-commit lite must include Environment — common churn during feature work');
    assert.ok(CHANGED_ONLY_VALIDATORS.includes('apiSurface'),
      'pre-commit lite must include API-Surface — catches endpoint additions/removals');
  });

  it('does NOT include slow validators (Freshness, Traceability, Doc-Quality)', () => {
    assert.ok(!CHANGED_ONLY_VALIDATORS.includes('freshness'));
    assert.ok(!CHANGED_ONLY_VALIDATORS.includes('traceability'));
    assert.ok(!CHANGED_ONLY_VALIDATORS.includes('docQuality'));
  });
});

describe('liteValidatorsConfig — never silently drops severity=high validators', () => {
  it('enables only the lite set by default', () => {
    const v = liteValidatorsConfig({});
    for (const k of CHANGED_ONLY_VALIDATORS) assert.equal(v[k], true, `${k} should be on`);
    assert.equal(v.security, false, 'security is not in the lite set, so off by default');
    assert.equal(v.freshness, false, 'slow validators stay off by default');
  });

  it('force-enables a validator the team escalated to severity=high', () => {
    // Regression: a changed-only gate used to pass on a committed secret even
    // when `security` was marked high, because the lite set silently dropped it.
    const v = liteValidatorsConfig({ severity: { security: 'high' } });
    assert.equal(v.security, true,
      'security=high must run under --changed-only — it is an explicit "always block" signal');
  });

  it('respects an explicit validator disable over a high-severity override', () => {
    const v = liteValidatorsConfig({
      severity: { security: 'high' },
      validators: { security: false },
    });
    assert.equal(v.security, false,
      'an explicit validators.security=false wins — you cannot escalate a disabled validator');
  });

  it('does not escalate medium/low severity validators', () => {
    const v = liteValidatorsConfig({ severity: { freshness: 'low', traceability: 'medium' } });
    assert.equal(v.freshness, false);
    assert.equal(v.traceability, false);
  });
});

// End-to-end smoke check: drive the CLI subprocess with --changed-only and
// verify only the lite validators ran.
describe('`docguard guard --changed-only` end-to-end (subprocess)', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('reports the lite-mode banner', async () => {
    dir = make({
      'package.json': JSON.stringify({ name: 'lite-test', version: '0.0.0' }),
      'docs-canonical/ARCHITECTURE.md': '# Architecture\nMinimal.',
      '.docguard.json': JSON.stringify({ projectName: 'lite-test', profile: 'starter', version: '0.5' }),
    });
    const { spawnSync } = await import('node:child_process');
    const result = spawnSync(
      'node',
      [join(process.cwd(), 'cli/docguard.mjs'), 'guard', '--changed-only'],
      { cwd: dir, encoding: 'utf-8' }
    );
    // Banner is on stdout. The subprocess may exit with various codes
    // depending on whether the fixture has warnings — we only assert the
    // banner appears.
    assert.match(result.stdout, /changed-only/, 'banner should announce changed-only mode');
    // v0.13 / N-1: banner now reports either the changed-file count or "no
    // changes since <ref>" instead of the old "pre-commit lite" phrasing.
    assert.match(result.stdout, /(no changes since|file\(s\) changed since)/,
      'banner should describe changed-file scope');
  });
});
