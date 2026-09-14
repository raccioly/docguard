import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * @req docguard.precision-evidence-loop#FR-007
 * @req docguard.precision-evidence-loop#FR-009
 * @req docguard.precision-evidence-loop#FR-010
 */

import { calculateMetrics, wilsonInterval } from '../benchmarks/lib/metrics.mjs';
import { compareBenchmarkCores, compareRuntimeObservations } from '../benchmarks/lib/compare.mjs';

const result = (overrides = {}) => ({
  id: 'case', repositoryGroup: 'repo', parserTier: 'js-ast',
  classification: 'defect', scope: { validatorKey: 'security', codes: ['SEC001'] },
  sourceRevision: 'sha256:source-1', configDigest: 'sha256:config-1',
  expected: ['SEC001@a.js'], actual: ['SEC001@a.js'], unexpected: [], missing: [],
  abstained: false, repairOutcome: 'not_evaluated', ...overrides,
});

describe('benchmark metrics', () => {
  it('reports exact counts and null ratios instead of claiming unsupported perfection', () => {
    const metrics = calculateMetrics([
      result(),
      result({ id: 'fp', classification: 'clean_control', expected: [], actual: ['SEC001@b.js'], unexpected: ['SEC001@b.js'] }),
      result({ id: 'unsupported', classification: 'unsupported_syntax', expected: [], actual: [], unexpected: [], parserTier: 'py-ast' }),
    ]);
    assert.equal(metrics.aggregate.truePositives, 1);
    assert.equal(metrics.aggregate.falsePositives, 1);
    assert.equal(metrics.aggregate.precision, 0.5);
    assert.equal(metrics.aggregate.recall, 1);
    assert.equal(metrics.aggregate.unsupportedRate, 0.333333);
    assert.equal(metrics.byParserTier['py-ast'].precision, null);
    assert.equal(metrics.byParserTier['py-ast'].recall, null);
    assert.equal(metrics.byParserTier['py-ast'].falsePositivesPerRepository, null);
    assert.equal(metrics.aggregate.acceptedRepairRate, null);
    assert.deepEqual(metrics.aggregate.confidence95.acceptedRepairRate, null);
    assert.deepEqual(wilsonInterval(0, 0), null);
    assert.deepEqual(wilsonInterval(12, 12), { lower: 0.757499, upper: 1 });
  });

  it('tracks accepted repair outcomes without treating unevaluated repairs as rejection', () => {
    const metrics = calculateMetrics([
      result({ id: 'accepted', repairOutcome: 'accepted' }),
      result({ id: 'rejected', repairOutcome: 'rejected' }),
      result({ id: 'unknown' }),
    ]).aggregate;
    assert.deepEqual(metrics.repairs, { accepted: 1, rejected: 1, notEvaluated: 1 });
    assert.equal(metrics.acceptedRepairRate, 0.5);
  });
});

describe('benchmark comparison', () => {
  it('fails independently on new false negatives, false positives, abstention, and removed cases', () => {
    const baselineCases = [result({ id: 'fn' }), result({ id: 'fp' }), result({ id: 'abstain' }), result({ id: 'removed' })];
    const candidateCases = [
      result({ id: 'fn', actual: [], missing: ['SEC001@a.js'] }),
      result({ id: 'fp', actual: ['SEC001@a.js', 'SEC001@extra.js'], unexpected: ['SEC001@extra.js'] }),
      result({ id: 'abstain', abstained: true }),
    ];
    const comparison = compareBenchmarkCores(
      { schemaVersion: 1, cases: baselineCases },
      { schemaVersion: 1, cases: candidateCases },
    );
    assert.equal(comparison.status, 'FAIL');
    assert.deepEqual(comparison.regressions.map(item => item.kind), [
      'new-supported-abstention', 'new-false-negative', 'new-false-positive', 'case-removed',
    ]);
  });

  it('invalidates reviewed evidence when fixture source or labels change', () => {
    const comparison = compareBenchmarkCores(
      { schemaVersion: 1, cases: [result()] },
      { schemaVersion: 1, cases: [result({ sourceRevision: 'sha256:source-2', expected: [] })] },
    );
    assert.equal(comparison.status, 'FAIL');
    assert.deepEqual(comparison.regressions[0], {
      id: 'case',
      kind: 'case-evidence-changed',
      fields: ['sourceRevision', 'expected'],
      detail: 'Reviewed source, configuration, classification, scope, or labels changed; adjudicate and replace the baseline explicitly.',
    });
  });

  it('keeps persisted timings observational and gates only controlled same-session samples', () => {
    const environment = { node: 'v22', platform: 'linux', arch: 'x64' };
    const baseline = { environment, cases: [{ id: 'a', coldMs: 100, warmMs: 50 }] };
    assert.equal(compareRuntimeObservations(baseline, { environment: { ...environment, node: 'v24' }, cases: [] }).comparable, false);
    const observational = compareRuntimeObservations(baseline, { environment, cases: [{ id: 'a', coldMs: 121, warmMs: 60 }] });
    assert.equal(observational.comparable, false);
    assert.match(observational.reason, /observational/);
    const comparisonProtocol = { controlled: true, sessionId: 'paired-run-1', sampleCount: 5 };
    const comparison = compareRuntimeObservations(
      { ...baseline, comparisonProtocol },
      { environment, comparisonProtocol, cases: [{ id: 'a', coldMs: 121, warmMs: 60 }] },
    );
    assert.equal(comparison.comparable, true);
    assert.deepEqual(comparison.regressions.map(item => item.phase), ['coldMs']);
    assert.equal(compareRuntimeObservations(
      { ...baseline, comparisonProtocol },
      { environment, comparisonProtocol: { ...comparisonProtocol, sessionId: 'other-run' }, cases: [] },
    ).comparable, false);
  });
});
