import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { validateMetricsConsistency } from '../cli/validators/metrics-consistency.mjs';

describe('Metrics-Consistency Validator', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'docguard-test-metrics-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('passes when metrics correctly match actual actuals', () => {
    // DocGuard-bound (Bug #2): the line references DocGuard, so the numbers are
    // DocGuard's to govern.
    writeFileSync(join(tmpDir, 'README.md'), 'DocGuard runs 15 checks across 12 validators.');

    const guardResults = [];
    for(let i=0; i<11; i++) {
      guardResults.push({ status: 'passed', total: i === 0 ? 5 : 1 });
    }

    const result = validateMetricsConsistency(tmpDir, {}, guardResults);

    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
    assert.strictEqual(result.passed, 2);
    assert.strictEqual(result.total, 2);
  });

  it('returns warnings when numbers mismatch actuals', () => {
    writeFileSync(join(tmpDir, 'README.md'), 'DocGuard runs 20 checks across 12 validators.');

    const guardResults = [];
    for(let i=0; i<11; i++) {
      guardResults.push({ status: 'passed', total: i === 0 ? 5 : 1 });
    }

    const result = validateMetricsConsistency(tmpDir, {}, guardResults);

    assert.deepEqual(result.errors, []);
    assert.strictEqual(result.warnings.length, 1);
    assert.ok(result.warnings[0].includes('README.md says "20 checks" but DocGuard\'s own checks count is 15'));
    assert.strictEqual(result.passed, 1); // 1 passed for validators
    assert.strictEqual(result.total, 2); // total 2 numbers
  });

  it('skips processing changelog files', () => {
    writeFileSync(join(tmpDir, 'CHANGELOG.md'), 'We removed 5 checks and 3 validators.');

    const guardResults = [{ status: 'passed', total: 10 }];
    const result = validateMetricsConsistency(tmpDir, {}, guardResults);

    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
    assert.strictEqual(result.passed, 0);
    assert.strictEqual(result.total, 0);
  });

  it('skips validation when there are no actual metrics', () => {
    writeFileSync(join(tmpDir, 'README.md'), 'We have 20 checks.');

    // guardResults is undefined
    const result = validateMetricsConsistency(tmpDir, {});

    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
    assert.strictEqual(result.passed, 0);
    assert.strictEqual(result.total, 0);
  });

  it('skips processing ignored files', () => {
    writeFileSync(join(tmpDir, '.docguardignore'), 'ignore-this.md');
    writeFileSync(join(tmpDir, 'ignore-this.md'), 'We have 20 checks, 12 validators.');

    const guardResults = [{ status: 'passed', total: 15 }];
    const result = validateMetricsConsistency(tmpDir, {}, guardResults);

    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
    assert.strictEqual(result.passed, 0);
    assert.strictEqual(result.total, 0);
  });

  it('checks for test count if test files exist', () => {
    mkdirSync(join(tmpDir, 'tests'), { recursive: true });
    writeFileSync(join(tmpDir, 'tests', 'a.test.mjs'), '...');
    writeFileSync(join(tmpDir, 'tests', 'b.test.mjs'), '...');

    // we don't have pattern for tests in the current implementation, but it shouldn't crash
    const result = validateMetricsConsistency(tmpDir, {});

    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
    assert.strictEqual(result.passed, 0);
    assert.strictEqual(result.total, 0);
  });

  // Field test (wu-whatsappinbox): the recursive root walk swept in OpenWolf
  // session archives and vendored toolkit READMEs deep under security/, then
  // reported their unrelated "N validators / N checks" prose as the user's
  // drift (~39 false warnings). Markdown buried in arbitrary subdirectories is
  // NOT a doc DocGuard governs, so it must not be scanned.
  it('does NOT scan markdown buried in arbitrary subdirectories (over-reach fix)', () => {
    mkdirSync(join(tmpDir, 'security', 'wolf-archive', 'old-session'), { recursive: true });
    writeFileSync(
      join(tmpDir, 'security', 'wolf-archive', 'old-session', 'memory.md'),
      'Session note: the guard ran 99 validators back then.'
    );
    const guardResults = [{ status: 'passed', total: 15 }];
    const result = validateMetricsConsistency(tmpDir, {}, guardResults);

    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, [],
      `deep-subdir markdown must not be flagged; got: ${result.warnings.join(' | ')}`);
  });

  // Conversely, a canonical doc the user actually configures — even outside the
  // conventional docs-canonical/ tree — MUST still be scanned, so the scoping
  // fix narrows noise without losing real detection.
  it('still scans a configured canonical doc located outside docs-canonical/', () => {
    mkdirSync(join(tmpDir, 'documentation'), { recursive: true });
    writeFileSync(join(tmpDir, 'documentation', 'OVERVIEW.md'), 'DocGuard runs 99 validators.');
    const guardResults = [];
    for (let i = 0; i < 11; i++) guardResults.push({ status: 'passed', total: i === 0 ? 5 : 1 });

    const result = validateMetricsConsistency(
      tmpDir,
      { requiredFiles: { canonical: ['documentation/OVERVIEW.md'] } },
      guardResults
    );

    assert.strictEqual(result.warnings.length, 1, `expected the configured doc to be scanned; got: ${result.warnings.join(' | ')}`);
    assert.ok(result.warnings[0].includes('99 validators'));
  });

  // Bug #2 (field report): TEST-SPEC.md said the proof harness contributes "10
  // checks". That number is NOT about DocGuard, so comparing it to DocGuard's
  // own count — and offering to overwrite it — corrupts a correct number.
  it('does NOT flag an unbound "N checks" that describes a different subject (Bug #2)', () => {
    mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
    writeFileSync(join(tmpDir, 'docs-canonical', 'TEST-SPEC.md'),
      'The proof harness contributes 10 checks to the suite.\n');
    const guardResults = [{ status: 'passed', total: 86 }]; // DocGuard's own count = 86

    const result = validateMetricsConsistency(
      tmpDir,
      { requiredFiles: { canonical: ['docs-canonical/TEST-SPEC.md'] } },
      guardResults
    );

    assert.deepEqual(result.warnings, [],
      `an unbound "10 checks" must not be flagged; got: ${result.warnings.join(' | ')}`);
    assert.deepEqual(result.fixes || [], [], 'no corrupting fix may be emitted for an unbound number');
  });

  it('stamps provenance (actualSource) on a bound metric fix (Bug #2)', () => {
    writeFileSync(join(tmpDir, 'README.md'), 'DocGuard runs 20 checks.');
    const guardResults = [{ status: 'passed', total: 15 }];
    const result = validateMetricsConsistency(tmpDir, {}, guardResults);
    const fix = (result.fixes || []).find(f => f.type === 'replace-count');
    assert.ok(fix, 'a bound mismatch should still produce a fix');
    assert.equal(fix.actualSource, 'docguard.guard.checks', 'fix must carry provenance for the applier');
  });
});

