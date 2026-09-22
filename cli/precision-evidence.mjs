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
import { computeDetectorsDigest } from './detector-digest.mjs';

export { PRECISION_EVIDENCE };

const NOT_MEASURED = Object.freeze({
  status: 'not-measured',
  reason: 'No benchmark case exercises this finding code, so DocGuard has measured no precision for it.',
  adjudicated: Object.freeze({ policyDisagreements: 0, ambiguous: 0 }),
});

/** Adjudicated disagreements on record for a code; zeros when there are none. */
export function adjudicatedForCode(code) {
  const entry = evidenceForCode(code);
  return entry.adjudicated || { policyDisagreements: 0, ambiguous: 0 };
}

/**
 * One line describing reviewed disagreements, or null when there are none.
 *
 * These are deliberately reported as counts beside a rate, never inside it:
 * a case where the detector fired as designed and a user disagreed belongs in
 * neither the numerator nor the denominator of precision.
 * @implements docguard.calibrated-finding-channels#FR-016
 */
export function describeAdjudications(code) {
  const { policyDisagreements, ambiguous } = adjudicatedForCode(code);
  const parts = [];
  if (policyDisagreements > 0) parts.push(`${policyDisagreements} reviewed policy disagreement(s)`);
  if (ambiguous > 0) parts.push(`${ambiguous} case(s) the maintainers could not adjudicate`);
  if (parts.length === 0) return null;
  return `${parts.join(' and ')} on record for this code; counted separately and excluded from every rate above.`;
}

/**
 * Whether the detectors that just ran are the ones the corpus measured.
 *
 * Returns 'unchanged' | 'changed' | 'unknown'. Only consulted when the version
 * strings already disagree, so a matching build pays nothing; when they do
 * disagree it costs one pass over the shipped detector sources (~1.2ms), which
 * is the difference between "these numbers still apply" and a false alarm that
 * makes every new release look uncalibrated.
 *
 * 'unknown' (no recorded digest, or an unreadable install) falls back to the
 * plain version-skew wording -- never to a claim the detectors are unchanged.
 */
export function detectorCalibration(computed = computeDetectorsDigest()) {
  const recorded = PRECISION_EVIDENCE.source.detectorsDigest;
  if (!recorded || !computed) return 'unknown';
  return recorded === computed ? 'unchanged' : 'changed';
}

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
      // The question a version string cannot answer: do these numbers describe
      // the code that just ran? A docs-only or CLI-shell release leaves every
      // detector byte-identical and every measurement exactly as valid.
      detectorsDigest: PRECISION_EVIDENCE.source.detectorsDigest ?? null,
      detectorCalibration: detectorCalibration(),
    },
    coverage: {
      codesInRun: present.length,
      measured: measured.length,
      notMeasured: present.length - measured.length,
      quotable: measured.filter(([, value]) => value.quotable).length,
      // Reviewed disagreements touching the codes in THIS run — visible
      // without ever entering a precision denominator.
      adjudicated: entries.reduce((sum, [, value]) => sum
        + ((value.adjudicated?.policyDisagreements || 0) + (value.adjudicated?.ambiguous || 0)), 0),
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
    const lines = [
      'This code carries no benchmark evidence: no case in the reviewed corpus exercises it.',
      'A finding from it may still be correct; DocGuard has simply never measured how often it is.',
    ];
    const adjudications = describeAdjudications(code);
    if (adjudications) lines.push(adjudications);
    return lines;
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
  const adjudications = describeAdjudications(code);
  if (adjudications) lines.push(adjudications);
  if (runningVersion && runningVersion !== PRECISION_EVIDENCE.source.toolVersion) {
    const calibration = detectorCalibration();
    const measured = `Measured on DocGuard ${PRECISION_EVIDENCE.source.toolVersion}; you are running ${runningVersion}`;
    lines.push(calibration === 'unchanged'
      ? `${measured} — the detectors are byte-identical to the measured build, so this number still applies.`
      : calibration === 'changed'
        ? `${measured}, and the detectors changed since that measurement, so this number may no longer hold.`
        : `${measured}.`);
  }
  lines.push(PRECISION_EVIDENCE.caveat);
  return lines;
}
