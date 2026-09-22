/**
 * Derives per-code benchmark evidence from a reviewed baseline envelope.
 *
 * The unit of evidence is the finding code, never the validator. DocGuard
 * defines far more codes than the corpus measures, so attributing a validator's
 * measured precision to an unmeasured code in the same validator would invent
 * evidence. An unmeasured code therefore reports `not-measured` and carries no
 * number and no backoff. A code that WAS measured may back off to a coarser
 * measured tier when its own denominator is below `minN`, because that tier is
 * the same measured family; each backoff says which tier it came from.
 *
 * @implements docguard.precision-evidence-loop#FR-019
 */

import { wilsonInterval } from './metrics.mjs';
import { BASELINE_MEASURES, benchmarkCaveat } from './baseline.mjs';

export const PRECISION_EVIDENCE_SCHEMA_URL = 'https://raccioly.github.io/docguard/schemas/docguard-precision-evidence.schema.json';
export const PRECISION_EVIDENCE_SCHEMA_VERSION = 1;
/**
 * Smallest precision denominator DocGuard will quote a point estimate from.
 * Matches the floor websec-validator publishes; below it a cell still carries
 * its counts and interval, marked not quotable.
 */
// Reporting floor for a quotable point estimate — a judgement about how few
// labelled findings may carry a headline rate, NOT a value fitted to data.
// Any data-derived replacement MUST be fitted against a strictly proper
// scoring rule — docguard.calibrated-finding-channels#FR-018.
export const DEFAULT_MIN_N = 5;

const MEASURED = new Set(['defect', 'clean_control']);

/**
 * Classifications that record a reviewed DISAGREEMENT rather than a measurement.
 *
 * A `policy_disagreement` is a case where the detector fired as designed and a
 * user disagreed with the design; `ambiguous` is one the maintainers could not
 * adjudicate either way. Neither may touch a precision or recall denominator
 * (precision-evidence-loop#FR-003) — but both must be VISIBLE, because the
 * previous pipeline could only absorb a false positive that had already been
 * fixed, which made "precision 1.0" a property of the process rather than an
 * observation about the detectors.
 * @implements docguard.calibrated-finding-channels#FR-016
 */
const ADJUDICATED = Object.freeze({ policy_disagreement: 'policyDisagreements', ambiguous: 'ambiguous' });
const emptyAdjudicated = () => ({ policyDisagreements: 0, ambiguous: 0 });
const codeOf = identity => identity.split('@')[0];
const ratio = (numerator, denominator) => (denominator === 0 ? null : Number((numerator / denominator).toFixed(6)));
const interval = value => (value === null ? null : [value.lower, value.upper]);

function emptyCell() {
  return {
    cases: 0,
    truePositives: 0,
    falsePositives: 0,
    falseNegatives: 0,
    cleanControls: 0,
    cleanControlsWithFindings: 0,
    repositoryGroups: new Set(),
    causalFamilies: new Set(),
  };
}

function finalize(cell, minN) {
  const precisionDenominator = cell.truePositives + cell.falsePositives;
  const recallDenominator = cell.truePositives + cell.falseNegatives;
  const quotable = precisionDenominator >= minN;
  return {
    cases: cell.cases,
    repositoryGroups: cell.repositoryGroups.size,
    causalFamilies: cell.causalFamilies.size,
    truePositives: cell.truePositives,
    falsePositives: cell.falsePositives,
    falseNegatives: cell.falseNegatives,
    cleanControls: cell.cleanControls,
    cleanControlsWithFindings: cell.cleanControlsWithFindings,
    precisionDenominator,
    precision: ratio(cell.truePositives, precisionDenominator),
    precisionInterval: interval(wilsonInterval(cell.truePositives, precisionDenominator)),
    recall: ratio(cell.truePositives, recallDenominator),
    recallInterval: interval(wilsonInterval(cell.truePositives, recallDenominator)),
    quotable,
    // Why a reader must not repeat the point estimate on its own. Null when they may.
    notQuotableReason: quotable ? null : `Only ${precisionDenominator} labelled finding(s) behind this rate; DocGuard does not quote a point estimate below ${minN}.`,
  };
}

function accumulate(cell, item) {
  cell.cases++;
  cell.repositoryGroups.add(item.repositoryGroup);
  cell.causalFamilies.add(item.causalFamily);
  if (item.classification === 'clean_control') {
    cell.cleanControls++;
    if (item.unexpected.length > 0) cell.cleanControlsWithFindings++;
  }
}

