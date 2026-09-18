/**
 * Answers "has this finding code ever been benchmarked, and what was measured?"
 *
 * DocGuard defines many more finding codes than its corpus measures. The unit
 * of evidence is therefore the code: a code the corpus never exercised reports
 * `not-measured` and carries no number, and it does NOT inherit the measured
 * precision of other codes in the same validator. Only a code that was itself
 * measured may fall back to a coarser measured tier, and the fallback names the
 * tier it came from.
 *
 * @implements docguard.precision-evidence-loop#FR-019
 */

import { PRECISION_EVIDENCE } from './precision-evidence-data.mjs';

export { PRECISION_EVIDENCE };

const NOT_MEASURED = Object.freeze({
  status: 'not-measured',
  reason: 'No benchmark case exercises this finding code, so DocGuard has measured no precision for it.',
});

/** The reviewed evidence for one code, or an explicit not-measured answer. */
export function evidenceForCode(code) {
  if (typeof code !== 'string' || !code) return NOT_MEASURED;
  return PRECISION_EVIDENCE.byCode[code] || NOT_MEASURED;
}

export function isMeasured(code) {
  return evidenceForCode(code).status === 'measured';
}

/**
 * The provenance block guard attaches to its result, scoped to the codes that
 * actually appear in the run so the report stays about this project.
 * @param {string[]} codes finding codes present in the run
 * @param {string} runningVersion the version of DocGuard producing the report
 */
export function precisionEvidenceBlock(codes, runningVersion) {
  const present = [...new Set((codes || []).filter(code => typeof code === 'string' && code))].sort();
  const entries = present.map(code => [code, evidenceForCode(code)]);
  const measured = entries.filter(([, value]) => value.status === 'measured');
  return {
    measures: PRECISION_EVIDENCE.measures,
    caveat: PRECISION_EVIDENCE.caveat,
    minN: PRECISION_EVIDENCE.minN,
    source: {
      toolVersion: PRECISION_EVIDENCE.source.toolVersion,
      toolRevision: PRECISION_EVIDENCE.source.toolRevision,
      reviewStatus: PRECISION_EVIDENCE.source.reviewStatus,
      reviewedAt: PRECISION_EVIDENCE.source.reviewedAt,
      runningVersion: runningVersion ?? null,
      // False means the numbers were measured on a different build than this one.
      matchesRunningVersion: Boolean(runningVersion) && runningVersion === PRECISION_EVIDENCE.source.toolVersion,
    },
    coverage: {
      codesInRun: present.length,
      measured: measured.length,
      notMeasured: present.length - measured.length,
      quotable: measured.filter(([, value]) => value.quotable).length,
    },
    codes: Object.fromEntries(entries),
  };
}

const percent = value => `${Math.round(value * 1000) / 10}%`;
const bounds = pair => `${percent(pair[0])}–${percent(pair[1])}`;

/**
 * Human-readable evidence for one code, as lines. Returns the not-measured
 * statement rather than nothing, because "we have not measured this" is the
 * answer a reader needs most often.
 */
export function describeEvidenceForCode(code, runningVersion) {
  const evidence = evidenceForCode(code);
  if (evidence.status !== 'measured') {
    return [
      'This code carries no benchmark evidence: no case in the reviewed corpus exercises it.',
      'A finding from it may still be correct; DocGuard has simply never measured how often it is.',
    ];
  }
  const lines = [];
  const controls = evidence.cleanControls - evidence.cleanControlsWithFindings;
  lines.push(`Measured on ${evidence.cases} labelled case(s) across ${evidence.repositoryGroups} repository group(s): `
    + `${evidence.truePositives} true positive(s), ${evidence.falsePositives} false positive(s), ${evidence.falseNegatives} missed.`);
  lines.push(`${controls} of ${evidence.cleanControls} paired clean control(s) stayed quiet.`);
  if (evidence.quotable) {
    lines.push(`Precision ${percent(evidence.precision)} (95% ${bounds(evidence.precisionInterval)}) over ${evidence.precisionDenominator} labelled finding(s).`);
  } else {
    lines.push(`Too few labelled findings (${evidence.precisionDenominator}, floor ${PRECISION_EVIDENCE.minN}) to quote a rate for this code on its own; `
      + `the 95% interval alone is ${bounds(evidence.precisionInterval)}.`);
    if (evidence.backoff) {
      const tier = evidence.backoff.tier === 'validator' ? `Its validator (${evidence.backoff.key})` : 'The whole measured corpus';
      lines.push(`${tier} reports ${percent(evidence.backoff.precision)} (95% ${bounds(evidence.backoff.precisionInterval)}) `
        + `over ${evidence.backoff.precisionDenominator} labelled finding(s).`);
    }
  }
  if (runningVersion && runningVersion !== PRECISION_EVIDENCE.source.toolVersion) {
    lines.push(`Measured on DocGuard ${PRECISION_EVIDENCE.source.toolVersion}; you are running ${runningVersion}.`);
  }
  lines.push(PRECISION_EVIDENCE.caveat);
  return lines;
}
