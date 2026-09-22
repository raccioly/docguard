import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * @req docguard.precision-evidence-loop#FR-019
 * @req docguard.precision-evidence-loop#SC-008
 */

import { derivePrecisionEvidence, DEFAULT_MIN_N } from '../benchmarks/lib/precision-evidence.mjs';
import { evidenceProjection, renderEvidenceModule, EVIDENCE_MODULE_PATH } from '../benchmarks/generate-precision-evidence.mjs';
import { loadBaseline } from '../benchmarks/lib/baseline.mjs';
import { PRECISION_EVIDENCE, evidenceForCode, isMeasured, precisionEvidenceBlock, describeEvidenceForCode } from '../cli/precision-evidence.mjs';
import { CODES } from '../cli/findings.mjs';

const CLI = resolve('cli/docguard.mjs');
const schema = () => JSON.parse(readFileSync(resolve('schemas/docguard-precision-evidence.schema.json'), 'utf8'));
const baseline = () => loadBaseline('benchmarks/baseline.json');

describe('per-code precision evidence', () => {
  it('attributes true and false positives by the code inside each finding identity', () => {
    const evidence = derivePrecisionEvidence({
      core: {
        manifestDigest: 'sha256:' + 'a'.repeat(64),
        tool: { version: '9.9.9', revision: null },
        cases: [{
          id: 'pair', repositoryGroup: 'repo', causalFamily: 'family', parserTier: 'js-ast',
          classification: 'defect', scope: { validatorKey: 'security', codes: ['SEC001', 'SEC002'] },
          expected: ['SEC001@a.js'], actual: ['SEC001@a.js', 'SEC002@b.js'],
          unexpected: ['SEC002@b.js'], missing: [],
        }],
      },
      review: { status: 'candidate', limitations: 'x' },
    });
    assert.equal(evidence.byCode.SEC001.truePositives, 1);
    assert.equal(evidence.byCode.SEC001.falsePositives, 0);
    assert.equal(evidence.byCode.SEC002.truePositives, 0);
    assert.equal(evidence.byCode.SEC002.falsePositives, 1, 'one code\'s false positive must not smear onto the other');
    assert.equal(evidence.byValidator.security.falsePositives, 1);
  });

  it('never lets an unmeasured code inherit its validator\'s measured precision', () => {
    // SEC005 is measured; SEC004 shares the security validator and is not.
    assert.equal(isMeasured('SEC005'), true);
    assert.equal(isMeasured('SEC004'), false);
    assert.equal(CODES.SEC004.validator, CODES.SEC005.validator, 'fixture assumes both codes sit in one validator');
    const unmeasured = evidenceForCode('SEC004');
    assert.equal(unmeasured.status, 'not-measured');
    assert.equal('precision' in unmeasured, false);
    assert.equal('backoff' in unmeasured, false);
    assert.match(describeEvidenceForCode('SEC004').join(' '), /no benchmark evidence/);
    assert.equal(describeEvidenceForCode('SEC004').join(' ').includes('%'), false, 'an unmeasured code must quote no rate');
  });

  it('backs a thin measured code off to a coarser measured tier, labelled', () => {
    const thin = evidenceForCode('SEC003');
    assert.equal(thin.status, 'measured');
    assert.equal(thin.quotable, false);
    assert.match(thin.notQuotableReason, /does not quote a point estimate below 5/);
    assert.equal(thin.backoff.tier, 'validator');
    assert.equal(thin.backoff.key, 'security');
    assert.equal(thin.backoff.quotable, true);
    const wide = evidenceForCode('SEC005');
    assert.equal(wide.quotable, true);
    assert.equal(wide.backoff, null, 'a quotable code needs no backoff');
    assert.equal(wide.precisionDenominator >= DEFAULT_MIN_N, true);
  });

  it('falls back to the aggregate only when the validator tier is itself too thin', () => {
    const structure = evidenceForCode('STR001');
    assert.equal(PRECISION_EVIDENCE.byValidator.structure.quotable, false);
    assert.equal(structure.backoff.tier, 'aggregate');
    assert.equal(structure.backoff.key, 'all-measured-codes');
  });

  it('keeps every measured code a real code and every ratio null-safe', () => {
    for (const [code, cell] of Object.entries(PRECISION_EVIDENCE.byCode)) {
      assert.ok(CODES[code], `${code} is measured but not a defined finding code`);
      assert.equal(cell.status, 'measured');
      if (cell.precisionDenominator === 0) {
        assert.equal(cell.precision, null);
        assert.equal(cell.precisionInterval, null);
      } else {
        assert.equal(cell.precision, Number((cell.truePositives / cell.precisionDenominator).toFixed(6)));
        assert.equal(cell.precisionInterval.length, 2);
      }
    }
  });

  it('rejects a nonsensical floor', () => {
    assert.throws(() => derivePrecisionEvidence(baseline(), { minN: 0 }), /minN/);
  });
});