// ── Project collections (field report #6) ─────────────────────────────────────
// `config.collections` binds a documentation noun to a glob whose file-count is
// the source of truth, so a wrong "16 extractors" in prose is caught
// deterministically — the exact false-negative the field report filed.
describe('Metrics-Consistency — project collections (field report #6)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'docguard-test-collections-'));
    mkdirSync(join(tmpDir, 'src', 'extractors'), { recursive: true });
    mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
    for (let i = 0; i < 19; i++) {
      writeFileSync(join(tmpDir, 'src', 'extractors', `e${i}.py`), 'x');
    }
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const cfg = { collections: { extractors: 'src/extractors/*.py' } };

  it('flags a documented count that disagrees with the collection glob (16 vs 19)', () => {
    writeFileSync(join(tmpDir, 'docs-canonical', 'ARCHITECTURE.md'), 'The pipeline runs 16 extractors over each target.');
    const result = validateMetricsConsistency(tmpDir, cfg, []);
    assert.strictEqual(result.warnings.length, 1, result.warnings.join(' | '));
    assert.ok(result.warnings[0].includes('says "16 extractors" but the code has 19'),
      `unexpected message: ${result.warnings[0]}`);
    const fix = (result.fixes || []).find(f => f.type === 'replace-count');
    assert.ok(fix && fix.actual === 19 && fix.found === 16);
    assert.equal(fix.actualSource, 'docguard.collections.extractors');
  });

  it('passes when the documented count matches the glob (19 vs 19)', () => {
    writeFileSync(join(tmpDir, 'docs-canonical', 'ARCHITECTURE.md'), 'The pipeline runs 19 extractors over each target.');
    const result = validateMetricsConsistency(tmpDir, cfg, []);
    assert.deepEqual(result.warnings, []);
  });

  it('does NOT require docguard-binding — a declared noun IS the opt-in', () => {
    // No "docguard" on the line; the built-in checks/validators rules would skip
    // this, but a declared collection must still catch it.
    writeFileSync(join(tmpDir, 'docs-canonical', 'METHODOLOGY.md'), 'We ship 16 extractors.');
    const result = validateMetricsConsistency(tmpDir, cfg, []);
    assert.strictEqual(result.warnings.length, 1, result.warnings.join(' | '));
    assert.ok(result.warnings[0].includes('METHODOLOGY.md'));
  });

  it('fail-safe: an unresolved glob (0 matches) never asserts "0" drift', () => {
    writeFileSync(join(tmpDir, 'docs-canonical', 'ARCHITECTURE.md'), 'We have 5 plugins.');
    const result = validateMetricsConsistency(tmpDir, { collections: { plugins: 'does/not/exist/*.py' } }, []);
    assert.deepEqual(result.warnings, [], 'a bad glob must not manufacture a false "doc says 5 but code has 0"');
  });

  it('reserved nouns (checks/validators/tests) keep the built-in count, ignoring a collection override', () => {
    // Declaring `validators` as a collection must NOT double-bind or override the
    // built-in DocGuard meta-count.
    writeFileSync(join(tmpDir, 'README.md'), 'DocGuard has 12 validators.');
    const result = validateMetricsConsistency(
      tmpDir,
      { collections: { validators: 'src/extractors/*.py' } }, // 19 files — must be ignored for the reserved noun
      [{ status: 'passed', total: 5 }],
    );
    // The built-in validators count is 2 (1 guard validator + the +1 self-count),
    // not 19; "12 validators" is bound to docguard so it's compared to the built-in.
    assert.ok(!result.warnings.some(w => w.includes('the code has 19')),
      `reserved noun must not use the collection glob: ${result.warnings.join(' | ')}`);
  });
});

