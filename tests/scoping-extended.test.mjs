/**
 * v0.15-P3 — Drift-Comments + TODO-Tracking honor config.changedFiles.
 *
 * @req SC-P3-001 — Drift validator scopes to changedFiles when set
 * @req SC-P3-002 — TODO-Tracking validator scopes to changedFiles when set
 * @req SC-P3-003 — CHANGED_ONLY_VALIDATORS now includes drift + todoTracking
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { validateDrift } from '../cli/validators/drift.mjs';
import { CHANGED_ONLY_VALIDATORS } from '../cli/commands/guard.mjs';

function makeRepo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-scope-ext-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

describe('CHANGED_ONLY_VALIDATORS — v0.15 lite set', () => {
  it('includes the new opt-ins (drift, todoTracking)', () => {
    assert.ok(CHANGED_ONLY_VALIDATORS.includes('drift'),
      'drift should be in the lite set');
    assert.ok(CHANGED_ONLY_VALIDATORS.includes('todoTracking'),
      'todoTracking should be in the lite set');
  });

  it('keeps the v0.13 opt-ins (docsSync, environment, apiSurface)', () => {
    assert.ok(CHANGED_ONLY_VALIDATORS.includes('docsSync'));
    assert.ok(CHANGED_ONLY_VALIDATORS.includes('environment'));
    assert.ok(CHANGED_ONLY_VALIDATORS.includes('apiSurface'));
  });
});

describe('Drift-Comments — config.changedFiles scope', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('scopes to listed files when changedFiles is set', () => {
    dir = makeRepo({
      'src/a.ts': '// DRIFT: a-drift\nexport const x = 1;',
      'src/b.ts': '// DRIFT: b-drift\nexport const y = 2;',
      'DRIFT-LOG.md': '# Drift Log\na-drift\n',  // covers a, not b
    });
    // Scoped to ONLY a.ts → b's drift comment isn't scanned
    const scoped = validateDrift(dir, {
      changedFiles: ['src/a.ts'],
      requiredFiles: { driftLog: 'DRIFT-LOG.md' },
    });
    // a's drift is covered in the log → pass
    // b's drift not scanned → not flagged
    const unscoped = validateDrift(dir, {
      requiredFiles: { driftLog: 'DRIFT-LOG.md' },
    });

    // The unscoped run sees BOTH a-drift and b-drift; b-drift is untracked.
    assert.ok(unscoped.errors.length >= 1 || unscoped.warnings.length >= 1,
      'full scan should flag b-drift as untracked');
    // The scoped run only sees a-drift, which IS in the log → fewer issues.
    assert.ok(
      (scoped.errors.length + scoped.warnings.length) <
      (unscoped.errors.length + unscoped.warnings.length),
      `scoped scan should flag fewer issues. scoped=${scoped.errors.length + scoped.warnings.length}, unscoped=${unscoped.errors.length + unscoped.warnings.length}`
    );
  });

  it('full scan when changedFiles is empty array', () => {
    dir = makeRepo({
      'src/a.ts': '// DRIFT: a-drift\n',
      'DRIFT-LOG.md': '# Drift Log\n',
    });
    const r = validateDrift(dir, {
      changedFiles: [],
      requiredFiles: { driftLog: 'DRIFT-LOG.md' },
    });
    // Empty changedFiles → fall through to full walkDir
    assert.ok(r.errors.length + r.warnings.length >= 1,
      'empty changedFiles should not short-circuit; full walk should run');
  });
});

// TODO-Tracking changedFiles scoping is exercised via end-to-end subprocess
// in tests/changed-only.test.mjs (already updated to expect the v0.15 set).
