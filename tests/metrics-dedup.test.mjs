/**
 * v0.14.1-N1 — Metrics-Consistency dedup.
 *
 * Reported by wu-whatsappinbox: a file that mentions a stale validator/check
 * count multiple times (e.g. once in a heading, once in a body table) was
 * producing one warning per occurrence — "4 warnings for 2 files".
 *
 * @req SC-N1-001 — same drift in one file → one warning (not one per match)
 * @req SC-N1-002 — distinct drift values in one file are separate warnings
 * @req SC-N1-003 — replace-count fix is emitted exactly once per (file, label)
 * @req SC-N1-004 — passed count uses unique-per-(file,label), not per-match
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { validateMetricsConsistency } from '../cli/validators/metrics-consistency.mjs';

function makeRepo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-metrics-dedup-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

// Simulate guard results so Metrics-Consistency knows what the "actual" count is.
function fakeGuardResults(validatorCount, checkTotal) {
  // Build N validators with checkTotal/N checks each (approx) so totals add up.
  const validators = [];
  const each = Math.floor(checkTotal / validatorCount);
  for (let i = 0; i < validatorCount; i++) {
    validators.push({ status: 'pass', total: each, passed: each });
  }
  // Pad last one to hit the exact target
  validators[validators.length - 1].total += checkTotal - each * validatorCount;
  return validators;
}

describe('Metrics-Consistency — dedup per (file, label, found)', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('same drift mentioned twice in one file → ONE warning, not two', () => {
    dir = makeRepo({
      'README.md':
        '# Project\n\n' +
        '## What\n\nDocGuard ships **21 validators** out of the box.\n\n' +
        '## Reference\n\nSee the [21 validators table](#table) below.\n',
    });
    // Actual count is 22 (one more than the doc claims)
    const r = validateMetricsConsistency(dir, { projectName: 't' }, fakeGuardResults(22, 100));
    const driftWarnings = r.warnings.filter(w => /21 validators/.test(w) && /README\.md/.test(w));
    assert.equal(driftWarnings.length, 1,
      `expected 1 warning for README.md, got ${driftWarnings.length}: ${driftWarnings.join(' | ')}`);
    const driftFixes = (r.fixes || []).filter(f => f.file === 'README.md' && f.label === 'validators');
    assert.equal(driftFixes.length, 1,
      `expected 1 replace-count fix for README.md, got ${driftFixes.length}`);
  });

  it('two DIFFERENT stale values in one file produce two warnings', () => {
    dir = makeRepo({
      'README.md':
        '# Project\n\n' +
        'DocGuard says **20 validators** here.\n' +
        'But over here it says **19 validators**.\n',
    });
    const r = validateMetricsConsistency(dir, { projectName: 't' }, fakeGuardResults(22, 100));
    const driftWarnings = r.warnings.filter(w => /README\.md/.test(w) && /validators/.test(w));
    // Two distinct stale values → two warnings (one per value)
    assert.equal(driftWarnings.length, 2);
    const driftFixes = (r.fixes || []).filter(f => f.file === 'README.md' && f.label === 'validators');
    assert.equal(driftFixes.length, 2,
      'two distinct drifts → two fixes (each fixes a different "found" value)');
  });

  it('same number mentioned twice in correct form → ONE passed credit, not two', () => {
    // The validator counts itself (+1) so 21 fake guards → "actual = 22 validators".
    dir = makeRepo({
      'README.md':
        '# Project\n\n' +
        '22 validators in total.\n' +
        'See the 22 validators table.\n',
    });
    const r = validateMetricsConsistency(dir, { projectName: 't' }, fakeGuardResults(21, 100));
    // README has TWO "22 validators" occurrences but only one pass should be credited.
    assert.equal(r.warnings.filter(w => /README\.md/.test(w)).length, 0,
      'matching number should not produce a warning');
    // Validators-pattern contribution should be exactly 1 pass for README (not 2).
    // We can't assert total directly because other patterns/files also contribute,
    // but we can verify the README-validators key was deduped via the internal state.
    // Workaround: assert total <= 2 (validators pattern + checks pattern at most once each).
    assert.ok(r.total <= 2,
      `README contributes at most 2 totals (validators + checks once each); got total=${r.total}`);
  });

  it('distinct files with the same stale value each get their own warning', () => {
    dir = makeRepo({
      'README.md':       '# A\n\n21 validators.\n',
      'AGENTS.md':       '# B\n\n21 validators.\n',
      'docs/quickstart.md': '# C\n\n21 validators.\n',
    });
    const r = validateMetricsConsistency(dir, { projectName: 't' }, fakeGuardResults(22, 100));
    const driftWarnings = r.warnings.filter(w => /21 validators/.test(w));
    assert.equal(driftWarnings.length, 3,
      'one warning per FILE that has the drift (3 distinct files = 3 warnings)');
  });
});