// ── Auto-detected documentation homes (field report #6 follow-up) ─────────────
// A folder literally named docs/, documentation/, guides/, … is unambiguously a
// doc home DocGuard governs and is now scanned WITHOUT being enrolled — while an
// arbitrary non-doc subdir (security/wolf-archive/) is still never walked.
describe('Metrics-Consistency — auto-detected doc homes', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), 'docguard-test-dochomes-')); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  const guardResultsTwoValidators = () => {
    const g = [];
    for (let i = 0; i < 11; i++) g.push({ status: 'passed', total: i === 0 ? 5 : 1 });
    return g;
  };

  it('auto-scans an UNCONFIGURED documentation/ dir (no requiredFiles entry)', () => {
    mkdirSync(join(tmpDir, 'documentation'), { recursive: true });
    writeFileSync(join(tmpDir, 'documentation', 'OVERVIEW.md'), 'DocGuard runs 99 validators.');
    // No requiredFiles config at all — relies purely on auto-detection.
    const result = validateMetricsConsistency(tmpDir, {}, guardResultsTwoValidators());
    assert.strictEqual(result.warnings.length, 1, result.warnings.join(' | '));
    assert.ok(result.warnings[0].includes('99 validators'));
  });

  it('catches a collection drift inside an auto-detected guides/ dir', () => {
    mkdirSync(join(tmpDir, 'src', 'extractors'), { recursive: true });
    mkdirSync(join(tmpDir, 'guides'), { recursive: true });
    for (let i = 0; i < 19; i++) writeFileSync(join(tmpDir, 'src', 'extractors', `e${i}.py`), 'x');
    writeFileSync(join(tmpDir, 'guides', 'PIPELINE.md'), 'It runs 16 extractors.');
    const result = validateMetricsConsistency(tmpDir, { collections: { extractors: 'src/extractors/*.py' } }, []);
    assert.strictEqual(result.warnings.length, 1, result.warnings.join(' | '));
    assert.ok(result.warnings[0].includes('guides/PIPELINE.md') && result.warnings[0].includes('the code has 19'));
  });

  it('still does NOT scan an arbitrary non-doc subdir (FP guard preserved)', () => {
    mkdirSync(join(tmpDir, 'security', 'wolf-archive'), { recursive: true });
    writeFileSync(join(tmpDir, 'security', 'wolf-archive', 'memory.md'), 'DocGuard ran 99 validators back then.');
    const result = validateMetricsConsistency(tmpDir, {}, guardResultsTwoValidators());
    assert.deepEqual(result.warnings, [], `arbitrary subdir must stay unscanned; got: ${result.warnings.join(' | ')}`);
  });

  it('config.docs.dirs EXTENDS the auto-detected set (adds a non-standard home)', () => {
    mkdirSync(join(tmpDir, 'reference'), { recursive: true });
    writeFileSync(join(tmpDir, 'reference', 'API.md'), 'DocGuard runs 99 validators.');
    // `reference/` is not a conventional name; it's only scanned because declared.
    const result = validateMetricsConsistency(tmpDir, { docs: { dirs: ['reference'] } }, guardResultsTwoValidators());
    assert.strictEqual(result.warnings.length, 1, result.warnings.join(' | '));
    assert.ok(result.warnings[0].includes('reference/API.md'));
  });

  it('honors .docguardignore to EXCLUDE a conventional doc dir', () => {
    mkdirSync(join(tmpDir, 'docs'), { recursive: true });
    writeFileSync(join(tmpDir, 'docs', 'NOTES.md'), 'DocGuard runs 99 validators.');
    writeFileSync(join(tmpDir, '.docguardignore'), 'docs/**');
    const result = validateMetricsConsistency(tmpDir, {}, guardResultsTwoValidators());
    assert.deepEqual(result.warnings, [], `ignored doc dir must not be flagged; got: ${result.warnings.join(' | ')}`);
  });
});