describe('guard precision evidence block', () => {
  it('is scoped to the codes in the run and counts what was never benchmarked', () => {
    const block = precisionEvidenceBlock(['SEC005', 'SEC005', 'SEC003', 'DQ007', 'SPR001'], '0.41.7');
    assert.deepEqual(block.coverage, { codesInRun: 4, measured: 2, notMeasured: 2, quotable: 1, adjudicated: 0 });
    assert.equal(block.codes.DQ007.status, 'not-measured');
    assert.equal(block.codes.SEC005.status, 'measured');
    assert.equal(block.measures, 'benchmark-precision');
    assert.match(block.caveat, /not the probability that a finding in your repository is real/);
  });

  it('says plainly when the numbers were measured on a different build', () => {
    assert.equal(precisionEvidenceBlock(['SEC005'], PRECISION_EVIDENCE.source.toolVersion).source.matchesRunningVersion, true);
    const skewed = precisionEvidenceBlock(['SEC005'], '0.1.0');
    assert.equal(skewed.source.matchesRunningVersion, false);
    assert.equal(skewed.source.runningVersion, '0.1.0');
    assert.match(describeEvidenceForCode('SEC005', '0.1.0').join(' '), /Measured on DocGuard .*you are running 0\.1\.0/);
  });

  it('survives an empty run and junk input without inventing a code', () => {
    const empty = precisionEvidenceBlock([], '0.41.7');
    assert.deepEqual(empty.coverage, { codesInRun: 0, measured: 0, notMeasured: 0, quotable: 0, adjudicated: 0 });
    assert.deepEqual(empty.codes, {});
    assert.deepEqual(precisionEvidenceBlock([null, undefined, ''], '0.41.7').codes, {});
    assert.equal(evidenceForCode(undefined).status, 'not-measured');
    assert.equal(evidenceForCode('NOPE999').status, 'not-measured');
  });

  it('reaches the guard JSON result without touching a single finding field', () => {
    const run = spawnSync(process.execPath, [CLI, 'guard', '--format', 'json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    assert.ok([0, 1, 2].includes(run.status), run.stderr);
    const report = JSON.parse(run.stdout);
    assert.ok(report.precisionEvidence, 'guard must carry the evidence block');
    assert.equal(report.precisionEvidence.measures, 'benchmark-precision');
    assert.equal(report.precisionEvidence.coverage.codesInRun, new Set(report.findings.map(f => f.code)).size);
    for (const finding of report.findings) {
      // Findings are written verbatim into shareable feedback records, so the
      // shape is a contract: it may only grow, and only with a spec. The three
      // channels added by docguard.calibrated-finding-channels are listed here
      // so an accidental field can never slip in unreviewed.
      assert.deepEqual(Object.keys(finding).sort(), [
        'code', 'confidence', 'disposition', 'effectiveSeverity', 'enforcement',
        'evidence', 'location', 'message', 'parserTier', 'redactedContext',
        'reportable', 'severity', 'suggestion', 'validator',
      ], 'findings are written verbatim into shareable feedback records; their shape changes only by spec');
      assert.ok(['act', 'escalate'].includes(finding.disposition));
      assert.ok(['measured', 'not-measured'].includes(finding.evidence.status));
      assert.equal(finding.location === null || typeof finding.location === 'string', true,
        'location is a string or null, never an object (FR-009)');
    }
  });

  it('explains a code on the command line, measured or not', () => {
    const measured = spawnSync(process.execPath, [CLI, 'explain', 'SEC005'], { encoding: 'utf8' });
    assert.equal(measured.status, 0, measured.stderr);
    assert.match(measured.stdout, /Benchmark evidence:/);
    assert.match(measured.stdout, /Precision 100% \(95% 56\.6%–100%\) over 5 labelled finding\(s\)\./);

    const unmeasured = spawnSync(process.execPath, [CLI, 'explain', 'DQ007'], { encoding: 'utf8' });
    assert.equal(unmeasured.status, 0, unmeasured.stderr);
    assert.match(unmeasured.stdout, /carries no benchmark evidence/);

    const json = JSON.parse(spawnSync(process.execPath, [CLI, 'explain', 'SEC005', '--format', 'json'], { encoding: 'utf8' }).stdout);
    assert.equal(json.precisionEvidence.status, 'measured');
    assert.equal(JSON.parse(spawnSync(process.execPath, [CLI, 'explain', 'DQ007', '--format', 'json'], { encoding: 'utf8' }).stdout).precisionEvidence.status, 'not-measured');
  });
});

describe('shipped evidence artifact', () => {
  it('matches the projection from the reviewed baseline, so a stale number cannot ship', () => {
    assert.equal(readFileSync(resolve(EVIDENCE_MODULE_PATH), 'utf8'), renderEvidenceModule(evidenceProjection()),
      `${EVIDENCE_MODULE_PATH} is stale — run: npm run generate:precision-evidence`);
    assert.deepEqual(PRECISION_EVIDENCE, JSON.parse(JSON.stringify(evidenceProjection())));
  });

  it('ships inside the published package, unlike the benchmark it derives from', () => {
    const files = JSON.parse(readFileSync(resolve('package.json'), 'utf8')).files;
    assert.ok(files.some(entry => EVIDENCE_MODULE_PATH.startsWith(entry)), 'the evidence module must be packaged');
    assert.equal(files.some(entry => entry.startsWith('benchmarks')), false, 'the corpus deliberately stays out of the package');
  });

  it('carries the reviewed baseline\'s own provenance, not a freshly invented one', () => {
    const reviewed = baseline();
    assert.equal(PRECISION_EVIDENCE.caveat, reviewed.review.caveat);
    assert.equal(PRECISION_EVIDENCE.measures, reviewed.review.measures);
    assert.equal(PRECISION_EVIDENCE.source.toolVersion, reviewed.core.tool.version);
    assert.equal(PRECISION_EVIDENCE.source.manifestDigest, reviewed.core.manifestDigest);
    assert.equal(PRECISION_EVIDENCE.source.reviewedAt, reviewed.review.reviewedAt);
  });
});

describe('architecture evidence', () => {
  it('measures ARC001 from the Python layer-boundary pair instead of reporting not-measured', () => {
    const cell = PRECISION_EVIDENCE.byCode.ARC001;
    assert.ok(cell, 'ARC001 must carry a per-code cell once the corpus measures it');
    assert.equal(cell.status, 'measured');
    assert.equal(isMeasured('ARC001'), true);
    assert.deepEqual(cell.validators, ['architecture']);
    assert.equal(cell.cases, 2, 'one defect and its opposite clean control');
    assert.equal(cell.truePositives, 1);
    assert.equal(cell.falsePositives, 0);
    assert.equal(cell.cleanControls, 1);
    assert.equal(cell.cleanControlsWithFindings, 0, 'the control must stay quiet');
  });

  it('refuses to quote ARC001 on its own below the reporting floor and names the tier it falls back to', () => {
    const cell = PRECISION_EVIDENCE.byCode.ARC001;
    assert.ok(cell.precisionDenominator < DEFAULT_MIN_N);
    assert.equal(cell.quotable, false, 'a single labelled finding cannot publish a rate');
    assert.ok(cell.precisionInterval[0] < 1, 'the Wilson lower bound is the honest read');
    assert.ok(cell.backoff, 'a measured cell below the floor names a coarser measured tier');
    assert.ok(['validator', 'aggregate'].includes(cell.backoff.tier));
    assert.match(describeEvidenceForCode('ARC001').join(' '), /Measured on 2 labelled case/);
  });

  it('still reports the other architecture codes as never benchmarked', () => {
    for (const code of ['ARC002', 'ARC003']) {
      assert.ok(CODES[code], `${code} must still be a defined finding code`);
      assert.equal(PRECISION_EVIDENCE.byCode[code], undefined, `${code} has no case and must not appear`);
      assert.equal(isMeasured(code), false);
      assert.equal(evidenceForCode(code).status, 'not-measured',
        `${code} must not inherit ARC001's measurement just because they share the architecture validator`);
    }
  });
});

describe('precision evidence schema', () => {
  it('is a strict draft 2020-12 contract that forbids a number on an unmeasured code', () => {
    const contract = schema();
    assert.equal(contract.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.equal(contract.additionalProperties, false);
    assert.equal(contract.$defs.measures.const, 'benchmark-precision');
    const notMeasured = contract.$defs.codeEvidence.oneOf.find(item => item.title === 'Not measured');
    assert.equal(notMeasured.additionalProperties, false);
    // `adjudicated` is the one thing an unmeasured code MAY carry: a count of
    // reviewed disagreements. It is not a rate and cannot become one — the
    // schema still admits no numeric evidence field here.
    assert.deepEqual(Object.keys(notMeasured.properties).sort(), ['adjudicated', 'reason', 'status']);
    assert.deepEqual(Object.keys(notMeasured.properties.adjudicated.$ref ? { ref: 1 } : notMeasured.properties.adjudicated), ['ref'],
      'the unmeasured shape references the shared adjudicated counter rather than inlining a number');
  });

  it('names every field the derivation emits on a cell and on the artifact', () => {
    const contract = schema();
    const cellFields = Object.keys(PRECISION_EVIDENCE.aggregate).sort();
    assert.deepEqual(contract.$defs.cell.required.slice().sort(), cellFields);
    assert.deepEqual(Object.keys(contract.$defs.cell.properties).sort(), cellFields);
    assert.deepEqual(contract.$defs.artifact.required.slice().sort(), Object.keys(PRECISION_EVIDENCE).sort());
    const block = precisionEvidenceBlock(['SEC005'], '0.41.7');
    assert.deepEqual(contract.required.slice().sort(), Object.keys(block).sort());
    assert.deepEqual(Object.keys(contract.properties.source.properties).sort(), Object.keys(block.source).sort());
    assert.deepEqual(contract.properties.coverage.required.slice().sort(), Object.keys(block.coverage).sort());
  });
});
