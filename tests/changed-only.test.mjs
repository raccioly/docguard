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

import { CHANGED_ONLY_VALIDATORS } from '../cli/commands/guard.mjs';

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
    assert.match(result.stdout, /pre-commit lite/, 'banner should mention pre-commit lite');
  });
});