/**
 * Per-code, per-validator and aggregate cells. True/false positives and
 * negatives are attributed by finding identity, which names its own code, so a
 * case scoped to several codes never smears one code's errors onto another.
 */
export function derivePrecisionEvidence(baseline, { minN = DEFAULT_MIN_N } = {}) {
  if (!Number.isInteger(minN) || minN < 1) throw new Error('minN must be a positive integer.');
  const cases = baseline.core.cases;
  const byCode = new Map();
  const byValidator = new Map();
  const aggregate = emptyCell();
  const codeCell = code => {
    if (!byCode.has(code)) byCode.set(code, { cell: emptyCell(), validators: new Set() });
    return byCode.get(code);
  };
  // Adjudications are tracked for EVERY code in the corpus, including codes
  // that no measured case exercises — "never measured, three disagreements on
  // record" is a more useful answer than either half alone.
  const adjudicatedByCode = new Map();
  const adjudicatedTotals = emptyAdjudicated();
  for (const item of cases) {
    const field = ADJUDICATED[item.classification];
    if (!field) continue;
    adjudicatedTotals[field]++;
    for (const code of item.scope.codes) {
      if (!adjudicatedByCode.has(code)) adjudicatedByCode.set(code, emptyAdjudicated());
      adjudicatedByCode.get(code)[field]++;
    }
  }
  const validatorCell = key => {
    if (!byValidator.has(key)) byValidator.set(key, emptyCell());
    return byValidator.get(key);
  };

  for (const item of cases) {
    if (!MEASURED.has(item.classification)) continue;
    accumulate(aggregate, item);
    accumulate(validatorCell(item.scope.validatorKey), item);
    for (const code of item.scope.codes) {
      const entry = codeCell(code);
      entry.validators.add(item.scope.validatorKey);
      accumulate(entry.cell, item);
    }
    const bump = (identities, field) => {
      for (const identity of identities) {
        const code = codeOf(identity);
        aggregate[field]++;
        validatorCell(item.scope.validatorKey)[field]++;
        codeCell(code).cell[field]++;
      }
    };
    bump(item.actual.filter(identity => item.expected.includes(identity)), 'truePositives');
    bump(item.unexpected, 'falsePositives');
    bump(item.missing, 'falseNegatives');
  }

  const validators = Object.fromEntries([...byValidator]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, cell]) => [key, finalize(cell, minN)]));
  const aggregateCell = finalize(aggregate, minN);

  const codes = Object.fromEntries([...byCode]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, { cell, validators: keys }]) => {
      const finalized = finalize(cell, minN);
      const validatorKey = [...keys].sort()[0];
      let backoff = null;
      if (!finalized.quotable) {
        // Only a MEASURED code may back off, and only to a tier that is itself quotable.
        if (validators[validatorKey]?.quotable) backoff = { tier: 'validator', key: validatorKey, ...validators[validatorKey] };
        else if (aggregateCell.quotable) backoff = { tier: 'aggregate', key: 'all-measured-codes', ...aggregateCell };
      }
      return [code, {
        status: 'measured',
        validators: [...keys].sort(),
        ...finalized,
        backoff,
        adjudicated: adjudicatedByCode.get(code) || emptyAdjudicated(),
      }];
    }));

  // A code that appears ONLY in adjudication rows still earns an entry: it has
  // no measurement, and saying so beside the disagreement count is the honest
  // report. It never inherits a number from anywhere.
  for (const [code, adjudicated] of [...adjudicatedByCode].sort(([a], [b]) => a.localeCompare(b))) {
    if (codes[code]) continue;
    codes[code] = { status: 'not-measured', adjudicated };
  }

  return {
    $schema: PRECISION_EVIDENCE_SCHEMA_URL,
    schemaVersion: PRECISION_EVIDENCE_SCHEMA_VERSION,
    measures: BASELINE_MEASURES,
    caveat: benchmarkCaveat(cases),
    minN,
    source: {
      manifestDigest: baseline.core.manifestDigest,
      toolVersion: baseline.core.tool.version,
      toolRevision: baseline.core.tool.revision,
      reviewStatus: baseline.review.status,
      reviewedAt: baseline.review.reviewedAt ?? null,
      reviewer: baseline.review.reviewer ?? null,
      limitations: baseline.review.limitations,
    },
    aggregate: aggregateCell,
    // Corpus-wide adjudicated disagreements. Deliberately a sibling of
    // `aggregate` rather than a field inside it: these counts share none of
    // that object's denominators and must never be mistaken for one.
    adjudicated: adjudicatedTotals,
    byValidator: validators,
    byCode: codes,
  };
}
