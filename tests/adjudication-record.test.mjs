/**
 * A reviewed disagreement leaves a record instead of vanishing.
 *
 * The corpus could only ever absorb a false positive that had ALREADY been
 * repaired: `assertContributionReady` refuses `ambiguous` and
 * `policy_disagreement` (correctly — neither can ship a "this no longer fires"
 * regression test), and every other path produces exactly that test. So a
 * disagreement the maintainers reviewed and declined to act on left no trace
 * anywhere, and "precision 1.0" described the contribution pipeline rather
 * than the detectors.
 *
 * An adjudication row fixes the record without corrupting the measurement.
 * Both alternatives would be dishonest: scoring it as a false positive lets a
 * user who dislikes a rule drive its measured precision down; scoring it as a
 * true positive lets a maintainer launder disagreement into validation.
 * Neither is a measurement, so it is a COUNT beside the rates and inside none
 * of them (precision-evidence-loop#FR-003).
 *
 * @implements docguard.calibrated-finding-channels#FR-015
 * @implements docguard.calibrated-finding-channels#FR-016
 * @implements docguard.calibrated-finding-channels#FR-017
 * @req docguard.calibrated-finding-channels#FR-015
 * @req docguard.calibrated-finding-channels#FR-016
 * @req docguard.calibrated-finding-channels#FR-017
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { calculateMetrics } from '../benchmarks/lib/metrics.mjs';
import { derivePrecisionEvidence } from '../benchmarks/lib/precision-evidence.mjs';
import { compareBenchmarkCores } from '../benchmarks/lib/compare.mjs';
import { buildAdjudicationRow, ADJUDICATED_CLASSIFICATIONS, assertContributionReady } from '../cli/feedback-fixture.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baseline = () => JSON.parse(readFileSync(resolve(ROOT, 'benchmarks/baseline.json'), 'utf8'));

const RATIONALE = 'Reviewed 2026-09-21: the literal is an eight-character credential-shaped string in a config module; SEC001 is behaving as specified and the reporter prefers a narrower rule.';

/** A synthetic row for an existing measured code, with no expected identity. */
const adjudicationRow = (classification = 'policy_disagreement', code = 'SEC001') => ({
  id: `adj-${code.toLowerCase()}-${classification}`,
  split: 'development',
  repositoryGroup: 'synthetic-adjudication',
  causalFamily: `adjudicated-${classification}`,
  parserTier: 'js-ast',
  classification,
  repairOutcome: 'not_evaluated',
  source: { kind: 'fixture', path: 'fixtures/js-security-control' },
  scope: { validatorKey: 'security', codes: [code] },
  config: {}, mutations: [], expected: [], forbidden: [], oppositeControl: null,
  adjudication: { rationale: RATIONALE, adjudicatedAt: '2026-09-21' },
  // Runner-side result fields.
  actual: [], unexpected: [], missing: [], abstained: false,
});

const withRow = (row) => { const b = baseline(); return { ...b, core: { ...b.core, cases: [...b.core.cases, row] } }; };

describe('an adjudication changes no rate (FR-016)', () => {
  test('every per-code ratio for the disputed code is byte-identical', () => {
    const before = derivePrecisionEvidence(baseline()).byCode.SEC001;
    const after = derivePrecisionEvidence(withRow(adjudicationRow())).byCode.SEC001;
    for (const field of ['precision', 'recall', 'precisionInterval', 'recallInterval',
      'precisionDenominator', 'truePositives', 'falsePositives', 'falseNegatives',
      'cases', 'cleanControls', 'quotable']) {
      assert.deepEqual(after[field], before[field], `SEC001.${field} must not move`);
    }
  });

  test('the aggregate and validator tiers are untouched', () => {
    const before = derivePrecisionEvidence(baseline());
    const after = derivePrecisionEvidence(withRow(adjudicationRow()));
    assert.deepEqual(after.aggregate, before.aggregate);
    assert.deepEqual(after.byValidator, before.byValidator);
  });

  test('calculateMetrics keeps every denominator, and counts the row separately', () => {
    const before = calculateMetrics(baseline().core.cases);
    const after = calculateMetrics(withRow(adjudicationRow()).core.cases);
    const strip = (m) => JSON.parse(JSON.stringify(m, (k, v) => (k === 'adjudicated' ? undefined : v)));
    assert.deepEqual(strip(after.aggregate), strip(before.aggregate),
      'an adjudicated case may not enter cases, precision, recall or abstention');
    assert.deepEqual(after.aggregate.adjudicated, { policyDisagreements: 1, ambiguous: 0 });
  });

  test('the disagreement is visible per code and corpus-wide', () => {
    const after = derivePrecisionEvidence(withRow(adjudicationRow()));
    assert.deepEqual(after.byCode.SEC001.adjudicated, { policyDisagreements: 1, ambiguous: 0 });
    assert.deepEqual(after.adjudicated, { policyDisagreements: 1, ambiguous: 0 });
  });

  test('ambiguous is counted in its own bucket, never merged with disagreement', () => {
    const after = derivePrecisionEvidence(withRow(adjudicationRow('ambiguous')));
    assert.deepEqual(after.byCode.SEC001.adjudicated, { policyDisagreements: 0, ambiguous: 1 });
  });

  test('a code with only adjudications reports not-measured and still shows them', () => {
    // It must never inherit a sibling's number to fill the gap.
    const after = derivePrecisionEvidence(withRow(adjudicationRow('policy_disagreement', 'SEC010')));
    assert.equal(after.byCode.SEC010.status, 'not-measured');
    assert.equal(after.byCode.SEC010.precision, undefined);
    assert.deepEqual(after.byCode.SEC010.adjudicated, { policyDisagreements: 1, ambiguous: 0 });
  });
});

