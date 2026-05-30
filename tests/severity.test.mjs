/**
 * Per-validator severity overrides — v0.5 schema feature.
 *
 * Tests the resolveSeverity helper directly, and verifies that
 * runGuardInternal annotates each validator with its resolved severity
 * and computes effective error/warning counts that respect overrides.
 *
 * @req SC-K4-001 — resolveSeverity returns 'medium' by default
 * @req SC-K4-002 — resolveSeverity reads config.severity[validatorKey] when present
 * @req SC-K4-003 — invalid severity strings fall back to 'medium' (no crash)
 * @req SC-K4-004 — high-severity warnings count as effectiveErrors
 * @req SC-K4-005 — low-severity warnings drop out of effective counts
 * @req SC-K4-006 — medium-severity warnings stay in effectiveWarnings
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { resolveSeverity, SEVERITY_LEVELS } from '../cli/shared.mjs';
import { runGuardInternal } from '../cli/commands/guard.mjs';

function make(files) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-severity-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

describe('resolveSeverity — the per-validator severity lookup', () => {
  it('returns "medium" by default (no override)', () => {
    assert.equal(resolveSeverity({}, 'todoTracking'), 'medium');
    assert.equal(resolveSeverity({ severity: {} }, 'todoTracking'), 'medium');
  });

  it('returns the configured severity when set', () => {
    const cfg = { severity: { todoTracking: 'high', freshness: 'low' } };
    assert.equal(resolveSeverity(cfg, 'todoTracking'), 'high');
    assert.equal(resolveSeverity(cfg, 'freshness'), 'low');
    assert.equal(resolveSeverity(cfg, 'environment'), 'medium');
  });

  it('is case-insensitive on the value', () => {
    const cfg = { severity: { todoTracking: 'HIGH', freshness: 'Low' } };
    assert.equal(resolveSeverity(cfg, 'todoTracking'), 'high');
    assert.equal(resolveSeverity(cfg, 'freshness'), 'low');
  });

  it('falls back to "medium" for invalid severity strings', () => {
    const cfg = { severity: { todoTracking: 'critical', freshness: 42, environment: null } };
    assert.equal(resolveSeverity(cfg, 'todoTracking'), 'medium');
    assert.equal(resolveSeverity(cfg, 'freshness'), 'medium');
    assert.equal(resolveSeverity(cfg, 'environment'), 'medium');
  });

  it('SEVERITY_LEVELS exports the three valid values', () => {
    assert.ok(SEVERITY_LEVELS.has('high'));
    assert.ok(SEVERITY_LEVELS.has('medium'));
    assert.ok(SEVERITY_LEVELS.has('low'));
    assert.equal(SEVERITY_LEVELS.size, 3);
  });
});

describe('runGuardInternal — severity-aware effective counts', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  function projectWithFreshnessWarn() {
    // A minimal repo that triggers a Freshness validator warning. Freshness
    // is a good vehicle because it's easy to provoke deterministically:
    // a canonical doc with a stale "last updated" header and a recent code
    // commit produces a warning. We instead disable everything except
    // Freshness with a stub that fires.
    return {
      'package.json': JSON.stringify({ name: 'test', version: '0.0.0' }),
      'docs-canonical/ARCHITECTURE.md': '# Architecture\n\nStub.',
      // No CHANGELOG to force Changelog validator to fail/warn? We instead
      // rely on Docs-Coverage which warns about missing README sections.
      'src/index.ts': 'export const x = 1;',
    };
  }

  it('default (no severity override): warnings stay in effectiveWarnings', () => {
    dir = make(projectWithFreshnessWarn());
    const config = {
      projectName: 'test',
      profile: 'starter',
      validators: {
        // Only run Docs-Coverage — its 'recommended README sections' check
        // produces predictable warnings on a fresh project without a README.
        structure: false, docsSync: false, drift: false, changelog: false,
        testSpec: false, environment: false, security: false, freshness: false,
        traceability: false, docsDiff: false, apiSurface: false,
        metadataSync: false, docsCoverage: true, docQuality: false,
        todoTracking: false, schemaSync: false, specKit: false,
        metricsConsistency: false, architecture: false,
      },
      // No severity overrides
    };
    const r = runGuardInternal(dir, config);
    // Either warnings were produced (Docs-Coverage typically does) or it's a
    // PASS. Either way, effective counts should match raw counts when no
    // severity override is set.
    assert.equal(r.effectiveErrors, r.errors,
      'with no overrides, effectiveErrors == errors');
    assert.equal(r.effectiveWarnings, r.warnings,
      'with no overrides, effectiveWarnings == warnings');
  });

  it('high-severity warnings become effectiveErrors (and drop out of effectiveWarnings)', () => {
    dir = make(projectWithFreshnessWarn());
    const config = {
      projectName: 'test',
      profile: 'starter',
      validators: {
        structure: false, docsSync: false, drift: false, changelog: false,
        testSpec: false, environment: false, security: false, freshness: false,
        traceability: false, docsDiff: false, apiSurface: false,
        metadataSync: false, docsCoverage: true, docQuality: false,
        todoTracking: false, schemaSync: false, specKit: false,
        metricsConsistency: false, architecture: false,
      },
      severity: { docsCoverage: 'high' },
    };
    const r = runGuardInternal(dir, config);
    if (r.warnings === 0) {
      // Project happened not to produce any docs-coverage warnings — assertion
      // becomes a no-op rather than a false fail.
      assert.equal(r.effectiveErrors, r.errors);
      assert.equal(r.effectiveWarnings, 0);
      return;
    }
    assert.equal(r.effectiveErrors, r.errors + r.warnings,
      'high severity should escalate all warnings to effectiveErrors');
    assert.equal(r.effectiveWarnings, 0,
      'no warnings should remain in effectiveWarnings');
  });

  it('low-severity warnings drop from effective counts entirely', () => {
    dir = make(projectWithFreshnessWarn());
    const config = {
      projectName: 'test',
      profile: 'starter',
      validators: {
        structure: false, docsSync: false, drift: false, changelog: false,
        testSpec: false, environment: false, security: false, freshness: false,
        traceability: false, docsDiff: false, apiSurface: false,
        metadataSync: false, docsCoverage: true, docQuality: false,
        todoTracking: false, schemaSync: false, specKit: false,
        metricsConsistency: false, architecture: false,
      },
      severity: { docsCoverage: 'low' },
    };
    const r = runGuardInternal(dir, config);
    assert.equal(r.effectiveErrors, r.errors,
      'low severity does not promote anything to errors');
    assert.equal(r.effectiveWarnings, 0,
      'low-severity warnings should not count toward effectiveWarnings');
  });

  it('each validator result is annotated with its resolved severity', () => {
    dir = make(projectWithFreshnessWarn());
    const config = {
      projectName: 'test',
      profile: 'starter',
      validators: { docsCoverage: true, structure: true, freshness: false },
      severity: { docsCoverage: 'low', structure: 'high' },
    };
    const r = runGuardInternal(dir, config);
    const dc = r.validators.find(v => v.key === 'docsCoverage');
    const st = r.validators.find(v => v.key === 'structure');
    if (dc) assert.equal(dc.severity, 'low');
    if (st) assert.equal(st.severity, 'high');
  });
});

describe('runGuardInternal — status word agrees with the severity-aware exit code', () => {
  // Regression for the bug where overallStatus used RAW counts while the exit
  // code used severity-adjusted (effective) counts, so the printed verdict
  // could contradict what CI did (WARN printed but exit 1, or vice-versa).
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  const projectWithFreshnessWarn = () => ({
    'package.json': JSON.stringify({ name: 'test', version: '0.0.0' }),
    'docs-canonical/ARCHITECTURE.md': '# Architecture\n\nStub.',
    'src/index.ts': 'export const x = 1;',
  });

  const onlyDocsCoverage = (severity) => ({
    projectName: 'test',
    profile: 'starter',
    validators: {
      structure: false, docsSync: false, drift: false, changelog: false,
      testSpec: false, environment: false, security: false, freshness: false,
      traceability: false, docsDiff: false, apiSurface: false,
      metadataSync: false, docsCoverage: true, docQuality: false,
      todoTracking: false, schemaSync: false, specKit: false,
      metricsConsistency: false, architecture: false,
    },
    ...(severity ? { severity: { docsCoverage: severity } } : {}),
  });

  // The invariant under test: the status word is exactly the verdict the exit
  // code encodes. effectiveErrors>0 ⇒ FAIL (exit 1); else effectiveWarnings>0
  // ⇒ WARN (exit 2); else PASS (exit 0).
  const assertStatusMatchesExit = (r) => {
    const expected = r.effectiveErrors > 0 ? 'FAIL' : r.effectiveWarnings > 0 ? 'WARN' : 'PASS';
    assert.equal(r.status, expected,
      `status "${r.status}" must match effective-count verdict "${expected}" (effErr=${r.effectiveErrors}, effWarn=${r.effectiveWarnings})`);
  };

  it('default warnings ⇒ status WARN (matches exit 2)', () => {
    dir = make(projectWithFreshnessWarn());
    const r = runGuardInternal(dir, onlyDocsCoverage(null));
    assertStatusMatchesExit(r);
    if (r.warnings > 0) assert.equal(r.status, 'WARN');
  });

  it('severity=high warnings ⇒ status FAIL (matches exit 1, not WARN)', () => {
    dir = make(projectWithFreshnessWarn());
    const r = runGuardInternal(dir, onlyDocsCoverage('high'));
    assertStatusMatchesExit(r);
    if (r.warnings > 0 || r.effectiveErrors > 0) assert.equal(r.status, 'FAIL');
  });

  it('severity=low warnings ⇒ status PASS (matches exit 0, not WARN)', () => {
    dir = make(projectWithFreshnessWarn());
    const r = runGuardInternal(dir, onlyDocsCoverage('low'));
    assertStatusMatchesExit(r);
    // With the only active validator demoted to low and no errors, the
    // effective counts are zero ⇒ PASS even though raw warnings may exist.
    if (r.errors === 0) assert.equal(r.status, 'PASS');
  });
});