describe('the row is auditable (FR-015)', () => {
  const manifest = {
    classification: 'policy_disagreement',
    detector: { code: 'SEC001', validator: 'security' },
    parserTier: 'js-ast',
    config: {},
    expectedIdentity: 'SEC001@src/config.js',
    oppositeControl: { files: [{ path: 'src/clean.js', content: 'export const x = 1;\n' }] },
    fixture: { files: [{ path: 'src/config.js', content: 'const password = "hunter2hunter2";\n' }] },
    provenance: { synthetic: true, redacted: true },
  };

  test('builds a corpus row that declares no expected or forbidden identity', () => {
    const row = buildAdjudicationRow(manifest, { rationale: RATIONALE, adjudicatedAt: '2026-09-21' });
    assert.equal(row.classification, 'policy_disagreement');
    assert.deepEqual(row.expected, []);
    assert.deepEqual(row.forbidden, []);
    assert.equal(row.scope.codes[0], 'SEC001');
    assert.equal(row.adjudication.adjudicatedAt, '2026-09-21');
    assert.match(row.adjudication.rationale, /behaving as specified/);
  });

  test('refuses a row with no reasoning or no date', () => {
    assert.throws(() => buildAdjudicationRow(manifest, { rationale: 'no', adjudicatedAt: '2026-09-21' }), /rationale/);
    assert.throws(() => buildAdjudicationRow(manifest, { rationale: RATIONALE }), /adjudicatedAt/);
    assert.throws(() => buildAdjudicationRow(manifest, { rationale: RATIONALE, adjudicatedAt: 'yesterday' }), /adjudicatedAt/);
  });

  test('refuses a row that drops its opposite control or its attestations', () => {
    // A disputed finding with no neighbouring clean case proves nothing either way.
    assert.throws(() => buildAdjudicationRow({ ...manifest, oppositeControl: null }, { rationale: RATIONALE, adjudicatedAt: '2026-09-21' }), /opposite control/);
    assert.throws(() => buildAdjudicationRow({ ...manifest, provenance: { synthetic: false, redacted: true } }, { rationale: RATIONALE, adjudicatedAt: '2026-09-21' }), /attestation/);
  });

  test('refuses classifications that should ship a regression test instead', () => {
    for (const classification of ['false_positive', 'false_negative', 'unsupported_syntax']) {
      assert.throws(() => buildAdjudicationRow({ ...manifest, classification }, { rationale: RATIONALE, adjudicatedAt: '2026-09-21' }), /regression test/);
      assert.ok(!ADJUDICATED_CLASSIFICATIONS.has(classification));
    }
  });

  test('the test-contribution gate still refuses adjudicated classes', () => {
    // The two paths stay disjoint: nothing can claim a detector was fixed when
    // the decision was that it needed no fixing.
    assert.throws(() => assertContributionReady({ ...manifest, contribution: { testOnly: true, scopeDocumented: true } }),
      /require adjudication/);
  });
});

describe('removal is a regression (FR-017)', () => {
  test('deleting an adjudication row fails the baseline comparison', () => {
    // The existing comparator already treats any missing baseline case as a
    // regression; this pins that it covers adjudication rows too, so a
    // disagreement cannot be quietly erased by a later contributor.
    const row = adjudicationRow();
    const core = withRow(row).core;
    const shrunk = { ...core, cases: core.cases.filter(c => c.id !== row.id) };
    const result = compareBenchmarkCores(core, shrunk, {});
    assert.equal(result.status, 'FAIL');
    assert.ok(result.regressions.some(r => r.id === row.id && r.kind === 'case-removed'),
      'removing a reviewed disagreement must be reported, not silently accepted');
  });
});
